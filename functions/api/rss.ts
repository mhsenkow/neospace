/**
 * GET /api/rss?url=<encoded> — fetch + parse an RSS/Atom feed for NeoSpace columns.
 * SSRF-guarded, origin-checked, rate-limited, edge-cached.
 */

import type { PagesFunction } from '@cloudflare/workers-types'
import { parseRssXml, sanitizeRssFetchUrl } from '../../shared/rssParser'
import { allowRequest, clientIp } from '../utils/rateLimit'

const UA = 'NeoSpace-RSS/1.0 (+https://neospace.ibm.io)'
const UPSTREAM_TIMEOUT_MS = 8_000
const MAX_BODY_BYTES = 1_500_000
const MAX_REDIRECTS = 4
const CACHE_TTL_SEC = 600
const STALE_SEC = 1_800

const RATE_LIMIT = 60
const RATE_WINDOW_MS = 5 * 60 * 1000

const ALLOWED_ORIGINS = new Set([
  'https://neospace.ibm.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

const ALLOWED_HOSTS = new Set([
  'neospace.ibm.io',
  'localhost',
  '127.0.0.1',
  'neospace-dc4.pages.dev',
])

function originAllowed(origin: string | null, requestUrl?: string): boolean {
  if (!origin) return false
  try {
    if (requestUrl && origin === new URL(requestUrl).origin) return true
  } catch {
    /* fall through */
  }
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const host = new URL(origin).hostname
    return host === 'neospace-dc4.pages.dev' || host.endsWith('.neospace-dc4.pages.dev')
  } catch {
    return false
  }
}

function hostAllowed(hostname: string): boolean {
  if (ALLOWED_HOSTS.has(hostname)) return true
  return hostname.endsWith('.neospace-dc4.pages.dev')
}

const JSON_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

function json(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...JSON_SECURITY_HEADERS,
      ...extraHeaders,
    },
  })
}

async function readBodyCapped(
  res: Response,
  max: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: 'too_large' }> {
  if (!res.body) return { ok: true, text: '' }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return { ok: false, reason: 'too_large' }
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(bytes) }
}

async function fetchFeedXml(startUrl: string): Promise<
  | { ok: true; xml: string; finalUrl: string }
  | { ok: false; status: number; error: string }
> {
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safe = sanitizeRssFetchUrl(current)
    if (!safe) {
      return { ok: false, status: 400, error: 'Blocked or invalid feed URL' }
    }
    let res: Response
    try {
      res = await fetch(safe, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8',
          'User-Agent': UA,
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
    } catch {
      return { ok: false, status: 502, error: 'Couldn’t reach that feed' }
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('Location')
      if (!loc || hop === MAX_REDIRECTS) {
        return { ok: false, status: 502, error: 'Too many redirects' }
      }
      try {
        current = new URL(loc, safe).toString()
      } catch {
        return { ok: false, status: 502, error: 'Bad redirect' }
      }
      continue
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status === 404 ? 404 : 502,
        error: res.status === 404 ? 'Feed not found' : `Upstream returned ${res.status}`,
      }
    }

    const body = await readBodyCapped(res, MAX_BODY_BYTES)
    if (!body.ok) {
      return { ok: false, status: 502, error: 'Feed is too large' }
    }
    return { ok: true, xml: body.text, finalUrl: safe }
  }
  return { ok: false, status: 502, error: 'Too many redirects' }
}

export const onRequestGet: PagesFunction = async (context) => {
  const request = context.request
  const origin = request.headers.get('Origin')
  const referer = request.headers.get('Referer')

  // Browser clients send Origin; allow same-origin Referer for navigation/prefetch
  let allowed = originAllowed(origin, request.url)
  if (!allowed && referer) {
    try {
      const ref = new URL(referer)
      allowed = hostAllowed(ref.hostname)
    } catch {
      allowed = false
    }
  }
  // Same-origin relative fetch has no Origin on some browsers — check Host
  if (!allowed) {
    try {
      allowed = hostAllowed(new URL(request.url).hostname)
    } catch {
      allowed = false
    }
  }
  if (!allowed) {
    return json({ error: 'Forbidden' }, 403, { 'Cache-Control': 'no-store' })
  }

  const ip = clientIp(request)
  const rl = allowRequest(`rss:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rl.allowed) {
    return json(
      { error: 'Too many requests' },
      429,
      {
        'Cache-Control': 'no-store',
        ...(rl.retryAfterSec ? { 'Retry-After': String(rl.retryAfterSec) } : {}),
      },
    )
  }

  const feedParam = new URL(request.url).searchParams.get('url') || ''
  const target = sanitizeRssFetchUrl(feedParam)
  if (!target) {
    return json({ error: 'Invalid feed URL' }, 400, { 'Cache-Control': 'no-store' })
  }

  const cache = caches.default
  const cacheKey = new Request(
    `https://rss-cache.neospace.internal/?u=${encodeURIComponent(target)}`,
    { method: 'GET' },
  )
  const cached = await cache.match(cacheKey)
  if (cached) {
    const hit = new Response(cached.body, cached)
    hit.headers.set('X-NeoSpace-Cache', 'HIT')
    return hit
  }

  const fetched = await fetchFeedXml(target)
  if (!fetched.ok) {
    return json(
      { error: fetched.error },
      fetched.status,
      { 'Cache-Control': 'no-store', 'X-NeoSpace-Cache': 'MISS' },
    )
  }

  const parsed = parseRssXml(fetched.xml, fetched.finalUrl)
  const payload = {
    title: parsed.title,
    siteUrl: parsed.siteUrl,
    feedUrl: fetched.finalUrl,
    items: parsed.items,
  }

  const response = json(payload, 200, {
    'Cache-Control': `public, s-maxage=${CACHE_TTL_SEC}, stale-while-revalidate=${STALE_SEC}`,
    'X-NeoSpace-Cache': 'MISS',
  })

  // Store a clone for the next visitor (edge cache)
  context.waitUntil(cache.put(cacheKey, response.clone()))

  return response
}
