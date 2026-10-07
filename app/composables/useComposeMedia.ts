/**
 * Shared compose media attachments — drag/drop, paste, upload, previews, alt text.
 */

import type { mastodon } from 'masto'
import { markRaw } from 'vue'
import { useStatusStore } from '~/stores/status'
import { CHART_ALT_MAX } from '~/utils/loomHandoff'

export interface ComposeAttachment {
  localId: string
  file: File
  previewUrl: string
  remoteId: string | null
  uploading: boolean
  error: string | null
  /** Accessibility description sent to Mastodon as media description */
  description: string
}

const MAX_ATTACHMENTS = 4
const MAX_FILE_BYTES = 40 * 1024 * 1024 // Mastodon default often 40MB images
const ACCEPT = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/i
export const COMPOSE_MEDIA_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime'

function uid() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function useComposeMedia() {
  const statusStore = useStatusStore()
  const attachments = ref<ComposeAttachment[]>([])
  const isDragging = ref(false)
  let dragDepth = 0
  const altTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
  const canAddMore = computed(() => attachments.value.length < MAX_ATTACHMENTS)

  const revokeAll = () => {
    for (const a of attachments.value) {
      if (a.previewUrl.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl)
    }
  }

  const removeAttachment = (localId: string) => {
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
    for (const t of altTimers.values()) clearTimeout(t)
    altTimers.clear()
    revokeAll()
    attachments.value = []
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
    try {
      const remote = await statusStore.uploadMedia(
        draft.file,
        draft.description.trim() || undefined,
      )
      const current = attachments.value.find((a) => a.localId === localId)
      if (!current) return
      current.remoteId = remote.id
      // Prefer server preview if available
      if (remote.previewUrl) {
        if (current.previewUrl.startsWith('blob:')) URL.revokeObjectURL(current.previewUrl)
        current.previewUrl = remote.previewUrl
      }
    } catch (e: any) {
      patchAttachment(localId, {
        error: e?.message || 'Upload failed',
        remoteId: null,
      })
    } finally {
      patchAttachment(localId, { uploading: false })
    }
  }

  type RejectedFile = { name: string; reason: string }

  /**
   * @param descriptions Optional parallel alt-text hints (e.g. Loom chart title).
   * @returns Accepted count and rejected files with reasons (for toasts).
   */
  const addFiles = async (
    files: FileList | File[] | null | undefined,
    descriptions?: (string | null | undefined)[],
  ): Promise<{ accepted: number; rejected: RejectedFile[] }> => {
    const rejected: RejectedFile[] = []
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

    const room = MAX_ATTACHMENTS - attachments.value.length
    if (room <= 0) {
      for (const file of list) {
        rejected.push({ name: file.name, reason: 'Attachment limit reached (4)' })
      }
      return { accepted: 0, rejected }
    }

    // Filter first so oversize/wrong-type don't consume slots
    const candidates: { file: File; hint?: string | null }[] = []
    list.forEach((file, i) => {
      if (!ACCEPT.test(file.type)) {
        rejected.push({ name: file.name, reason: 'Unsupported file type' })
        return
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected.push({ name: file.name, reason: 'File too large (max 40MB)' })
        return
      }
      candidates.push({ file, hint: descriptions?.[i] })
    })

    const take = candidates.slice(0, room)
    for (const extra of candidates.slice(room)) {
      rejected.push({ name: extra.file.name, reason: 'Attachment limit reached (4)' })
    }

    const accepted: ComposeAttachment[] = take.map(({ file, hint }) => ({
      localId: uid(),
      file: markRaw(file),
      previewUrl: URL.createObjectURL(file),
      remoteId: null,
      uploading: true,
      error: null,
      description: (hint || '').trim().slice(0, CHART_ALT_MAX),
    }))

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
      description: value.slice(0, CHART_ALT_MAX),
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
        void statusStore.updateMediaDescription(current.remoteId, current.description.trim())
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
      if (item.kind === 'file' && ACCEPT.test(item.type)) {
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
    maxAttachments: MAX_ATTACHMENTS,
    altMax: CHART_ALT_MAX,
    addFiles,
    retryUpload,
    removeAttachment,
    clearAttachments,
    setDescription,
    flushAltDescriptions,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    onPaste,
  }
}

export type { mastodon }
