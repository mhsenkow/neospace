/**
 * Capacitor / native-shell detection and OAuth redirect helpers.
 * Web + PWA keep using window.location.origin; the native binary uses a custom
 * URL scheme so Mastodon returns into the app (same WebView storage as PKCE),
 * not into an external browser tab on neospace.ibm.io.
 */

/** Universal Link callback — still recognized if a server or old build hits it. */
export const NATIVE_OAUTH_REDIRECT_URI = 'https://neospace.ibm.io/auth/callback'
/** Primary native redirect: CFBundleURLSchemes → appUrlOpen → /auth/callback. */
export const NATIVE_OAUTH_SCHEME_REDIRECT = 'loomspace://auth/callback'

const CUSTOM_SCHEMES = new Set(['loomspace:', 'neospace:'])

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
  // Custom scheme keeps code + state inside the Capacitor WebView. An https
  // redirect opens the production site in Chrome/Safari with empty localStorage
  // → "expired or wrong tab" after authorize.
  if (isNativeShell()) return NATIVE_OAUTH_SCHEME_REDIRECT
  return `${window.location.origin}/auth/callback`
}

/** True when a deep-link URL is our OAuth callback (https UL or custom scheme). */
export function isOAuthCallbackUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (CUSTOM_SCHEMES.has(u.protocol) && (u.hostname === 'auth' || u.pathname.startsWith('//auth'))) {
      return true
    }
    if (u.hostname === 'neospace.ibm.io' && u.pathname.replace(/\/+$/, '') === '/auth/callback') {
      return true
    }
    return (
      u.pathname.replace(/\/+$/, '') === '/auth/callback' &&
      (u.searchParams.has('code') || u.searchParams.has('error'))
    )
  } catch {
    return /\/auth\/callback/i.test(url)
  }
}

/** Path + query for in-app router navigation from a deep link. */
export function oauthCallbackRouteFromUrl(url: string): string {
  try {
    const u = new URL(url)
    // loomspace://auth/callback?code=… → pathname may be empty; host is "auth"
    if (CUSTOM_SCHEMES.has(u.protocol)) {
      const qs = u.search || ''
      return `/auth/callback${qs}`
    }
    return `${u.pathname}${u.search}`
  } catch {
    const q = url.includes('?') ? url.slice(url.indexOf('?')) : ''
    return `/auth/callback${q}`
  }
}
