import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mastodonLength } from '../app/utils/mastodonLength'
import { formatRelativeTime } from '../app/utils/relativeTime'
import { useComposeSheetStore } from '../app/stores/composeSheet'

describe('mastodonLength — URL edges', () => {
  it('does not swallow sentence punctuation after a link', () => {
    expect(mastodonLength('see https://example.com.')).toBe(4 + 23 + 1)
    expect(mastodonLength('https://a.co/x?!')).toBe(23 + 2)
    expect(mastodonLength('(https://a.co/path), ok')).toBe(1 + 23 + 2 + 3)
  })

  it('keeps counting links back to back after trimming', () => {
    expect(mastodonLength('https://a.co, https://b.co.')).toBe(23 + 2 + 23 + 1)
  })

  it('is stable across repeated calls (shared segmenter, global regex)', () => {
    const text = 'héllo 👩‍👩‍👧 @bob@x.y https://z.co'
    const first = mastodonLength(text)
    expect(mastodonLength(text)).toBe(first)
    expect(first).toBe(6 + 2 + 4 + 1 + 23)
  })
})

describe('formatRelativeTime — clock skew', () => {
  it('reads a few seconds in the future as now, not "in 20 seconds"', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    const future = now + 20_000
    const asNow = formatRelativeTime(now, now, 'en')
    expect(formatRelativeTime(future, now, 'en')).toBe(asNow)
  })

  it('still formats genuinely future times', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    expect(formatRelativeTime(now + 2 * 3_600_000, now, 'en')).toBe('in 2 hours')
  })
})

describe('composeSheet.posted', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('closes the sheet even when the onPosted callback throws', () => {
    const sheet = useComposeSheetStore()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    sheet.show({
      onPosted: () => {
        throw new Error('boom')
      },
    })
    expect(sheet.open).toBe(true)
    sheet.posted({ id: '1' } as never)
    expect(sheet.open).toBe(false)
    expect(sheet.onPosted).toBeNull()
    err.mockRestore()
  })

  it('swallows rejections from async callbacks', async () => {
    const sheet = useComposeSheetStore()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    sheet.show({ onPosted: (async () => { throw new Error('later') }) as never })
    sheet.posted({ id: '2' } as never)
    await new Promise((r) => setTimeout(r, 0))
    expect(err).toHaveBeenCalled()
    expect(sheet.open).toBe(false)
    err.mockRestore()
  })
})
