/**
 * Capacitor / native-shell detection and OAuth redirect helpers.
 * Web + PWA keep using window.location.origin; the iOS binary uses a stable https callback.
 */

export const NATIVE_OAUTH_REDIRECT_URI = 'https://neospace.ibm.io/auth/callback'
/** Custom-scheme fallback when Universal Links are unavailable (dev / first TestFlight). */
export const NATIVE_OAUTH_SCHEME_REDIRECT = 'neospace://auth/callback'

export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  try {
    // Capacitor injects this on the WebView; avoid importing @capacitor/core in SSR paths.
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()
  } catch {
    return false
  }
}

/** OAuth redirect_uri for app registrations and authorize/token exchange. */
export function oauthRedirectUri(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000/auth/callback'
  if (isNativeShell()) return NATIVE_OAUTH_REDIRECT_URI
  return `${window.location.origin}/auth/callback`
}

/** True when a deep-link URL is our OAuth callback (https UL or custom scheme). */
export function isOAuthCallbackUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'neospace:' && (u.hostname === 'auth' || u.pathname.startsWith('//auth'))) {
      return true
    }
    if (u.hostname === 'neospace.ibm.io' && u.pathname.replace(/\/+$/, '') === '/auth/callback') {
      return true
    }
    return u.pathname.replace(/\/+$/, '') === '/auth/callback' && (u.searchParams.has('code') || u.searchParams.has('error'))
  } catch {
    return /\/auth\/callback/i.test(url)
  }
}

/** Path + query for in-app router navigation from a deep link. */
export function oauthCallbackRouteFromUrl(url: string): string {
  try {
    const u = new URL(url)
    // neospace://auth/callback?code=… → pathname may be empty; host is "auth"
    if (u.protocol === 'neospace:') {
      const qs = u.search || ''
      return `/auth/callback${qs}`
    }
    return `${u.pathname}${u.search}`
  } catch {
    const q = url.includes('?') ? url.slice(url.indexOf('?')) : ''
    return `/auth/callback${q}`
  }
}
