/**
 * Shared open/close for the Accounts & Servers panel.
 * State lives in the overlay store (like the account switcher) so it stacks with confirm/lightbox.
 */
import { useOverlayStore } from '~/stores/overlay'

export function useAccountsManager() {
  const overlayStore = useOverlayStore()

  const isOpen = computed({
    get: () => overlayStore.accountsManager.open,
    set: (open: boolean) => {
      overlayStore.accountsManager.open = open
    },
  })

  const open = () => overlayStore.openAccountsManager()
  const close = () => overlayStore.closeAccountsManager()

  return {
    isOpen,
    open,
    close,
  }
}
