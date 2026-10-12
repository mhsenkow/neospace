import type { Page, Route } from '@playwright/test'
import {
  HOME_INSTANCE,
  SECOND_INSTANCE,
  account,
  homeTimeline,
  instanceV2,
  makeStatus,
  oauthToken,
  secondAccount,
  secondHomeTimeline,
  secondInstanceV2,
  secondOauthToken,
} from '../fixtures/mastodon'

type Json = Record<string, unknown> | unknown[]

/** One fixture Mastodon server the app can be signed in to */
export interface MockServer {
  origin: string
  token: string
  account: typeof account
  instance: Record<string, unknown>
  home: Record<string, unknown>[]
}

export const primaryServer: MockServer = {
  origin: HOME_INSTANCE,
  token: oauthToken.access_token,
  account,
  instance: instanceV2,
  home: homeTimeline,
}

export const secondServer: MockServer = {
  origin: SECOND_INSTANCE,
  token: secondOauthToken.access_token,
  account: secondAccount,
  instance: secondInstanceV2,
  home: secondHomeTimeline,
}

/** What the OAuth token endpoint accepts for one exchange */
export interface OAuthExpectation {
  origin: string
  code: string
  verifier: string
  clientId: string
  clientSecret: string
  redirectUri: string
  token: typeof oauthToken
}

export interface RecordedRequest {
  method: string
  origin: string
  path: string
  query: Record<string, string>
  authorization: string | null
  /** Parsed JSON body (or the raw string when it is not JSON) */
  body: unknown
}

export interface MockApi {
  servers: MockServer[]
  /** Every request answered by a fixture, in order */
  requests: RecordedRequest[]
  /** Requests no fixture covers — answered 501 and failing the test at teardown */
  unhandled: string[]
  addServer(server: MockServer): void
  /** Arm the OAuth token endpoint for one valid exchange */
  expectOAuthExchange(expectation: OAuthExpectation): void
  /** Matching requests so far (method + path, optionally one origin) */
  find(method: string, path: string, origin?: string): RecordedRequest[]
  /** Throws when anything unrecognised was requested */
  assertClean(): void
}

/**
 * Read-only probes the app fires on load whose content these journeys never assert on.
 * Listing them is deliberate: anything NOT here or in the handlers below fails the test,
 * so a misspelled endpoint or unintended mutation can't hide behind an empty success.
 */
const OPTIONAL_PROBES: Record<string, Json> = {
  '/api/v1/conversations': [],
  '/api/v1/trends/tags': [],
  '/api/v1/trends/links': [],
  '/api/v1/followed_tags': [],
  '/api/v1/notifications': [],
  '/api/v1/notifications/unread_count': { count: 0 },
  // Post cards read the reading prefs (expand media / spoilers, autoplay GIFs) at boot
  '/api/v1/preferences': {
    'posting:default:visibility': 'public',
    'posting:default:sensitive': false,
    'posting:default:language': null,
    'reading:expand:media': 'default',
    'reading:expand:spoilers': false,
    'reading:autoplay:gifs': true,
  },
}

/** 1×1 transparent PNG for avatar/header/logo requests to fixture hosts */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const isLocal = (url: URL) => url.hostname === '127.0.0.1' || url.hostname === 'localhost'

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
  })
}

function parseBody(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * Mock Mastodon REST + OAuth for the fixture hosts. Call before navigating.
 * Strict by design: unrecognised requests are recorded in `unhandled`, answered 501,
 * and fail the test via `assertClean()` (wired into the shared `test` fixture).
 */
export async function mockMastodonApi(
  page: Page,
  opts: { servers?: MockServer[] } = {},
): Promise<MockApi> {
  const requests: RecordedRequest[] = []
  const unhandled: string[] = []
  const servers = [...(opts.servers ?? [primaryServer])]
  let oauth: OAuthExpectation | null = null
  /** Deterministic created-post ids — stable across runs, monotonic per mock session */
  let postedSeq = 0
  const nextPostedId = () => {
    postedSeq += 1
    return String(9000 + postedSeq)
  }

  const serverFor = (origin: string) => servers.find((s) => s.origin === origin)

  const api: MockApi = {
    servers,
    requests,
    unhandled,
    addServer: (server) => {
      servers.push(server)
    },
    expectOAuthExchange: (expectation) => {
      oauth = expectation
    },
    find: (method, path, origin) =>
      requests.filter(
        (r) => r.method === method && r.path === path && (!origin || r.origin === origin),
      ),
    assertClean: () => {
      if (unhandled.length) {
        throw new Error(
          `Unhandled mocked API request(s) — add a fixture or fix the endpoint:\n  ${unhandled.join('\n  ')}`,
        )
      }
    },
  }

  const fail = async (route: Route, why: string) => {
    unhandled.push(why)
    await json(route, { error: `e2e: unhandled ${why}` }, 501)
  }

  await page.route(
    (url) => !isLocal(url),
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const method = request.method()
      const path = url.pathname
      const label = `${method} ${url.origin}${path}`

      if (method === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': '*',
          },
        })
        return
      }

      // Avatars, headers, and logos on fixture hosts
      if (method === 'GET' && /^\/(avatars|headers|packs)\//.test(path)) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
        return
      }

      // Streaming is never mocked as a live socket
      if (path.startsWith('/api/v1/streaming')) {
        await route.abort()
        return
      }

      const record = (): RecordedRequest => {
        const entry: RecordedRequest = {
          method,
          origin: url.origin,
          path,
          query: Object.fromEntries(url.searchParams),
          authorization: request.headers()['authorization'] ?? null,
          body: parseBody(request.postData()),
        }
        requests.push(entry)
        return entry
      }

      // ── OAuth token exchange ────────────────────────────────────────────
      if (path === '/oauth/token' && method === 'POST') {
        if (!oauth || oauth.origin !== url.origin) return fail(route, label)
        const entry = record()
        const body = (entry.body ?? {}) as Record<string, string>
        const valid =
          body.grant_type === 'authorization_code' &&
          body.code === oauth.code &&
          body.code_verifier === oauth.verifier &&
          body.client_id === oauth.clientId &&
          body.client_secret === oauth.clientSecret &&
          body.redirect_uri === oauth.redirectUri
        if (!valid) {
          return json(route, { error: 'invalid_grant', error_description: 'Bad exchange' }, 400)
        }
        return json(route, oauth.token)
      }

      // ── Public, unauthenticated reads (guest browsing; any server) ──────
      if (method === 'GET' && path === '/api/v2/instance') {
        const known = serverFor(url.origin)
        record()
        return json(route, known?.instance ?? { ...instanceV2, domain: url.hostname })
      }
      if (method === 'GET' && path === '/api/v1/timelines/public') {
        record()
        return json(route, homeTimeline)
      }

      // ── Authenticated reads / writes: known servers only, bearer required ─
      const server = serverFor(url.origin)
      if (server && path.startsWith('/api/')) {
        const authed = request.headers()['authorization'] === `Bearer ${server.token}`
        const needsAuth = (): boolean => {
          if (authed) return true
          record()
          void json(route, { error: 'The access token is invalid' }, 401)
          return false
        }

        if (method === 'GET' && path === '/api/v1/accounts/verify_credentials') {
          if (!needsAuth()) return
          record()
          return json(route, server.account)
        }
        if (method === 'GET' && path === '/api/v1/timelines/home') {
          if (!needsAuth()) return
          record()
          return json(route, server.home)
        }
        if (method === 'POST' && path === '/api/v1/statuses') {
          if (!needsAuth()) return
          const entry = record()
          const body = (entry.body ?? {}) as { status?: string; visibility?: string }
          const text = typeof body.status === 'string' ? body.status : ''
          if (!text.trim()) {
            return json(route, { error: 'Validation failed: Text is required' }, 422)
          }
          const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          const id = nextPostedId()
          const visibility =
            typeof body.visibility === 'string' && body.visibility.trim()
              ? body.visibility
              : 'public'
          return json(
            route,
            makeStatus(id, {
              content: `<p>${escaped || ' '}</p>`,
              visibility,
              account: server.account,
              uri: `${server.origin}/users/${server.account.username}/statuses/${id}`,
              url: `${server.origin}/@${server.account.username}/${id}`,
            }),
          )
        }
        if (method === 'GET' && OPTIONAL_PROBES[path] !== undefined) {
          if (!needsAuth()) return
          record()
          return json(route, OPTIONAL_PROBES[path])
        }
      }

      // Guest probes on any origin (trends on public servers)
      if (method === 'GET' && OPTIONAL_PROBES[path] !== undefined && !server) {
        record()
        return json(route, OPTIONAL_PROBES[path])
      }

      return fail(route, label)
    },
  )

  return api
}

export interface SeedAccount {
  /** Instances-store slot id */
  id: string
  server: MockServer
}

export const primarySeed: SeedAccount = { id: 'local-1', server: primaryServer }
export const secondSeed: SeedAccount = { id: 'local-2', server: secondServer }

function seededInstance(seed: SeedAccount) {
  const { server } = seed
  const host = server.origin.replace(/^https?:\/\//, '')
  return {
    id: seed.id,
    url: server.origin,
    name: String(server.instance.title ?? host),
    accessToken: server.token,
    clientId: 'e2e-client',
    clientSecret: null,
    user: {
      id: server.account.id,
      username: server.account.username,
      acct: server.account.acct,
      display_name: server.account.display_name,
      displayName: server.account.display_name,
      avatar: server.account.avatar,
      url: server.account.url,
    },
    instanceInfo: null,
    isConnecting: false,
    error: null,
    lastFetched: null,
  }
}

/**
 * Seed signed-in session(s) (localStorage shape used by the instances store).
 * The first account is active and main unless `activeId` says otherwise.
 * Only seeds an empty browser — a reload keeps whatever the app persisted since.
 */
export async function seedAuthenticatedSession(
  page: Page,
  accounts: SeedAccount[] = [primarySeed],
  activeId: string = accounts[0]!.id,
) {
  const instances = accounts.map(seededInstance)
  await page.addInitScript(
    ({ instances, activeId, primaryId }) => {
      if (localStorage.getItem('neospace_instances') !== null) return
      localStorage.setItem(
        'neospace_instances',
        JSON.stringify({
          v: 1,
          instances,
          activeAccountId: activeId,
          primaryAccountId: primaryId,
          activeInstanceFilter: null,
        }),
      )
    },
    { instances, activeId, primaryId: instances[0]!.id },
  )
}

/**
 * Seed the state a browser holds when it comes back from the server's authorize page:
 * a registered app slot with no token yet, its client secret, and the pending
 * state/verifier record written by `beginOAuthChallenge`.
 */
export async function seedPendingOAuth(
  page: Page,
  opts: {
    seed?: SeedAccount
    state: string
    verifier: string
    clientId: string
    clientSecret: string
  },
) {
  const seed = opts.seed ?? primarySeed
  const instance = { ...seededInstance(seed), accessToken: null, user: null, clientId: opts.clientId }
  await page.addInitScript(
    ({ instance, host, state, verifier, clientSecret }) => {
      if (localStorage.getItem('neospace_instances') !== null) return
      localStorage.setItem(
        'neospace_instances',
        JSON.stringify({
          v: 1,
          instances: [instance],
          activeAccountId: null,
          primaryAccountId: null,
          activeInstanceFilter: null,
        }),
      )
      localStorage.setItem(`neospace_oauth_secret:${instance.id}`, clientSecret)
      localStorage.setItem(
        'neospace_pending_auth',
        JSON.stringify({
          state,
          verifier,
          instanceId: instance.id,
          host,
          addMode: false,
          returnTo: null,
          createdAt: Date.now(),
        }),
      )
    },
    {
      instance,
      host: seed.server.origin.replace(/^https?:\/\//, ''),
      state: opts.state,
      verifier: opts.verifier,
      clientSecret: opts.clientSecret,
    },
  )
}
