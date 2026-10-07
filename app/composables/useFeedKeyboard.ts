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

    let idx = cards.findIndex((c) => c === active || c.contains(active as Node))

    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault()
      if (idx < 0) idx = e.key === 'j' ? -1 : 0
      const next =
        e.key === 'j'
          ? Math.min(idx + 1, cards.length - 1)
          : Math.max(idx <= 0 ? 0 : idx - 1, 0)
      const card = cards[next]
      if (!card) return
      card.focus()
      card.scrollIntoView({ block: 'nearest' })
      return
    }

    if (e.key === 'Enter' || e.key === 'o') {
      if (idx < 0) return
      const card = cards[idx]
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
