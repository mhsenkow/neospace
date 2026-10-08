/**
 * Page scroll that works on both shells: desktop scrolls the window, while the
 * viewport-locked mobile shell scrolls `#main-content` instead.
 */

/** `#main-content` when it is the active scroller (mobile shell), else null. */
export const getMainScroller = (): HTMLElement | null => {
  if (typeof document === 'undefined') return null
  const main = document.getElementById('main-content')
  if (!main) return null
  const oy = getComputedStyle(main).overflowY
  return oy === 'auto' || oy === 'scroll' ? main : null
}

export const getPageScrollTop = (): number => {
  if (typeof window === 'undefined') return 0
  return getMainScroller()?.scrollTop ?? window.scrollY
}

export const scrollPageTo = (top: number, behavior: ScrollBehavior = 'auto') => {
  if (typeof window === 'undefined') return
  const main = getMainScroller()
  if (main) main.scrollTo({ top, behavior })
  else window.scrollTo({ top, behavior })
}
