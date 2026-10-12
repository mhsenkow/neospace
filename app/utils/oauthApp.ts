/**
 * OAuth app cache + token-endpoint fetch helpers (split out of the instances store).
 */

const OAUTH_APP_CACHE_KEY = 'neospace_oauth_apps'
export const OAUTH_FETCH_TIMEOUT_MS = 15_000

type CachedApp = { clientId: string; clientSecret: string }

export function readCachedOAuthApp(host: string): CachedApp | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(OAUTH_APP_CACHE_KEY)
    if (!raw) return null
    const map = JSON.parse(raw) as Record<string, { clientId?: string; clientSecret?: string }>
    const entry = map[host.toLowerCase()]
    if (entry?.clientId && entry?.clientSecret) {
      return { clientId: entry.clientId, clientSecret: entry.clientSecret }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function writeCachedOAuthApp(host: string, clientId: string, clientSecret: string) {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(OAUTH_APP_CACHE_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, CachedApp>) : {}
    map[host.toLowerCase()] = { clientId, clientSecret }
    localStorage.setItem(OAUTH_APP_CACHE_KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode */
  }
}

/** Drop a cached app (e.g. the server answered `invalid_client`). */
export function clearCachedOAuthApp(host: string) {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(OAUTH_APP_CACHE_KEY)
    if (!raw) return
    const map = JSON.parse(raw) as Record<string, unknown>
    delete map[host.toLowerCase()]
    localStorage.setItem(OAUTH_APP_CACHE_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export async function oauthFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
  })
}

export async function parseOAuthResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    if (text.trim().startsWith('<')) {
      throw new Error('Server returned an error page instead of a token response')
    }
    throw new Error(text.slice(0, 120) || 'Unexpected server response')
  }
}
