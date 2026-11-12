/**
 * Compose voice-note flow — record, then attach through the media composable.
 * Wraps `useVoiceNote` with the compose guards (no poll, attachment limit) and toasts.
 */

import type { Ref } from 'vue'
import { useToastStore } from '~/stores/toast'
import { useVoiceNote } from '~/composables/useVoiceNote'
import type { useComposeMedia } from '~/composables/useComposeMedia'

type AddFiles = ReturnType<typeof useComposeMedia>['addFiles']

export function useComposeVoiceNote(opts: {
  addFiles: AddFiles
  showPoll: Ref<boolean>
  canAddMore: Ref<boolean>
}) {
  const { addFiles, showPoll, canAddMore } = opts
  const toastStore = useToastStore()
  const voiceNote = useVoiceNote()
  const voiceBusy = computed(() => voiceNote.recording.value)
  const voiceElapsedLabel = computed(() => {
    const s = voiceNote.elapsedSec.value
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${r.toString().padStart(2, '0')}`
  })

  const attachVoiceNote = async (file: File | null) => {
    if (!file) return
    const result = await addFiles([file])
    if (result.accepted > 0) {
      toastStore.show({ message: 'Voice note attached', duration: 2200 })
    } else if (result.rejected[0]) {
      toastStore.show({
        message: result.rejected[0].reason || 'Couldn’t attach voice note',
        duration: 3600,
      })
    }
  }

  const toggleVoiceNote = async () => {
    if (voiceNote.recording.value) {
      const file = await voiceNote.stop()
      await attachVoiceNote(file)
      return
    }
    if (showPoll.value) {
      toastStore.show({ message: 'Remove the poll before adding a voice note', duration: 2800 })
      return
    }
    if (!canAddMore.value) {
      toastStore.show({ message: 'Attachment limit reached', duration: 2800 })
      return
    }
    const ok = await voiceNote.start()
    if (!ok && voiceNote.error.value) {
      toastStore.show({ message: voiceNote.error.value, duration: 3600 })
    }
  }

  return { voiceNote, voiceBusy, voiceElapsedLabel, toggleVoiceNote }
}
