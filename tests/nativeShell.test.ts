import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NATIVE_OAUTH_REDIRECT_URI,
  NATIVE_OAUTH_SCHEME_REDIRECT,
  isOAuthCallbackUrl,
  oauthCallbackRouteFromUrl,
  oauthRedirectUri,
} from '../app/utils/nativeShell'

describe('nativeShell OAuth deep links', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the https Universal Link as a recognized callback', () => {
    expect(NATIVE_OAUTH_REDIRECT_URI).toBe('https://neospace.ibm.io/auth/callback')
  })

  it('uses the LoomSpace custom scheme as the native redirect_uri', () => {
    expect(NATIVE_OAUTH_SCHEME_REDIRECT).toBe('loomspace://auth/callback')
  })

  it('returns the custom scheme when running inside Capacitor', () => {
    vi.stubGlobal('window', {
      location: { origin: 'capacitor://localhost' },
      Capacitor: { isNativePlatform: () => true },
    })
    expect(oauthRedirectUri()).toBe(NATIVE_OAUTH_SCHEME_REDIRECT)
  })

  it('returns the page origin callback on the web', () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://neospace.ibm.io' },
      Capacitor: { isNativePlatform: () => false },
    })
    expect(oauthRedirectUri()).toBe('https://neospace.ibm.io/auth/callback')
  })

  it('recognizes https Universal Link callbacks', () => {
    expect(
      isOAuthCallbackUrl('https://neospace.ibm.io/auth/callback?code=abc&state=xyz'),
    ).toBe(true)
  })

  it('recognizes LoomSpace and legacy NeoSpace custom-scheme callbacks', () => {
    expect(isOAuthCallbackUrl('loomspace://auth/callback?code=abc&state=xyz')).toBe(true)
    expect(isOAuthCallbackUrl('neospace://auth/callback?code=abc&state=xyz')).toBe(true)
  })

  it('maps https callback URLs to the in-app route', () => {
    expect(oauthCallbackRouteFromUrl('https://neospace.ibm.io/auth/callback?code=a&state=b')).toBe(
      '/auth/callback?code=a&state=b',
    )
  })

  it('maps scheme callbacks to the in-app route', () => {
    expect(oauthCallbackRouteFromUrl('loomspace://auth/callback?code=a&state=b')).toBe(
      '/auth/callback?code=a&state=b',
    )
    expect(oauthCallbackRouteFromUrl('neospace://auth/callback?code=a&state=b')).toBe(
      '/auth/callback?code=a&state=b',
    )
  })
})
