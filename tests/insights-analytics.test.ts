import { describe, expect, it } from 'vitest'
import {
  buildInsightsAnalytical,
  buildInsightsReport,
  statusToInsightRow,
  type InsightPostRow,
} from '../app/utils/insights'

const row = (partial: Partial<InsightPostRow> & { id: string }): InsightPostRow => ({
  created_at: '2026-01-01T12:00:00Z',
  date: '2026-01-01',
  hour: 12,
  weekday: 4,
  weekday_name: 'Thu',
  favourites: 0,
  reblogs: 0,
  replies: 0,
  quotes: 0,
  engagement: 0,
  visibility: 'public',
  language: 'en',
  kind: 'original',
  has_media: 0,
  has_poll: 0,
  has_cw: 0,
  has_question: 0,
  char_count: 40,
  tags: '',
  preview: 'hello',
  url: '',
  ...partial,
})

describe('buildInsightsAnalytical', () => {
  it('computes media lift, length buckets, and z-score outliers', () => {
    const posts = [
      row({ id: '1', engagement: 2, has_media: 0, char_count: 40 }),
      row({ id: '2', engagement: 2, has_media: 0, char_count: 40 }),
      row({ id: '3', engagement: 10, has_media: 1, char_count: 120, tags: 'cats', has_question: 1 }),
      row({ id: '4', engagement: 12, has_media: 1, char_count: 120 }),
      row({ id: '5', engagement: 40, has_media: 1, char_count: 300, preview: 'breakout' }),
      row({ id: '6', engagement: 3, has_media: 0, char_count: 40, hour: 9 }),
      row({ id: '7', engagement: 4, has_media: 0, char_count: 40, hour: 9 }),
      row({ id: '8', engagement: 20, has_media: 1, char_count: 100, hour: 18 }),
      row({ id: '9', engagement: 22, has_media: 1, char_count: 100, hour: 18 }),
    ]
    const analytical = buildInsightsAnalytical(posts)
    const media = analytical.lifts.find((l) => l.key === 'media')
    expect(media).toBeTruthy()
    expect(media!.lift!).toBeGreaterThan(1)

    expect(analytical.lengthBuckets.some((b) => b.key === 'short')).toBe(true)
    expect(analytical.lengthBuckets.some((b) => b.key === 'long')).toBe(true)
    expect(analytical.bestHour?.hour).toBe(18)
    expect(analytical.engagementStdDev).toBeGreaterThan(0)
    expect(analytical.outliers.length).toBeGreaterThan(0)
    expect(analytical.outliers[0]!.id).toBe('5')
    expect(analytical.outliers[0]!.zScore).toBeGreaterThanOrEqual(1.5)
  })
})

describe('statusToInsightRow analytical fields', () => {
  it('records questions and character counts', () => {
    const mapped = statusToInsightRow({
      id: '1',
      createdAt: '2026-01-01T12:00:00Z',
      content: '<p>Is this working?</p>',
      favouritesCount: 1,
      mediaAttachments: [{ id: 'm' }],
      tags: [{ name: 'test' }],
    })
    expect(mapped.has_question).toBe(1)
    expect(mapped.char_count).toBeGreaterThan(5)
    expect(mapped.has_media).toBe(1)
  })
})

describe('buildInsightsReport analytical section', () => {
  it('includes analytical on the report', () => {
    const now = new Date('2026-01-05T12:00:00Z')
    const report = buildInsightsReport({
      account: { acct: 'me', followersCount: 10, statusesCount: 3 },
      statuses: [
        {
          id: '1',
          createdAt: '2026-01-04T12:00:00Z',
          content: '<p>plain</p>',
          favouritesCount: 1,
          visibility: 'public',
        },
        {
          id: '2',
          createdAt: '2026-01-04T18:00:00Z',
          content: '<p>photo?</p>',
          favouritesCount: 8,
          mediaAttachments: [{}],
          visibility: 'public',
        },
      ],
      windowDays: 7,
      now,
    })
    expect(report.analytical).toBeTruthy()
    expect(report.analytical.lifts.length).toBeGreaterThan(0)
    expect(report.posts[0]!.char_count).toBeGreaterThanOrEqual(0)
  })
})

describe('mediaLoupe helpers', () => {
  it('simplifies aspects and decodes blurhash palette', async () => {
    const {
      simplifyAspectRatio,
      formatMegapixels,
      blurhashPalette,
      focusToCssPercent,
      mediaAttachmentLoupeMeta,
    } = await import('../app/utils/mediaLoupe')
    expect(simplifyAspectRatio(1920, 1080)).toBe('16:9')
    expect(formatMegapixels(2000, 2000)).toContain('MP')
    expect(focusToCssPercent({ x: 0, y: 0 })).toEqual({ left: '50.00%', top: '50.00%' })
    const meta = mediaAttachmentLoupeMeta({
      id: 'm1',
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      meta: { original: { width: 800, height: 600 }, focus: { x: -0.5, y: 0.25 } },
    })
    expect(meta.width).toBe(800)
    expect(meta.focus?.x).toBe(-0.5)
    expect(blurhashPalette(meta.blurhash!, 5).length).toBe(5)
  })
})
