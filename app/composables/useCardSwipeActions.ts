/**
 * One-handed horizontal swipe gestures on feed cards (not Flip).
 * Pure helpers are exported for unit tests.
 */

import { onUnmounted, ref, type Ref } from 'vue'

export const CARD_SWIPE_SLOP_PX = 14
export const CARD_SWIPE_THRESHOLD_PX = 56
export const CARD_SWIPE_LOCK_RATIO = 1.8
export const CARD_SWIPE_MAX_PULL_PX = 88

export type CardSwipeIntent = 'none' | 'like' | 'reply'

export type CardSwipeClassify = {
  /** True once the gesture is locked to horizontal */
  locked: boolean
  intent: CardSwipeIntent
  /** Visual translateX, clamped */
  offset: number
  /** True when release should fire the intent */
  shouldCommit: boolean
}

/** Classify a touch delta against vertical scroll / carousel conflicts. */
export function classifyCardSwipe(
  dx: number,
  dy: number,
  opts?: {
    slop?: number
    threshold?: number
    lockRatio?: number
    maxPull?: number
    alreadyLocked?: boolean
  },
): CardSwipeClassify {
  const slop = opts?.slop ?? CARD_SWIPE_SLOP_PX
  const threshold = opts?.threshold ?? CARD_SWIPE_THRESHOLD_PX
  const lockRatio = opts?.lockRatio ?? CARD_SWIPE_LOCK_RATIO
  const maxPull = opts?.maxPull ?? CARD_SWIPE_MAX_PULL_PX
  const dist = Math.hypot(dx, dy)

  if (dist < slop) {
    return { locked: false, intent: 'none', offset: 0, shouldCommit: false }
  }

  const horizontal = Math.abs(dx) > lockRatio * Math.abs(dy)
  const locked = !!opts?.alreadyLocked || horizontal
  if (!locked) {
    return { locked: false, intent: 'none', offset: 0, shouldCommit: false }
  }

  const intent: CardSwipeIntent = dx > 0 ? 'like' : dx < 0 ? 'reply' : 'none'
  const raw = Math.max(-maxPull, Math.min(maxPull, dx))
  return {
    locked: true,
    intent,
    offset: raw,
    shouldCommit: Math.abs(dx) >= threshold && intent !== 'none',
  }
}

export function useCardSwipeActions(opts: {
  enabled: Ref<boolean>
  onLike: () => void
  onReply: () => void
}) {
  const offset = ref(0)
  const intent = ref<CardSwipeIntent>('none')
  const dragging = ref(false)

  let startX = 0
  let startY = 0
  let locked = false
  let active = false
  let el: HTMLElement | null = null

  const reset = () => {
    offset.value = 0
    intent.value = 'none'
    dragging.value = false
    locked = false
    active = false
  }

  const onTouchStart = (e: TouchEvent) => {
    if (!opts.enabled.value || e.touches.length !== 1) return
    const t = e.touches[0]
    if (!t) return
    const target = e.target as HTMLElement | null
    if (target?.closest('a, button, input, textarea, summary, video, audio, [role="button"], .status-media__track')) {
      return
    }
    startX = t.clientX
    startY = t.clientY
    locked = false
    active = true
    dragging.value = false
  }

  const onTouchMove = (e: TouchEvent) => {
    if (!active || !opts.enabled.value) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    const result = classifyCardSwipe(dx, dy, { alreadyLocked: locked })
    if (!result.locked) {
      if (Math.hypot(dx, dy) >= CARD_SWIPE_SLOP_PX) {
        // Vertical / diagonal — abandon gesture so the feed can scroll
        active = false
        reset()
      }
      return
    }
    locked = true
    dragging.value = true
    offset.value = result.offset
    intent.value = result.intent
    if (e.cancelable) e.preventDefault()
  }

  const onTouchEnd = (e: TouchEvent) => {
    if (!active) return
    const t = e.changedTouches[0]
    const dx = t ? t.clientX - startX : offset.value
    const dy = t ? t.clientY - startY : 0
    const result = classifyCardSwipe(dx, dy, { alreadyLocked: locked })
    const commit = result.shouldCommit
    const commitIntent = result.intent
    reset()
    if (!commit) return
    if (typeof navigator !== 'undefined') navigator.vibrate?.(10)
    if (commitIntent === 'like') opts.onLike()
    else if (commitIntent === 'reply') opts.onReply()
  }

  const onTouchCancel = () => {
    reset()
  }

  const bind = (node: HTMLElement | null) => {
    if (el === node) return
    if (el) {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
    }
    el = node
    if (!el) return
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchCancel, { passive: true })
  }

  onUnmounted(() => bind(null))

  return {
    offset,
    intent,
    dragging,
    bind,
    reset,
  }
}

/** Pointer → card-local coords for the floating heart burst. */
export function localBurstPoint(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top'>,
) {
  return { x: clientX - rect.left, y: clientY - rect.top }
}

/**
 * Flip hammock content taps expand in place; scroll-view cards still open the thread.
 * Exported for unit tests — keep in sync with RealPostCard `onContentClick`.
 */
export function resolveFlipContentClick(opts: {
  isFlip: boolean
  overflows: boolean
  expanded: boolean
}): 'toggle-expand' | 'noop' | 'open-thread' {
  if (opts.isFlip) {
    if (opts.overflows || opts.expanded) return 'toggle-expand'
    return 'noop'
  }
  return 'open-thread'
}
