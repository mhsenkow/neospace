/**
 * OAuth state + PKCE helpers (authorization code flow).
 */

const AUTH_STATE_KEY = 'neospace_oauth_state'
const AUTH_VERIFIER_KEY = 'neospace_oauth_verifier'
const AUTH_SECRET_PREFIX = 'neospace_oauth_secret:'
const PENDING_AUTH_KEY = 'neospace_pending_auth'
const PENDING_TTL_MS = 10 * 60 * 1000

export interface PendingAuthRecord {
  state: string
  verifier: string
  instanceId: string
  host: string
  addMode: boolean
  returnTo: string | null
  createdAt: number
}

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

function readPendingAuth(): PendingAuthRecord | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(PENDING_AUTH_KEY)
    if (!raw) return null
    const rec = JSON.parse(raw) as PendingAuthRecord
    if (!rec?.state || !rec.verifier || Date.now() - rec.createdAt > PENDING_TTL_MS) {
      localStorage.removeItem(PENDING_AUTH_KEY)
      return null
    }
    return rec
  } catch {
    return null
  }
}

function writePendingAuth(rec: PendingAuthRecord) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PENDING_AUTH_KEY, JSON.stringify(rec))
  } catch {
    /* quota / private mode */
  }
}

export function clearPendingAuth() {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(AUTH_STATE_KEY)
    sessionStorage.removeItem(AUTH_VERIFIER_KEY)
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(PENDING_AUTH_KEY)
    } catch {
      /* ignore */
    }
  }
}

/** Same-origin path only — blocks open redirects. */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  // Browsers read `/\host` as `//host` and drop tab/newline before parsing,
  // so `/\evil.example` or `/\t/evil.example` would leave the origin
  if (/[\\\0-\x1f\x7f]/.test(raw) || /%(?:0[9ad]|5c)/i.test(raw)) return null
  try {
    const base = 'https://neospace.invalid'
    if (new URL(raw, base).origin !== base) return null
  } catch {
    return null
  }
  return raw
}

export async function beginOAuthChallenge(opts?: {
  instanceId: string
  host: string
  addMode?: boolean
  returnTo?: string | null
}): Promise<{
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
  if (opts?.instanceId) {
    writePendingAuth({
      state,
      verifier: codeVerifier,
      instanceId: opts.instanceId,
      host: opts.host,
      addMode: !!opts.addMode,
      returnTo: sanitizeReturnTo(opts.returnTo),
      createdAt: Date.now(),
    })
  }
  return { state, codeChallenge, codeVerifier }
}

export function consumeOAuthChallenge(stateFromQuery: string | null): {
  ok: boolean
  codeVerifier: string | null
  pending?: PendingAuthRecord | null
  error?: string
} {
  const pending = readPendingAuth()
  if (typeof sessionStorage === 'undefined' && !pending) {
    return { ok: false, codeVerifier: null, error: 'No session storage' }
  }
  const sessionState =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(AUTH_STATE_KEY) : null
  const sessionVerifier =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(AUTH_VERIFIER_KEY) : null
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(AUTH_STATE_KEY)
    sessionStorage.removeItem(AUTH_VERIFIER_KEY)
  }
  if (!stateFromQuery) {
    return { ok: false, codeVerifier: null, error: 'Invalid OAuth state' }
  }
  // The shared localStorage record belongs to whichever tab started sign-in
  // last; this tab's own sessionStorage pair still counts — but then the
  // record (instance, returnTo) is the other tab's and must not be used.
  if (pending && pending.state === stateFromQuery) {
    return { ok: true, codeVerifier: pending.verifier, pending }
  }
  if (sessionState && sessionState === stateFromQuery) {
    if (!sessionVerifier) {
      return { ok: false, codeVerifier: null, error: 'Missing PKCE verifier' }
    }
    return { ok: true, codeVerifier: sessionVerifier, pending: null }
  }
  return { ok: false, codeVerifier: null, error: 'Invalid OAuth state' }
}

/**
 * Client secrets for token revoke.
 * Session during OAuth; persisted to localStorage after login so logout can revoke
 * even when the original tab is gone (access tokens already live in localStorage).
 */
export function stashClientSecret(instanceId: string, secret: string) {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(AUTH_SECRET_PREFIX + instanceId, secret)
  }
}

export function persistClientSecret(instanceId: string, secret: string) {
  stashClientSecret(instanceId, secret)
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(AUTH_SECRET_PREFIX + instanceId, secret)
    } catch {
      /* quota / private mode */
    }
  }
}

export function readClientSecret(instanceId: string): string | null {
  if (typeof sessionStorage !== 'undefined') {
    const fromSession = sessionStorage.getItem(AUTH_SECRET_PREFIX + instanceId)
    if (fromSession) return fromSession
  }
  if (typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(AUTH_SECRET_PREFIX + instanceId)
    } catch {
      return null
    }
  }
  return null
}

export function clearClientSecret(instanceId: string) {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(AUTH_SECRET_PREFIX + instanceId)
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(AUTH_SECRET_PREFIX + instanceId)
    } catch {
      /* ignore */
    }
  }
}
