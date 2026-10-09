import { describe, expect, it } from 'vitest'
import {
  escapeCsv,
  formatDateOnly,
  insightHeatmapToCsv,
  insightPostsToCsv,
  statusToInsightRow,
} from '../app/utils/insights'
import { parseStoredLocalPrefs } from '../app/stores/settings'
import { mergePresenceIntoFields, profileFieldLimit } from '../app/utils/profileSources'

describe('stored local prefs parsing', () => {
  it('drops corrupt JSON instead of throwing', () => {
    expect(parseStoredLocalPrefs('{"theme":')).toBeNull()
    expect(parseStoredLocalPrefs('not json')).toBeNull()
  })

  it('drops non-object payloads (null, arrays, primitives)', () => {
    expect(parseStoredLocalPrefs(null)).toBeNull()
    expect(parseStoredLocalPrefs('')).toBeNull()
    expect(parseStoredLocalPrefs('null')).toBeNull()
    expect(parseStoredLocalPrefs('[1,2]')).toBeNull()
    expect(parseStoredLocalPrefs('42')).toBeNull()
    expect(parseStoredLocalPrefs('"dark"')).toBeNull()
  })

  it('strips the schema version and keeps fields', () => {
    expect(parseStoredLocalPrefs('{"v":1,"theme":"dark","collapseReblogs":false}')).toEqual({
      theme: 'dark',
      collapseReblogs: false,
    })
    // Legacy (pre-version) blobs still parse
    expect(parseStoredLocalPrefs('{"theme":"light"}')).toEqual({ theme: 'light' })
  })

  it('does not pollute Object.prototype via __proto__ keys', () => {
    const parsed = parseStoredLocalPrefs('{"__proto__":{"polluted":true},"theme":"dark"}')
    expect(parsed?.theme).toBe('dark')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('CSV export injection', () => {
  it('prefixes formula-looking text cells', () => {
    expect(escapeCsv('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(escapeCsv('+1')).toBe("'+1")
    expect(escapeCsv('-2+3')).toBe("'-2+3")
    expect(escapeCsv('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escapeCsv('\t=1')).toBe("'\t=1")
    expect(escapeCsv('\r=1')).toBe(`"'\r=1"`)
  })

  it('leaves numbers and plain text alone', () => {
    expect(escapeCsv(42)).toBe('42')
    expect(escapeCsv(0)).toBe('0')
    expect(escapeCsv(Number.NaN)).toBe('')
    expect(escapeCsv('hello')).toBe('hello')
    expect(escapeCsv('a,b')).toBe('"a,b"')
  })

  it('neutralises a post preview that starts with a formula', () => {
    const row = statusToInsightRow({
      id: '1',
      createdAt: '2026-10-01T12:00:00.000Z',
      content: '<p>=cmd|\' /C calc\'!A0</p>',
    })
    const csv = insightPostsToCsv([row])
    const body = csv.split('\n')[1] || ''
    expect(body).toContain("'=cmd|")
    expect(body).not.toMatch(/,=cmd/)
  })

  it('heatmap csv keeps numeric columns unquoted', () => {
    const csv = insightHeatmapToCsv([{ weekday: 1, weekday_name: 'Mon', hour: 9, posts: 3 }])
    expect(csv.split('\n')[1]).toBe('1,Mon,9,3')
  })

  it('String#trim strips the BOM (why the combined bundle re-adds one)', () => {
    expect('﻿a,b'.trim()).toBe('a,b')
  })
})

describe('date-only formatting', () => {
  it('formats Mastodon calendar dates in local time (no off-by-one west of UTC)', () => {
    const out = formatDateOnly('2024-05-02', { year: 'numeric', month: '2-digit', day: '2-digit' })
    const expected = new Date(2024, 4, 2).toLocaleDateString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    expect(out).toBe(expected)
  })

  it('returns null for empty / invalid input', () => {
    expect(formatDateOnly(null)).toBeNull()
    expect(formatDateOnly('')).toBeNull()
    expect(formatDateOnly('not a date')).toBeNull()
  })
})

describe('profile field limits', () => {
  it('honours instance limits above Mastodon’s default 4', () => {
    expect(profileFieldLimit(undefined)).toBe(4)
    expect(profileFieldLimit(6)).toBe(6)
    expect(profileFieldLimit(1000)).toBe(16)
    expect(profileFieldLimit(0)).toBe(4)
  })

  it('keeps presence links when the server allows more than 4 fields', () => {
    const fields = [
      { name: 'Pronouns', value: 'they/them' },
      { name: 'Location', value: 'Earth' },
      { name: 'Hobby', value: 'Birds' },
      { name: 'Job', value: 'Baker' },
    ]
    const merged = mergePresenceIntoFields(
      fields,
      { bluesky: '@me.bsky.social', seenu: '', website: 'example.com' },
      6,
    )
    expect(merged).toHaveLength(6)
    expect(merged.map((f) => f.name)).toContain('Bluesky')
    expect(merged.map((f) => f.name)).toContain('Website')
  })
})
