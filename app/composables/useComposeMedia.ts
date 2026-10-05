/**
 * Shared compose media attachments — drag/drop, paste, upload, previews.
 */

import type { mastodon } from 'masto'
import { useStatusStore } from '~/stores/status'

export interface ComposeAttachment {
  localId: string
  file: File
  previewUrl: string
  remoteId: string | null
  uploading: boolean
  error: string | null
}

const MAX_ATTACHMENTS = 4
const MAX_FILE_BYTES = 40 * 1024 * 1024 // Mastodon default often 40MB images
const ACCEPT = /^image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime)$/i

function uid() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function useComposeMedia() {
  const statusStore = useStatusStore()
  const attachments = ref<ComposeAttachment[]>([])
  const isDragging = ref(false)
  let dragDepth = 0

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
    const idx = attachments.value.findIndex((a) => a.localId === localId)
    if (idx === -1) return
    const [gone] = attachments.value.splice(idx, 1)
    if (gone?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(gone.previewUrl)
  }

  const clearAttachments = () => {
    revokeAll()
    attachments.value = []
  }

  const uploadOne = async (draft: ComposeAttachment) => {
    draft.uploading = true
    draft.error = null
    try {
      const remote = await statusStore.uploadMedia(draft.file)
      draft.remoteId = remote.id
      // Prefer server preview if available
      if (remote.previewUrl) {
        if (draft.previewUrl.startsWith('blob:')) URL.revokeObjectURL(draft.previewUrl)
        draft.previewUrl = remote.previewUrl
      }
    } catch (e: any) {
      draft.error = e?.message || 'Upload failed'
      draft.remoteId = null
    } finally {
      draft.uploading = false
    }
  }

  const addFiles = async (files: FileList | File[] | null | undefined) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    const room = MAX_ATTACHMENTS - attachments.value.length
    if (room <= 0) return

    const accepted: ComposeAttachment[] = []
    for (const file of list.slice(0, room)) {
      if (!ACCEPT.test(file.type)) continue
      if (file.size > MAX_FILE_BYTES) continue
      accepted.push({
        localId: uid(),
        file,
        previewUrl: URL.createObjectURL(file),
        remoteId: null,
        uploading: true,
        error: null,
      })
    }

    if (accepted.length === 0) return
    attachments.value.push(...accepted)
    await Promise.all(accepted.map((a) => uploadOne(a)))
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
    e.preventDefault()
    dragDepth = 0
    isDragging.value = false
    await addFiles(e.dataTransfer?.files)
  }

  const onPaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && ACCEPT.test(item.type)) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length === 0) return
    e.preventDefault()
    await addFiles(files)
  }

  onUnmounted(() => {
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
    addFiles,
    removeAttachment,
    clearAttachments,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    onPaste,
  }
}

export type { mastodon }
