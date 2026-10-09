import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRestAPIClient } from 'masto'
import { assertSafePathSegment, guardMastoClient } from '../app/utils/mastoGuard'
import { normalizeServer } from '../app/utils/instances'
import { sanitizeProfileCss } from '../app/utils/sanitizeCss'
import { emojify } from '../app/utils/emojify'
import { clearLogRing, formatLogRingForFeedback, logError, redactSecrets } from '../app/utils/log'
import { isLoomOrigin } from '../app/utils/loomHandoff'
import { isBruhOrigin } from '../app/utils/bruhHandoff'
import { onRequestPost, screenshotDataUrl } from '../functions/api/feedback'
import { ipv6Bucket } from '../functions/utils/rateLimit'
import { beginOAuthChallenge, consumeOAuthChallenge, sanitizeReturnTo } from '../app/utils/oauthPkce'

function mockFetch() {
  const calls: { url: string; method: string }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    calls.push({ url: req.url, method: req.method })
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('masto $select path guard', () => {
  it('rejects traversal, separators, query/fragment, encoded dots/slashes, and empties', () => {
    for (const bad of ['..', '.', '', 'a/b', 'a\\b', '1?x=1', '1#x', '%2e%2e', '%2F', '%5c', 'a\tb', '.\t.']) {
      expect(() => assertSafePathSegment(bad), bad).toThrow(/Unsafe/)
    }
    for (const ok of ['109999999999999999', 'caf%C3%A9', 'café', 'cats', 123]) {
      expect(() => assertSafePathSegment(ok)).not.toThrow()
    }
  })

  it('blocks ../ injection before any request is sent', async () => {
    const calls = mockFetch()
    const client = guardMastoClient(createRestAPIClient({ url: 'https://example.social' }))
    expect(() => client.v1.tags.$select('../accounts/1/follow?')).toThrow(/Unsafe/)
    expect(calls).toHaveLength(0)
  })

  it('without the guard masto really does collapse the path (regression witness)', async () => {
    const calls = mockFetch()
    const raw = createRestAPIClient({ url: 'https://example.social' })
    await raw.v1.tags.$select('../accounts/1/follow?').follow()
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/accounts/1/follow')
  })

  it('keeps nested $select, actions, $raw, and paginators working', async () => {
    const calls = mockFetch()
    const client = guardMastoClient(createRestAPIClient({ url: 'https://example.social' }))
    await client.v1.accounts.$select('42').follow()
    await client.v1.statuses.$select('7').context.fetch()
    await client.v1.tags.$select('caf%C3%A9').fetch()
    const raw = await client.v1.accounts.$select('42').statuses.list.$raw({ limit: 1 })
    expect(raw.headers).toBeInstanceOf(Headers)
    const page = await client.v1.timelines.tag.$select('cats').list({ limit: 1 })
    expect(page).toEqual({})
    const paths = calls.map((c) => new URL(c.url).pathname)
    expect(paths).toEqual([
      '/api/v1/accounts/42/follow',
      '/api/v1/statuses/7/context',
      '/api/v1/tags/caf%C3%A9',
      '/api/v1/accounts/42/statuses',
      '/api/v1/timelines/tag/cats',
    ])
    expect(calls[0]!.method).toBe('POST')
  })
})

describe('normalizeServer', () => {
  it('rejects IP literals and loopback / LAN-only names', () => {
    for (const bad of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.1', 'localhost', 'foo.localhost', 'nas.local', 'svc.internal', 'router.home.arpa']) {
      expect(normalizeServer(bad), bad).toBeNull()
    }
    expect(normalizeServer('mastodon.social')).toBe('https://mastodon.social')
    expect(normalizeServer('@me@social.example.org')).toBe('https://social.example.org')
  })
})

describe('sanitizeProfileCss adversarial', () => {
  const SCOPE = '.chaos-active #main-content'
  /** Every top-level selector we emit must start with the scope (comments ignored). */
  function selectorsOf(css: string): string[] {
    const out: string[] = []
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of stripped.matchAll(/(?:^|})\s*([^{}@]+)\{/g)) out.push(m[1]!.trim())
    return out
  }

  it('keeps the old smoke expectations', () => {
    const out = sanitizeProfileCss('@font-face { src: url(https://e.x/f) } .z { color: red; }')
    expect(out).toContain('blocked font face')
    expect(out).toBe(`/* blocked font face */${SCOPE} .z{ color: red; }`)
  })

  it.each([
    ['brace inside a string', 'a { content: "}" } body { top: 0 }'],
    ['brace inside unquoted data url', 'a { background: url(data:image/png,}) } body { top: 0 }'],
    ['@layer statement', '@layer x; body { top: 0 }'],
    ['@charset statement', '@charset "x"; body { top: 0 }'],
    ['CSS nesting :is(&, body)', 'a { :is(&, body) { top: 0 } }'],
    ['CSS nesting :not(&)', 'a { color: red; :not(&) { top: 0 } }'],
    ['sibling combinator after scope', '.chaos-active #main-content ~ nav { top: 0 }'],
    ['leading sibling combinator', '~ nav, + aside { top: 0 }'],
    ['paren swallowing a brace', 'a{x:y(} b)} body{top:0}'],
    ['comment hiding a brace', 'a { color: red /* } */ } body { top: 0 }'],
    ['comment spliced by tag removal', 'a{}/<b>* } body{top:0} */'],
    ['nested comment re-forming', 'a{} //**/* x */ body{top:0}'],
    ['double-escaped backslash', 'a{} \\5c 7d body{top:0}'],
  ])('%s stays scoped', (_name, input) => {
    const out = sanitizeProfileCss(input)
    for (const sel of selectorsOf(out)) {
      for (const part of sel.split(',')) {
        expect(part.trim().startsWith(SCOPE), `${part} in ${out}`).toBe(true)
        expect(part.trim().slice(SCOPE.length).trim()).not.toMatch(/^[~+]/)
      }
    }
    expect(out).not.toMatch(/(^|})\s*body\s*\{/)
  })

  it('drops nested-rule bodies and statement at-rules entirely', () => {
    expect(sanitizeProfileCss('a { :is(&, body) { top: 0 } }')).toBe('')
    expect(sanitizeProfileCss('@layer x; b { color: red }')).toBe(`${SCOPE} b{ color: red }`)
  })

  it('keeps @media blocks (even after whitespace) and scopes their rules', () => {
    const out = sanitizeProfileCss('a{color:red}\n@media (max-width: 600px) { b { color: blue } }')
    expect(out).toBe(`${SCOPE} a{color:red}@media (max-width: 600px){${SCOPE} b{ color: blue }}`)
  })

  it('pins position:fixed (and var() indirection) to absolute', () => {
    const out = sanitizeProfileCss(
      'a{position:fixed;inset:0;z-index:99}b{--p:fixed;position:var(--p)}c{position: sticky}d{background-position: 0 0}',
    )
    expect(out).not.toMatch(/position:\s*(fixed|var)/)
    expect(out).toContain('position: sticky')
    expect(out).toContain('background-position: 0 0')
    expect(out.match(/position: absolute/g)).toHaveLength(2)
  })

  it('blocks url()/@import smuggled through escapes and comments', () => {
    for (const input of [
      'a{background:\\75 rl(https://evil.example/x)}',
      'a{background:u\\5c rl(https://evil.example/x)}',
      '@im\\70 ort "https://evil.example/x.css"; a{}',
      'a{background:image-set("https://evil.example/x" 1x)}',
      'a{background:URL(//evil.example/x)}',
      'a{background:url( "https://evil.example/x" )}',
    ]) {
      expect(sanitizeProfileCss(input), input).not.toMatch(/evil\.example/)
    }
    // A comment becomes whitespace, so `ur l(` is two tokens — never a url()
    expect(sanitizeProfileCss('a{background:ur/**/l(https://evil.example/x)}')).not.toMatch(/url\(/i)
    expect(sanitizeProfileCss('a{background:url(data:image/png;base64,AAAA)}')).toContain(
      'url(data:image/png;base64,AAAA)',
    )
  })

  it('is idempotent on its own output (own skin re-applied)', () => {
    const once = sanitizeProfileCss('a{color:red} b, c > d {margin:0}')
    expect(sanitizeProfileCss(once)).toBe(once)
  })
})

describe('emojify', () => {
  const emojis = [{ shortcode: 'blob', url: 'https://cdn.example/blob.png' }]

  it('never splices an <img> into an attribute of sanitized HTML', () => {
    const html =
      '<p><a href="https://x.example/:blob:/" title=":blob:" rel="noopener">see :blob:</a></p>'
    const out = emojify(html, emojis, { escape: false })
    expect(out).toContain('href="https://x.example/:blob:/"')
    expect(out).toContain('title=":blob:"')
    expect(out.match(/<img /g)).toHaveLength(1)
    expect(out).toMatch(/see <img class="emoji" src="https:\/\/cdn\.example\/blob\.png"/)
  })

  it('skips tags even when an attribute value contains ">"', () => {
    const out = emojify('<a href="https://x.example/?a=>:blob:">t</a>', emojis, { escape: false })
    expect(out).not.toContain('<img')
  })

  it('escapes hostile display names and emoji URLs', () => {
    const out = emojify(':blob:" onmouseover="alert(1)', [
      { shortcode: 'blob', url: 'https://cdn.example/a"onerror="x.png' },
    ])
    // Only ever inside escaped text / a quoted src — never a live attribute
    expect(out).not.toMatch(/"\s*(onmouseover|onerror)=/)
    expect(out).toContain('&quot; onmouseover=&quot;')
    expect(out).toContain('src="https://cdn.example/a&quot;onerror=&quot;x.png"')
    // Non-http(s) emoji URLs are ignored outright
    expect(emojify(':x:', [{ shortcode: 'x', url: 'javascript:alert(1)' }])).toBe(':x:')
  })
})

describe('log ring redaction', () => {
  it('scrubs tokens, codes, secrets, and Authorization values', () => {
    const msg = redactSecrets(
      'ws wss://m.example/api/v1/streaming?stream=user&access_token=SECRET1 ' +
        'cb https://neo.example/auth/callback?code=SECRET2&state=SECRET3 ' +
        '{"accessToken":"SECRET4","clientSecret":"SECRET5","id":"1"} Authorization: Bearer SECRET6',
    )
    expect(msg).not.toMatch(/SECRET\d/)
    expect(msg).toContain('stream=user')
    expect(msg).toContain('"id":"1"')
  })

  it('applies to what Leave-a-note attaches', () => {
    clearLogRing()
    logError('stream failed', new Error('GET https://m.example/x?access_token=abc123 failed'))
    expect(formatLogRingForFeedback()).not.toContain('abc123')
  })
})

describe('suite handoff origins', () => {
  it('trusts allowlisted + own preview hosts only', () => {
    expect(isLoomOrigin('https://loom.ibm.io')).toBe(true)
    expect(isLoomOrigin('https://pr-3-loom-storyteller.mhsenkow.workers.dev')).toBe(true)
    expect(isLoomOrigin('http://localhost:5173')).toBe(true)
    expect(isLoomOrigin('https://loom-evil.pages.dev')).toBe(false)
    expect(isLoomOrigin('https://loom.attacker.workers.dev')).toBe(false)
    expect(isLoomOrigin('http://loom.mhsenkow.workers.dev')).toBe(false)
    expect(isBruhOrigin('https://abc123.bruh-15b.pages.dev')).toBe(true)
    expect(isBruhOrigin('https://bruh-evil.pages.dev')).toBe(false)
    expect(isBruhOrigin('https://bruh.attacker.workers.dev')).toBe(false)
    expect(isBruhOrigin('https://evilbruh.pages.dev')).toBe(false)
  })
})

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

describe('OAuth state across tabs', () => {
  it("accepts this tab's own state when another tab overwrote the shared record", async () => {
    const local = memoryStorage()
    const tabA = memoryStorage()
    const tabB = memoryStorage()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', tabA)
    const a = await beginOAuthChallenge({ instanceId: 'A', host: 'a.example' })
    vi.stubGlobal('sessionStorage', tabB)
    const b = await beginOAuthChallenge({ instanceId: 'B', host: 'b.example' })

    // Tab A returns from its server: shared record is B's, A's own pair still matches
    vi.stubGlobal('sessionStorage', tabA)
    const resA = consumeOAuthChallenge(a.state)
    expect(resA.ok).toBe(true)
    expect(resA.codeVerifier).toBe(a.codeVerifier)
    expect(resA.pending).toBeNull()

    vi.stubGlobal('sessionStorage', tabB)
    const resB = consumeOAuthChallenge(b.state)
    expect(resB.ok).toBe(true)
    expect(resB.pending?.instanceId).toBe('B')

    expect(consumeOAuthChallenge('forged').ok).toBe(false)
  })
})

describe('feedback Pages Function', () => {
  let ipSeq = 0
  function post(body: string, headers: Record<string, string> = {}) {
    return new Request('https://neospace.ibm.io/api/feedback', {
      method: 'POST',
      body,
      headers: {
        Origin: 'https://neospace.ibm.io',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': `203.0.113.${++ipSeq}`,
        ...headers,
      },
    })
  }
  function githubMock() {
    const sent: { url: string; body: any; auth: string | null }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({
          url: String(url),
          body: JSON.parse(String(init.body)),
          auth: new Headers(init.headers).get('Authorization'),
        })
        return new Response(JSON.stringify({ html_url: 'https://github.com/x/y/issues/1' }), {
          status: 201,
        })
      }),
    )
    return sent
  }
  const env = { GITHUB_TOKEN: 'ghp_secret' }

  it('answers 400 (not a thrown 500) for null / non-object / wrongly typed JSON', async () => {
    githubMock()
    for (const body of ['null', '[]', '7', '{"title":{"x":1},"body":5,"kind":[]}']) {
      const res = await onRequestPost({ request: post(body), env })
      expect([400, 200], body).toContain(res.status)
      expect(res.headers.get('Content-Type')).toBe('application/json')
    }
  })

  it('refuses oversized chunked bodies without trusting Content-Length', async () => {
    githubMock()
    const big = JSON.stringify({ body: 'x'.repeat(600_000) })
    const res = await onRequestPost({ request: post(big), env })
    expect(res.status).toBe(413)
  })

  it('never lets the screenshot field inject markdown into the issue', async () => {
    const sent = githubMock()
    const evil = 'data:x) @octocat [click](https://phish.example) other/repo#1 ('
    const res = await onRequestPost({
      request: post(JSON.stringify({ title: 'Hi\nthere', body: 'note', imageBase64: evil })),
      env,
    })
    expect(res.status).toBe(200)
    const issue = sent[0]!.body
    expect(issue.body).not.toContain('@octocat')
    expect(issue.body).not.toContain('phish.example')
    expect(issue.title).toBe('Hi there')
    const json = (await res.json()) as Record<string, unknown>
    expect(JSON.stringify(json)).not.toContain('ghp_secret')
  })

  it('keeps valid screenshots', async () => {
    const sent = githubMock()
    await onRequestPost({
      request: post(JSON.stringify({ body: 'n', imageBase64: 'data:image/jpeg;base64,/9j/4AAQ==' })),
      env,
    })
    expect(sent[0]!.body.body).toContain('![screenshot](data:image/jpeg;base64,/9j/4AAQ==)')
    expect(screenshotDataUrl('iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('maps GitHub network failures to a JSON 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))))
    const res = await onRequestPost({ request: post('{"body":"x"}'), env })
    expect(res.status).toBe(502)
    expect(((await res.json()) as { code: string }).code).toBe('GITHUB_UNAVAILABLE')
  })
})

describe('rate limit IPv6 bucketing', () => {
  it('groups by the real /64 even when :: hides zero groups', () => {
    expect(ipv6Bucket('2001:db8::a:b:c:d')).toBe('2001:db8:0:0::/64')
    expect(ipv6Bucket('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipv6Bucket('2001:db8:1:2:a::1')).toBe('2001:db8:1:2::/64')
    expect(ipv6Bucket('2001:0db8:0001:0002:0:0:0:5')).toBe('2001:db8:1:2::/64')
    expect(ipv6Bucket('::ffff:1.2.3.4')).toBe('::ffff:1.2.3.4')
    expect(ipv6Bucket('203.0.113.9')).toBe('203.0.113.9')
  })
})

describe('sanitizeReturnTo', () => {
  it('only accepts same-origin paths', () => {
    expect(sanitizeReturnTo('/profile?tab=posts')).toBe('/profile?tab=posts')
    for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example', 'https://evil.example', '/%0a/evil', 'javascript:alert(1)', '']) {
      expect(sanitizeReturnTo(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
