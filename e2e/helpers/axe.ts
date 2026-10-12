import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/**
 * Scan the page and fail on serious/critical WCAG A/AA violations.
 * Call only after the screen under test has settled (feed rendered, dialog open, …) —
 * scanning the loading shell proves nothing about loaded content.
 */
export async function expectNoSeriousViolations(page: Page, scope?: string) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa'])
  if (scope) builder = builder.include(scope)
  const results = await builder.analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    serious.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    })),
  ).toEqual([])
}
