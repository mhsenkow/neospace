/**
 * Shared open/close for the Threads-style account switcher sheet.
 * State lives in the overlay store for stacking with confirm/lightbox.
 */
import { useOverlayStore } from '~/stores/overlay'

export function useAccountSwitcher() {
  const overlayStore = useOverlayStore()

  const isOpen = computed({
    get: () => overlayStore.accountSwitcher.open,
    set: (open: boolean) => {
      overlayStore.accountSwitcher.open = open
    },
  })

  const open = () => overlayStore.openAccountSwitcher()
  const close = () => overlayStore.closeAccountSwitcher()
  const toggle = () => overlayStore.toggleAccountSwitcher()

  return {
    isOpen,
    open,
    close,
    toggle,
  }
}
