import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet } from '../functions/api/rss'
import { sanitizeRssFetchUrl } from '../shared/rssParser'

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <link>https://blog.example/</link>
  <item>
    <title>Hello</title>
    <link>https://blog.example/hello</link>
    <guid>https://blog.example/hello</guid>
    <description>A post</description>
    <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
  </item>
</channel></rss>`

function mockCache() {
  const store = new Map<string, Response>()
  return {
    match: vi.fn(async (req: Request) => {
      const hit = store.get(req.url)
      return hit ? hit.clone() : undefined
    }),
    put: vi.fn(async (req: Request, res: Response) => {
      store.set(req.url, res.clone())
    }),
  }
}

function contextFor(url: string, headers: Record<string, string> = {}) {
  const cache = mockCache()
  vi.stubGlobal('caches', { default: cache })
  const waitUntil = vi.fn()
  return {
    request: new Request(url, { headers }),
    env: {},
    waitUntil,
    cache,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sanitizeRssFetchUrl (SSRF)', () => {
  it('rejects loopback, link-local, and credentialed URLs', () => {
    for (const bad of [
      'http://127.0.0.1/feed.xml',
      'http://localhost/feed.xml',
      'http://169.254.169.254/latest',
      'http://10.0.0.1/rss',
      'https://user:pass@blog.example/feed',
      'ftp://blog.example/feed',
      'not a url',
      '',
    ]) {
      expect(sanitizeRssFetchUrl(bad), bad).toBeNull()
    }
  })

  it('accepts public http(s) feeds and strips hashes', () => {
    expect(sanitizeRssFetchUrl('https://blog.example/feed.xml#frag')).toBe(
      'https://blog.example/feed.xml',
    )
  })
})

describe('GET /api/rss', () => {
  it('refuses cross-origin calls that are not on a LoomSpace host', async () => {
    // Same-origin Origin≡Host is allowed (Pages always serves from a LoomSpace host).
    // A mismatched Origin on a non-LoomSpace host must 403.
    const ctx = contextFor('https://evil.example/api/rss?url=https://blog.example/feed.xml', {
      Origin: 'https://other.evil',
    })
    const res = await onRequestGet(ctx as never)
    expect(res.status).toBe(403)
  })

  it('rejects blocked feed URLs with 400', async () => {
    const ctx = contextFor('https://neospace.ibm.io/api/rss?url=http://127.0.0.1/feed', {
      Origin: 'https://neospace.ibm.io',
    })
    const res = await onRequestGet(ctx as never)
    expect(res.status).toBe(400)
  })

  it('fetches, parses, and caches a valid feed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(SAMPLE_RSS, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } })),
    )
    const ctx = contextFor(
      'https://neospace.ibm.io/api/rss?url=' + encodeURIComponent('https://blog.example/feed.xml'),
      { Origin: 'https://neospace.ibm.io' },
    )
    const res = await onRequestGet(ctx as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-LoomSpace-Cache')).toBe('MISS')
    const body = (await res.json()) as { title: string; items: { title: string }[] }
    expect(body.title).toBe('Test Feed')
    expect(body.items[0]?.title).toBe('Hello')
    expect(ctx.waitUntil).toHaveBeenCalled()

    const hit = await onRequestGet(ctx as never)
    expect(hit.headers.get('X-LoomSpace-Cache')).toBe('HIT')
  })

  it('maps oversized upstream bodies to 502', async () => {
    const huge = new ReadableStream({
      start(controller) {
        const chunk = new Uint8Array(600_000)
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(huge, { status: 200 })),
    )
    const ctx = contextFor(
      'https://neospace.ibm.io/api/rss?url=' + encodeURIComponent('https://blog.example/big.xml'),
      { Origin: 'https://neospace.ibm.io' },
    )
    const res = await onRequestGet(ctx as never)
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toMatch(/too large/i)
  })
})
