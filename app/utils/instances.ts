/**
 * Shared instance defaults and server-name helpers.
 *
 * Several large Mastodon hosts now require auth for public timelines
 * (mastodon.social returns 422 for unauthenticated /api/v1/timelines/public).
 * Guest mode must default to an instance that still allows public reads.
 */

import { httpStatusFrom, isClientError, isTimeoutError, isUnexpectedResponseError } from '~/utils/friendlyError'

export const DEFAULT_PUBLIC_INSTANCE = 'https://fosstodon.org'

/** Hosts known to gate unauthenticated public timeline access */
export const AUTH_GATED_PUBLIC_HOSTS = new Set([
  'mastodon.social',
  'mstdn.social',
  'tech.lgbt',
])

/** How long a runtime-learned gate is remembered (Mastodon hosts can change policy). */
export const AUTH_GATED_LEARNED_TTL_MS = 90 * 24 * 60 * 60 * 1000

const AUTH_GATED_LEARNED_KEY = 'neo:auth-gated-public-hosts'

type LearnedGateEntry = { host: string; expiresAt: number }

function readLearnedAuthGatedHosts(): Map<string, number> {
  const out = new Map<string, number>()
  if (typeof localStorage === 'undefined') return out
  try {
    const raw = localStorage.getItem(AUTH_GATED_LEARNED_KEY)
    if (!raw) return out
    const parsed = JSON.parse(raw) as LearnedGateEntry[]
    if (!Array.isArray(parsed)) return out
    const now = Date.now()
    let dirty = false
    for (const row of parsed) {
      const host = row?.host?.toLowerCase?.()
      const expiresAt = row?.expiresAt
      if (!host || typeof expiresAt !== 'number') {
        dirty = true
        continue
      }
      if (expiresAt <= now) {
        dirty = true
        continue
      }
      out.set(host, expiresAt)
    }
    if (dirty) persistLearnedAuthGatedHosts(out)
  } catch {
    /* ignore corrupt storage */
  }
  return out
}

function persistLearnedAuthGatedHosts(map: Map<string, number>) {
  if (typeof localStorage === 'undefined') return
  const payload: LearnedGateEntry[] = [...map.entries()].map(([host, expiresAt]) => ({ host, expiresAt }))
  localStorage.setItem(AUTH_GATED_LEARNED_KEY, JSON.stringify(payload))
}

/** Remember that this host returned 401/422 for unauthenticated public timelines. */
export function rememberAuthGatedPublicHost(urlOrHost: string): void {
  const host = urlOrHost.includes('://') ? hostnameOf(urlOrHost) : urlOrHost.toLowerCase().split('/')[0] || ''
  if (!host) return
  const learned = readLearnedAuthGatedHosts()
  learned.set(host, Date.now() + AUTH_GATED_LEARNED_TTL_MS)
  persistLearnedAuthGatedHosts(learned)
}

/** Call when timelines/public fails for a guest/watch row — learns the host at runtime. */
export function notePublicTimelineAuthFailure(
  urlOrHost: string,
  err: unknown,
  opts?: { authenticated?: boolean },
): void {
  if (opts?.authenticated) return
  const status = httpStatusFrom(err)
  if (status !== 401 && status !== 422) return
  rememberAuthGatedPublicHost(urlOrHost)
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]?.toLowerCase() || ''
  }
}

/** Exact hostname match — avoids `url.includes('c.im')` matching abc.im */
export function hostnameMatches(url: string, domain: string): boolean {
  const host = domain.includes('://') ? hostnameOf(domain) : domain.toLowerCase().split('/')[0] || ''
  return hostnameOf(url) === host
}

export function isAuthGatedPublicHost(urlOrHost: string): boolean {
  const host = urlOrHost.includes('://') ? hostnameOf(urlOrHost) : urlOrHost.toLowerCase().split('/')[0] || ''
  if (AUTH_GATED_PUBLIC_HOSTS.has(host)) return true
  const learned = readLearnedAuthGatedHosts()
  const expiresAt = learned.get(host)
  if (!expiresAt) return false
  if (expiresAt <= Date.now()) {
    learned.delete(host)
    persistLearnedAuthGatedHosts(learned)
    return false
  }
  return true
}

export function resolvePublicInstanceUrl(
  preferred?: string | null,
  fallback: string = DEFAULT_PUBLIC_INSTANCE,
): string {
  if (preferred && !isAuthGatedPublicHost(preferred)) {
    return preferred.replace(/\/+$/, '')
  }
  return fallback
}

/**
 * Accept pasted URLs, @user@host, or bare hostnames → https://host
 */
export function normalizeServer(raw: string): string | null {
  let value = raw.trim().toLowerCase()
  if (!value) return null

  // @alice@mastodon.social → mastodon.social
  const atMatch = value.match(/^@?[^@\s]+@([^@\s]+)$/)
  if (atMatch?.[1]) value = atMatch[1]

  value = value.replace(/^https?:\/\//, '')
  value = value.replace(/\/.*$/, '')
  value = value.replace(/\/+$/, '')
  // Fully-qualified form (`mastodon.social.`) is the same host. Ports are deliberately
  // not accepted: servers are public hostnames on the default HTTPS port.
  value = value.replace(/\.$/, '')

  // IDN hosts (bücher.social, кириллица.example): convert to punycode first, then validate
  // the ASCII form — the URL parser also rejects forbidden host characters for us
  if (/[^\x00-\x7f]/.test(value)) {
    try {
      const host = new URL(`https://${value}`).hostname
      if (host.includes('/') || host.includes('@')) return null
      value = host
    } catch {
      return null
    }
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return null
  }

  // A server entry is a public hostname. IPv4 literals (incl. 127.0.0.1 /
  // 10.x / 169.254.x — every all-numeric TLD) and loopback/LAN-only names would
  // point OAuth + API traffic (and tokens) at the user's own network.
  if (/\.\d+$/.test(value)) return null
  if (/(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(value)) return null

  return `https://${value}`
}

/** One phrase for the monthly-active figure, e.g. "1,234 active this month". */
export function formatMonthlyActive(count: number): string {
  return `${count.toLocaleString()} active this month`
}

export function friendlyServerError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err || '')
  const lower = message.toLowerCase()

  if (lower.includes('already watching') || lower.includes('already connected')) {
    return 'You’re already connected to this server.'
  }
  // Branch on the client's error kinds before any wording: masto's raw text ("The server
  // returned data with an unknown encoding…", "Request timed out") never reaches the user
  if (isTimeoutError(err)) {
    return 'That server took too long to respond. Try again in a moment.'
  }
  if (isUnexpectedResponseError(err)) {
    return "That doesn't look like a Mastodon-compatible server."
  }
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('cors')) {
    return "We couldn't reach that server. Check the name and your internet connection, then try again."
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return "We couldn't find that server. Double-check the spelling — it usually looks like mastodon.social."
  }
  if (!isClientError(err) && message && message.length < 120 && !lower.includes('error:')) {
    return message
  }
  return "Something went wrong connecting to that server. Please try again."
}
