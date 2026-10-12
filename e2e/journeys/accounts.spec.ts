import { test, expect } from '../helpers/test'
import {
  primarySeed,
  primaryServer,
  secondSeed,
  secondServer,
  seedAuthenticatedSession,
} from '../helpers/mockApi'

const COMPOSE_FIELD = /what.?s new/i

test.describe('account switching', () => {
  test.beforeEach(async ({ page, api }) => {
    api.addServer(secondServer)
    await seedAuthenticatedSession(page, [primarySeed, secondSeed])
  })

  test('switching accounts changes identity, home feed, and the posting target together', async ({
    page,
    api,
  }) => {
    await page.goto('/')
    const feed = page.getByRole('feed', { name: /posts/i }).first()

    // Starts as the first account: its identity and its own home feed
    await expect(feed.getByText('Fixture post 100')).toBeVisible({ timeout: 20_000 })
    await expect(feed.getByText('Second server home post')).toHaveCount(0)
    await page.getByRole('button', { name: 'Neo Tester, switch accounts' }).click()

    const sheet = page.getByRole('dialog', { name: 'Accounts' })
    await expect(sheet.getByRole('button', { name: /Neo Tester/ })).toHaveAttribute('aria-current', 'true')
    await expect(sheet.getByRole('button', { name: /Trin Tester/ })).not.toHaveAttribute('aria-current', 'true')

    await sheet.getByRole('button', { name: /Trin Tester/ }).click()
    await expect(page.getByRole('dialog', { name: 'Accounts' })).toHaveCount(0)

    // Identity: the switcher now names the second account, and says who you post as
    await expect(page.getByRole('button', { name: 'Trin Tester, switch accounts' })).toBeVisible()
    await expect(page.getByText('Posting as @trin@second.test')).toBeVisible()

    // Feed: the second account's home timeline replaced the first one's
    await expect(feed.getByText('Second server home post')).toBeVisible({ timeout: 20_000 })
    await expect(feed.getByText('Fixture post 100')).toHaveCount(0)
    const homeFetches = api.find('GET', '/api/v1/timelines/home', secondServer.origin)
    expect(homeFetches.length).toBeGreaterThan(0)
    expect(homeFetches.every((r) => r.authorization === `Bearer ${secondServer.token}`)).toBe(true)

    // Posting target: a new post goes to the second server with the second token
    await page.getByRole('button', { name: 'New post' }).click()
    const composer = page.getByRole('dialog').getByRole('combobox', { name: COMPOSE_FIELD })
    await composer.fill('Posted as the second account')
    await page.getByRole('dialog').getByRole('button', { name: 'Post', exact: true }).click()

    await expect(feed.getByText('Posted as the second account')).toBeVisible()
    expect(api.find('POST', '/api/v1/statuses', primaryServer.origin)).toHaveLength(0)
    const [posted] = api.find('POST', '/api/v1/statuses', secondServer.origin)
    expect(posted!.authorization).toBe(`Bearer ${secondServer.token}`)
    expect(posted!.body).toMatchObject({ status: 'Posted as the second account' })

    // The choice persists for the next load
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('neospace_instances')!))
    expect(stored.activeAccountId).toBe(secondSeed.id)
  })

  test('switching back restores the first account across the same three surfaces', async ({ page, api }) => {
    await page.goto('/')
    const feed = page.getByRole('feed', { name: /posts/i }).first()
    await expect(feed.getByText('Fixture post 100')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Neo Tester, switch accounts' }).click()
    await page.getByRole('dialog', { name: 'Accounts' }).getByRole('button', { name: /Trin Tester/ }).click()
    await expect(feed.getByText('Second server home post')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Trin Tester, switch accounts' }).click()
    await page.getByRole('dialog', { name: 'Accounts' }).getByRole('button', { name: /Neo Tester/ }).click()

    await expect(page.getByRole('button', { name: 'Neo Tester, switch accounts' })).toBeVisible()
    await expect(feed.getByText('Fixture post 100')).toBeVisible({ timeout: 20_000 })
    await expect(feed.getByText('Second server home post')).toHaveCount(0)

    await page.getByRole('button', { name: 'New post' }).click()
    await page.getByRole('dialog').getByRole('combobox', { name: COMPOSE_FIELD }).fill('Back on the first')
    await page.getByRole('dialog').getByRole('button', { name: 'Post', exact: true }).click()
    await expect(feed.getByText('Back on the first')).toBeVisible()
    expect(api.find('POST', '/api/v1/statuses', secondServer.origin)).toHaveLength(0)
    expect(api.find('POST', '/api/v1/statuses', primaryServer.origin)).toHaveLength(1)
  })
})
