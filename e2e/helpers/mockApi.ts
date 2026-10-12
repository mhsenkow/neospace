import type { Page, Route } from '@playwright/test'
import {
  HOME_INSTANCE,
  account,
  homeTimeline,
  instanceV2,
  makeStatus,
  oauthToken,
} from '../fixtures/mastodon'

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Mock Mastodon REST + OAuth for the fixture host. Call before navigating.
 */
export async function mockMastodonApi(page: Page) {
  await page.route('**/api/v*/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (path === '/api/v2/instance') return json(route, instanceV2)
    if (path === '/api/v1/instance') return json(route, { ...instanceV2, uri: 'mastodon.test' })
    if (path === '/api/v1/accounts/verify_credentials') return json(route, account)
    if (path === '/api/v1/timelines/home') return json(route, homeTimeline)
    if (path === '/api/v1/timelines/public') return json(route, homeTimeline)
    if (path === '/api/v1/notifications') return json(route, [])
    if (path === '/api/v1/conversations') return json(route, [])
    if (path === '/api/v1/custom_emojis') return json(route, [])
    if (path === '/api/v1/preferences') return json(route, {})
    if (path.startsWith('/api/v1/accounts/lookup')) return json(route, account)
    if (path === '/api/v1/statuses' && method === 'POST') {
      const posted = makeStatus(String(Date.now()), { content: '<p>Composed in e2e</p>' })
      return json(route, posted)
    }
    if (path.startsWith('/api/v1/statuses/') && method === 'GET') {
      const id = path.split('/').pop()!
      return json(route, makeStatus(id))
    }
    if (path === '/api/v1/apps' && method === 'POST') {
      return json(route, {
        id: '1',
        name: 'NeoSpace',
        website: null,
        redirect_uri: 'http://127.0.0.1/auth/callback',
        client_id: 'e2e-client',
        client_secret: 'e2e-secret',
        vapid_key: '',
      })
    }
    // Unhandled — empty success so the SPA doesn't hang on optional probes
    return json(route, Array.isArray(homeTimeline) ? [] : {})
  })

  await page.route('**/oauth/token', async (route) => {
    await json(route, oauthToken)
  })

  // Avoid live WebSocket / streaming noise
  await page.route('**/api/v1/streaming**', (route) => route.abort())
}

/** Seed a signed-in session against the fixture host (localStorage shape used by instances store). */
export async function seedAuthenticatedSession(page: Page) {
  await page.addInitScript(
    ({ instanceUrl, token, acct }) => {
      const instance = {
        id: 'local-1',
        url: instanceUrl,
        name: 'Mastodon Test',
        accessToken: token,
        clientId: 'e2e-client',
        clientSecret: null,
        user: {
          id: '1',
          username: 'neo',
          acct,
          display_name: 'Neo Tester',
          displayName: 'Neo Tester',
          avatar: `${instanceUrl}/avatars/neo.png`,
          url: `${instanceUrl}/@neo`,
        },
        instanceInfo: null,
        isConnecting: false,
        error: null,
        lastFetched: null,
      }
      localStorage.setItem(
        'neospace_instances',
        JSON.stringify({
          v: 1,
          instances: [instance],
          activeAccountId: instance.id,
          primaryAccountId: instance.id,
          activeInstanceFilter: null,
        }),
      )
    },
    { instanceUrl: HOME_INSTANCE, token: oauthToken.access_token, acct: account.acct },
  )
}
