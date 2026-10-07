/**
 * Focus trap + restore for dialogs / sheets.
 * Module-level stack: only the topmost trap handles Escape/Tab.
 * Bubble phase so nested handlers (e.g. mention Escape) can run first.
 */

import { nextTick, onUnmounted, watch, type Ref } from 'vue'
import { useScrollLock } from '~/composables/useScrollLock'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

type TrapEntry = {
  id: number
  root: () => HTMLElement | null | undefined
  onEscape?: () => void
}

let trapStack: TrapEntry[] = []
let idSeq = 0
let listening = false

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.tabIndex !== -1 &&
      el.offsetParent !== null,
  )
}

function topTrap(): TrapEntry | undefined {
  return trapStack[trapStack.length - 1]
}

const onKeydown = (e: KeyboardEvent) => {
  const top = topTrap()
  if (!top) return
  if (e.defaultPrevented) return

  if (e.key === 'Escape') {
    // Bubble phase: if an inner handler already stopped/prevented, respect it
    if (e.defaultPrevented) return
    top.onEscape?.()
    return
  }

  if (e.key !== 'Tab') return
  const root = top.root()
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

const onFocusIn = (e: FocusEvent) => {
  const top = topTrap()
  if (!top) return
  const root = top.root()
  if (!root) return
  const target = e.target as Node | null
  if (target && root.contains(target)) return
  const nodes = listFocusable(root)
  ;(nodes[0] || root).focus()
}

function ensureListening() {
  if (listening) return
  listening = true
  document.addEventListener('keydown', onKeydown, false)
  document.addEventListener('focusin', onFocusIn)
}

function maybeStopListening() {
  if (trapStack.length || !listening) return
  listening = false
  document.removeEventListener('keydown', onKeydown, false)
  document.removeEventListener('focusin', onFocusIn)
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
  const scrollLock = useScrollLock()
  let previous: HTMLElement | null = null
  let entry: TrapEntry | null = null
  let locked = false
  let scrollHeld = false

  const activate = async () => {
    previous = (document.activeElement as HTMLElement) || null
    locked = true
    entry = {
      id: ++idSeq,
      root: () => containerRef.value,
      onEscape: opts?.onEscape,
    }
    trapStack.push(entry)
    ensureListening()
    document.documentElement.classList.add('neo-dialog-open')
    if (!scrollHeld) {
      scrollLock.lock()
      scrollHeld = true
    }
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
    if (entry) {
      trapStack = trapStack.filter((t) => t.id !== entry!.id)
      entry = null
    }
    if (!trapStack.length) {
      document.documentElement.classList.remove('neo-dialog-open')
    }
    if (scrollHeld) {
      scrollLock.unlock()
      scrollHeld = false
    }
    maybeStopListening()
    const restore = previous
    previous = null
    if (restore && restore.isConnected && typeof restore.focus === 'function') {
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
