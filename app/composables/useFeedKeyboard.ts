/**
 * Lightweight feed keyboard: j/k between cards, Enter/o opens thread, Escape blurs.
 */

import type { Ref } from 'vue'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Index of the first card that intersects the [top, bottom] band, or the last
 * card when everything is above it (-1 for an empty list).
 */
export function firstVisibleCardIndex(
  rects: ReadonlyArray<{ top: number; bottom: number }>,
  top: number,
  bottom: number,
): number {
  if (!rects.length) return -1
  const i = rects.findIndex((r) => r.bottom > top && r.top < bottom)
  return i >= 0 ? i : rects.length - 1
}

/** Nearest scrolling ancestor's visible band, clipped to the window */
function visibleBand(el: HTMLElement): { top: number; bottom: number } {
  let band = { top: 0, bottom: window.innerHeight }
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
      const r = node.getBoundingClientRect()
      band = { top: Math.max(band.top, r.top), bottom: Math.min(band.bottom, r.bottom) }
      break
    }
  }
  return band
}

export function useFeedKeyboard(root: Ref<HTMLElement | null | undefined>) {
  const onKeydown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.isComposing || e.keyCode === 229) return
    if (isTypingTarget(e.target)) return

    const el = root.value
    if (!el) return

    const active = document.activeElement
    if (active !== el && !(active instanceof Node && el.contains(active))) return

    const cards = Array.from(el.querySelectorAll<HTMLElement>('.status-card'))
    if (!cards.length) return

    // Caps Lock reports uppercase letters; shortcuts shouldn't silently stop working
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (e.shiftKey && key.length === 1) return

    let idx = cards.findIndex((c) => c === active || c.contains(active as Node))

    if (key === 'j' || key === 'k') {
      e.preventDefault()
      let next: number
      if (idx < 0) {
        // Nothing focused yet: start at the first card actually on screen, not card 0
        const band = visibleBand(el)
        next = firstVisibleCardIndex(
          cards.map((c) => c.getBoundingClientRect()),
          band.top,
          band.bottom,
        )
      } else {
        next =
          key === 'j'
            ? Math.min(idx + 1, cards.length - 1)
            : Math.max(idx <= 0 ? 0 : idx - 1, 0)
      }
      const card = cards[next]
      if (!card) return
      card.focus({ preventScroll: true })
      card.scrollIntoView({ block: 'nearest' })
      return
    }

    if (e.key === 'Enter' || key === 'o') {
      if (idx < 0) return
      const card = cards[idx]
      // Enter only from the card itself — Enter on Like / Reply / links / CW
      // summary inside the card must run that control, not open the thread.
      if (e.key === 'Enter' && active !== card) return
      const link =
        card?.querySelector<HTMLAnchorElement>('a[href*="/status/"]') ||
        card?.querySelector<HTMLAnchorElement>('a.status-time, a[href^="/status/"]')
      if (!link) return
      e.preventDefault()
      link.click()
      return
    }

    if (e.key === 'Escape') {
      if (active instanceof HTMLElement && el.contains(active) && active !== el) {
        e.preventDefault()
        active.blur()
        el.focus({ preventScroll: true })
      }
    }
  }

  return { onKeydown }
}
