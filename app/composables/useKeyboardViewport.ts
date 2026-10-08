/**
 * Pin an overlay/sheet to the visual viewport so the soft keyboard
 * doesn't bury inputs on iOS/Android.
 */

import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useScrollLock } from '~/composables/useScrollLock'
import {
  captureKeyboardBaseline,
  measureKeyboard,
} from '~/utils/keyboardDetect'

const KEYBOARD_SCROLL_SEL =
  '[data-keyboard-scroll], .compose-sheet__body, .algo-sheet__body, .group-pick-sheet__inner, .notes-panel, .notes-sheet__panel, .recipient-picker__list'

const KEYBOARD_FIXED_SEL =
  '.chat-composer, [data-keyboard-fixed], .reply-dock, .thread-reply-dock'

const KEYBOARD_FOOTER_SEL =
  '.compose-footer, .notes-actions, .compose-sheet__footer, .algo-sheet__footer, [data-keyboard-footer]'

/** Sheets currently pinned — keeps data-keyboard-open honest while docks report inset 0. */
let sheetPins = 0
let sheetKeyboardOpen = false

const sharedInsetStyle = ref<Record<string, string>>({ bottom: '0px' })
const sharedKeyboardOpen = ref(false)
let keyboardInsetSubs = 0
let lastInset = -1
let lastOpen = false
let insetRaf = 0

function publishKeyboardOpen(open: boolean) {
  const next = open || sheetKeyboardOpen
  lastOpen = next
  sharedKeyboardOpen.value = next
  document.documentElement.toggleAttribute('data-keyboard-open', next)
}

function publishInset(inset: number, open: boolean) {
  const kb = inset >= 100 ? inset : 0
  if (kb !== lastInset) {
    lastInset = kb
    sharedInsetStyle.value = { bottom: `${kb}px` }
    document.documentElement.style.setProperty('--neo-keyboard-inset', `${kb}px`)
  }
  publishKeyboardOpen(open)
}

/**
 * Scroll a focused field into its sheet/panel scrollport — never yank the
 * document under a fixed composer (Android overlay keyboards).
 */
export function scrollFieldIntoKeyboardView(
  el: HTMLElement,
  opts?: { behavior?: ScrollBehavior },
) {
  if (typeof window === 'undefined') return
  const behavior = opts?.behavior ?? 'smooth'

  // Fixed bars already lift with --neo-keyboard-inset
  if (el.closest(KEYBOARD_FIXED_SEL)) return

  const parent = el.closest(KEYBOARD_SCROLL_SEL) as HTMLElement | null
  if (parent && parent !== el && parent.scrollHeight > parent.clientHeight + 2) {
    const pRect = parent.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const pad = 12
    const footer = parent.querySelector(KEYBOARD_FOOTER_SEL) as HTMLElement | null
      || parent.parentElement?.querySelector(KEYBOARD_FOOTER_SEL) as HTMLElement | null
    const footerH = footer?.offsetHeight ?? 0
    const topLimit = pRect.top + pad
    const bottomLimit = pRect.bottom - pad - footerH
    if (eRect.top < topLimit) {
      parent.scrollBy({ top: eRect.top - topLimit, behavior })
    } else if (eRect.bottom > bottomLimit) {
      parent.scrollBy({ top: eRect.bottom - bottomLimit, behavior })
    }
    return
  }

  // Page-level fields: nearest keeps sticky search bars from jumping
  el.scrollIntoView({ block: 'nearest', behavior })
}

export function useKeyboardViewport(
  active: Ref<boolean> | { value: boolean },
  opts?: {
    /** Also lock body scroll while active (modals/sheets) */
    lockScroll?: boolean
  },
) {
  const viewportStyle = ref<Record<string, string>>({})
  const keyboardOpen = ref(false)
  const scrollLock = useScrollLock()
  let scrollHeld = false
  let scrollY = 0
  let rafPending = 0
  let pinned = false

  const syncViewport = () => {
    if (typeof window === 'undefined') return
    // Desktop mouse/trackpad: keep the centered card — don't pin to visualViewport.
    const deskFine = window.matchMedia(
      '(min-width: 1024px) and (hover: hover) and (pointer: fine)',
    ).matches
    const vv = window.visualViewport
    if (deskFine || !vv) {
      viewportStyle.value = {}
      keyboardOpen.value = false
      sheetKeyboardOpen = false
      // Preserve dock-driven open state; don't force-clear the shared flag.
      const { open } = measureKeyboard()
      publishKeyboardOpen(open)
      return
    }
    viewportStyle.value = {
      top: `${vv.offsetTop}px`,
      left: `${vv.offsetLeft}px`,
      width: `${vv.width}px`,
      height: `${vv.height}px`,
    }
    const { open } = measureKeyboard()
    keyboardOpen.value = open
    sheetKeyboardOpen = open
    publishKeyboardOpen(open)
  }

  const scheduleSync = () => {
    if (rafPending) return
    rafPending = requestAnimationFrame(() => {
      rafPending = 0
      syncViewport()
    })
  }

  const attach = () => {
    if (typeof window === 'undefined') return
    if (!pinned) {
      pinned = true
      sheetPins += 1
    }
    scrollY = window.scrollY
    captureKeyboardBaseline()
    syncViewport()
    if (opts?.lockScroll && !scrollHeld) {
      scrollLock.lock()
      scrollHeld = true
    }
    window.visualViewport?.addEventListener('resize', scheduleSync)
    window.visualViewport?.addEventListener('scroll', scheduleSync)
    window.addEventListener('resize', scheduleSync)
  }

  const detach = () => {
    if (typeof window === 'undefined') return
    if (pinned) {
      pinned = false
      sheetPins = Math.max(0, sheetPins - 1)
    }
    if (scrollHeld) {
      scrollLock.unlock()
      window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' as ScrollBehavior })
      scrollHeld = false
    }
    window.visualViewport?.removeEventListener('resize', scheduleSync)
    window.visualViewport?.removeEventListener('scroll', scheduleSync)
    window.removeEventListener('resize', scheduleSync)
    if (rafPending) {
      cancelAnimationFrame(rafPending)
      rafPending = 0
    }
    viewportStyle.value = {}
    keyboardOpen.value = false
    if (sheetPins === 0) sheetKeyboardOpen = false
    const { open } = measureKeyboard()
    publishKeyboardOpen(open)
    captureKeyboardBaseline()
  }

  let focusTimer: ReturnType<typeof setTimeout> | null = null

  const onFocusField = (e: FocusEvent) => {
    const el = e.target as HTMLElement | null
    if (!el) return
    const tag = el.tagName
    if (tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT') return
    if (el instanceof HTMLInputElement) {
      const t = el.type
      if (t === 'button' || t === 'submit' || t === 'checkbox' || t === 'radio' || t === 'file') {
        return
      }
    }
    if (focusTimer) clearTimeout(focusTimer)
    // Wait for soft keyboard animation, then re-pin + scroll the sheet body
    focusTimer = setTimeout(() => {
      focusTimer = null
      scheduleSync()
      const reduced =
        document.documentElement.classList.contains('reduce-motion') ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      scrollFieldIntoKeyboardView(el, { behavior: reduced ? 'auto' : 'smooth' })
    }, keyboardOpen.value ? 80 : 300)
  }

  watch(
    () => active.value,
    (isActive) => {
      if (isActive) attach()
      else detach()
    },
    // immediate: sheets may mount already open (layout lazy-mounts them)
    { flush: 'post', immediate: true },
  )

  onUnmounted(() => {
    if (focusTimer) clearTimeout(focusTimer)
    if (active.value) detach()
  })

  return { viewportStyle, keyboardOpen, syncViewport, onFocusField }
}

/**
 * Bottom inset for fixed composers/docks that sit above the soft keyboard.
 * Call when the bar is mounted (always-on), unlike useKeyboardViewport's active gate.
 *
 * With `interactive-widget=resizes-content` (Android), layout already shrinks and
 * inset is often ~0; keep the math for iOS / overlay keyboards. Also publishes
 * `--neo-keyboard-inset` for page padding (threads / DMs).
 *
 * Shared singleton — layout + ChatComposer + reply dock can all subscribe without
 * fighting over listeners / zeroing the CSS var on unmount.
 */
const syncKeyboardInset = () => {
  if (typeof window === 'undefined') return
  const { inset, open } = measureKeyboard()
  if (!open) captureKeyboardBaseline()
  publishInset(inset, open)
}

const scheduleKeyboardInset = () => {
  if (insetRaf) return
  insetRaf = requestAnimationFrame(() => {
    insetRaf = 0
    syncKeyboardInset()
  })
}

const onInsetFocusIn = () => scheduleKeyboardInset()
const onInsetFocusOut = () => {
  window.setTimeout(() => {
    captureKeyboardBaseline()
    scheduleKeyboardInset()
  }, 80)
}

const attachKeyboardInset = () => {
  if (typeof window === 'undefined') return
  lastInset = -1
  lastOpen = false
  captureKeyboardBaseline()
  syncKeyboardInset()
  window.visualViewport?.addEventListener('resize', scheduleKeyboardInset)
  window.visualViewport?.addEventListener('scroll', scheduleKeyboardInset)
  window.addEventListener('resize', scheduleKeyboardInset)
  document.addEventListener('focusin', onInsetFocusIn)
  document.addEventListener('focusout', onInsetFocusOut)
}

const detachKeyboardInset = () => {
  if (typeof window === 'undefined') return
  window.visualViewport?.removeEventListener('resize', scheduleKeyboardInset)
  window.visualViewport?.removeEventListener('scroll', scheduleKeyboardInset)
  window.removeEventListener('resize', scheduleKeyboardInset)
  document.removeEventListener('focusin', onInsetFocusIn)
  document.removeEventListener('focusout', onInsetFocusOut)
  if (insetRaf) {
    cancelAnimationFrame(insetRaf)
    insetRaf = 0
  }
  lastInset = 0
  document.documentElement.style.setProperty('--neo-keyboard-inset', '0px')
  sharedInsetStyle.value = { bottom: '0px' }
  if (sheetPins === 0) {
    sheetKeyboardOpen = false
    publishKeyboardOpen(false)
  } else {
    publishKeyboardOpen(sheetKeyboardOpen)
  }
}

export function useKeyboardBottomInset() {
  onMounted(() => {
    keyboardInsetSubs += 1
    if (keyboardInsetSubs === 1) attachKeyboardInset()
    else syncKeyboardInset()
  })
  onUnmounted(() => {
    keyboardInsetSubs = Math.max(0, keyboardInsetSubs - 1)
    if (keyboardInsetSubs === 0) detachKeyboardInset()
  })

  return {
    insetStyle: sharedInsetStyle,
    syncInset: syncKeyboardInset,
    keyboardOpen: sharedKeyboardOpen,
  }
}
