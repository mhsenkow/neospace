/**
 * Shared compose media attachments — drag/drop, paste, upload, previews, alt text.
 */

import { markRaw } from 'vue'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import {
  COMPOSE_IMAGE_ACCEPT,
  COMPOSE_MAX_IMAGE_DIMENSION,
  COMPOSE_MEDIA_ACCEPT,
  DEFAULT_MAX_ATTACHMENTS,
  DEFAULT_MAX_FILE_BYTES,
  MEDIA_ALT_MAX,
  uploadTimeoutForBytes,
} from '~/utils/composeConstants'

export type ComposeAttachmentSource = 'user' | 'handoff'

export interface ComposeAttachment {
  localId: string
  file: File
  previewUrl: string
  remoteId: string | null
  uploading: boolean
  error: string | null
  /** Accessibility description sent to Mastodon as media description */
  description: string
  source: ComposeAttachmentSource
}

type RejectedFile = { name: string; reason: string }

function uid() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function downscaleImageFile(file: File, maxDim = COMPOSE_MAX_IMAGE_DIMENSION): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  if (typeof createImageBitmap === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    if (bitmap.width <= maxDim && bitmap.height <= maxDim) {
      bitmap.close()
      return file
    }
    const scale = maxDim / Math.max(bitmap.width, bitmap.height)
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outType, outType === 'image/jpeg' ? 0.92 : undefined)
    })
    if (!blob) return file
    const ext = outType === 'image/png' ? '.png' : '.jpg'
    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${base}${ext}`, { type: outType })
  } catch {
    return file
  }
}

export function useComposeMedia() {
  const statusStore = useStatusStore()
  const instancesStore = useInstancesStore()
  const attachments = ref<ComposeAttachment[]>([])
  const isDragging = ref(false)
  const uploadAnnounce = ref('')
  let dragDepth = 0
  const altTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const uploadControllers = new Map<string, AbortController>()

  const maxAttachments = computed(
    () => instancesStore.composeMediaLimits.maxAttachments,
  )
  const maxFileBytes = computed(() => instancesStore.composeMediaLimits.maxFileBytes)
  const altMax = computed(() => instancesStore.composeMediaLimits.altMax)

  const isUploading = computed(() => attachments.value.some((a) => a.uploading))
  const hasMedia = computed(() => attachments.value.length > 0)
  const mediaIds = computed(() =>
    attachments.value.map((a) => a.remoteId).filter((id): id is string => !!id),
  )
  const allReady = computed(
    () =>
      attachments.value.length === 0 ||
      attachments.value.every((a) => a.remoteId && !a.uploading && !a.error),
  )
  const canAddMore = computed(() => attachments.value.length < maxAttachments.value)

  const announce = (message: string) => {
    uploadAnnounce.value = ''
    nextTick(() => {
      uploadAnnounce.value = message
    })
  }

  const abortUpload = (localId: string) => {
    uploadControllers.get(localId)?.abort()
    uploadControllers.delete(localId)
  }

  const revokeAll = () => {
    for (const a of attachments.value) {
      if (a.previewUrl.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl)
    }
  }

  const removeAttachment = (localId: string) => {
    abortUpload(localId)
    const timer = altTimers.get(localId)
    if (timer) {
      clearTimeout(timer)
      altTimers.delete(localId)
    }
    const idx = attachments.value.findIndex((a) => a.localId === localId)
    if (idx === -1) return
    const [gone] = attachments.value.splice(idx, 1)
    if (gone?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(gone.previewUrl)
  }

  const clearAttachments = () => {
    for (const a of attachments.value) abortUpload(a.localId)
    uploadControllers.clear()
    for (const t of altTimers.values()) clearTimeout(t)
    altTimers.clear()
    revokeAll()
    attachments.value = []
  }

  const clearHandoffAttachments = () => {
    for (const a of attachments.value.filter((x) => x.source === 'handoff')) {
      removeAttachment(a.localId)
    }
  }

  /** Always mutate via attachments.value so Vue tracks uploading/error/remoteId. */
  const patchAttachment = (localId: string, patch: Partial<ComposeAttachment>) => {
    const draft = attachments.value.find((a) => a.localId === localId)
    if (!draft) return null
    Object.assign(draft, patch)
    return draft
  }

  const uploadOne = async (localId: string) => {
    const draft = patchAttachment(localId, { uploading: true, error: null })
    if (!draft) return
    abortUpload(localId)
    const controller = new AbortController()
    uploadControllers.set(localId, controller)
    const label = draft.file.name || 'Attachment'
    announce(`Uploading ${label}`)
    try {
      const remote = await statusStore.uploadMedia(
        draft.file,
        draft.description.trim() || undefined,
        {
          signal: controller.signal,
          timeoutMs: uploadTimeoutForBytes(draft.file.size),
        },
      )
      if (controller.signal.aborted) return
      const current = attachments.value.find((a) => a.localId === localId)
      if (!current) return
      current.remoteId = remote.id
      announce(`${label} uploaded`)
    } catch (e: any) {
      if (controller.signal.aborted) return
      const msg = e?.message || 'Upload failed'
      patchAttachment(localId, {
        error: msg,
        remoteId: null,
      })
      announce(`${label} upload failed`)
    } finally {
      uploadControllers.delete(localId)
      patchAttachment(localId, { uploading: false })
    }
  }

  /**
   * @param descriptions Optional parallel alt-text hints (e.g. Loom chart title).
   * @returns Accepted count and rejected files with reasons (for toasts).
   */
  const addFiles = async (
    files: FileList | File[] | null | undefined,
    descriptions?: (string | null | undefined)[],
    opts?: { source?: ComposeAttachmentSource },
  ): Promise<{ accepted: number; rejected: RejectedFile[] }> => {
    const rejected: RejectedFile[] = []
    const source = opts?.source ?? 'user'
    if (!files || files.length === 0) return { accepted: 0, rejected }

    const list = Array.from(files)
    const hasVideo = (f: File) => /^video\//i.test(f.type)
    const incomingVideo = list.some(hasVideo)
    const existingVideo = attachments.value.some((a) => hasVideo(a.file))
    if (incomingVideo && (attachments.value.length > 0 || list.length > 1)) {
      for (const file of list) {
        rejected.push({
          name: file.name,
          reason: 'Video must be the only attachment',
        })
      }
      return { accepted: 0, rejected }
    }
    if (existingVideo) {
      for (const file of list) {
        rejected.push({
          name: file.name,
          reason: 'Remove the video before adding other files',
        })
      }
      return { accepted: 0, rejected }
    }

    const limit = maxAttachments.value
    const maxBytes = maxFileBytes.value
    const room = limit - attachments.value.length
    if (room <= 0) {
      for (const file of list) {
        rejected.push({ name: file.name, reason: `Attachment limit reached (${limit})` })
      }
      return { accepted: 0, rejected }
    }

    const candidates: { file: File; hint?: string | null }[] = []
    let descIdx = 0
    for (const file of list) {
      if (!COMPOSE_IMAGE_ACCEPT.test(file.type)) {
        rejected.push({ name: file.name, reason: 'Unsupported file type' })
        descIdx += 1
        continue
      }
      if (file.size > maxBytes) {
        const mb = Math.round(maxBytes / (1024 * 1024))
        rejected.push({ name: file.name, reason: `File too large (max ${mb}MB)` })
        descIdx += 1
        continue
      }
      candidates.push({ file, hint: descriptions?.[descIdx] })
      descIdx += 1
    }

    const take = candidates.slice(0, room)
    for (const extra of candidates.slice(room)) {
      rejected.push({ name: extra.file.name, reason: `Attachment limit reached (${limit})` })
    }

    const accepted: ComposeAttachment[] = []
    for (const { file, hint } of take) {
      const prepared = file.type.startsWith('image/') ? await downscaleImageFile(file) : file
      accepted.push({
        localId: uid(),
        file: markRaw(prepared),
        previewUrl: URL.createObjectURL(prepared),
        remoteId: null,
        uploading: true,
        error: null,
        description: (hint || '').trim().slice(0, altMax.value),
        source,
      })
    }

    if (accepted.length === 0) return { accepted: 0, rejected }
    attachments.value.push(...accepted)
    await Promise.all(accepted.map((a) => uploadOne(a.localId)))

    if (rejected.length && typeof window !== 'undefined') {
      try {
        const { useToastStore } = await import('~/stores/toast')
        const first = rejected[0]!
        const more = rejected.length > 1 ? ` (+${rejected.length - 1} more)` : ''
        useToastStore().show({
          message: `${first.name}: ${first.reason}${more}`,
        })
      } catch {
        /* toast optional */
      }
    }

    return { accepted: accepted.length, rejected }
  }

  const retryUpload = async (localId: string) => {
    const draft = attachments.value.find((a) => a.localId === localId)
    if (!draft || draft.uploading) return
    await uploadOne(localId)
  }

  const setDescription = (localId: string, value: string) => {
    const draft = patchAttachment(localId, {
      description: value.slice(0, altMax.value),
    })
    if (!draft?.remoteId) return

    const prev = altTimers.get(localId)
    if (prev) clearTimeout(prev)
    altTimers.set(
      localId,
      setTimeout(() => {
        altTimers.delete(localId)
        const current = attachments.value.find((a) => a.localId === localId)
        if (!current?.remoteId) return
        void statusStore
          .updateMediaDescription(current.remoteId, current.description.trim())
          .catch(async () => {
            try {
              const { useToastStore } = await import('~/stores/toast')
              useToastStore().show({ message: 'Alt text not saved · tap to retry', duration: 4000 })
            } catch {
              /* toast optional */
            }
          })
      }, 450),
    )
  }

  /** Flush pending alt-text PUTs before post (⌘↵ races the 450ms debounce) */
  const flushAltDescriptions = async () => {
    const pending: Promise<unknown>[] = []
    for (const [localId, timer] of altTimers) {
      clearTimeout(timer)
      altTimers.delete(localId)
      const current = attachments.value.find((a) => a.localId === localId)
      if (!current?.remoteId) continue
      pending.push(
        statusStore.updateMediaDescription(current.remoteId, current.description.trim()),
      )
    }
    if (pending.length) await Promise.allSettled(pending)
  }

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    dragDepth += 1
    isDragging.value = true
  }

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault()
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) isDragging.value = false
  }

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = async (e: DragEvent) => {
    const dt = e.dataTransfer
    if (!dt?.types?.includes('Files') || !dt.files?.length) return
    e.preventDefault()
    dragDepth = 0
    isDragging.value = false
    await addFiles(dt.files)
  }

  const onPaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const hasText = Array.from(items).some(
      (item) => item.kind === 'string' && item.type === 'text/plain',
    )
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && COMPOSE_IMAGE_ACCEPT.test(item.type)) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length === 0) return
    if (hasText) return
    e.preventDefault()
    await addFiles(files)
  }

  onUnmounted(() => {
    for (const a of attachments.value) abortUpload(a.localId)
    uploadControllers.clear()
    for (const t of altTimers.values()) clearTimeout(t)
    altTimers.clear()
    revokeAll()
  })

  return {
    attachments,
    isDragging,
    isUploading,
    hasMedia,
    mediaIds,
    allReady,
    canAddMore,
    maxAttachments,
    altMax,
    uploadAnnounce,
    addFiles,
    retryUpload,
    removeAttachment,
    clearAttachments,
    clearHandoffAttachments,
    setDescription,
    flushAltDescriptions,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    onPaste,
  }
}

