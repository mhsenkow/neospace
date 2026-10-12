import { describe, expect, it, vi } from 'vitest'
import { formatMonthlyActive, normalizeServer } from '../app/utils/instances'
import { INSTALL_DISMISS_TTL_MS, isInstallDismissalActive } from '../app/composables/useInstallApp'
import { formatCompactRelativeTime } from '../app/utils/relativeTime'
import { resolveIcon } from '../app/utils/neoIcons'
import { matchesMedia } from '../app/utils/cachedMedia'
import { nextMaxIdFromLink } from '../app/utils/linkHeader'
import { formatCount, formatCountLabel, searchQueryTooShort } from '../app/utils/searchQuery'
import { tagKey } from '../app/utils/hashtag'

describe('P3 batch: small utilities', () => {
  it('normalizeServer strips one trailing dot (FQDN form)', () => {
    expect(normalizeServer('mastodon.social.')).toBe('https://mastodon.social')
    expect(normalizeServer('https://mastodon.social./')).toBe('https://mastodon.social')
  })

  it('formatMonthlyActive reads as one phrase', () => {
    expect(formatMonthlyActive(1234)).toBe(`${(1234).toLocaleString()} active this month`)
  })

  it('install-banner dismissal expires after 30 days; legacy "1" is expired', () => {
    const now = 1_800_000_000_000
    expect(isInstallDismissalActive(String(now - 1000), now)).toBe(true)
    expect(isInstallDismissalActive(String(now - INSTALL_DISMISS_TTL_MS - 1), now)).toBe(false)
    expect(isInstallDismissalActive('1', now)).toBe(false)
    expect(isInstallDismissalActive(null, now)).toBe(false)
  })

  it('compact relative time shows a short date for clearly-future posts', () => {
    const now = Date.UTC(2026, 9, 12, 12, 0, 0)
    expect(formatCompactRelativeTime(now + 3 * 86_400_000, now, 'en')).toMatch(/Oct/)
    // Clock skew under a minute stays "now"-ish, not a date
    expect(formatCompactRelativeTime(now + 20_000, now, 'en')).not.toMatch(/Oct/)
  })

  it('resolveIcon renders nothing for an unknown name instead of throwing', () => {
    const render = resolveIcon('definitely-not-an-icon' as never)
    expect(render({} as never)).toEqual([])
  })

  it('matchesMedia reuses one MediaQueryList per query', () => {
    const matchMedia = vi.fn(() => ({ matches: true }))
    vi.stubGlobal('window', { matchMedia })
    try {
      expect(matchesMedia('(hover: none)')).toBe(true)
      expect(matchesMedia('(hover: none)')).toBe(true)
      expect(matchMedia).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('Link header cursor survives a relative next URL', () => {
    expect(nextMaxIdFromLink('</api/v1/timelines/home?max_id=42>; rel="next"')).toBe('42')
    expect(nextMaxIdFromLink('<https://x.example/api?max_id=7>; rel="next", <https://x.example/a>; rel="prev"')).toBe('7')
    expect(nextMaxIdFromLink(null)).toBeNull()
  })

  it('formatCountLabel pluralises and compacts', () => {
    expect(formatCountLabel(1, 'post')).toBe('1 post')
    expect(formatCountLabel(0, 'post')).toBe('0 posts')
    expect(formatCountLabel(12_345, 'follower')).toBe(`${formatCount(12_345)} followers`)
  })

  it('tagKey folds Latin accents (Mastodon-style)', () => {
    expect(tagKey('Café')).toBe('cafe')
    expect(tagKey('#Café')).toBe('cafe')
  })

  it('searchQueryTooShort allows a single non-Latin character', () => {
    expect(searchQueryTooShort('猫')).toBe(false)
    expect(searchQueryTooShort('ab')).toBe(false)
    expect(searchQueryTooShort('a')).toBe(true)
  })
})
