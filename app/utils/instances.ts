/**
 * Shared instance defaults for guest browsing.
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
