import { watch } from 'vue'
import { useEdwardStore } from '~/stores/edward'
import { useComposeSheetStore } from '~/stores/composeSheet'

/**
 * Edward is recessed while the compose sheet is open (reply from the modal / watch deck).
 * Restore on ANY close — Cancel, Discard, Esc — from the long-lived Edward shell: it outlives
 * the modal and deck that opened the sheet, so cleanup can't be skipped by an unmount.
 */
export function useEdwardRecessRestore() {
  const edward = useEdwardStore()
  const composeSheet = useComposeSheetStore()
  return watch(
    () => composeSheet.open,
    (open) => {
      if (!open && edward.recessed) edward.setRecessed(false)
    },
  )
}
