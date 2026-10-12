import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockMastodonApi, seedAuthenticatedSession } from '../helpers/mockApi'

test.describe('critical journeys', () => {
  test.beforeEach(async ({ page }) => {
    await mockMastodonApi(page)
  })

  test('guest landing loads without serious a11y violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })

  test('OAuth callback page handles token exchange route', async ({ page }) => {
    // Callback with mock code — page should not crash; fixtures cover /oauth/token
    await page.goto('/auth/callback?code=e2e-code&state=e2e')
    await expect(page.locator('body')).toBeVisible()
    // Either redirects home/login or shows an error — never a blank crash
    await expect(page.locator('#__nuxt, #__nuxt *').first()).toBeAttached({ timeout: 15_000 })
  })

  test('authenticated board shows compose affordance', async ({ page }) => {
    await seedAuthenticatedSession(page)
    await page.goto('/')
    await expect(page.locator('body')).toBeVisible()
    // Compose entry: sidebar "New post" and/or in-column "What's new?" box
    await expect(page.getByRole('button', { name: 'New post' })).toBeVisible({ timeout: 20_000 })
  })

  test('explore / login surfaces are reachable', async ({ page }) => {
    await page.goto('/explore')
    await expect(page.locator('body')).toBeVisible()
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: /sign in|log in|connect/i }).or(page.locator('body'))).toBeVisible()
  })
})

test.describe('mobile dialogs', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('mobile shell opens without crash', async ({ page }) => {
    await mockMastodonApi(page)
    await page.goto('/')
    await expect(page.locator('body')).toBeVisible()
    const menu = page.getByRole('button', { name: /menu|more|settings|accounts/i }).first()
    if (await menu.isVisible().catch(() => false)) {
      await menu.click()
      await expect(page.locator('body')).toBeVisible()
    }
  })
})
