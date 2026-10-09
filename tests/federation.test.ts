import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  authorizeInteractionUrl,
  classifyFederationError,
  federationMessage,
  isTransient,
  resolveCandidates,
} from '../app/utils/federation'
import { useStatusStore } from '../app/stores/status'

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { statusCode: status })

describe('classifyFederationError', () => {
  it('maps HTTP statuses to what went wrong', () => {
    expect(classifyFederationError(httpError(404))).toBe('unreachable')
    expect(classifyFederationError(httpError(422))).toBe('unreachable')
    expect(classifyFederationError(httpError(403))).toBe('forbidden')
    expect(classifyFederationError(httpError(429))).toBe('rate-limited')
    expect(classifyFederationError(httpError(503))).toBe('timeout')
    expect(classifyFederationError(new Error('Request timed out'))).toBe('timeout')
  })

  it('only retries the transient ones', () => {
    expect(isTransient('timeout')).toBe(true)
    expect(isTransient('rate-limited')).toBe(true)
    expect(isTransient('unreachable')).toBe(false)
    expect(isTransient('forbidden')).toBe(false)
  })
})

describe('messages + hand-off', () => {
  it('names both servers', () => {
    const m = federationMessage('unreachable', 'like', { home: 'fosstodon.org', origin: 'woof.group' })
    expect(m).toContain('fosstodon.org')
    expect(m).toContain('woof.group')
  })

  it("builds your server's remote-interaction URL", () => {
    expect(authorizeInteractionUrl('https://fosstodon.org/', 'https://woof.group/users/a/statuses/1')).toBe(
      'https://fosstodon.org/authorize_interaction?uri=https%3A%2F%2Fwoof.group%2Fusers%2Fa%2Fstatuses%2F1',
    )
  })

  it('orders resolve candidates, deduped, http only', () => {
    expect(
      resolveCandidates('https://a.social/users/x/statuses/1', null, 'https://a.social/@x/1', 'https://a.social/users/x/statuses/1', 'javascript:alert(1)'),
    ).toEqual(['https://a.social/users/x/statuses/1', 'https://a.social/@x/1'])
  })
})

describe('resolveStatusDetailed', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('falls back to the page URL when the ActivityPub id fails', async () => {
    const store = useStatusStore()
    const once = vi.spyOn(store, 'resolveStatusOnce').mockImplementation(async (url: string) => (url.includes('/@') ? '42' : null))
    const out = await store.resolveStatusDetailed(['https://a.social/users/x/statuses/1', 'https://a.social/@x/1'])
    expect(out).toEqual({ id: '42', failure: null })
    expect(once).toHaveBeenCalledTimes(2)
  })

  it('retries a slow remote once, then reports why', async () => {
    vi.useFakeTimers()
    const store = useStatusStore()
    const once = vi.spyOn(store, 'resolveStatusOnce').mockRejectedValue(httpError(503))
    const pending = store.resolveStatusDetailed(['https://slow.social/users/x/statuses/1'])
    await vi.advanceTimersByTimeAsync(1500)
    expect(await pending).toEqual({ id: null, failure: 'timeout' })
    expect(once).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('does not retry a hard refusal', async () => {
    const store = useStatusStore()
    const once = vi.spyOn(store, 'resolveStatusOnce').mockRejectedValue(httpError(403))
    expect(await store.resolveStatusDetailed(['https://locked.social/users/x/statuses/1'])).toEqual({
      id: null,
      failure: 'forbidden',
    })
    expect(once).toHaveBeenCalledTimes(1)
  })
})
