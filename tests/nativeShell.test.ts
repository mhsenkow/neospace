import { describe, expect, it } from 'vitest'
import {
  NATIVE_OAUTH_REDIRECT_URI,
  NATIVE_OAUTH_SCHEME_REDIRECT,
  isOAuthCallbackUrl,
  oauthCallbackRouteFromUrl,
} from '../app/utils/nativeShell'

describe('nativeShell OAuth deep links', () => {
  it('uses the stable production https callback for native', () => {
    expect(NATIVE_OAUTH_REDIRECT_URI).toBe('https://neospace.ibm.io/auth/callback')
  })

  it('prefers the LoomSpace custom scheme', () => {
    expect(NATIVE_OAUTH_SCHEME_REDIRECT).toBe('loomspace://auth/callback')
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
