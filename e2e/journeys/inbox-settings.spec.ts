import { test, expect } from '../helpers/test'
import { expectNoSeriousViolations } from '../helpers/axe'
import { seedAuthenticatedSession } from '../helpers/mockApi'

test.describe('guest settings', () => {
  test('profile invites sign-in and other categories stay usable', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('feed').getByRole('article').first()).toBeVisible({
      timeout: 20_000,
    })
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(dialog.getByPlaceholder('Your display name')).toHaveCount(0)
    await expect(dialog.getByText('Not authenticated')).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Privacy & Safety' }).click()
    await expect(dialog.getByText(/Privacy tools need a signed-in account/)).toBeVisible()
    await expect(dialog.getByText('Not authenticated')).toHaveCount(0)
    await expect(dialog.getByText('Remember searches on this device')).toBeVisible()

    await dialog.getByRole('button', { name: 'Appearance' }).click()
    await expect(dialog.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await expectNoSeriousViolations(page)
  })
})

test.describe('inbox and settings shells', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedSession(page)
  })

  test('Activity page settles and passes axe', async ({ page }) => {
    await page.goto('/notifications')
    await expect(page.getByText('Activity').first()).toBeVisible({ timeout: 20_000 })
    // Empty fixture inbox still exposes filter chrome
    await expect(page.getByRole('tablist', { name: /filter activity/i })).toBeVisible()
    await expectNoSeriousViolations(page)
  })

  test('Messages page settles and passes axe', async ({ page }) => {
    await page.goto('/messages')
    await expect(page.getByText('Messages').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'New message' }).first()).toBeVisible()
    await expectNoSeriousViolations(page)
  })

  test('Settings dialog opens from the sidebar and passes axe', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('feed', { name: /posts/i }).first()).toBeVisible({
      timeout: 20_000,
    })
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('navigation', { name: /settings categories/i })).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: /display name/i })).toBeVisible()
    await expectNoSeriousViolations(page)
  })
})
