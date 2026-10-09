/**
 * Tiny in-isolate rate limiter for Cloudflare Pages Functions / Workers.
 * Not global across colos — dampens abuse; not a hard guarantee.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
let lastPruneAt = 0

/** Prune stale buckets at most once per minute */
function prune(now: number) {
  if (now - lastPruneAt < 60_000) return
  if (buckets.size < 500) return
  lastPruneAt = now
  for (const [k, b] of buckets) {
    if (now > b.resetAt) buckets.delete(k)
  }
}

export type RateLimitResult = {
  allowed: boolean
  retryAfterSec?: number
}

/**
 * @returns whether the request is allowed and optional Retry-After seconds
 */
export function allowRequest(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  prune(now)
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }
  if (b.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    }
  }
  b.count += 1
  return { allowed: true }
}

/**
 * Bucket IPv6 addresses by /64 prefix. `::` must be expanded first: in
 * `2001:db8::a:b:c:d` the first four non-empty groups are host bits, so a
 * naive split let one /64 rotate through endless buckets.
 */
export function ipv6Bucket(ip: string): string {
  if (!ip.includes(':') || ip.includes('.')) return ip // IPv4 / IPv4-mapped
  const [head = '', tail, extra] = ip.toLowerCase().split('::')
  if (extra !== undefined) return ip
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const fill = tail === undefined ? 0 : 8 - left.length - right.length
  if (fill < 0) return ip
  const groups = [...left, ...Array<string>(fill).fill('0'), ...right]
  if (groups.length !== 8) return ip
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
}

/**
 * Raw client IP from Cloudflare only — never trust X-Forwarded-For.
 * Returns empty string when CF-Connecting-IP is missing (local dev).
 */
export function rawClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')?.trim() || ''
}

/** Rate-limit key for the client (IPv6 grouped by /64). */
export function clientIp(request: Request): string {
  const cf = rawClientIp(request)
  return cf ? ipv6Bucket(cf) : ''
}
