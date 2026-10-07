/**
 * Shared open state for Leave-a-note (sidebar + FAB).
 */
export function useFeedbackNotes() {
  const open = useState('neo-feedback-open', () => false)
  return {
    open,
    show: () => {
      open.value = true
    },
    hide: () => {
      open.value = false
    },
  }
}
