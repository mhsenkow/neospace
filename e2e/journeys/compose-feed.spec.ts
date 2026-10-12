import { test, expect } from '@playwright/test'
import { mockMastodonApi, seedAuthenticatedSession } from '../helpers/mockApi'

test.describe('compose and feed', () => {
  test.beforeEach(async ({ page }) => {
    await mockMastodonApi(page)
    await seedAuthenticatedSession(page)
  })

  test('compose sheet opens from New post', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'New post' }).click()
    const input = page.getByRole('combobox', { name: /what'?s new|write|compose/i }).or(
      page.getByPlaceholder(/what'?s new|write/i),
    )
    await expect(input.first()).toBeVisible({ timeout: 15_000 })
  })

  test('feed column chrome is present after load', async ({ page }) => {
    await page.goto('/')
    // Board shell: columns page or Home nav
    await expect(page.locator('.columns-page')).toBeVisible({ timeout: 15_000 })
  })
})
