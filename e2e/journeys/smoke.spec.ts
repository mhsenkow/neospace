import { test, expect } from '../helpers/test'
import { expectNoSeriousViolations } from '../helpers/axe'
import {
  primaryServer,
  seedAuthenticatedSession,
  seedPendingOAuth,
} from '../helpers/mockApi'
import { oauthApp, oauthToken } from '../fixtures/mastodon'

const STATE = 'e2e-state-0123456789'
const VERIFIER = 'e2e-verifier-0123456789-0123456789-0123456789'

test.describe('critical journeys', () => {
  test('guest landing settles on a public feed without serious a11y violations', async ({ page }) => {
    await page.goto('/')

    // Settled content, not the loading shell: a public feed with real posts and the sign-in path
    const feed = page.getByRole('feed')
    await expect(feed.getByRole('article').first()).toBeVisible({ timeout: 20_000 })
    await expect(feed.getByText('Fixture post 100')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: /loading/i })).toHaveCount(0)

    await expectNoSeriousViolations(page)
  })

  test('authenticated feed renders posts and passes axe', async ({ page }) => {
    await seedAuthenticatedSession(page)
    await page.goto('/')

    const feed = page.getByRole('feed', { name: /posts/i }).first()
    await expect(feed.getByText('Fixture post 100')).toBeVisible({ timeout: 20_000 })
    await expect(feed.getByText('Earlier fixture')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New post' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Neo Tester, accounts/ })).toBeVisible()

    await expectNoSeriousViolations(page)
    // The feed owns articles only — loading/"all caught up" chrome lives outside role=feed
    await expect(feed.locator(':scope > :not(article)')).toHaveCount(0)
  })

  test('valid OAuth callback exchanges the code and signs the account in', async ({
    page,
    api,
    baseURL,
  }) => {
    api.expectOAuthExchange({
      origin: primaryServer.origin,
      code: 'e2e-code',
      verifier: VERIFIER,
      clientId: oauthApp.client_id,
      clientSecret: oauthApp.client_secret,
      redirectUri: `${baseURL}/auth/callback`,
      token: oauthToken,
    })
    await seedPendingOAuth(page, {
      state: STATE,
      verifier: VERIFIER,
      clientId: oauthApp.client_id,
      clientSecret: oauthApp.client_secret,
    })

    await page.goto(`/auth/callback?code=e2e-code&state=${STATE}`)

    // Lands home, signed in as the fixture account, with the code scrubbed from the URL
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })
    await expect(page.getByRole('button', { name: /Neo Tester, accounts/ })).toBeVisible()
    await expect(page.getByRole('feed', { name: /posts/i }).first().getByText('Fixture post 100')).toBeVisible()

    const exchanges = api.find('POST', '/oauth/token', primaryServer.origin)
    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]!.body).toMatchObject({
      grant_type: 'authorization_code',
      code: 'e2e-code',
      code_verifier: VERIFIER,
      client_id: oauthApp.client_id,
    })

    // The new token is what the app then uses, and what it persisted
    const verify = api.find('GET', '/api/v1/accounts/verify_credentials', primaryServer.origin)
    expect(verify[0]!.authorization).toBe(`Bearer ${oauthToken.access_token}`)
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('neospace_instances')!))
    expect(stored.activeAccountId).toBe('local-1')
    expect(stored.instances[0]).toMatchObject({
      accessToken: oauthToken.access_token,
      user: { username: 'neo' },
    })
    expect(await page.evaluate(() => localStorage.getItem('neospace_pending_auth'))).toBeNull()
  })

  test('OAuth callback with a mismatched state never reaches the token endpoint', async ({
    page,
    api,
  }) => {
    await seedPendingOAuth(page, {
      state: STATE,
      verifier: VERIFIER,
      clientId: oauthApp.client_id,
      clientSecret: oauthApp.client_secret,
    })

    await page.goto('/auth/callback?code=e2e-code&state=someone-elses-state')

    await expect(page.getByRole('heading', { name: 'Couldn’t sign in' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible()
    expect(api.find('POST', '/oauth/token')).toHaveLength(0)
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('neospace_instances') ?? 'null'))
    expect(stored?.activeAccountId ?? null).toBeNull()
  })

  test('OAuth callback surfaces a rejected code and stays signed out', async ({ page, api, baseURL }) => {
    api.expectOAuthExchange({
      origin: primaryServer.origin,
      code: 'the-real-code',
      verifier: VERIFIER,
      clientId: oauthApp.client_id,
      clientSecret: oauthApp.client_secret,
      redirectUri: `${baseURL}/auth/callback`,
      token: oauthToken,
    })
    await seedPendingOAuth(page, {
      state: STATE,
      verifier: VERIFIER,
      clientId: oauthApp.client_id,
      clientSecret: oauthApp.client_secret,
    })

    await page.goto(`/auth/callback?code=stale-code&state=${STATE}`)

    await expect(page.getByRole('heading', { name: 'Couldn’t sign in' })).toBeVisible({ timeout: 20_000 })
    expect(api.find('POST', '/oauth/token')).toHaveLength(1)
    expect(api.find('GET', '/api/v1/accounts/verify_credentials')).toHaveLength(0)
  })

  test('search route shows its heading, field, and mode tabs', async ({ page }) => {
    await page.goto('/explore')

    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Search in' })).toBeVisible()
    await expect(page).toHaveURL(/\/explore/)
  })

  test('login route shows the server picker', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Your handle or server')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in on this server' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Explore servers' })).toBeVisible()
  })
})
