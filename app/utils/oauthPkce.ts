/**
 * OAuth state + PKCE helpers (authorization code flow).
 */

const AUTH_STATE_KEY = 'neospace_oauth_state'
const AUTH_VERIFIER_KEY = 'neospace_oauth_verifier'
const AUTH_SECRET_PREFIX = 'neospace_oauth_secret:'

function randomString(bytes = 32): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return base64Url(arr)
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64Url(digest)
}

export async function beginOAuthChallenge(): Promise<{
  state: string
  codeChallenge: string
  codeVerifier: string
}> {
  const state = randomString(24)
  const codeVerifier = randomString(64)
  const codeChallenge = await sha256Base64Url(codeVerifier)
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(AUTH_STATE_KEY, state)
    sessionStorage.setItem(AUTH_VERIFIER_KEY, codeVerifier)
  }
  return { state, codeChallenge, codeVerifier }
}

export function consumeOAuthChallenge(stateFromQuery: string | null): {
  ok: boolean
  codeVerifier: string | null
  error?: string
} {
  if (typeof sessionStorage === 'undefined') {
    return { ok: false, codeVerifier: null, error: 'No session storage' }
  }
  const expected = sessionStorage.getItem(AUTH_STATE_KEY)
  const verifier = sessionStorage.getItem(AUTH_VERIFIER_KEY)
  sessionStorage.removeItem(AUTH_STATE_KEY)
  sessionStorage.removeItem(AUTH_VERIFIER_KEY)
  if (!expected || !stateFromQuery || expected !== stateFromQuery) {
    return { ok: false, codeVerifier: null, error: 'Invalid OAuth state' }
  }
  return { ok: true, codeVerifier: verifier }
}

/** Ephemeral client secrets — session only, never localStorage */
export function stashClientSecret(instanceId: string, secret: string) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(AUTH_SECRET_PREFIX + instanceId, secret)
}

export function readClientSecret(instanceId: string): string | null {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage.getItem(AUTH_SECRET_PREFIX + instanceId)
}

export function clearClientSecret(instanceId: string) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(AUTH_SECRET_PREFIX + instanceId)
}
