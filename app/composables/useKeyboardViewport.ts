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

  const attach = () => {
    if (typeof window === 'undefined') return
    syncViewport()
    if (opts?.lockScroll && !scrollHeld) {
      scrollLock.lock()
      scrollHeld = true
    }
    window.visualViewport?.addEventListener('resize', syncViewport)
    window.visualViewport?.addEventListener('scroll', syncViewport)
    window.addEventListener('resize', syncViewport)
  }

  const detach = () => {
    if (typeof window === 'undefined') return
    if (scrollHeld) {
      scrollLock.unlock()
      scrollHeld = false
    }
    window.visualViewport?.removeEventListener('resize', syncViewport)
    window.visualViewport?.removeEventListener('scroll', syncViewport)
    window.removeEventListener('resize', syncViewport)
    viewportStyle.value = {}
  }

  const onFocusField = (e: FocusEvent) => {
    const el = e.target as HTMLElement | null
    if (!el) return
    window.setTimeout(() => {
      syncViewport()
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
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
