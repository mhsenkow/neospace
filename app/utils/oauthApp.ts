/**
 * OAuth app cache + token-endpoint fetch helpers (split out of the instances store).
 */

const OAUTH_APP_CACHE_KEY = 'neospace_oauth_apps'
export const OAUTH_FETCH_TIMEOUT_MS = 15_000

type CachedApp = { clientId: string; clientSecret: string }

/** What a registration was made for — reuse is only safe when these still match */
export type OAuthAppIdentity = { redirectUri: string; scopes: string }

type StoredApp = CachedApp & Partial<OAuthAppIdentity> & { savedAt?: number }

/** Persisted blob stays bounded: least-recently-saved hosts are pruned past this */
const OAUTH_APP_CACHE_MAX = 32
/** Registrations older than this are dropped — servers may rotate app credentials */
export const OAUTH_APP_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000

const hostKey = (host: string) => host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')

function isStoredApp(v: unknown): v is StoredApp {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as StoredApp
  return typeof o.clientId === 'string' && !!o.clientId && typeof o.clientSecret === 'string' && !!o.clientSecret
}

function readMap(now = Date.now()): Record<string, StoredApp> {
  try {
    const raw = localStorage.getItem(OAUTH_APP_CACHE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, StoredApp> = {}
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isStoredApp(entry)) continue
      const savedAt = entry.savedAt
      if (typeof savedAt === 'number' && now - savedAt > OAUTH_APP_CACHE_TTL_MS) continue
      out[key] = entry
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Cached client registration for `host`. When `identity` is given the entry must have been
 * registered for the same callback URI and scopes — otherwise it's treated as absent so the
 * caller re-registers (legacy entries without that metadata are re-registered once).
 */
export function readCachedOAuthApp(host: string, identity?: OAuthAppIdentity): CachedApp | null {
  if (typeof localStorage === 'undefined') return null
  const entry = readMap()[hostKey(host)]
  if (
    !entry ||
    typeof entry.clientId !== 'string' ||
    !entry.clientId ||
    typeof entry.clientSecret !== 'string' ||
    !entry.clientSecret
  ) {
    return null
  }
  if (identity && (entry.redirectUri !== identity.redirectUri || entry.scopes !== identity.scopes)) {
    return null
  }
  return { clientId: entry.clientId, clientSecret: entry.clientSecret }
}

export function writeCachedOAuthApp(
  host: string,
  clientId: string,
  clientSecret: string,
  identity?: OAuthAppIdentity,
) {
  if (typeof localStorage === 'undefined') return
  try {
    const map = readMap()
    const key = hostKey(host)
    delete map[key] // re-insert last so insertion order doubles as recency
    map[key] = { clientId, clientSecret, ...(identity || {}), savedAt: Date.now() }
    const keys = Object.keys(map)
    for (const old of keys.slice(0, Math.max(0, keys.length - OAUTH_APP_CACHE_MAX))) delete map[old]
    localStorage.setItem(OAUTH_APP_CACHE_KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode */
  }
}

/** Drop a cached app (e.g. the server answered `invalid_client`). */
export function clearCachedOAuthApp(host: string) {
  if (typeof localStorage === 'undefined') return
  try {
    const map = readMap()
    delete map[hostKey(host)]
    localStorage.setItem(OAUTH_APP_CACHE_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/** Fetch with the timeout AND the caller's signal — navigating away cancels promptly */
export async function oauthFetch(url: string, init: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS)
  const caller = init.signal ?? null
  let signal: AbortSignal = timeout
  if (caller) {
    if (typeof AbortSignal.any === 'function') {
      signal = AbortSignal.any([caller, timeout])
    } else {
      const merged = new AbortController()
      const abort = () => merged.abort()
      if (caller.aborted || timeout.aborted) abort()
      caller.addEventListener('abort', abort, { once: true })
      timeout.addEventListener('abort', abort, { once: true })
      signal = merged.signal
    }
  }
  return fetch(url, { ...init, signal })
}

export async function parseOAuthResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    if (text.trim().startsWith('<')) {
      throw new Error('Server returned an error page instead of a token response')
    }
    throw new Error(text.slice(0, 120) || 'Unexpected server response')
  }
  // `null`, arrays and bare scalars are valid JSON but never an OAuth response object
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Server sent an unexpected response — try again')
  }
  return parsed as Record<string, unknown>
}

/** A successful token response must carry a non-empty string `access_token` */
export function requireAccessToken(data: Record<string, unknown>): string {
  const token = data.access_token
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Token exchange failed: no access token returned')
  }
  if (data.token_type !== undefined && typeof data.token_type !== 'string') {
    throw new Error('Server sent an unexpected response — try again')
  }
  return token
}
