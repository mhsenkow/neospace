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
 */
export function useKeyboardBottomInset() {
  const insetStyle = ref<Record<string, string>>({})

  const syncInset = () => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) {
      insetStyle.value = { bottom: '0px' }
      return
    }
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    insetStyle.value = { bottom: `${inset}px` }
  }

  const attach = () => {
    if (typeof window === 'undefined') return
    syncInset()
    window.visualViewport?.addEventListener('resize', syncInset)
    window.visualViewport?.addEventListener('scroll', syncInset)
    window.addEventListener('resize', syncInset)
  }

  const detach = () => {
    if (typeof window === 'undefined') return
    window.visualViewport?.removeEventListener('resize', syncInset)
    window.visualViewport?.removeEventListener('scroll', syncInset)
    window.removeEventListener('resize', syncInset)
  }

  onMounted(attach)
  onUnmounted(detach)

  return { insetStyle, syncInset }
}
