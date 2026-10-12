import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MAX_TOASTS, inferToastKind, useToastStore } from '../app/stores/toast'
import { firstVisibleCardIndex } from '../app/composables/useFeedKeyboard'
import { handleInText } from '../app/utils/edwardAffinity'
import { stripSortTokens } from '../app/utils/edwardExplore'
import { buildFeedbackBody } from '../app/utils/feedback'

describe('toast store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('infers error kind from failure copy and honours an explicit kind', () => {
    expect(inferToastKind("Couldn't send your vote")).toBe('error')
    expect(inferToastKind('Failed to load')).toBe('error')
    expect(inferToastKind('Posted')).toBe('info')
    expect(inferToastKind("Couldn't do it", 'success')).toBe('success')
  })

  it('merges identical messages instead of stacking them', () => {
    const toasts = useToastStore()
    const a = toasts.show({ message: 'You are offline' })
    const b = toasts.show({ message: 'You are offline' })
    expect(a).toBe(b)
    expect(toasts.toasts).toHaveLength(1)
  })

  it('keeps at most MAX_TOASTS, dropping the oldest', () => {
    const toasts = useToastStore()
    for (let i = 0; i < MAX_TOASTS + 2; i++) toasts.show({ message: `msg ${i}` })
    expect(toasts.toasts).toHaveLength(MAX_TOASTS)
    expect(toasts.toasts[0]!.message).toBe('msg 2')
  })

  it('does not merge toasts that differ by action label', () => {
    const toasts = useToastStore()
    toasts.show({ message: 'Deleted', actionLabel: 'Undo' })
    toasts.show({ message: 'Deleted' })
    expect(toasts.toasts).toHaveLength(2)
  })
})

describe('firstVisibleCardIndex', () => {
  const rects = [
    { top: -300, bottom: -100 },
    { top: -80, bottom: 120 },
    { top: 140, bottom: 340 },
  ]

  it('picks the first card intersecting the band', () => {
    expect(firstVisibleCardIndex(rects, 0, 500)).toBe(1)
  })

  it('falls back to the last card when everything is above the band', () => {
    expect(firstVisibleCardIndex(rects, 1000, 1200)).toBe(2)
  })

  it('returns -1 for an empty list', () => {
    expect(firstVisibleCardIndex([], 0, 500)).toBe(-1)
  })
})

describe('handleInText', () => {
  it('matches whole words, with or without @', () => {
    expect(handleInText('thanks @alice for this', 'alice')).toBe(true)
    expect(handleInText('Alice said hi', 'alice')).toBe(true)
  })

  it('does not match inside longer words or for short handles', () => {
    expect(handleInText('malicechat', 'alice')).toBe(false)
    expect(handleInText('the art of dev', 'art')).toBe(false)
    expect(handleInText('hello', null)).toBe(false)
  })
})

describe('stripSortTokens', () => {
  it('removes sort:x and bare sort words but keeps the rest', () => {
    expect(stripSortTokens('#cats sort:loud near photos')).toBe('#cats photos')
    expect(stripSortTokens('  shuffle   dogs ')).toBe('dogs')
  })
})

describe('buildFeedbackBody', () => {
  it('never attaches logs unless opted in', () => {
    expect(buildFeedbackBody('hi', false, 'SECRET')).toBe('hi')
  })

  it('attaches exactly the supplied log snapshot', () => {
    const out = buildFeedbackBody('hi', true, 'line one\nline two')
    expect(out).toContain('line one\nline two')
    expect(out.startsWith('hi')).toBe(true)
  })

  it('skips the block when the snapshot is empty', () => {
    expect(buildFeedbackBody('hi', true, '')).toBe('hi')
  })
})
