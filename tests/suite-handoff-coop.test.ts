import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { useComposeHandoffStore } from '../app/stores/composeHandoff'
import { useComposeSheetStore } from '../app/stores/composeSheet'
import { useLoomHandoff } from '../app/composables/useLoomHandoff'

/**
 * Suite → NeoSpace handoffs under the production opener policy.
 * public/_headers sends `Cross-Origin-Opener-Policy: same-origin`, which severs
 * `window.opener` for any cross-origin sibling that opened us. The `?compose=` query
 * is therefore the delivery path that must work; postMessage is a bonus that only
 * exists where the opener survives (local dev).
 */

const headers = readFileSync(fileURLToPath(new URL('../public/_headers', import.meta.url)), 'utf8')

vi.mock('~/composables/useMasto', () => ({
  clientFor: vi.fn(),
  activeClient: vi.fn(),
  activeCredentials: vi.fn(),
  publicClient: vi.fn(),
  createRestClient: vi.fn(),
  clearClientCache: vi.fn(),
}))

type Listener = (e: unknown) => void

function makeWindow(opener: unknown) {
  const listeners = new Set<Listener>()
  return {
    opener,
    listeners,
    addEventListener: (type: string, fn: Listener) => type === 'message' && listeners.add(fn),
    removeEventListener: (type: string, fn: Listener) => type === 'message' && listeners.delete(fn),
    matchMedia: () => ({ matches: true }), // phone layout → compose sheet
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    setInterval: (fn: () => void, ms?: number) => setInterval(fn, ms),
    clearInterval: (id: number) => clearInterval(id),
    dispatch(origin: string, data: unknown, source?: unknown) {
      for (const fn of [...listeners]) fn({ origin, data, source })
    },
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

function setup(opts: { opener: unknown; query?: Record<string, string>; path?: string }) {
  const win = makeWindow(opts.opener)
  const route = { path: opts.path ?? '/', query: { ...(opts.query || {}) } as Record<string, string> }
  const replace = vi.fn(async (to: { path?: string; query?: Record<string, string> }) => {
    if (to.path) route.path = to.path
    if (to.query) route.query = to.query
  })
  const store: Record<string, string> = {}
  vi.stubGlobal('window', win)
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  })
  vi.stubGlobal('useRouter', () => ({ replace }))
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('nextTick', () => Promise.resolve())
  vi.stubGlobal('watch', () => () => {})

  setActivePinia(createPinia())
  const instances = useInstancesStore()
  instances.instances = [
    { id: 'a', url: 'https://home.example', accessToken: 'tok', user: { id: '1', acct: 'me' } } as never,
  ]
  instances.activeAccountId = 'a'
  const sheet = useComposeSheetStore()
  const show = vi.spyOn(sheet, 'show')
  const handoff = useComposeHandoffStore()
  return { win, route, replace, show, handoff, api: useLoomHandoff() }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('production opener policy', () => {
  it('ships COOP same-origin, so cross-origin openers do not survive', () => {
    const all = headers.slice(headers.indexOf('/*'), headers.indexOf('\n\n', headers.indexOf('/*')))
    expect(all).toMatch(/^\s*Cross-Origin-Opener-Policy:\s*same-origin\s*$/m)
  })
})

describe.each([
  ['notebook', 'Cell from the notebook'],
  ['bruh', 'Page excerpt from bruh'],
  ['loom', 'Chart caption from Loom'],
])('%s share under COOP (window.opener severed)', (source, text) => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))

  it('does not rely on the opener: no ready pings, no throw', () => {
    const { api, win } = setup({ opener: null, query: { compose: source, text } })
    const stop = api.registerLoomListeners()
    expect(win.listeners.size).toBe(1)
    stop()
    expect(win.listeners.size).toBe(0)
  })

  it('arrives once via the query fallback with the expected content', async () => {
    const { api, route, replace, show, handoff } = setup({ opener: null, query: { compose: source, text } })
    api.registerLoomListeners()
    await api.bootLoomHandoff()

    expect(handoff.pending?.text).toBe(text)
    expect(show).toHaveBeenCalledTimes(1)
    // The compose params are dropped so refresh / back can't re-fire the share
    expect(route.query).toEqual({})
    expect(replace.mock.calls.every(([to]) => !JSON.stringify(to).includes('compose'))).toBe(true)
  })

  it('signed-out: waits behind login, then delivers once after sign-in', async () => {
    const { api, handoff, replace, show } = setup({ opener: null, query: { compose: source, text } })
    const instances = useInstancesStore()
    instances.instances = []
    await api.bootLoomHandoff()
    expect(handoff.pending).toBeNull()
    expect(replace).toHaveBeenCalledWith('/login')
    expect(sessionStorage.getItem('neospace_loom_share_v1')).toContain(text)
    expect(show).not.toHaveBeenCalled()
  })
})

describe('message delivery where the opener survives (local dev)', () => {
  it('delivers a notebook share once and acks every message; duplicates never reopen compose', async () => {
    const opener = { closed: false, postMessage: vi.fn() }
    const { api, win, handoff, show } = setup({ opener })
    api.registerLoomListeners()
    // ready pings reach the opener (that is how siblings know to send)
    expect(opener.postMessage).toHaveBeenCalledWith({ type: 'neospace-notebook-ready', v: 1 }, 'https://ibm.io')

    const msg = { type: 'notebook-neospace-share', v: 1, text: 'cell one' }
    win.dispatch('https://ibm.io', msg)
    await flush()
    win.dispatch('https://ibm.io', msg)
    await flush()

    expect(handoff.pending?.text).toBe('cell one')
    expect(show).toHaveBeenCalledTimes(1)
    const acks = opener.postMessage.mock.calls.filter(([m]) => m?.type === 'neospace-notebook-ack')
    expect(acks).toHaveLength(2)
    expect(acks.every(([, origin]) => origin === 'https://ibm.io')).toBe(true)
  })

  it('routes a Loom share from loom.ibm.io to the Loom handler (not the notebook one)', async () => {
    const opener = { closed: false, postMessage: vi.fn() }
    const { api, win, handoff } = setup({ opener })
    api.registerLoomListeners()
    win.dispatch('https://loom.ibm.io', { type: 'loom-neospace-share', v: 1, text: 'chart caption', story: '' })
    await flush()
    expect(handoff.pending?.text).toBe('chart caption')
    expect(opener.postMessage.mock.calls.some(([m]) => m?.type === 'neospace-loom-ack')).toBe(true)
  })

  it('does not let a notebook-origin sender deliver a Loom or bruh share', async () => {
    const opener = { closed: false, postMessage: vi.fn() }
    const { api, win, handoff } = setup({ opener })
    api.registerLoomListeners()
    win.dispatch('https://ibm.io', { type: 'loom-neospace-share', v: 1, text: 'spoof', story: '' })
    win.dispatch('https://ibm.io', { type: 'bruh-neospace-share', v: 1, text: 'spoof' })
    await flush()
    expect(handoff.pending).toBeNull()
  })

  it('acks the window that sent the share, not only window.opener', async () => {
    const opener = { closed: false, postMessage: vi.fn() }
    const sender = { closed: false, postMessage: vi.fn() }
    const { api, win } = setup({ opener })
    api.registerLoomListeners()
    opener.postMessage.mockClear()
    win.dispatch('https://ibm.io', { type: 'notebook-neospace-share', v: 1, text: 'cell' }, sender)
    await flush()
    expect(sender.postMessage).toHaveBeenCalledWith({ type: 'neospace-notebook-ack', v: 1 }, 'https://ibm.io')
    expect(opener.postMessage.mock.calls.some(([m]) => m?.type === 'neospace-notebook-ack')).toBe(false)
  })

  it('ignores shares from origins outside the suite', async () => {
    const opener = { closed: false, postMessage: vi.fn() }
    const { api, win, handoff, show } = setup({ opener })
    api.registerLoomListeners()
    win.dispatch('https://evil.example', { type: 'notebook-neospace-share', v: 1, text: 'nope' })
    await flush()
    expect(handoff.pending).toBeNull()
    expect(show).not.toHaveBeenCalled()
  })
})
