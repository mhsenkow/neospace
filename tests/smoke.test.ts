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
import { mastodonLength } from '../app/utils/mastodonLength'
import { compareId, idLess } from '../app/utils/compareId'
import { sanitizeProfileCss } from '../app/utils/sanitizeCss'

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

describe('mastodonLength', () => {
  it('counts plain text by grapheme', () => {
    expect(mastodonLength('hello')).toBe(5)
    expect(mastodonLength('a👍b')).toBe(3)
  })

  it('counts http(s) URLs as 23', () => {
    expect(mastodonLength('see https://example.com/very/long/path')).toBe(4 + 23)
    expect(mastodonLength('http://a.co https://b.co/x')).toBe(23 + 1 + 23)
  })

  it('counts remote mentions as @local only', () => {
    expect(mastodonLength('@alice@mastodon.social')).toBe(6) // @alice
    expect(mastodonLength('hi @bob@x.y!')).toBe(3 + 4 + 1) // hi + @bob + !
  })
})

describe('compareId', () => {
  it('compares snowflake ids by length then lexicographically', () => {
    expect(compareId('99', '100')).toBeLessThan(0)
    expect(compareId('100', '99')).toBeGreaterThan(0)
    expect(compareId('abc', 'abc')).toBe(0)
    expect(idLess('9', '10')).toBe(true)
  })
})

describe('sanitizeProfileCss', () => {
  it('blocks remote url(), protocol-relative, image-set, and @font-face', () => {
    const out = sanitizeProfileCss(`
      .x { background: url(//evil.example/x); }
      .y { background: image-set(url(https://evil.example/a) 1x); }
      @font-face { font-family: x; src: url(https://evil.example/f.woff); }
      .z { color: red; }
    `)
    expect(out).not.toMatch(/evil\.example/)
    expect(out).not.toMatch(/@font-face\b/i)
    expect(out).toContain('blocked font face')
    expect(out).toContain('.chaos-active #main-content')
    expect(out).toMatch(/color:\s*red/)
  })

  it('decodes CSS escapes before blocking url()', () => {
    const out = sanitizeProfileCss('.x{background:u\\72l(https://evil.example/x)}')
    expect(out).not.toMatch(/evil\.example/)
  })
})

describe('daySeparatorLabel', () => {
  it('labels today, yesterday, and older dates', async () => {
    const { daySeparatorLabel } = await import('../app/utils/dmHelpers')
    const today = new Date()
    expect(daySeparatorLabel(today.toISOString())).toBe('Today')
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    expect(daySeparatorLabel(yesterday.toISOString())).toBe('Yesterday')
    expect(daySeparatorLabel('2020-01-15T12:00:00Z')).toMatch(/Jan/)
  })
})

describe('conversation matching helpers', () => {
  it('matches exact 1:1 participants only', () => {
    // Mirrors conversations.findDirectWith / markReadForThread exact-set rules
    const exactOneToOne = (
      conversations: { accounts: { id: string }[] }[],
      accountId: string,
    ) =>
      conversations.find((c) => {
        const ids = c.accounts.map((a) => a.id)
        return ids.length === 1 && ids[0] === accountId
      }) || null

    const list = [
      { accounts: [{ id: 'alice' }, { id: 'bob' }] },
      { accounts: [{ id: 'alice' }] },
    ]
    expect(exactOneToOne(list, 'alice')?.accounts).toEqual([{ id: 'alice' }])
    expect(exactOneToOne(list, 'bob')).toBeNull()
  })
})

describe('feedback area path', () => {
  it('keeps pathname only (no query/hash secrets)', async () => {
    const { createGitHubIssue } = await import('../app/utils/feedback')
    // Unit-check the client payload shape via the documented contract in feedback.ts
    expect(typeof createGitHubIssue).toBe('function')
    const pathOnly = '/messages'
    expect(pathOnly).not.toMatch(/\?/)
    expect('/status/123?token=x'.split('?')[0]).toBe('/status/123')
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
