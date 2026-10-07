/**
 * Shared open/close for the Threads-style account switcher sheet.
 */
const isOpen = ref(false)

export function useAccountSwitcher() {
  const open = () => {
    isOpen.value = true
  }

  const close = () => {
    isOpen.value = false
  }

  const toggle = () => {
    isOpen.value = !isOpen.value
  }

  return {
    isOpen,
    open,
    close,
    toggle,
  }
}
