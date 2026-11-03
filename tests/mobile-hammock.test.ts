import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  CARD_SWIPE_SLOP_PX,
  CARD_SWIPE_THRESHOLD_PX,
  classifyCardSwipe,
  localBurstPoint,
  resolveFlipContentClick,
} from '../app/composables/useCardSwipeActions'
import { useOverlayStore } from '../app/stores/overlay'
import type { mastodon } from 'masto'

const status = (over: Partial<mastodon.v1.Status> = {}): mastodon.v1.Status =>
  ({
    id: '42',
    uri: 'https://example.com/users/a/statuses/42',
    url: 'https://example.com/@a/42',
    content: '<p>Hello hammock</p>',
    account: {
      id: '1',
      username: 'a',
      acct: 'a@example.com',
      displayName: 'A',
      avatar: '',
    },
    repliesCount: 3,
    ...over,
  }) as mastodon.v1.Status

describe('classifyCardSwipe', () => {
  it('stays unlocked inside the slop radius', () => {
    const r = classifyCardSwipe(8, 2)
    expect(r.locked).toBe(false)
    expect(r.intent).toBe('none')
    expect(r.shouldCommit).toBe(false)
    expect(r.offset).toBe(0)
  })

  it('rejects vertical-ish drags so the feed can scroll', () => {
    const r = classifyCardSwipe(20, 30)
    expect(r.locked).toBe(false)
    expect(r.intent).toBe('none')
  })

  it('locks right pulls as like past the threshold', () => {
    const r = classifyCardSwipe(CARD_SWIPE_THRESHOLD_PX + 4, 4)
    expect(r.locked).toBe(true)
    expect(r.intent).toBe('like')
    expect(r.shouldCommit).toBe(true)
    expect(r.offset).toBeGreaterThan(0)
  })

  it('locks left pulls as reply', () => {
    const r = classifyCardSwipe(-(CARD_SWIPE_THRESHOLD_PX + 8), -3)
    expect(r.locked).toBe(true)
    expect(r.intent).toBe('reply')
    expect(r.shouldCommit).toBe(true)
    expect(r.offset).toBeLessThan(0)
  })

  it('locks without committing when still under the threshold', () => {
    const dx = Math.max(CARD_SWIPE_SLOP_PX + 2, CARD_SWIPE_THRESHOLD_PX - 10)
    const r = classifyCardSwipe(dx, 1)
    expect(r.locked).toBe(true)
    expect(r.intent).toBe('like')
    expect(r.shouldCommit).toBe(false)
  })

  it('honors alreadyLocked so a started gesture can finish', () => {
    const r = classifyCardSwipe(10, 40, { alreadyLocked: true })
    expect(r.locked).toBe(true)
    expect(r.intent).toBe('like')
  })
})

describe('overlay thread peek', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('opens with the parent status and focus flag', () => {
    const overlay = useOverlayStore()
    const s = status()
    const onReplied = vi.fn()
    overlay.openThreadPeek({ status: s, focusInput: true, onReplied })
    expect(overlay.threadPeek.open).toBe(true)
    expect(overlay.threadPeek.status?.id).toBe('42')
    expect(overlay.threadPeek.focusInput).toBe(true)
    overlay.notifyThreadPeekReplied(status({ id: '99' }))
    expect(onReplied).toHaveBeenCalledOnce()
    expect(onReplied.mock.calls[0]![0].id).toBe('99')
  })

  it('clears state on close', () => {
    const overlay = useOverlayStore()
    overlay.openThreadPeek({ status: status(), focusInput: false })
    overlay.closeThreadPeek()
    expect(overlay.threadPeek).toEqual({
      open: false,
      status: null,
      focusInput: false,
    })
    // Callback must not fire after close
    const spy = vi.fn()
    overlay.openThreadPeek({ status: status(), onReplied: spy })
    overlay.closeThreadPeek()
    overlay.notifyThreadPeekReplied(status({ id: 'x' }))
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('flip hammock helpers', () => {
  it('maps client coords into card-local burst position', () => {
    expect(localBurstPoint(120, 340, { left: 20, top: 100 })).toEqual({ x: 100, y: 240 })
  })

  it('never navigates away on Flip content taps', () => {
    expect(
      resolveFlipContentClick({ isFlip: true, overflows: true, expanded: false }),
    ).toBe('toggle-expand')
    expect(
      resolveFlipContentClick({ isFlip: true, overflows: false, expanded: true }),
    ).toBe('toggle-expand')
    expect(
      resolveFlipContentClick({ isFlip: true, overflows: false, expanded: false }),
    ).toBe('noop')
  })

  it('still opens the thread from scroll-view cards', () => {
    expect(
      resolveFlipContentClick({ isFlip: false, overflows: true, expanded: false }),
    ).toBe('open-thread')
  })
})
