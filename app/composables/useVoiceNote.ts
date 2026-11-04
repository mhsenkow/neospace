/**
 * Record a short voice note as an audio File for compose upload.
 * Uses MediaRecorder when available; callers attach via addFiles().
 */

const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || ''
}

function extForMime(mime: string) {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

export function useVoiceNote() {
  const supported = computed(
    () => typeof window !== 'undefined' && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia,
  )
  const recording = ref(false)
  const elapsedSec = ref(0)
  const error = ref('')

  let media: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let chunks: BlobPart[] = []
  let tick: ReturnType<typeof setInterval> | null = null
  let startedAt = 0

  const clearTick = () => {
    if (tick) {
      clearInterval(tick)
      tick = null
    }
  }

  const releaseStream = () => {
    media?.getTracks().forEach((t) => t.stop())
    media = null
  }

  const stopInternal = (): Promise<File | null> =>
    new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') {
        recording.value = false
        clearTick()
        releaseStream()
        resolve(null)
        return
      }
      recorder.onstop = () => {
        const mime = recorder?.mimeType || pickMimeType() || 'audio/webm'
        const blob = new Blob(chunks, { type: mime })
        chunks = []
        recording.value = false
        clearTick()
        releaseStream()
        recorder = null
        if (blob.size < 256) {
          resolve(null)
          return
        }
        const file = new File([blob], `voice-note-${Date.now()}.${extForMime(mime)}`, {
          type: mime.split(';')[0] || 'audio/webm',
          lastModified: Date.now(),
        })
        resolve(file)
      }
      try {
        recorder.stop()
      } catch {
        recording.value = false
        clearTick()
        releaseStream()
        recorder = null
        resolve(null)
      }
    })

  const start = async () => {
    error.value = ''
    if (!supported.value || recording.value) return false
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMimeType()
      chunks = []
      recorder = mime
        ? new MediaRecorder(media, { mimeType: mime })
        : new MediaRecorder(media)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.start(250)
      recording.value = true
      startedAt = Date.now()
      elapsedSec.value = 0
      clearTick()
      tick = setInterval(() => {
        elapsedSec.value = Math.floor((Date.now() - startedAt) / 1000)
        // Soft cap — Mastodon-friendly short note
        if (elapsedSec.value >= 120) void stopInternal()
      }, 250)
      return true
    } catch (e) {
      releaseStream()
      recorder = null
      recording.value = false
      error.value =
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : 'Couldn’t start recording'
      return false
    }
  }

  const stop = () => stopInternal()

  const cancel = async () => {
    chunks = []
    await stopInternal()
    return null
  }

  onUnmounted(() => {
    void cancel()
  })

  return {
    supported,
    recording,
    elapsedSec,
    error,
    start,
    stop,
    cancel,
  }
}
