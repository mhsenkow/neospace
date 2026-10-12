import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isUploadCancelled,
  isUploadTimeout,
  postFormWithProgress,
  UploadCancelledError,
  UploadTimeoutError,
  uploadFraction,
} from '../app/utils/mediaUpload'
import { isScheduledUnsupported, toLocalInputValue, validRescheduleIso, scheduledPreview } from '../app/utils/scheduledPosts'

afterEach(() => vi.unstubAllGlobals())

describe('uploadFraction', () => {
  it('is null whenever the total is unknown — never an invented percentage', () => {
    expect(uploadFraction(10, 0)).toBeNull()
    expect(uploadFraction(10, NaN)).toBeNull()
    expect(uploadFraction(10, 100, false)).toBeNull()
    expect(uploadFraction(25, 100)).toBe(0.25)
    expect(uploadFraction(500, 100)).toBe(1)
  })
})

describe('postFormWithProgress (fetch fallback — no XHR in node)', () => {
  const form = () => new FormData()

  it('returns status and parsed body, reporting unknown progress as null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: '7' }), { status: 202 })),
    )
    const progress: (number | null)[] = []
    let sent = false
    const res = await postFormWithProgress('https://x.example/api/v2/media', form(), {
      onProgress: (f) => progress.push(f),
      onSent: () => (sent = true),
    })
    expect(res).toEqual({ status: 202, body: { id: '7' } })
    expect(progress).toEqual([null])
    expect(sent).toBe(true)
  })

  it('distinguishes a user abort from a timeout', async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
    )
    vi.stubGlobal('fetch', hang)

    const user = new AbortController()
    const p1 = postFormWithProgress('https://x.example', form(), { signal: user.signal })
    user.abort()
    const e1 = await p1.catch((e) => e)
    expect(isUploadCancelled(e1)).toBe(true)
    expect(isUploadTimeout(e1)).toBe(false)

    const e2 = await postFormWithProgress('https://x.example', form(), { timeoutMs: 5 }).catch((e) => e)
    expect(isUploadTimeout(e2)).toBe(true)
    expect(isUploadCancelled(e2)).toBe(false)
    expect(e1).toBeInstanceOf(UploadCancelledError)
    expect(e2).toBeInstanceOf(UploadTimeoutError)
  })

  it('rejects immediately when already aborted', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const c = new AbortController()
    c.abort()
    await expect(postFormWithProgress('https://x.example', form(), { signal: c.signal })).rejects.toBeInstanceOf(
      UploadCancelledError,
    )
  })
})

describe('scheduled post helpers', () => {
  it('detects unsupported servers by HTTP status only', () => {
    expect(isScheduledUnsupported({ statusCode: 404 })).toBe(true)
    expect(isScheduledUnsupported({ status: 501 })).toBe(true)
    expect(isScheduledUnsupported({ status: 500 })).toBe(false)
    expect(isScheduledUnsupported(new Error('Failed to fetch'))).toBe(false)
  })

  it('validates reschedule times (≥ 5 minutes ahead)', () => {
    const now = Date.parse('2026-10-12T12:00:00Z')
    expect(validRescheduleIso('2026-10-12T12:03:00Z', now)).toBeNull()
    expect(validRescheduleIso('not a date', now)).toBeNull()
    expect(validRescheduleIso('2026-10-12T12:06:00Z', now)).toBe('2026-10-12T12:06:00.000Z')
  })

  it('formats local input values and previews', () => {
    expect(toLocalInputValue('garbage')).toBe('')
    expect(toLocalInputValue('2026-10-12T12:06:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(scheduledPreview({ text: '  a\n\nb  ' })).toBe('a b')
    expect(scheduledPreview({ text: '', spoilerText: '' })).toBe('(no text)')
    expect(scheduledPreview({ text: 'x'.repeat(200), spoilerText: 'cw' }, 20)).toHaveLength(20)
  })
})
