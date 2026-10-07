import { describe, expect, it } from 'vitest'
import {
  lineageBlurb,
  storyBase,
  storyIdFromUrl,
  suggestedChartAlt,
  STORY_PUBLIC_NOTICE,
} from '../app/utils/loomHandoff'
import { friendlyAuthError } from '../app/utils/authErrors'
import {
  isAuthGatedPublicHost,
  normalizeServer,
  resolvePublicInstanceUrl,
  DEFAULT_PUBLIC_INSTANCE,
} from '../app/utils/instances'
import {
  buildInsightsReport,
  insightDaysToCsv,
  insightPostsToCsv,
  statusToInsightRow,
} from '../app/utils/insights'
import { buildInsightsExport } from '../app/utils/loomExport'

describe('loom handoff story URLs', () => {
  it('parses loom.ibm.io story ids', () => {
    expect(storyIdFromUrl('https://loom.ibm.io/s/abc12345')).toBe('abc12345')
    expect(storyIdFromUrl('https://loom.ibm.io/s/abc12345/')).toBe('abc12345')
    expect(storyBase('https://loom.ibm.io/s/abc12345')).toBe('https://loom.ibm.io/s/abc12345')
  })

  it('parses worker origin stories', () => {
    expect(storyIdFromUrl('https://loom-storyteller.mhsenkow.workers.dev/s/zz99yy88')).toBe(
      'zz99yy88',
    )
  })

  it('rejects non-story URLs', () => {
    expect(storyIdFromUrl('https://example.com/s/abc12345')).toBeNull()
    expect(storyIdFromUrl('https://loom.ibm.io/charts')).toBeNull()
    expect(storyBase('not-a-url')).toBeNull()
  })
})

describe('lineageBlurb + chart alt', () => {
  it('builds a lineage line from snapshot JSON', () => {
    const blurb = lineageBlurb({
      source: { label: 'sales.csv' },
      columns: [{}, {}, {}],
      totalRows: 1200,
      truncated: true,
      capturedAt: '2026-10-05T12:00:00Z',
    })
    expect(blurb).toContain('Data lineage')
    expect(blurb).toContain('sales.csv')
    expect(blurb).toContain('1,200 rows (sample)')
    expect(blurb).toContain('3 columns')
    expect(blurb).toContain('captured 2026-10-05')
  })

  it('suggests accessible alt from caption + lineage', () => {
    const alt = suggestedChartAlt({
      caption: 'Revenue by region\n\nhttps://loom.ibm.io/s/abc12345',
      lineage: 'Data lineage · Source: sales.csv · 100 rows',
    })
    expect(alt.startsWith('Chart: Revenue by region')).toBe(true)
    expect(alt).toContain('sales.csv')
    expect(alt).not.toContain('Data lineage ·')
  })

  it('exposes a public-story privacy notice', () => {
    expect(STORY_PUBLIC_NOTICE).toMatch(/public for 7 days/i)
    expect(STORY_PUBLIC_NOTICE).toMatch(/lineage/i)
  })
})

describe('OAuth callback errors', () => {
  it('maps access_denied', () => {
    expect(friendlyAuthError('access_denied')).toMatch(/cancelled/i)
  })

  it('maps expired / missing session', () => {
    expect(friendlyAuthError('No pending authorization')).toMatch(/expired/i)
    expect(friendlyAuthError('missing oauth credentials')).toMatch(/interrupted/i)
  })

  it('passes through short raw messages', () => {
    expect(friendlyAuthError('Server said nope')).toBe('Server said nope')
  })

  it('falls back for long opaque errors', () => {
    expect(friendlyAuthError('x'.repeat(200))).toMatch(/couldn’t finish signing you in/i)
  })
})

describe('instance helpers', () => {
  it('normalizes bare hosts and @user@host', () => {
    expect(normalizeServer('mastodon.social')).toBe('https://mastodon.social')
    expect(normalizeServer('@alice@fosstodon.org')).toBe('https://fosstodon.org')
    expect(normalizeServer('https://tech.lgbt/')).toBe('https://tech.lgbt')
    expect(normalizeServer('not a host')).toBeNull()
  })

  it('flags auth-gated public hosts', () => {
    expect(isAuthGatedPublicHost('https://mastodon.social')).toBe(true)
    expect(isAuthGatedPublicHost('fosstodon.org')).toBe(false)
  })

  it('falls back away from gated preferred hosts for guest browse', () => {
    expect(resolvePublicInstanceUrl('https://mastodon.social')).toBe(DEFAULT_PUBLIC_INSTANCE)
    expect(resolvePublicInstanceUrl('https://fosstodon.org')).toBe('https://fosstodon.org')
  })
})

describe('insights aggregation', () => {
  const now = new Date('2026-10-06T15:00:00Z')

  const statuses = [
    {
      id: '1',
      createdAt: '2026-10-05T14:00:00Z',
      favouritesCount: 10,
      reblogsCount: 2,
      repliesCount: 1,
      quotesCount: 0,
      visibility: 'public',
      language: 'en',
      content: '<p>Hello <a href="#">#cats</a></p>',
      tags: [{ name: 'cats' }],
      mediaAttachments: [{ id: 'm1' }],
    },
    {
      id: '2',
      createdAt: '2026-10-04T09:00:00Z',
      favouritesCount: 3,
      reblogsCount: 0,
      repliesCount: 4,
      content: '<p>Reply</p>',
      inReplyToId: '99',
      tags: [{ name: 'cats' }, { name: 'tech' }],
    },
    {
      id: '3',
      createdAt: '2026-09-01T12:00:00Z',
      favouritesCount: 100,
      content: '<p>Too old</p>',
    },
  ]

  it('maps status fields into insight rows', () => {
    const row = statusToInsightRow(statuses[0]!)
    expect(row.engagement).toBe(13)
    expect(row.has_media).toBe(1)
    expect(row.tags).toBe('cats')
    expect(row.kind).toBe('original')
  })

  it('windows statuses and builds daily series + top tags', () => {
    const report = buildInsightsReport({
      account: { acct: 'neo@example.com', followersCount: 12, statusesCount: 40 },
      statuses,
      windowDays: 30,
      now,
    })
    expect(report.totals.posts).toBe(2)
    expect(report.totals.engagement).toBe(13 + 7)
    expect(report.byDay).toHaveLength(30)
    expect(report.topTags[0]?.name).toBe('cats')
    expect(insightPostsToCsv(report.posts)).toContain('engagement')
    expect(insightDaysToCsv(report.byDay).split('\n').length).toBe(31)
  })

  it('builds Loom export files with preferred area chart', () => {
    const report = buildInsightsReport({
      account: { acct: 'neo@example.com' },
      statuses,
      windowDays: 7,
      now,
    })
    const pack = buildInsightsExport(report)
    expect(pack.files).toHaveLength(3)
    expect(pack.preferred.kind).toBe('area')
    expect(pack.preferred.xField).toBe('date')
    expect(pack.preferred.yField).toBe('engagement')
  })
})
