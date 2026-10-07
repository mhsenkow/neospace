/**
 * Pin an overlay/sheet to the visual viewport so the soft keyboard
 * doesn't bury inputs on iOS/Android.
 */

import { onUnmounted, ref, watch, type Ref } from 'vue'

export function useKeyboardViewport(
  active: Ref<boolean> | { value: boolean },
  opts?: {
    /** Also lock body scroll while active (modals/sheets) */
    lockScroll?: boolean
  },
) {
  const viewportStyle = ref<Record<string, string>>({})
  let scrollLockY = 0

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

  const lockScroll = () => {
    if (typeof document === 'undefined') return
    scrollLockY = window.scrollY || 0
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.inset = '0'
    document.body.style.width = '100%'
  }

  const unlockScroll = () => {
    if (typeof document === 'undefined') return
    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
    document.body.style.position = ''
    document.body.style.inset = ''
    document.body.style.width = ''
    window.scrollTo(0, scrollLockY)
  }

  const attach = () => {
    if (typeof window === 'undefined') return
    syncViewport()
    if (opts?.lockScroll) lockScroll()
    window.visualViewport?.addEventListener('resize', syncViewport)
    window.visualViewport?.addEventListener('scroll', syncViewport)
    window.addEventListener('resize', syncViewport)
  }

  const detach = () => {
    if (typeof window === 'undefined') return
    if (opts?.lockScroll) unlockScroll()
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
