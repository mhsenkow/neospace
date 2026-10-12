import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { provenOwnStatus, sameActingAccount, type ActingAccount } from '../app/utils/statusOwnership'
import {
  buildDeletedStatusEvent,
  dropDeletedStatus,
  matchesDeletedStatus,
} from '../app/utils/deletedStatus'
import {
  classifyStatusSourceError,
  discardRedraftSnapshot,
  redraftSlot,
  saveRedraftSnapshot,
} from '../app/utils/redraft'
import { draftStorageKey, readDraft } from '../app/composables/useDraft'
import { useInstancesStore } from '../app/stores/instances'
import { useStatusStore } from '../app/stores/status'

const me: ActingAccount = { id: 'inst-a', url: 'https://home.example', userId: '42' }

const post = (over: Record<string, unknown> = {}) => ({
  id: '100',
  uri: 'https://home.example/users/me/statuses/100',
  url: 'https://home.example/@me/100',
  account: { id: '42' },
  _instanceId: 'inst-a',
  _instanceUrl: 'https://home.example',
  ...over,
})

describe('provenOwnStatus (NS-010)', () => {
  it('allows an own post served by the acting server', () => {
    const s = post()
    expect(provenOwnStatus(s, s, me)).toBe(true)
  })

  it('fails closed when the post carries no origin tag', () => {
    const s = post({ _instanceId: undefined, _instanceUrl: undefined })
    expect(provenOwnStatus(s, s, me)).toBe(false)
  })

  it('rejects a same-id author fetched from another server', () => {
    const s = post({ _instanceId: 'inst-b', _instanceUrl: 'https://remote.example' })
    expect(provenOwnStatus(s, s, me)).toBe(false)
  })

  it('rejects another author even on the acting server', () => {
    const s = post({ account: { id: '7' } })
    expect(provenOwnStatus(s, s, me)).toBe(false)
  })

  it('takes the origin from a boost wrapper when the original is untagged', () => {
    const original = post({ _instanceId: undefined, _instanceUrl: undefined })
    const wrapper = post({ id: '200', account: { id: '9' } })
    expect(provenOwnStatus(original, wrapper, me)).toBe(true)
  })

  it('needs an acting account at all', () => {
    const s = post()
    expect(provenOwnStatus(s, s, null)).toBe(false)
  })

  it('detects an account switch', () => {
    expect(sameActingAccount(me, { ...me })).toBe(true)
    expect(sameActingAccount(me, { ...me, id: 'inst-b', userId: '9' })).toBe(false)
    expect(sameActingAccount(me, null)).toBe(false)
  })
})

describe('canonical deletion events (NS-004 / NS-009)', () => {
  const event = buildDeletedStatusEvent(
    { id: '100', uri: 'https://home.example/users/me/statuses/100', url: 'https://home.example/@me/100' },
    { id: 'inst-a', url: 'https://home.example' },
  )

  it('removes the deleted post and a boost of it', () => {
    const boost = {
      id: '555',
      reblog: { id: '9000', uri: 'https://home.example/users/me/statuses/100' },
      _instanceUrl: 'https://other.example',
    }
    expect(matchesDeletedStatus(post(), event)).toBe(true)
    expect(matchesDeletedStatus(boost, event)).toBe(true)
  })

  it('keeps a different post that shares the bare id on another server', () => {
    const stranger = {
      id: '100',
      uri: 'https://remote.example/users/bob/statuses/100',
      _instanceUrl: 'https://remote.example',
    }
    const strangerBoost = { id: '3', reblog: { id: '100', uri: 'https://remote.example/users/bob/statuses/100' } }
    expect(matchesDeletedStatus(stranger, event)).toBe(false)
    expect(matchesDeletedStatus(strangerBoost, event)).toBe(false)
  })

  it('compares uri-less copies by id only on the same origin host', () => {
    expect(matchesDeletedStatus({ id: '100', _instanceUrl: 'https://home.example' }, event)).toBe(true)
    expect(matchesDeletedStatus({ id: '100', _instanceUrl: 'https://remote.example' }, event)).toBe(false)
    expect(matchesDeletedStatus({ id: '100' }, event)).toBe(false)
  })

  it('drops only matches and returns the same array when nothing matched', () => {
    const keep = { id: '100', uri: 'https://remote.example/s/100', _instanceUrl: 'https://remote.example' }
    const list = [post(), keep]
    expect(dropDeletedStatus(list, event)).toEqual([keep])
    const untouched = [keep]
    expect(dropDeletedStatus(untouched, event)).toBe(untouched)
  })
})

describe('status source outcomes (NS-008)', () => {
  it('only a missing endpoint is "unsupported"', () => {
    expect(classifyStatusSourceError({ status: 404 })).toBe('unsupported')
    expect(classifyStatusSourceError({ status: 501 })).toBe('unsupported')
  })

  it('treats auth, rate limits, 5xx and offline as non-fallback failures', () => {
    expect(classifyStatusSourceError({ status: 401 })).toBe('auth')
    expect(classifyStatusSourceError({ status: 403 })).toBe('auth')
    expect(classifyStatusSourceError({ status: 429 })).toBe('network')
    expect(classifyStatusSourceError({ status: 503 })).toBe('network')
    expect(classifyStatusSourceError(new TypeError('Failed to fetch'))).toBe('network')
    expect(classifyStatusSourceError(new Error('weird'))).toBe('unknown')
  })
})

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('redraft snapshot (NS-007)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

  it('persists text / CW / visibility under the captured account before deletion', () => {
    const result = saveRedraftSnapshot('inst-a', '100', { text: 'hello', spoilerText: 'cw', visibility: 'unlisted' })
    expect(result.ok).toBe(true)
    expect(readDraft(draftStorageKey('inst-a', redraftSlot('100')))).toEqual({
      text: 'hello',
      spoiler: 'cw',
      visibility: 'unlisted',
    })
    // Another account never sees it
    expect(readDraft(draftStorageKey('inst-b', redraftSlot('100')))).toBeNull()
  })

  it('reports a failed save instead of pretending it is recoverable', () => {
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('quota')
      },
    })
    const result = saveRedraftSnapshot('inst-a', '100', { text: 'hello', spoilerText: '', visibility: 'public' })
    expect(result).toEqual({ ok: false, reason: 'storage' })
  })

  it('removes the snapshot when the delete definitely did not happen', () => {
    saveRedraftSnapshot('inst-a', '100', { text: 'hello', spoilerText: '', visibility: 'public' })
    discardRedraftSnapshot('inst-a', '100')
    expect(readDraft(draftStorageKey('inst-a', redraftSlot('100')))).toBeNull()
  })
})

describe('account-bound status API (NS-005 / NS-006)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [
      { id: 'inst-a', url: 'https://home.example/', accessToken: 'tok-a', user: { id: '42' } },
      { id: 'inst-b', url: 'https://other.example', accessToken: 'tok-b', user: { id: '9' } },
    ] as never
    instances.activeAccountId = 'inst-b' // the user switched away after confirming on inst-a
  })

  it('deletes through the captured account, not the active one', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'src' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await useStatusStore().deleteStatus('100', 'inst-a')

    expect(result.text).toBe('src')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://home.example/api/v1/statuses/100')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-a')
  })

  it('refuses an account that is no longer signed in', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(useStatusStore().deleteStatus('100', 'gone')).rejects.toThrow(/no longer signed in/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exposes the HTTP status of a refused delete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    await expect(useStatusStore().deleteStatus('100', 'inst-a')).rejects.toMatchObject({ status: 403 })
  })

  it('types an unreachable source fetch as network, not unsupported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const outcome = await useStatusStore().fetchStatusSource('100', 'inst-a')
    expect(outcome).toMatchObject({ ok: false, reason: 'network' })
  })

  it('types a missing /source route as unsupported', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Record not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })),
    )
    const outcome = await useStatusStore().fetchStatusSource('100', 'inst-a')
    expect(outcome).toMatchObject({ ok: false, reason: 'unsupported' })
  })
})
