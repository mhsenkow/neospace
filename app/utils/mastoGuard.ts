/**
 * Path-injection guard for masto.js REST clients.
 *
 * masto joins `$select(arg)` args into the request path verbatim, and URL
 * resolution then collapses dot-segments — so
 * `client.v1.tags.$select('../accounts/1/follow?').follow()` POSTs to
 * /api/v1/accounts/1/follow. Many ids come from route params / localStorage,
 * so every client is wrapped once here and unsafe segments throw.
 *
 * Args are validated, never re-encoded: call sites that already pass
 * encodeURIComponent output (`caf%C3%A9`) must keep working.
 */

/** Throws unless `arg` is a single, non-traversing path segment. */
export function assertSafePathSegment(arg: unknown): void {
  const s = String(arg ?? '')
  if (
    !s ||
    s === '.' ||
    s === '..' ||
    /[/\\?#\0-\x20\x7f]/.test(s) ||
    /%(?:2e|2f|5c)/i.test(s)
  ) {
    throw new Error('Unsafe API path segment')
  }
}

function isProxyable(v: unknown): v is object {
  return v !== null && (typeof v === 'object' || typeof v === 'function')
}

/**
 * Wrap a masto client (or any action proxy under it). Only `$select` calls are
 * checked; action results (promises, paginators, `$raw` responses) and symbol
 * properties such as `Symbol.dispose` pass through untouched.
 */
export function guardMastoClient<T extends object>(target: T, isSelect = false): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver)
      if (typeof prop === 'symbol' || !isProxyable(value)) return value
      return guardMastoClient(value, prop === '$select')
    },
    apply(t, thisArg, args: unknown[]) {
      if (!isSelect) return Reflect.apply(t as (...a: unknown[]) => unknown, thisArg, args)
      for (const arg of args) assertSafePathSegment(arg)
      const next = Reflect.apply(t as (...a: unknown[]) => unknown, thisArg, args)
      return isProxyable(next) ? guardMastoClient(next) : next
    },
  })
}
