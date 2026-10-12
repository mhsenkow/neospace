import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCachedOAuthApp,
  oauthFetch,
  parseOAuthResponse,
  readCachedOAuthApp,
  requireAccessToken,
  writeCachedOAuthApp,
} from '../app/utils/oauthApp'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

const id = { redirectUri: 'https://neo.example/auth/callback', scopes: 'read write follow push' }

describe('OAuth app cache identity', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('reuses a registration only for the same callback and scopes', () => {
    writeCachedOAuthApp('M.Example', 'cid', 'sec', id)
    expect(readCachedOAuthApp('m.example', id)).toEqual({ clientId: 'cid', clientSecret: 'sec' })
    expect(readCachedOAuthApp('m.example', { ...id, redirectUri: 'https://other.example/cb' })).toBeNull()
    expect(readCachedOAuthApp('m.example', { ...id, scopes: 'read' })).toBeNull()
  })

  it('treats legacy entries (no identity) as stale when identity is required', () => {
    localStorage.setItem(
      'neospace_oauth_apps',
      JSON.stringify({ 'm.example': { clientId: 'old', clientSecret: 'old' } }),
    )
    expect(readCachedOAuthApp('m.example')).toEqual({ clientId: 'old', clientSecret: 'old' })
    expect(readCachedOAuthApp('m.example', id)).toBeNull()
  })

  it('recovers from a rejected client: clear once, re-register, no stale reuse', () => {
    writeCachedOAuthApp('m.example', 'bad', 'bad', id)
    // server answered invalid_client
    clearCachedOAuthApp('https://m.example')
    expect(readCachedOAuthApp('m.example', id)).toBeNull()
    writeCachedOAuthApp('m.example', 'fresh', 'fresh', id)
    expect(readCachedOAuthApp('m.example', id)?.clientId).toBe('fresh')
  })

  it('survives a corrupt cache blob and prunes beyond its bound', () => {
    localStorage.setItem('neospace_oauth_apps', '[1,2]')
    expect(readCachedOAuthApp('m.example', id)).toBeNull()
    for (let i = 0; i < 40; i++) writeCachedOAuthApp(`h${i}.example`, `c${i}`, `s${i}`, id)
    expect(readCachedOAuthApp('h0.example', id)).toBeNull()
    expect(readCachedOAuthApp('h39.example', id)?.clientId).toBe('c39')
  })
})

describe('token response validation', () => {
  it('rejects null, arrays and wrong field types with friendly errors', async () => {
    await expect(parseOAuthResponse(new Response('null'))).rejects.toThrow(/unexpected response/)
    await expect(parseOAuthResponse(new Response('[]'))).rejects.toThrow(/unexpected response/)
    await expect(parseOAuthResponse(new Response('<html>'))).rejects.toThrow(/error page/)
    expect(() => requireAccessToken({ access_token: 5 })).toThrow(/no access token/)
    expect(() => requireAccessToken({ access_token: '  ' })).toThrow(/no access token/)
    expect(() => requireAccessToken({ access_token: 't', token_type: 3 })).toThrow(/unexpected/)
    expect(requireAccessToken({ access_token: 'tok', token_type: 'Bearer' })).toBe('tok')
  })
})

describe('oauthFetch cancellation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('aborts when the caller aborts while keeping the timeout signal', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: string, init: RequestInit) => {
        seen = init.signal as AbortSignal
        return new Promise((_res, rej) =>
          seen!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))),
        )
      }),
    )
    const caller = new AbortController()
    const p = oauthFetch('https://m.example/oauth/token', { method: 'POST', signal: caller.signal })
    expect(seen!.aborted).toBe(false)
    caller.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen!.aborted).toBe(true)
  })

  it('still times out without a caller signal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return new Response('{}')
    }))
    await oauthFetch('https://m.example/x', {})
  })
})

describe('pending sign-in records', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    }
  }

  it('keeps one record per state so two tabs both keep add mode and returnTo', async () => {
    const { beginOAuthChallenge, consumeOAuthChallenge, peekPendingAuth, clearPendingAuth } = await import(
      '../app/utils/oauthPkce'
    )
    vi.stubGlobal('localStorage', mem())
    vi.stubGlobal('sessionStorage', mem())
    const a = await beginOAuthChallenge({ instanceId: 'A', host: 'a.example', addMode: true, returnTo: '/profile' })
    const b = await beginOAuthChallenge({ instanceId: 'B', host: 'b.example', returnTo: '/explore' })
    expect(peekPendingAuth(a.state)).toMatchObject({ instanceId: 'A', addMode: true, returnTo: '/profile' })
    expect(peekPendingAuth(b.state)).toMatchObject({ instanceId: 'B', addMode: false })
    const resA = consumeOAuthChallenge(a.state)
    expect(resA.pending).toMatchObject({ addMode: true, returnTo: '/profile' })
    // clearing A leaves B untouched
    clearPendingAuth(a.state)
    expect(peekPendingAuth(a.state)).toBeNull()
    expect(peekPendingAuth(b.state)).not.toBeNull()
    vi.unstubAllGlobals()
  })

  it('prunes expired records and migrates the legacy single-slot shape', async () => {
    const { peekPendingAuth } = await import('../app/utils/oauthPkce')
    const ls = mem()
    vi.stubGlobal('localStorage', ls)
    vi.stubGlobal('sessionStorage', mem())
    const base = { verifier: 'v', instanceId: 'A', host: 'a', addMode: false, returnTo: null }
    ls.setItem('neospace_pending_auth', JSON.stringify({ ...base, state: 'old-slot', createdAt: Date.now() }))
    expect(peekPendingAuth('old-slot')).not.toBeNull()
    expect(Object.keys(JSON.parse(ls.getItem('neospace_pending_auth')!))).toEqual(['old-slot'])
    ls.setItem(
      'neospace_pending_auth',
      JSON.stringify({ stale: { ...base, state: 'stale', createdAt: Date.now() - 11 * 60 * 1000 } }),
    )
    expect(peekPendingAuth('stale')).toBeNull()
    expect(ls.getItem('neospace_pending_auth')).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('readerForUrl', () => {
  it('prefers the active account on the host and skips expired slots', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    const { useInstancesStore } = await import('../app/stores/instances')
    const { readerForUrl } = await import('../app/composables/useMasto')
    setActivePinia(createPinia())
    const store = useInstancesStore()
    const slot = (id: string, token: string | null) =>
      ({ id, url: 'https://m.example', accessToken: token, user: { id } }) as never
    store.instances = [slot('expired', null), slot('one', 'tok-1'), slot('two', 'tok-2')]
    store.activeAccountId = 'two'
    expect(readerForUrl('https://m.example/')?.accessToken).toBe('tok-2')
    store.activeAccountId = 'expired'
    expect(readerForUrl('https://m.example')?.accessToken).toBe('tok-1')
    expect(readerForUrl('https://other.example')).toBeNull()
  })
})
