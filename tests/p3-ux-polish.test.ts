import { describe, expect, it } from 'vitest'
import { formatCompactRelativeTime, formatRelativeTime } from '../app/utils/relativeTime'

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
