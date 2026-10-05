/**
 * Shared open/close for the Accounts & Servers panel.
 */
const isOpen = ref(false)

export function useAccountsManager() {
  const open = () => {
    isOpen.value = true
  }

  const close = () => {
    isOpen.value = false
  }

  return {
    isOpen,
    open,
    close,
  }
}
