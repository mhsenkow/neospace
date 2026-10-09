/**
 * Shared instance defaults and server-name helpers.
 *
 * Several large Mastodon hosts now require auth for public timelines
 * (mastodon.social returns 422 for unauthenticated /api/v1/timelines/public).
 * Guest mode must default to an instance that still allows public reads.
 */

export const DEFAULT_PUBLIC_INSTANCE = 'https://fosstodon.org'

/** Hosts known to gate unauthenticated public timeline access */
export const AUTH_GATED_PUBLIC_HOSTS = new Set([
  'mastodon.social',
  'mstdn.social',
  'tech.lgbt',
])

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
  const host = urlOrHost.includes('://') ? hostnameOf(urlOrHost) : urlOrHost.toLowerCase()
  return AUTH_GATED_PUBLIC_HOSTS.has(host)
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

export function friendlyServerError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err || '')
  const lower = message.toLowerCase()

  if (lower.includes('already watching') || lower.includes('already connected')) {
    return 'You’re already connected to this server.'
  }
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('cors')) {
    return "We couldn't reach that server. Check the name and your internet connection, then try again."
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return "We couldn't find that server. Double-check the spelling — it usually looks like mastodon.social."
  }
  if (lower.includes('timeout')) {
    return 'That server took too long to respond. Try again in a moment.'
  }
  if (message && message.length < 120 && !lower.includes('error:')) {
    return message
  }
  return "Something went wrong connecting to that server. Please try again."
}
