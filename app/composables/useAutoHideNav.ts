/**
 * Mobile tab bar that slides away while you read and comes back on the first
 * scroll up (Threads / X style).
 *
 * The bar is in-flow (fixed chrome inside the overflow:hidden shell gets
 * clipped on iOS), so hiding it is a FLIP: give it a negative margin so
 * `main` grows into its space, counter-translate it (and the board's pill
 * strip, which `main` growing pushes down by the same amount) back to where
 * it was, then animate the translate to 0. Only `transform` animates — the
 * one layout change happens up front, hidden behind the bar itself. Showing
 * runs the same steps in reverse and restores the layout once the bar has
 * slid back over its old slot.
 *
 * Scroll is watched in capture phase on the document, so it works for the
 * page scroller (`main`) and every board column alike.
 */

import { onMounted, onUnmounted, watch, type Ref } from 'vue'

const DURATION_MS = 240
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** Px of continuous downward scroll before hiding / upward before showing */
const HIDE_AFTER = 28
const SHOW_AFTER = 14
/** Always visible this close to the top of a scroller */
const TOP_ZONE = 12

/** Scrolls that aren't "reading" — sheets, menus, pickers, horizontal strips */
const IGNORE =
  '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"], .neo-menu__panel, .mobile-feed-tabs, .mobile-nav, textarea'

type Phase = 'shown' | 'hiding' | 'hidden' | 'showing'

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.classList.contains('reduce-motion'))

const isMobileShell = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches

export function useAutoHideNav(navRef: Ref<HTMLElement | null>) {
  const route = useRoute()
  let phase: Phase = 'shown'
  let timer: ReturnType<typeof setTimeout> | null = null
  let travelled = 0
  const lastTop = new WeakMap<EventTarget, number>()

  /** Elements that move with the bar: itself + the board's column pills */
  const riders = (): HTMLElement[] => {
    const nav = navRef.value
    if (!nav) return []
    const pills = Array.from(document.querySelectorAll<HTMLElement>('.mobile-feed-tabs')).filter(
      (el) => el.offsetParent !== null,
    )
    return [nav, ...pills]
  }

  /** Visual offset a rider currently has (mid-animation included) */
  const currentY = (el: HTMLElement) => {
    const tf = getComputedStyle(el).transform
    return tf && tf !== 'none' ? new DOMMatrixReadOnly(tf).m42 : 0
  }

  /** Stop any running slide where it is, so the next one starts from there */
  const freeze = (els: HTMLElement[]) =>
    els.map((el) => {
      const y = currentY(el)
      el.style.transition = 'none'
      el.style.transform = y ? `translateY(${y}px)` : ''
      return y
    })

  /** Layout position, ignoring our own transform */
  const layoutTop = (el: HTMLElement) => {
    const tf = el.style.transform
    el.style.transform = 'none'
    const top = el.getBoundingClientRect().top
    el.style.transform = tf
    return top
  }

  const slide = (els: HTMLElement[], ys: number[], animate: boolean) => {
    void navRef.value?.offsetHeight
    els.forEach((el, i) => {
      el.style.transition = animate ? `transform ${DURATION_MS}ms ${EASE}` : 'none'
      el.style.transform = `translateY(${ys[i] ?? 0}px)`
    })
  }

  const clearRiders = (els: HTMLElement[]) => {
    for (const el of els) {
      el.style.transition = ''
      el.style.transform = ''
    }
  }

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const hide = () => {
    const nav = navRef.value
    if (!nav || phase === 'hidden' || phase === 'hiding' || !isMobileShell()) return
    if (!nav.offsetHeight) return
    const root = document.documentElement
    const animate = !reducedMotion()
    clearTimer()
    const els = riders()
    const ys = freeze(els)

    if (!root.classList.contains('neo-nav-collapsed')) {
      root.style.setProperty('--neo-nav-live-h', `${nav.offsetHeight}px`)
      // First / Last: collapse the slot, then counter-translate so nothing visibly jumps
      const before = els.map(layoutTop)
      root.classList.add('neo-nav-collapsed')
      const after = els.map(layoutTop)
      els.forEach((el, i) => {
        el.style.transform = `translateY(${ys[i]! + before[i]! - after[i]!}px)`
      })
    }
    // Play: the bar slides off the bottom edge, the pills settle at the bottom
    slide(els, els.map(() => 0), animate)
    root.classList.add('neo-nav-hidden')
    phase = 'hiding'
    timer = setTimeout(() => {
      phase = 'hidden'
      clearRiders(riders())
    }, animate ? DURATION_MS : 0)
  }

  const finishShow = () => {
    const els = riders()
    clearRiders(els)
    document.documentElement.classList.remove('neo-nav-collapsed')
    phase = 'shown'
  }

  const show = (instant = false) => {
    if (phase === 'shown' || phase === 'showing') return
    const root = document.documentElement
    const animate = !instant && !reducedMotion() && !!navRef.value?.offsetHeight
    clearTimer()
    root.classList.remove('neo-nav-hidden')
    if (!animate || !root.classList.contains('neo-nav-collapsed')) {
      finishShow()
      return
    }
    // Where each rider lands once the slot comes back (measured, then undone)
    const els = riders()
    freeze(els)
    const collapsed = els.map(layoutTop)
    root.classList.remove('neo-nav-collapsed')
    const restored = els.map(layoutTop)
    root.classList.add('neo-nav-collapsed')
    // Slide back over the still-collapsed slot, then hand the space back
    slide(els, els.map((_, i) => restored[i]! - collapsed[i]!), true)
    phase = 'showing'
    timer = setTimeout(finishShow, DURATION_MS)
  }

  const onScroll = (e: Event) => {
    if (!isMobileShell()) return
    const target = e.target === document ? document.scrollingElement : (e.target as Element | null)
    if (!(target instanceof Element)) return
    if (target.closest(IGNORE)) return
    const top = target.scrollTop
    const prev = lastTop.get(target)
    lastTop.set(target, top)
    if (prev === undefined) return
    const delta = top - prev
    if (!delta) return // horizontal-only (board carousel)

    if (top <= TOP_ZONE) {
      travelled = 0
      show()
      return
    }
    // Rubber-band past the end on iOS reads as "scroll up" — ignore it
    if (top + target.clientHeight >= target.scrollHeight - 2 && delta < 0 && phase === 'hidden') return

    if (Math.sign(delta) !== Math.sign(travelled)) travelled = 0
    travelled += delta
    if (travelled > HIDE_AFTER) hide()
    else if (travelled < -SHOW_AFTER) show()
  }

  /** Keyboard users tabbing into the bar always get it back */
  const onFocusIn = () => show()

  const onResize = () => {
    if (!isMobileShell()) show(true)
  }

  watch(
    () => route.fullPath,
    () => {
      travelled = 0
      show()
    },
  )

  onMounted(() => {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    navRef.value?.addEventListener('focusin', onFocusIn)
  })

  onUnmounted(() => {
    document.removeEventListener('scroll', onScroll, { capture: true })
    window.removeEventListener('resize', onResize)
    navRef.value?.removeEventListener('focusin', onFocusIn)
    clearTimer()
    const root = document.documentElement
    clearRiders(riders())
    root.classList.remove('neo-nav-hidden', 'neo-nav-collapsed')
  })

  return { show, hide }
}
