import { describe, expect, it } from 'vitest'
import {
  accountActiveLabel,
  formatCompactRelativeTime,
  formatRelativeTime,
} from '../app/utils/relativeTime'
import { tagHistorySummary } from '../app/utils/hashtag'
import { normalizePresenceInput } from '../app/utils/profileSources'

describe('relative time at unit boundaries (NS-271)', () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0)

  it('moves to the next unit instead of "60 seconds ago"', () => {
    expect(formatRelativeTime(now - 59_600, now, 'en')).not.toMatch(/60 seconds/)
    expect(formatRelativeTime(now - 119_000, now, 'en')).toBe('1 minute ago')
  })

  it('never rounds up into the next compact unit', () => {
    expect(formatCompactRelativeTime(now - (3_600_000 - 1_000), now, 'en')).toBe('59m')
    expect(formatCompactRelativeTime(now - (86_400_000 - 1_000), now, 'en')).toBe('23h')
    expect(formatCompactRelativeTime(now - 2 * 3_600_000, now, 'en')).toBe('2h')
  })
})

describe('accountActiveLabel (NS-566)', () => {
  it('uses calendar-day wording for last_status_at dates', () => {
    expect(accountActiveLabel('2026-10-12', 'en')).toBe('active today')
    expect(accountActiveLabel('2026-10-11', 'en')).toBe('active yesterday')
    expect(accountActiveLabel('2026-10-09', 'en')).toBe('active 3 days ago')
  })
})

describe('tagHistorySummary (NS-484)', () => {
  it('pluralizes posts and labels account sums', () => {
    const summary = tagHistorySummary({
      name: 'neo',
      url: '',
      history: [{ day: '1', uses: '1', accounts: '2' }],
    } as never)
    expect(summary).toContain('accounts (daily sum)')
    expect(summary).toContain('1 post')
  })
})

describe('normalizePresenceInput (NS-539/540)', () => {
  it('rejects non-bsky hosts for bluesky fields', () => {
    expect(normalizePresenceInput('bluesky', 'https://phish.example')).toBe(
      'https://phish.example',
    )
  })

  it('encodes bluesky handles', () => {
    expect(normalizePresenceInput('bluesky', 'alice.bsky.social')).toBe(
      'https://bsky.app/profile/alice.bsky.social',
    )
  })
})
