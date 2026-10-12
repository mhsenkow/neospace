import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  draftGroupTag,
  draftQuoteUrl,
  draftStorageKey,
  listAccountDrafts,
  parseDraftRecord,
  readDraft,
  writeDraft,
  DRAFT_SCHEMA_VERSION,
} from '../app/composables/useDraft'
import { parseMediaId, postFormWithProgress, UploadProtocolError } from '../app/utils/mediaUpload'
import { parseRetryAfterMs, useStatusStore } from '../app/stores/status'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('drafts — recency, schema, context', () => {
  let store: ReturnType<typeof memoryStorage>
  beforeEach(() => {
    store = memoryStorage()
    vi.stubGlobal('localStorage', store)
  })

  it('lists the most recently edited draft first, legacy (undated) records last', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    writeDraft(draftStorageKey('a', 'zzz'), { text: 'older', spoiler: '', visibility: '' })
    vi.setSystemTime(2_000)
    writeDraft(draftStorageKey('a', 'aaa'), { text: 'newer', spoiler: '', visibility: '' })
    store.setItem(draftStorageKey('a', 'legacy'), JSON.stringify({ text: 'old format' }))
    expect(listAccountDrafts('a').map((d) => d.key)).toEqual(['aaa', 'zzz', 'legacy'])
  })

  it('writes a schema version and rejects malformed or future records', () => {
    writeDraft(draftStorageKey('a', 'new'), { text: 'hi', spoiler: '', visibility: '' })
    expect(JSON.parse(store.getItem(draftStorageKey('a', 'new'))!).v).toBe(DRAFT_SCHEMA_VERSION)
    expect(parseDraftRecord('[1,2]')).toBeNull()
    expect(parseDraftRecord('null')).toBeNull()
    expect(parseDraftRecord('"text"')).toBeNull()
    expect(parseDraftRecord(JSON.stringify({ v: DRAFT_SCHEMA_VERSION + 1, text: 'x' }))).toBeNull()
    expect(parseDraftRecord(JSON.stringify({ v: 'nope', text: 'x' }))).toBeNull()
    expect(parseDraftRecord(JSON.stringify({ text: 'legacy' }))?.payload.text).toBe('legacy')
    store.setItem(draftStorageKey('a', 'future'), JSON.stringify({ v: 99, text: 'x' }))
    expect(readDraft(draftStorageKey('a', 'future'))).toBeNull()
  })

  it('decodes group and quote context from draft keys safely', () => {
    expect(draftGroupTag('group:cats')).toBe('cats')
    expect(draftGroupTag('group:ca ts')).toBeNull()
    expect(draftGroupTag('new')).toBeNull()
    expect(draftQuoteUrl('quote:https://m.example/@a/1')).toBe('https://m.example/@a/1')
    expect(draftQuoteUrl('quote:javascript:alert(1)')).toBeNull()
    expect(draftQuoteUrl('reply:1')).toBeNull()
  })
})

describe('media upload boundaries', () => {
  it('flags non-object 2xx bodies as malformed', async () => {
    for (const body of ['[]', 'null', '<html></html>', '']) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
      const res = await postFormWithProgress('https://x.example', new FormData())
      expect(res.malformed).toBe(true)
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":"1"}', { status: 200 })))
    expect((await postFormWithProgress('https://x.example', new FormData())).malformed).toBeUndefined()
  })

  it('accepts only plausible media ids', () => {
    expect(parseMediaId('109876543210')).toBe('109876543210')
    expect(parseMediaId(42)).toBe('42')
    expect(parseMediaId({})).toBeNull()
    expect(parseMediaId('')).toBeNull()
    expect(parseMediaId('a b')).toBeNull()
    expect(parseMediaId(null)).toBeNull()
    expect(new UploadProtocolError().name).toBe('UploadProtocolError')
  })

  it('parses Retry-After seconds and caps it', () => {
    expect(parseRetryAfterMs('2')).toBe(2000)
    expect(parseRetryAfterMs('9999')).toBe(10_000)
    expect(parseRetryAfterMs(null)).toBe(0)
    expect(parseRetryAfterMs('garbage')).toBe(0)
  })
})

describe('waitForMediaProcessing', () => {
  const creds = { url: 'https://m.example', accessToken: 't' }
  beforeEach(() => setActivePinia(createPinia()))

  it('recovers from a transient failure without re-uploading and leaves no abort listeners', async () => {
    vi.useFakeTimers()
    const responses = [
      new Response('', { status: 503, headers: { 'Retry-After': '1' } }),
      new Response(JSON.stringify({ url: 'https://m.example/a.png' }), { status: 200 }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!))
    const ctrl = new AbortController()
    const add = vi.spyOn(ctrl.signal, 'addEventListener')
    const remove = vi.spyOn(ctrl.signal, 'removeEventListener')
    const p = useStatusStore().waitForMediaProcessing('7', creds, ctrl.signal, 60_000)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toMatchObject({ state: 'ready' })
    expect(add.mock.calls.length).toBe(remove.mock.calls.length)
  })

  it('gives the attachment back as processing after repeated transient failures', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    const p = useStatusStore().waitForMediaProcessing('7', creds, undefined, 120_000)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toEqual({ state: 'processing' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

describe('scheduled post helpers', () => {
  it('previews only the warning for content-warned posts, exposing the body deliberately', async () => {
    const { scheduledPreview, scheduledHiddenBody } = await import('../app/utils/scheduledPosts')
    expect(scheduledPreview({ text: 'secret', spoilerText: 'food' })).toBe('CW: food')
    expect(scheduledHiddenBody({ text: 'secret', spoilerText: 'food' })).toBe('secret')
    expect(scheduledHiddenBody({ text: 'plain' })).toBeNull()
  })

  it('rejects local times that do not exist or are too soon, accepts exact instants', async () => {
    const { checkLocalSchedule } = await import('../app/utils/scheduledPosts')
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(checkLocalSchedule('nope', now)).toEqual({ ok: false, reason: 'invalid' })
    expect(checkLocalSchedule('2030-02-31T10:00', now).ok).toBe(false)
    expect(checkLocalSchedule('2026-01-01T00:01:00Z', now)).toEqual({ ok: false, reason: 'too-soon' })
    expect(checkLocalSchedule('2030-06-01T10:00:00Z', now)).toEqual({
      ok: true,
      iso: '2030-06-01T10:00:00.000Z',
    })
  })

  it('detects a spring-forward gap in a DST zone', async () => {
    const { checkLocalSchedule } = await import('../app/utils/scheduledPosts')
    const tz = process.env.TZ
    // 2030-03-10 02:30 does not exist in US Eastern time; the zone is read at call time on most V8 builds
    process.env.TZ = 'America/New_York'
    try {
      const res = checkLocalSchedule('2030-03-10T02:30', Date.parse('2026-01-01T00:00:00Z'))
      if (new Date('2030-03-10T02:30').getHours() !== 2) expect(res).toEqual({ ok: false, reason: 'nonexistent' })
      else expect(res.ok).toBe(true)
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
})

describe('server software detection', () => {
  it('does not call every bare semver Mastodon', async () => {
    const { detectServerSoftware } = await import('../app/utils/serverCapabilities')
    expect(detectServerSoftware('4.3.2')).toBe('unknown')
    expect(detectServerSoftware('4.3.2', 'https://github.com/mastodon/mastodon')).toBe('mastodon')
    expect(detectServerSoftware('4.4.0+glitch')).toBe('mastodon')
  })
})

describe('compose tokens', () => {
  it('replaces the whole token when the caret is in its middle', async () => {
    const { findComposeToken, applyToken } = await import('../app/utils/composeTokens')
    const text = 'hi @aliceb. ok'
    const token = findComposeToken(text, 6)! // @al|iceb.
    expect(token.query).toBe('al')
    expect(token.replaceEnd).toBe(10) // "@aliceb" — trailing "." stays
    expect(applyToken(text, token, '@alice@x.example').text).toBe('hi @alice@x.example . ok')
  })

  it('accepts combining marks in hashtags', async () => {
    const { findComposeToken } = await import('../app/utils/composeTokens')
    expect(findComposeToken('#कि', 3)?.query).toBe('कि')
    expect(findComposeToken('x #café', 7)?.query).toBe('café')
  })
})

describe('server input and error copy', () => {
  it('accepts IDN hosts as punycode and still rejects junk', async () => {
    const { normalizeServer } = await import('../app/utils/instances')
    expect(normalizeServer('bücher.social')).toBe('https://xn--bcher-kva.social')
    expect(normalizeServer('https://bücher.social/')).toBe('https://xn--bcher-kva.social')
    expect(normalizeServer('bü cher.social')).toBeNull()
    expect(normalizeServer('bücher')).toBeNull()
  })

  it('maps transport errors to calm copy and never echoes masto wording', async () => {
    const { friendlyServerError } = await import('../app/utils/instances')
    const { mapErrorToMessage } = await import('../app/utils/friendlyError')
    const { friendlyAuthError } = await import('../app/utils/authErrors')
    const named = (name: string, message: string) => Object.assign(new Error(message), { name })
    expect(friendlyServerError(named('MastoTimeoutError', 'Request timed out'))).toMatch(/too long/)
    expect(friendlyServerError(new Error('The operation timed out'))).toMatch(/too long/)
    expect(
      friendlyServerError(named('MastoUnexpectedError', 'The server returned data with an unknown encoding.')),
    ).toBe("That doesn't look like a Mastodon-compatible server.")
    expect(mapErrorToMessage(named('MastoUnexpectedError', 'unknown encoding')).detail).not.toMatch(/encoding/)
    expect(mapErrorToMessage(new Error('Unsafe API path segment')).detail).not.toMatch(/Unsafe/)
    expect(mapErrorToMessage(named('MastoHttpError', 'weird')).detail).not.toMatch(/weird/)
    // app-authored validation messages still show
    expect(mapErrorToMessage(new Error('Poll options must be different')).detail).toMatch(/Poll options/)
    expect(friendlyAuthError('invalid_scope')).toMatch(/doesn’t allow/)
    expect(friendlyAuthError('The operation was aborted due to timeout')).toMatch(/too long/)
    expect(friendlyAuthError('invalid_client')).toMatch(/reconnect/)
  })

  it('only calls the user offline when the browser says so', async () => {
    const { mapErrorToMessage } = await import('../app/utils/friendlyError')
    vi.stubGlobal('navigator', { onLine: true })
    expect(mapErrorToMessage(new TypeError('Failed to fetch')).title).toBe('Couldn’t reach the server')
    vi.stubGlobal('navigator', { onLine: false })
    expect(mapErrorToMessage(new TypeError('Failed to fetch')).title).toBe('You appear to be offline')
  })
})
