/**
 * Focus trap + restore for dialogs / sheets.
 * Module-level stack: only the topmost trap handles Escape/Tab.
 * Bubble phase so nested handlers (e.g. mention Escape) can run first.
 */

import { nextTick, onUnmounted, watch, type Ref } from 'vue'
import { useScrollLock } from '~/composables/useScrollLock'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])'

type TrapEntry = {
  id: number
  root: () => HTMLElement | null | undefined
  onEscape?: () => void
  /** Where focus goes back to when this trap closes */
  previous: HTMLElement | null
}

let trapStack: TrapEntry[] = []
let idSeq = 0
let listening = false

function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  }
  return el.offsetParent !== null
}

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      // :disabled also covers controls inside a disabled <fieldset>
      !el.matches(':disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.tabIndex !== -1 &&
      !el.closest('[inert]') &&
      isVisible(el),
  )
}

/**
 * Focus origin to return to. A menu item (NeoMenu) is hidden by the time the
 * dialog it opened closes — return to the menu's trigger instead of <body>.
 */
function restoreTarget(el: HTMLElement | null): HTMLElement | null {
  const menu = el?.closest?.('[role="menu"][id]')
  if (!menu) return el
  const trigger = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`)
  return trigger || el
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
  // Teleported popups (NeoMenu `teleport`) live in <body> but belong to a trigger
  // inside the trap — let focus in, or keyboard users can never reach the items.
  const menu = target instanceof Element ? target.closest('[role="menu"][id]') : null
  if (menu && root.querySelector(`[aria-controls="${CSS.escape(menu.id)}"]`)) return
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
  let entry: TrapEntry | null = null
  let locked = false
  let scrollHeld = false

  const activate = async () => {
    locked = true
    entry = {
      id: ++idSeq,
      root: () => containerRef.value,
      onEscape: opts?.onEscape,
      previous: restoreTarget((document.activeElement as HTMLElement) || null),
    }
    trapStack.push(entry)
    ensureListening()
    document.documentElement.classList.add('neo-dialog-open')
    if (!scrollHeld) {
      scrollLock.lock()
      scrollHeld = true
    }
    await nextTick()
    // Lazily-mounted dialogs (async chunk under Suspense) can attach their
    // container after `active` flips — wait briefly (timers, not rAF: rAF
    // stalls in background tabs).
    for (let i = 0; i < 20 && locked && !containerRef.value; i++) {
      await new Promise((r) => setTimeout(r, 16))
    }
    if (!locked) return
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
    let restore: HTMLElement | null = null
    if (entry) {
      const closing = entry
      const wasTop = topTrap()?.id === closing.id
      const closingRoot = closing.root()
      trapStack = trapStack.filter((t) => t.id !== closing.id)
      entry = null
      if (wasTop) {
        restore = closing.previous
      } else {
        // A trap under the top one closed (e.g. the drawer behind a dialog it
        // opened): don't pull focus out of the open dialog — hand our origin to
        // any dialog that was opened from inside us, whose own origin is going away.
        for (const t of trapStack) {
          if (!t.previous) continue
          const orphaned = closingRoot ? closingRoot.contains(t.previous) : !t.previous.isConnected
          if (orphaned) t.previous = closing.previous
        }
      }
    }
    if (!trapStack.length) {
      document.documentElement.classList.remove('neo-dialog-open')
    }
    if (scrollHeld) {
      scrollLock.unlock()
      scrollHeld = false
    }
    maybeStopListening()
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
    // immediate: sheets often mount with open=true via v-if
    { flush: 'post', immediate: true },
  )

  onUnmounted(() => {
    if (locked) deactivate()
  })
}
