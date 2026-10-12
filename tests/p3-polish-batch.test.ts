import { describe, expect, it } from 'vitest'
import {
  CRITICAL_FONT_PRELOAD_PATHS,
  criticalFontPreloadHref,
  resolveFontFamilies,
} from '../app/utils/loadFonts'
import { largestRemainderSlots, formatInsightHour } from '../app/utils/insights'
import { buildPostQuery, emptyPostFilters, localIsoDay } from '../app/utils/searchQuery'
import { sanitizeProfileCss } from '../app/utils/sanitizeCss'

describe('P3 polish batch', () => {
  it('loads critical regular before deferred body family', () => {
    const { critical, deferred } = resolveFontFamilies('monocle', 'serif')
    expect(critical).toEqual(['Source Sans 3'])
    expect(deferred).toEqual(['Source Serif 4'])
  })

  it('prepaint preload href only when mapped', () => {
    expect(criticalFontPreloadHref('monocle', 'sans')).toBeNull()
    expect(CRITICAL_FONT_PRELOAD_PATHS['OpenDyslexic']).toMatch(/opendyslexic/)
  })

  it('largest-remainder slots always sum to 100', () => {
    const slots = largestRemainderSlots([33, 33, 33], 100)
    expect(slots.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('formatInsightHour uses unpadded hour', () => {
    expect(formatInsightHour(9)).toBe('9:00')
    expect(formatInsightHour(9.9)).toBe('9:00')
  })

  it('after: uses local calendar date minus window+1 day', () => {
    const now = new Date(2026, 9, 12, 23, 30, 0) // Oct 12 local
    const q = buildPostQuery('', { ...emptyPostFilters(), since: 'day' }, now)
    expect(q).toMatch(/after:2026-10-10/)
    expect(localIsoDay(now)).toBe('2026-10-12')
  })

  it('preserves @keyframes with a profile prefix and rewrites animation-name', () => {
    const out = sanitizeProfileCss(
      '@keyframes pulse { from { opacity: 1 } to { opacity: 0.5 } } .x { animation: pulse 2s infinite; color: red; }',
    )
    expect(out).toContain('@keyframes ns-profile-pulse')
    expect(out).toContain('animation: ns-profile-pulse')
    expect(out).not.toMatch(/animation:\s*pulse\b/)
  })
})
