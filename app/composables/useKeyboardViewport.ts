/**
 * Pin an overlay/sheet to the visual viewport so the soft keyboard
 * doesn't bury inputs on iOS/Android.
 */

import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useScrollLock } from '~/composables/useScrollLock'

export function useKeyboardViewport(
  active: Ref<boolean> | { value: boolean },
  opts?: {
    /** Also lock body scroll while active (modals/sheets) */
    lockScroll?: boolean
  },
) {
  const viewportStyle = ref<Record<string, string>>({})
  const scrollLock = useScrollLock()
  let scrollHeld = false
  let scrollY = 0
  let rafPending = 0

  const syncViewport = () => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) {
      viewportStyle.value = {
        top: '0px',
        left: '0px',
        width: '100%',
        height: '100%',
      }
      return
    }
    viewportStyle.value = {
      top: `${vv.offsetTop}px`,
      left: `${vv.offsetLeft}px`,
      width: `${vv.width}px`,
      height: `${vv.height}px`,
    }
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
    scrollY = window.scrollY
    syncViewport()
    if (opts?.lockScroll && !scrollHeld) {
      scrollLock.lock()
      document.body.style.top = `-${scrollY}px`
      scrollHeld = true
    }
    window.visualViewport?.addEventListener('resize', scheduleSync)
    window.visualViewport?.addEventListener('scroll', scheduleSync)
    window.addEventListener('resize', scheduleSync)
  }

  const detach = () => {
    if (typeof window === 'undefined') return
    if (scrollHeld) {
      scrollLock.unlock()
      document.body.style.top = ''
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
    focusTimer = setTimeout(() => {
      focusTimer = null
      scheduleSync()
      const reduced =
        document.documentElement.classList.contains('reduce-motion') ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' })
    }, 300)
  }

  watch(
    () => active.value,
    (isActive) => {
      if (isActive) attach()
      else detach()
    },
    { flush: 'post' },
  )

  onUnmounted(() => {
    if (focusTimer) clearTimeout(focusTimer)
    if (active.value) detach()
  })

  return { viewportStyle, syncViewport, onFocusField }
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
const sharedInsetStyle = ref<Record<string, string>>({ bottom: '0px' })
const sharedKeyboardOpen = ref(false)
let keyboardInsetSubs = 0

const syncKeyboardInset = () => {
  if (typeof window === 'undefined') return
  const vv = window.visualViewport
  if (!vv) {
    sharedInsetStyle.value = { bottom: '0px' }
    sharedKeyboardOpen.value = false
    document.documentElement.style.setProperty('--neo-keyboard-inset', '0px')
    return
  }
  // Prefer layout-vs-visual gap; also catch vv.offsetTop (iOS Safari URL bar / keyboard)
  const inset = Math.max(
    0,
    Math.round(window.innerHeight - vv.height - vv.offsetTop),
    // When resizes-content already shrank innerHeight, still lift if vv is smaller
    Math.round(document.documentElement.clientHeight - vv.height - vv.offsetTop),
  )
  // Ignore URL-bar jitter. Android 10 / overlay keyboards often land ~180–280px;
  // keep threshold below that. With interactive-widget=resizes-content, inset≈0
  // and the layout shell already shrinks — composers sit at bottom:0.
  const kb = inset >= 100 ? inset : 0
  sharedInsetStyle.value = { bottom: `${kb}px` }
  sharedKeyboardOpen.value = kb > 0
  document.documentElement.style.setProperty('--neo-keyboard-inset', `${kb}px`)
}

const attachKeyboardInset = () => {
  if (typeof window === 'undefined') return
  syncKeyboardInset()
  window.visualViewport?.addEventListener('resize', syncKeyboardInset)
  window.visualViewport?.addEventListener('scroll', syncKeyboardInset)
  window.addEventListener('resize', syncKeyboardInset)
}

const detachKeyboardInset = () => {
  if (typeof window === 'undefined') return
  window.visualViewport?.removeEventListener('resize', syncKeyboardInset)
  window.visualViewport?.removeEventListener('scroll', syncKeyboardInset)
  window.removeEventListener('resize', syncKeyboardInset)
  document.documentElement.style.setProperty('--neo-keyboard-inset', '0px')
  sharedInsetStyle.value = { bottom: '0px' }
  sharedKeyboardOpen.value = false
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
