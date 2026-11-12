import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSameAppOrigin } from '../app/utils/openExternal'

describe('isSameAppOrigin', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('treats same-origin paths as in-app', () => {
    vi.stubGlobal('window', { location: { href: 'https://localhost/home', origin: 'https://localhost' } })
    expect(isSameAppOrigin('/auth/callback')).toBe(true)
    expect(isSameAppOrigin('https://localhost/profile')).toBe(true)
  })

  it('rejects foreign https hosts', () => {
    vi.stubGlobal('window', { location: { href: 'https://localhost/', origin: 'https://localhost' } })
    expect(isSameAppOrigin('https://mastodon.social/oauth/authorize')).toBe(false)
  })

  it('treats LoomSpace custom schemes as in-app', () => {
    vi.stubGlobal('window', { location: { href: 'https://localhost/', origin: 'https://localhost' } })
    expect(isSameAppOrigin('loomspace://auth/callback?code=1')).toBe(true)
    expect(isSameAppOrigin('neospace://auth/callback')).toBe(true)
  })
})
