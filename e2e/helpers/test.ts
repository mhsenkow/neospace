import { test as base, expect } from '@playwright/test'
import { mockMastodonApi, type MockApi } from './mockApi'

/**
 * Journey `test` with the strict Mastodon mock installed.
 * Any API request without a fixture fails the test at teardown (see `MockApi.assertClean`).
 */
export const test = base.extend<{ api: MockApi }>({
  api: [
    async ({ page }, use) => {
      const api = await mockMastodonApi(page)
      await use(api)
      api.assertClean()
    },
    { auto: true },
  ],
})

export { expect }
