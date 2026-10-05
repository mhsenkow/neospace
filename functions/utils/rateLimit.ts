/**
 * Tiny in-isolate rate limiter for Cloudflare Pages Functions / Workers.
 * Not global across colos — dampens abuse; not a hard guarantee.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Prune occasionally so isolates don't grow unbounded */
function prune(now: number) {
  if (buckets.size < 500) return
  for (const [k, b] of buckets) {
    if (now > b.resetAt) buckets.delete(k)
  }
}

/**
 * @returns true if the request is allowed
 */
export function allowRequest(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now()
  prune(now)
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= limit) return false
  b.count += 1
  return true
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  )
}
