import { test, expect } from '../helpers/test'
import { expectNoSeriousViolations } from '../helpers/axe'
import { seedAuthenticatedSession } from '../helpers/mockApi'

// Runs in the `mobile` project only (see playwright.config.ts): touch device, phone viewport.
test.describe('mobile shell dialogs', () => {
  test('menu button opens a named dialog, focuses inside it, and returns focus on Escape', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('feed').first().getByRole('article').first()).toBeVisible({ timeout: 20_000 })

    // The trigger is required — no silent skip when it goes missing
    const trigger = page.getByRole('button', { name: 'Menu', exact: true })
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.click()

    const dialog = page.getByRole('dialog', { name: 'Menu' })
    await expect(dialog).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(dialog.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Search' })).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Settings' })).toBeVisible()

    // Focus moved into the dialog (its close button) and stays trapped there
    await expect(dialog.getByRole('button', { name: 'Close menu' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.locator(':focus')).toHaveCount(1)

    await expectNoSeriousViolations(page, '#mobile-sidebar')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
  })

  test('menu navigation closes the dialog and lands on the route', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Menu' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Search' }).click()

    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible({ timeout: 15_000 })
  })

  test('signed-in menu shows who you post as and offers sign out', async ({ page }) => {
    await seedAuthenticatedSession(page)
    await page.goto('/')
    await expect(page.getByRole('feed', { name: /posts/i }).first().getByText('Fixture post 100')).toBeVisible({
      timeout: 20_000,
    })

    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Menu' })
    await expect(dialog.getByText('Neo Tester')).toBeVisible()
    await expect(dialog.getByText(/Posting on mastodon\.test/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  test('New post tab opens the compose dialog and Cancel closes it', async ({ page }) => {
    await seedAuthenticatedSession(page)
    await page.goto('/')
    await expect(page.getByRole('feed', { name: /posts/i }).first().getByText('Fixture post 100')).toBeVisible({
      timeout: 20_000,
    })
    await expectNoSeriousViolations(page)

    const trigger = page.getByRole('button', { name: 'New post' })
    await expect(trigger).toBeVisible()
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: 'New post' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: /what.?s new/i })).toBeVisible()
    await expect(dialog.locator(':focus')).toHaveCount(1)

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })
})
