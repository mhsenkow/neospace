import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isUploadCancelled,
  isUploadTimeout,
  postFormWithProgress,
  UploadCancelledError,
  UploadTimeoutError,
  uploadFraction,
} from '../app/utils/mediaUpload'
import {
  isScheduledUnsupported,
  scheduledMetaSummary,
  scheduledPostMeta,
  scheduledPreview,
  toLocalInputValue,
  validRescheduleIso,
} from '../app/utils/scheduledPosts'

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

/** Minimal XMLHttpRequest double — drives the real XHR branch of postFormWithProgress */
class FakeXHR {
  static instances: FakeXHR[] = []
  static failOn: 'open' | 'send' | null = null
  upload: {
    onprogress?: (e: { loaded: number; total: number; lengthComputable: boolean }) => void
    onload?: () => void
  } = {}
  onload?: () => void
  onerror?: () => void
  onabort?: () => void
  status = 0
  responseText = ''
  headers: Record<string, string> = {}
  opened: [string, string] | null = null
  aborted = false

  constructor() {
    FakeXHR.instances.push(this)
  }
  open(method: string, url: string) {
    if (FakeXHR.failOn === 'open') throw new Error('open failed')
    this.opened = [method, url]
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }
  send() {
    if (FakeXHR.failOn === 'send') throw new Error('send failed')
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body)
    this.onload?.()
  }
}

describe('postFormWithProgress (XHR branch)', () => {
  const form = () => new FormData()
  const last = () => FakeXHR.instances[FakeXHR.instances.length - 1]!

  beforeEach(() => {
    FakeXHR.instances = []
    FakeXHR.failOn = null
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    // The fetch fallback must stay unused — a regression there can't mask an XHR break
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('fetch fallback used')
      }),
    )
  })
  afterEach(() => vi.useRealTimers())

  it('posts with auth headers and resolves the parsed response', async () => {
    const p = postFormWithProgress('https://x.example/api/v2/media', form(), {
      headers: { Authorization: 'Bearer t' },
    })
    expect(last().opened).toEqual(['POST', 'https://x.example/api/v2/media'])
    expect(last().headers).toEqual({ Authorization: 'Bearer t' })
    last().respond(202, { id: '9' })
    await expect(p).resolves.toEqual({ status: 202, body: { id: '9' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports real byte progress, null for unknown totals, and signals when sent', async () => {
    const progress: (number | null)[] = []
    let sent = 0
    const p = postFormWithProgress('https://x.example', form(), {
      onProgress: (f) => progress.push(f),
      onSent: () => sent++,
    })
    const xhr = last()
    xhr.upload.onprogress?.({ loaded: 25, total: 100, lengthComputable: true })
    xhr.upload.onprogress?.({ loaded: 50, total: 0, lengthComputable: false })
    xhr.upload.onprogress?.({ loaded: 100, total: 100, lengthComputable: true })
    expect(sent).toBe(0)
    xhr.upload.onload?.()
    expect(sent).toBe(1)
    xhr.respond(200, {})
    await p
    expect(progress).toEqual([0.25, null, 1])
  })

  it('treats a non-JSON body as empty and surfaces network errors', async () => {
    const ok = postFormWithProgress('https://x.example', form())
    last().respond(502, '<html>bad gateway</html>')
    await expect(ok).resolves.toEqual({ status: 502, body: {}, malformed: true })

    const down = postFormWithProgress('https://x.example', form())
    last().onerror?.()
    await expect(down).rejects.toThrow(/Network error/)
  })

  it('aborts the request when the caller aborts, as a cancellation', async () => {
    const user = new AbortController()
    const p = postFormWithProgress('https://x.example', form(), { signal: user.signal })
    user.abort()
    const err = await p.catch((e) => e)
    expect(last().aborted).toBe(true)
    expect(isUploadCancelled(err)).toBe(true)
    expect(isUploadTimeout(err)).toBe(false)
  })

  it('rejects without opening a request when already aborted', async () => {
    const c = new AbortController()
    c.abort()
    await expect(postFormWithProgress('https://x.example', form(), { signal: c.signal })).rejects.toBeInstanceOf(
      UploadCancelledError,
    )
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('aborts on timeout and reports it as a timeout, not a cancellation', async () => {
    vi.useFakeTimers()
    const p = postFormWithProgress('https://x.example', form(), { timeoutMs: 1000 })
    const settled = p.catch((e) => e)
    vi.advanceTimersByTime(1000)
    const err = await settled
    expect(last().aborted).toBe(true)
    expect(isUploadTimeout(err)).toBe(true)
    expect(isUploadCancelled(err)).toBe(false)
  })

  it('stops the timer and abort listener once the upload finishes', async () => {
    vi.useFakeTimers()
    const user = new AbortController()
    const remove = vi.spyOn(user.signal, 'removeEventListener')
    const p = postFormWithProgress('https://x.example', form(), { signal: user.signal, timeoutMs: 1000 })
    last().respond(200, {})
    await p
    expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it.each(['open', 'send'] as const)('cleans up when %s throws synchronously', async (stage) => {
    vi.useFakeTimers()
    FakeXHR.failOn = stage
    const user = new AbortController()
    const remove = vi.spyOn(user.signal, 'removeEventListener')
    await expect(
      postFormWithProgress('https://x.example', form(), { signal: user.signal, timeoutMs: 1000 }),
    ).rejects.toThrow(`${stage} failed`)
    expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
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
    expect(scheduledPreview({ text: 'x'.repeat(200) }, 20)).toHaveLength(20)
    // A content warning hides the body — only the warning shows
    expect(scheduledPreview({ text: 'secret', spoilerText: 'cw' })).toBe('CW: cw')
  })

  it('summarizes scheduled-post context for the queue', () => {
    const meta = scheduledPostMeta({
      visibility: 'unlisted',
      mediaIds: ['1', '2'],
      inReplyToId: '9',
      poll: { options: ['a', 'b', ''] },
    })
    expect(scheduledMetaSummary(meta)).toBe(
      'Unlisted · 2 attachments · Reply · Poll · 2 options',
    )
  })
})
