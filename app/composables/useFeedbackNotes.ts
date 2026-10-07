/**
 * Shared open state for Leave-a-note (sidebar + FAB).
 * Pushes a history entry on open so Android back closes the dialog.
 */

let historyHookInstalled = false

function installHistoryHook(
  open: Ref<boolean>,
  historyPushed: Ref<boolean>,
  suppressPop: Ref<boolean>,
) {
  if (historyHookInstalled || typeof window === 'undefined') return
  historyHookInstalled = true

  window.addEventListener('popstate', () => {
    if (suppressPop.value) {
      suppressPop.value = false
      return
    }
    if (open.value) {
      open.value = false
      historyPushed.value = false
    }
  })
}

export function useFeedbackNotes() {
  const open = useState('neo-feedback-open', () => false)
  const historyPushed = useState('neo-feedback-history-pushed', () => false)
  const suppressPop = useState('neo-feedback-suppress-pop', () => false)

  installHistoryHook(open, historyPushed, suppressPop)

  const close = () => {
    if (!open.value) return
    open.value = false
    if (import.meta.client && historyPushed.value) {
      suppressPop.value = true
      history.back()
      historyPushed.value = false
    }
  }

  const show = () => {
    open.value = true
  }

  if (import.meta.client) {
    watch(open, (isOpen) => {
      if (isOpen && !historyPushed.value) {
        history.pushState({ neoFeedback: true }, '')
        historyPushed.value = true
      }
    })
  }

  return {
    open,
    show,
    hide: close,
    close,
  }
}
