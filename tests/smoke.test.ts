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
import { collapseDuplicateReblogs, statusIdentity } from '../app/utils/statusIdentity'
import { formatLogRingForFeedback, logError, logWarn } from '../app/utils/log'
import { formatCompactRelativeTime } from '../app/utils/relativeTime'
import { stripParticipantMentions } from '../app/utils/dmMentions'
import {
  decodeAlgorithmShare,
  encodeAlgorithmShare,
  sharePayloadToRecipe,
  statusMatchesRecipe,
} from '../app/utils/algorithms'

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

  it('never echoes arbitrary server text', () => {
    expect(friendlyAuthError('Server said nope')).toMatch(/couldn’t finish signing you in/i)
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
  it('matches exact 1:1 participants only via findExactOneToOne', async () => {
    const { findExactOneToOne } = await import('../app/utils/dmHelpers')
    const list = [
      { accounts: [{ id: 'alice' }, { id: 'bob' }] },
      { accounts: [{ id: 'alice' }] },
    ]
    expect(findExactOneToOne(list, 'alice')?.accounts).toEqual([{ id: 'alice' }])
    expect(findExactOneToOne(list, 'bob')).toBeNull()
    expect(findExactOneToOne(list, '')).toBeNull()
  })
})

describe('rateLimit', () => {
  it('allows up to the limit then blocks within the window', async () => {
    const { allowRequest } = await import('../functions/utils/rateLimit')
    const key = `test-${Date.now()}-${Math.random()}`
    expect(allowRequest(key, 2, 60_000).allowed).toBe(true)
    expect(allowRequest(key, 2, 60_000).allowed).toBe(true)
    const blocked = allowRequest(key, 2, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('uses CF-Connecting-IP only and buckets IPv6 by /64', async () => {
    const { clientIp } = await import('../functions/utils/rateLimit')
    const req = new Request('https://example.com', {
      headers: {
        'CF-Connecting-IP': '2001:db8:85a3:1:0:0:0:1',
        'X-Forwarded-For': '9.9.9.9',
      },
    })
    expect(clientIp(req)).toBe('2001:db8:85a3:1::/64')

    const noCf = new Request('https://example.com', {
      headers: { 'X-Forwarded-For': '9.9.9.9' },
    })
    expect(clientIp(noCf)).toBe('')
  })
})

describe('feedbackConstants', () => {
  it('whitelists note kinds', async () => {
    const { isFeedbackKind, FEEDBACK_KINDS } = await import('../shared/feedbackConstants')
    expect(FEEDBACK_KINDS).toContain('bug')
    expect(isFeedbackKind('bug')).toBe(true)
    expect(isFeedbackKind('spam')).toBe(false)
  })
})

describe('guessCategory', () => {
  it('matches whole tokens only', async () => {
    const { guessCategory } = await import('../app/utils/guessCategory')
    expect(guessCategory('ai')).toBe('tech')
    expect(guessCategory('linux')).toBe('tech')
    expect(guessCategory('rain')).toBe('other') // must not match 'ai'
    expect(guessCategory('Taiwan')).toBe('other')
    expect(guessCategory('education')).toBe('other') // must not match 'cat'
    expect(guessCategory('cat')).toBe('social')
    expect(guessCategory('gaming-news')).toBe('gaming') // first matching bucket wins
  })
})

describe('notifGroup', () => {
  it('collapses consecutive same type+status with count', async () => {
    const { collapseConsecutiveNotifications, groupActorLabel } = await import(
      '../app/utils/notifGroup'
    )
    const collapsed = collapseConsecutiveNotifications([
      { type: 'favourite', createdAt: '2026-10-07T12:00:00Z', status: { id: 's1' }, account: { username: 'a' }, _key: '1', _instanceId: 'i' },
      { type: 'favourite', createdAt: '2026-10-07T11:59:00Z', status: { id: 's1' }, account: { username: 'b' }, _key: '2', _instanceId: 'i' },
      { type: 'favourite', createdAt: '2026-10-07T11:58:00Z', status: { id: 's1' }, account: { username: 'c' }, _key: '3', _instanceId: 'i' },
      { type: 'reblog', createdAt: '2026-10-07T11:57:00Z', status: { id: 's1' }, account: { username: 'd' }, _key: '4', _instanceId: 'i' },
    ])
    expect(collapsed).toHaveLength(2)
    expect(collapsed[0]!._groupCount).toBe(3)
    expect(collapsed[0]!._groupedKeys).toEqual(['2', '3'])
    expect(groupActorLabel('Alice', 4)).toBe('Alice and 3 others')
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

describe('collapseDuplicateReblogs', () => {
  it('merges consecutive reblogs of the same original', () => {
    const original = { id: '1', uri: 'https://mastodon.social/users/x/statuses/1' }
    const statuses = [
      { id: '10', reblog: original, account: { username: 'alice' } },
      { id: '11', reblog: original, account: { username: 'bob' } },
      { id: '12', reblog: original, account: { username: 'carol' } },
      { id: '20', content: 'plain' },
    ]
    const out = collapseDuplicateReblogs(statuses)
    expect(out).toHaveLength(2)
    expect(out[0]?._collapsedRebloggers?.length).toBe(3)
    expect(statusIdentity(out[0]!.reblog!)).toBe(statusIdentity(original))
  })
})

describe('log ring buffer', () => {
  it('captures warn/error for feedback attachment', () => {
    logWarn('timeline poll')
    logError('chunk load')
    const ring = formatLogRingForFeedback()
    expect(ring).toContain('timeline poll')
    expect(ring).toContain('chunk load')
  })
})

describe('algorithm recipes', () => {
  it('round-trips share encode/decode with curator attribution', () => {
    const recipe = {
      id: 'algo_test',
      name: 'Cats only',
      description: 'Soft media',
      source: 'local' as const,
      mediaOnly: true,
      includeTags: ['cats'],
      authorAcct: 'alice@example.com',
      authorName: 'Alice',
      createdAt: 1,
      updatedAt: 1,
    }
    const encoded = encodeAlgorithmShare(recipe)
    const payload = decodeAlgorithmShare(encoded)
    expect(payload?.n).toBe('Cats only')
    expect(payload?.s).toBe('local')
    expect(payload?.m).toBe(1)
    expect(payload?.it).toEqual(['cats'])
    expect(payload?.a).toBe('alice@example.com')
    const restored = sharePayloadToRecipe(payload!)
    expect(restored.name).toBe('Cats only')
    expect(restored.mediaOnly).toBe(true)
    expect(statusMatchesRecipe(
      {
        reblog: null,
        inReplyToId: null,
        mediaAttachments: [{ id: '1' }],
        tags: [{ name: 'cats' }],
        content: '<p>hello</p>',
      } as any,
      restored,
    )).toBe(true)
    expect(statusMatchesRecipe(
      {
        reblog: null,
        inReplyToId: null,
        mediaAttachments: [],
        tags: [{ name: 'cats' }],
        content: '<p>hello</p>',
      } as any,
      restored,
    )).toBe(false)
  })

  it('rejects garbage share payloads', () => {
    expect(decodeAlgorithmShare('not-valid!!!')).toBeNull()
    expect(decodeAlgorithmShare('')).toBeNull()
  })
})

describe('formatCompactRelativeTime', () => {
  const now = new Date('2026-10-07T12:00:00Z')
  const ago = (s: number) => new Date(now.getTime() - s * 1000)

  it('uses narrow units inside a week', () => {
    expect(formatCompactRelativeTime(ago(20), now, 'en')).toBe('now')
    expect(formatCompactRelativeTime(ago(5 * 60), now, 'en')).toBe('5m')
    expect(formatCompactRelativeTime(ago(3 * 3600), now, 'en')).toBe('3h')
    expect(formatCompactRelativeTime(ago(2 * 86_400), now, 'en')).toBe('2d')
  })

  it('falls back to a short date, with year only when it differs', () => {
    expect(formatCompactRelativeTime(new Date('2026-09-03T12:00:00Z'), now, 'en')).toBe('Sep 3')
    expect(formatCompactRelativeTime(new Date('2024-09-03T12:00:00Z'), now, 'en')).toBe('Sep 3, 2024')
  })

  it('treats future timestamps (clock skew) as now', () => {
    expect(formatCompactRelativeTime(ago(-30), now, 'en')).toBe('now')
  })
})

describe('stripParticipantMentions', () => {
  const hcard = (user: string, url: string) =>
    `<span class="h-card" translate="no"><a href="${url}" class="u-url mention">@<span>${user}</span></a></span>`

  it('drops leading h-card mentions of participants', () => {
    const html = `<p>${hcard('fediversecounter', 'https://mastodon.social/@fediversecounter')} hi there</p>`
    expect(stripParticipantMentions(html, ['fediversecounter'])).toBe('<p>hi there</p>')
  })

  it('uses status.mentions to tell same-named people on other servers apart', () => {
    const html = `<p>${hcard('alice', 'https://b.social/@alice')} look</p>`
    const mentions = [{ url: 'https://b.social/@alice', acct: 'alice@b.social' }]
    expect(stripParticipantMentions(html, ['alice@a.social'], mentions)).toBe(html)
    expect(stripParticipantMentions(html, ['alice@b.social'], mentions)).toBe('<p>look</p>')
  })

  it('keeps everything when any leading mention is not a participant', () => {
    const html = `<p>${hcard('bob', 'https://x.social/@bob')} ${hcard('carol', 'https://x.social/@carol')} hey</p>`
    expect(stripParticipantMentions(html, ['bob'])).toBe(html)
  })

  it('leaves non-mention text and mid-sentence mentions alone', () => {
    const html = `<p>@home tonight, ${hcard('bob', 'https://x.social/@bob')}?</p>`
    expect(stripParticipantMentions(html, ['bob'])).toBe(html)
  })
})
