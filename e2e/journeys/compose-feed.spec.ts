import { test, expect } from '../helpers/test'
import { primaryServer, seedAuthenticatedSession } from '../helpers/mockApi'

const DRAFT_KEY = 'neospace_draft:local-1:new'
const COMPOSE_FIELD = /what.?s new/i

test.describe('compose and feed', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedSession(page)
  })

  test('posting from the compose sheet sends the right payload, shows the post, and clears the draft', async ({
    page,
    api,
  }) => {
    await page.goto('/')
    const feed = page.getByRole('feed', { name: /posts/i }).first()
    await expect(feed.getByText('Fixture post 100')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'New post' }).click()
    const sheet = page.getByRole('dialog')
    const field = sheet.getByRole('combobox', { name: COMPOSE_FIELD })
    // Focus is trapped inside the dialog while it is open
    await expect(sheet.locator(':focus')).toHaveCount(1)

    await field.fill('Hello from the browser e2e')
    await sheet.getByLabel('Post visibility').selectOption('unlisted')

    // Autosave stores the draft while composing (debounced)
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY))
      .toContain('Hello from the browser e2e')

    await sheet.getByRole('button', { name: 'Post', exact: true }).click()

    // Request: right server, token, text, and the chosen (non-default) visibility
    await expect.poll(() => api.find('POST', '/api/v1/statuses').length).toBe(1)
    const [request] = api.find('POST', '/api/v1/statuses', primaryServer.origin)
    expect(request!.authorization).toBe(`Bearer ${primaryServer.token}`)
    expect(request!.body).toMatchObject({
      status: 'Hello from the browser e2e',
      visibility: 'unlisted',
    })

    // Result: the returned post is in the feed, the sheet is gone, the draft is cleared
    await expect(feed.getByText('Hello from the browser e2e')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)).toBeNull()

    await page.getByRole('button', { name: 'New post' }).click()
    await expect(page.getByRole('dialog').getByRole('combobox', { name: COMPOSE_FIELD })).toHaveValue('')
  })

  test('a failed post keeps the text and the draft, and shows no phantom post', async ({ page, api }) => {
    // Override the fixture's POST so the server refuses it
    await page.route(`${primaryServer.origin}/api/v1/statuses`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      api.requests.push({
        method: 'POST',
        origin: primaryServer.origin,
        path: '/api/v1/statuses',
        query: {},
        authorization: route.request().headers()['authorization'] ?? null,
        body: route.request().postDataJSON(),
      })
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: 'Validation failed: Text is too long' }),
      })
    })

    await page.goto('/')
    await expect(
      page.getByRole('feed', { name: /posts/i }).first().getByText('Fixture post 100'),
    ).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'New post' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('combobox', { name: COMPOSE_FIELD }).fill('This one will be refused')
    await sheet.getByRole('button', { name: 'Post', exact: true }).click()

    await expect(sheet.getByRole('alert')).toBeVisible()
    await expect(sheet.getByRole('combobox', { name: COMPOSE_FIELD })).toHaveValue('This one will be refused')
    await expect(page.getByRole('feed', { name: /posts/i }).first().getByText('This one will be refused')).toHaveCount(0)
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY))
      .toContain('This one will be refused')
  })

  test('the first column offers an inline composer on the board', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.columns-page')).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('feed', { name: /posts/i }).first().getByText('Fixture post 100'),
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.getByPlaceholder(/what'?s new/i).first()).toBeVisible()
  })
})
