/**
 * Shared compose media attachments — drag/drop, paste, upload, previews, alt text.
 */

import { markRaw } from 'vue'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import { useSettingsStore } from '~/stores/settings'
import {
  COMPOSE_IMAGE_ACCEPT,
  formatByteSize,
  normalizeMediaUploadQuality,
  prepareComposeImage,
  uploadTimeoutForBytes,
} from '~/utils/composeConstants'
import { PEERTUBE_JOIN_URL } from '~/utils/peertube'

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
  /** Client-side shrink before upload (null for video / skipped) */
  optimizeHint: string | null
}

type RejectedFile = { name: string; reason: string }

function uid() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function useComposeMedia() {
  const statusStore = useStatusStore()
  const instancesStore = useInstancesStore()
  const settingsStore = useSettingsStore()
  const attachments = ref<ComposeAttachment[]>([])
  const isDragging = ref(false)
  const uploadAnnounce = ref('')
  /** Shown when a video exceeds the instance upload cap — paste a PeerTube link instead */
  const peerTubeHint = ref<string | null>(null)
  let dragDepth = 0
  const altTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const uploadControllers = new Map<string, AbortController>()
  /** Set on unmount — addFiles awaits downscaling and must not start uploads after */
  let disposed = false

  const dismissPeerTubeHint = () => {
    peerTubeHint.value = null
  }

  const maxAttachments = computed(
    () => instancesStore.composeMediaLimits.maxAttachments,
  )
  const maxFileBytes = computed(() => instancesStore.composeMediaLimits.maxFileBytes)
  const altMax = computed(() => instancesStore.composeMediaLimits.altMax)

  /** Host that will store attachments (active account’s instance) */
  const mediaStorageHost = computed(() => {
    const raw = instancesStore.activeAccount?.url || ''
    if (!raw) return ''
    try {
      return new URL(raw).hostname
    } catch {
      return raw.replace(/^https?:\/\//, '').replace(/\/$/, '')
    }
  })

  const mediaOptimizeSummary = computed(() => {
    const optimized = attachments.value.filter((a) => a.optimizeHint)
    if (!optimized.length) return null
    if (optimized.length === 1) return optimized[0]!.optimizeHint
    return `${optimized.length} photos resized on this device`
  })

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
    peerTubeHint.value = null
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
    const sentDescription = draft.description.trim()
    announce(`Uploading ${label}`)
    try {
      const remote = await statusStore.uploadMedia(
        draft.file,
        sentDescription || undefined,
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
      // Alt typed while the upload ran had no media id to PUT to — send it now
      // (queued, so flushAltDescriptions() still catches it before posting).
      if (current.description.trim() !== sentDescription) {
        setDescription(localId, current.description)
      }
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
    let oversizedVideoMb: number | null = null
    for (const file of list) {
      if (!COMPOSE_IMAGE_ACCEPT.test(file.type)) {
        rejected.push({ name: file.name, reason: 'Unsupported file type' })
        descIdx += 1
        continue
      }
      if (file.size > maxBytes) {
        const mb = Math.round(maxBytes / (1024 * 1024))
        if (hasVideo(file)) {
          oversizedVideoMb = mb
          rejected.push({
            name: file.name,
            reason: `Too large for this instance (max ${mb}MB) — host on PeerTube and paste the link`,
          })
        } else {
          rejected.push({ name: file.name, reason: `File too large (max ${mb}MB)` })
        }
        descIdx += 1
        continue
      }
      candidates.push({ file, hint: descriptions?.[descIdx] })
      descIdx += 1
    }

    if (oversizedVideoMb != null) {
      peerTubeHint.value = `Videos over ${oversizedVideoMb}MB aren’t accepted here. Upload to PeerTube, then paste the link into your post.`
    }

    const take = candidates.slice(0, room)
    for (const extra of candidates.slice(room)) {
      rejected.push({ name: extra.file.name, reason: `Attachment limit reached (${limit})` })
    }

    const quality = normalizeMediaUploadQuality(
      settingsStore.localPreferences.mediaUploadQuality,
    )
    const accepted: ComposeAttachment[] = []
    for (const { file, hint } of take) {
      let prepared = file
      let optimizeHint: string | null = null
      if (file.type.startsWith('image/')) {
        const result = await prepareComposeImage(file, quality)
        prepared = result.file
        if (result.didOptimize) {
          optimizeHint = `${formatByteSize(result.originalBytes)} → ${formatByteSize(result.outputBytes)}`
        }
      }
      // Downscaling awaits — the composer may have closed, or a parallel paste /
      // drop may have filled the remaining slots meanwhile.
      if (disposed) break
      if (attachments.value.length + accepted.length >= limit) {
        rejected.push({ name: file.name, reason: `Attachment limit reached (${limit})` })
        continue
      }
      accepted.push({
        localId: uid(),
        file: markRaw(prepared),
        previewUrl: URL.createObjectURL(prepared),
        remoteId: null,
        uploading: true,
        error: null,
        description: (hint || '').trim().slice(0, altMax.value),
        source,
        optimizeHint,
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
        const message = `${first.name}: ${first.reason}${more}`
        if (oversizedVideoMb != null) {
          useToastStore().show({
            message,
            actionLabel: 'Find a host',
            onAction: () => {
              window.open(PEERTUBE_JOIN_URL, '_blank', 'noopener,noreferrer')
            },
            duration: 14000,
          })
        } else {
          useToastStore().show({ message })
        }
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
    disposed = true
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
    mediaStorageHost,
    mediaOptimizeSummary,
    peerTubeHint,
    dismissPeerTubeHint,
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

