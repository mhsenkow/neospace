/**
 * Focus trap + restore for dialogs / sheets.
 * When active: Tab cycles inside container, Escape calls onEscape, focus returns on close.
 */

import { nextTick, onUnmounted, watch, type Ref } from 'vue'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.tabIndex !== -1 &&
      el.offsetParent !== null,
  )
}

export function useFocusTrap(
  containerRef: Ref<HTMLElement | null | undefined>,
  active: Ref<boolean> | { value: boolean },
  opts?: {
    onEscape?: () => void
    /** Focus this selector first (e.g. close button or input) */
    initialFocus?: string
  },
) {
  let previous: HTMLElement | null = null
  let locked = false

  const onKeydown = (e: KeyboardEvent) => {
    if (!locked) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      opts?.onEscape?.()
      return
    }
    if (e.key !== 'Tab') return
    const root = containerRef.value
    if (!root) return
    const nodes = listFocusable(root)
    if (!nodes.length) {
      e.preventDefault()
      root.focus()
      return
    }
    const first = nodes[0]!
    const last = nodes[nodes.length - 1]!
    const current = document.activeElement as HTMLElement | null
    if (e.shiftKey) {
      if (!current || current === first || !root.contains(current)) {
        e.preventDefault()
        last.focus()
      }
    } else if (!current || current === last || !root.contains(current)) {
      e.preventDefault()
      first.focus()
    }
  }

  const activate = async () => {
    previous = (document.activeElement as HTMLElement) || null
    locked = true
    document.addEventListener('keydown', onKeydown, true)
    document.documentElement.classList.add('neo-dialog-open')
    await nextTick()
    const root = containerRef.value
    if (!root) return
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
    const preferred = opts?.initialFocus
      ? root.querySelector<HTMLElement>(opts.initialFocus)
      : null
    const nodes = listFocusable(root)
    ;(preferred || nodes[0] || root).focus()
  }

  const deactivate = () => {
    locked = false
    document.removeEventListener('keydown', onKeydown, true)
    document.documentElement.classList.remove('neo-dialog-open')
    const restore = previous
    previous = null
    if (restore && typeof restore.focus === 'function') {
      try {
        restore.focus()
      } catch {
        /* element may be gone */
      }
    }
  }

  watch(
    () => active.value,
    (isActive) => {
      if (isActive) void activate()
      else deactivate()
    },
    { flush: 'post' },
  )

  onUnmounted(() => {
    if (locked) deactivate()
  })
}
