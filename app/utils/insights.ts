/**
 * Pure Mastodon → insights aggregation (no Pinia / DOM).
 * Built from Account totals + Status engagement fields — no impressions/reach.
 */

export type InsightsWindowDays = 7 | 30 | 90

export type InsightStatusLike = {
  id: string
  createdAt: string
  favouritesCount?: number | null
  reblogsCount?: number | null
  repliesCount?: number | null
  quotesCount?: number | null
  visibility?: string | null
  language?: string | null
  inReplyToId?: string | null
  reblog?: unknown
  sensitive?: boolean | null
  spoilerText?: string | null
  url?: string | null
  content?: string | null
  mediaAttachments?: unknown[] | null
  poll?: unknown
  tags?: { name?: string | null }[] | null
}

export type InsightAccountLike = {
  acct?: string | null
  displayName?: string | null
  followersCount?: number | null
  followingCount?: number | null
  statusesCount?: number | null
  createdAt?: string | null
  lastStatusAt?: string | null
}

export type InsightPostRow = {
  id: string
  created_at: string
  date: string
  hour: number
  weekday: number
  weekday_name: string
  favourites: number
  reblogs: number
  replies: number
  quotes: number
  engagement: number
  visibility: string
  language: string
  kind: 'original' | 'reply' | 'boost'
  has_media: 0 | 1
  has_poll: 0 | 1
  has_cw: 0 | 1
  /** 1 when preview / body contains a question mark */
  has_question: 0 | 1
  /** Stripped body length (for length-bucket analytics) */
  char_count: number
  tags: string
  preview: string
  url: string
}

export type InsightLift = {
  key: string
  label: string
  withCount: number
  withoutCount: number
  withMean: number
  withoutMean: number
  /** withMean / withoutMean (1 = no difference); null when baseline is empty */
  lift: number | null
}

export type InsightLengthBucket = {
  key: 'short' | 'medium' | 'long'
  label: string
  count: number
  meanEngagement: number
}

export type InsightOutlier = {
  id: string
  preview: string
  engagement: number
  zScore: number
}

export type InsightsAnalytical = {
  lifts: InsightLift[]
  lengthBuckets: InsightLengthBucket[]
  bestHour: { hour: number; meanEngagement: number; posts: number } | null
  engagementMean: number
  engagementStdDev: number
  outliers: InsightOutlier[]
}

export type InsightDayRow = {
  date: string
  posts: number
  engagement: number
  favourites: number
  reblogs: number
  replies: number
}

export type InsightHeatCell = {
  weekday: number
  weekday_name: string
  hour: number
  posts: number
}

export type InsightsReport = {
  windowDays: InsightsWindowDays
  sampled: number
  truncated: boolean
  oldestSampledAt: string | null
  newestSampledAt: string | null
  account: {
    acct: string
    displayName: string
    followers: number
    following: number
    statuses: number
    createdAt: string | null
    lastStatusAt: string | null
  }
  totals: {
    posts: number
    originals: number
    replies: number
    boosts: number
    media: number
    polls: number
    cw: number
    favourites: number
    reblogs: number
    repliesRecv: number
    quotes: number
    engagement: number
    avgEngagement: number
  }
  byDay: InsightDayRow[]
  heatmap: InsightHeatCell[]
  mix: { kind: string; count: number }[]
  visibility: { name: string; count: number }[]
  topPosts: InsightPostRow[]
  topTags: { name: string; count: number; engagement: number }[]
  posts: InsightPostRow[]
  analytical: InsightsAnalytical
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Numeric (&#39; / &#x27;) and the common named entities Mastodon emits */
const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d{1,7});/g, (m, d: string) => codePointOr(Number(d), m))
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h: string) => codePointOr(parseInt(h, 16), m))
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // Last, so "&amp;lt;" decodes once to "&lt;" and not on to "<"
    .replace(/&amp;/g, '&')

const codePointOr = (cp: number, fallback: string) => {
  if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return fallback
  return String.fromCodePoint(cp)
}

const stripTags = (html: string) =>
  decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const dayKey = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function statusToInsightRow(status: InsightStatusLike): InsightPostRow {
  const created = new Date(status.createdAt)
  const favourites = n(status.favouritesCount)
  const reblogs = n(status.reblogsCount)
  const replies = n(status.repliesCount)
  const quotes = n(status.quotesCount)
  const isBoost = !!status.reblog
  const isReply = !isBoost && !!status.inReplyToId
  const kind: InsightPostRow['kind'] = isBoost ? 'boost' : isReply ? 'reply' : 'original'
  const tags = (status.tags || [])
    .map((t) => (t?.name || '').replace(/^#/, '').trim())
    .filter(Boolean)
  const body = stripTags(status.content || '')
  let preview = body.slice(0, 140)
  if (status.spoilerText?.trim()) preview = status.spoilerText.trim().slice(0, 140)
  else if (!preview.trim()) {
    if ((status.mediaAttachments?.length || 0) > 0) preview = 'Photo / video post'
    else if (status.poll) preview = 'Poll'
  }

  return {
    id: status.id,
    created_at: status.createdAt,
    date: Number.isFinite(created.getTime()) ? dayKey(created) : '',
    hour: Number.isFinite(created.getTime()) ? created.getHours() : 0,
    weekday: Number.isFinite(created.getTime()) ? created.getDay() : 0,
    weekday_name: WEEKDAYS[Number.isFinite(created.getTime()) ? created.getDay() : 0] || 'Sun',
    favourites,
    reblogs,
    replies,
    quotes,
    engagement: favourites + reblogs + replies + quotes,
    visibility: status.visibility || 'public',
    language: status.language || '',
    kind,
    has_media: (status.mediaAttachments?.length || 0) > 0 ? 1 : 0,
    has_poll: status.poll ? 1 : 0,
    has_cw: status.sensitive || !!(status.spoilerText && status.spoilerText.trim()) ? 1 : 0,
    has_question: /\?/.test(body) ? 1 : 0,
    char_count: body.length,
    tags: tags.join(';'),
    preview,
    url: status.url || '',
  }
}

const meanOf = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0)

const stdDevOf = (vals: number[], mean: number) => {
  if (vals.length < 2) return 0
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
  return Math.sqrt(variance)
}

const liftFor = (
  rows: InsightPostRow[],
  key: string,
  label: string,
  predicate: (r: InsightPostRow) => boolean,
): InsightLift => {
  const withRows = rows.filter(predicate)
  const withoutRows = rows.filter((r) => !predicate(r))
  const withMean = meanOf(withRows.map((r) => r.engagement))
  const withoutMean = meanOf(withoutRows.map((r) => r.engagement))
  return {
    key,
    label,
    withCount: withRows.length,
    withoutCount: withoutRows.length,
    withMean,
    withoutMean,
    lift: withoutRows.length && withoutMean > 0 ? withMean / withoutMean : withRows.length ? null : null,
  }
}

/** Correlations, length buckets, best hour by rate, and z-score outliers */
export function buildInsightsAnalytical(countable: InsightPostRow[]): InsightsAnalytical {
  const originals = countable.filter((r) => r.kind === 'original')
  const sample = originals.length ? originals : countable

  const lifts = [
    liftFor(sample, 'media', 'With media', (r) => r.has_media === 1),
    liftFor(sample, 'tags', 'With hashtags', (r) => !!r.tags.trim()),
    liftFor(sample, 'question', 'Asks a question', (r) => r.has_question === 1),
    liftFor(sample, 'cw', 'Content warning', (r) => r.has_cw === 1),
    liftFor(countable, 'reply', 'Replies vs originals', (r) => r.kind === 'reply'),
  ].filter((l) => l.withCount > 0 && l.withoutCount > 0)

  const bucketsDef: { key: InsightLengthBucket['key']; label: string; test: (n: number) => boolean }[] = [
    { key: 'short', label: 'Short (<80)', test: (n) => n < 80 },
    { key: 'medium', label: 'Medium (80–240)', test: (n) => n >= 80 && n <= 240 },
    { key: 'long', label: 'Long (>240)', test: (n) => n > 240 },
  ]
  const lengthBuckets = bucketsDef
    .map((b) => {
      const rows = sample.filter((r) => b.test(r.char_count))
      return {
        key: b.key,
        label: b.label,
        count: rows.length,
        meanEngagement: meanOf(rows.map((r) => r.engagement)),
      }
    })
    .filter((b) => b.count > 0)

  const byHour = new Map<number, number[]>()
  for (const r of sample) {
    const list = byHour.get(r.hour) || []
    list.push(r.engagement)
    byHour.set(r.hour, list)
  }
  let bestHour: InsightsAnalytical['bestHour'] = null
  for (const [hour, vals] of byHour) {
    if (vals.length < 2) continue
    const meanEngagement = meanOf(vals)
    if (!bestHour || meanEngagement > bestHour.meanEngagement) {
      bestHour = { hour, meanEngagement, posts: vals.length }
    }
  }

  const engagements = sample.map((r) => r.engagement)
  const engagementMean = meanOf(engagements)
  const engagementStdDev = stdDevOf(engagements, engagementMean)
  const outliers: InsightOutlier[] =
    engagementStdDev > 0
      ? sample
          .map((r) => ({
            id: r.id,
            preview: r.preview,
            engagement: r.engagement,
            zScore: (r.engagement - engagementMean) / engagementStdDev,
          }))
          .filter((o) => o.zScore >= 1.5)
          .sort((a, b) => b.zScore - a.zScore)
          .slice(0, 8)
      : []

  return {
    lifts,
    lengthBuckets,
    bestHour,
    engagementMean,
    engagementStdDev,
    outliers,
  }
}

export function buildInsightsReport(opts: {
  account: InsightAccountLike
  statuses: InsightStatusLike[]
  windowDays: InsightsWindowDays
  truncated?: boolean
  now?: Date
  /**
   * Count followers-only posts (the owner's own on-screen charts). Default false — exports and
   * anything leaving the app must never carry them. Direct messages are always excluded.
   */
  includePrivate?: boolean
}): InsightsReport {
  const now = opts.now || new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const cutoff = new Date(startToday)
  cutoff.setDate(cutoff.getDate() - (opts.windowDays - 1))
  const rows = opts.statuses
    .map(statusToInsightRow)
    .filter((r) => r.visibility !== 'direct' && (opts.includePrivate || r.visibility !== 'private'))
    .filter((r) => {
      const t = Date.parse(r.created_at)
      return Number.isFinite(t) && t >= cutoff.getTime() && t <= now.getTime()
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

  const originals = rows.filter((r) => r.kind === 'original')
  const replies = rows.filter((r) => r.kind === 'reply')
  const boosts = rows.filter((r) => r.kind === 'boost')
  const countable = rows.filter((r) => r.kind !== 'boost')

  const favourites = countable.reduce((s, r) => s + r.favourites, 0)
  const reblogsRecv = countable.reduce((s, r) => s + r.reblogs, 0)
  const repliesRecv = countable.reduce((s, r) => s + r.replies, 0)
  const quotes = countable.reduce((s, r) => s + r.quotes, 0)
  const engagement = favourites + reblogsRecv + repliesRecv + quotes

  const dayMap = new Map<string, InsightDayRow>()
  for (let i = opts.windowDays - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = dayKey(d)
    dayMap.set(key, {
      date: key,
      posts: 0,
      engagement: 0,
      favourites: 0,
      reblogs: 0,
      replies: 0,
    })
  }
  for (const r of countable) {
    const bucket = dayMap.get(r.date)
    if (!bucket) continue
    bucket.posts += 1
    bucket.engagement += r.engagement
    bucket.favourites += r.favourites
    bucket.reblogs += r.reblogs
    bucket.replies += r.replies
  }

  const heatMap = new Map<string, InsightHeatCell>()
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      heatMap.set(`${w}-${h}`, {
        weekday: w,
        weekday_name: WEEKDAYS[w]!,
        hour: h,
        posts: 0,
      })
    }
  }
  for (const r of countable) {
    const cell = heatMap.get(`${r.weekday}-${r.hour}`)
    if (cell) cell.posts += 1
  }

  const visMap = new Map<string, number>()
  for (const r of countable) {
    visMap.set(r.visibility, (visMap.get(r.visibility) || 0) + 1)
  }

  const tagMap = new Map<string, { count: number; engagement: number }>()
  for (const r of countable) {
    if (!r.tags) continue
    for (const raw of r.tags.split(';')) {
      const name = raw.trim().toLowerCase()
      if (!name) continue
      const prev = tagMap.get(name) || { count: 0, engagement: 0 }
      prev.count += 1
      prev.engagement += r.engagement
      tagMap.set(name, prev)
    }
  }

  const times = rows.map((r) => Date.parse(r.created_at)).filter(Number.isFinite)

  return {
    windowDays: opts.windowDays,
    sampled: rows.length,
    truncated: !!opts.truncated,
    oldestSampledAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    newestSampledAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    account: {
      acct: opts.account.acct || '',
      displayName: opts.account.displayName || opts.account.acct || '',
      followers: n(opts.account.followersCount),
      following: n(opts.account.followingCount),
      statuses: n(opts.account.statusesCount),
      createdAt: opts.account.createdAt || null,
      lastStatusAt: opts.account.lastStatusAt || null,
    },
    totals: {
      posts: countable.length,
      originals: originals.length,
      replies: replies.length,
      boosts: boosts.length,
      media: countable.filter((r) => r.has_media).length,
      polls: countable.filter((r) => r.has_poll).length,
      cw: countable.filter((r) => r.has_cw).length,
      favourites,
      reblogs: reblogsRecv,
      repliesRecv,
      quotes,
      engagement,
      avgEngagement: countable.length ? engagement / countable.length : 0,
    },
    byDay: [...dayMap.values()],
    heatmap: [...heatMap.values()],
    mix: [
      { kind: 'original', count: originals.length },
      { kind: 'reply', count: replies.length },
      { kind: 'boost', count: boosts.length },
      { kind: 'media', count: countable.filter((r) => r.has_media).length },
      { kind: 'poll', count: countable.filter((r) => r.has_poll).length },
      { kind: 'cw', count: countable.filter((r) => r.has_cw).length },
    ].filter((m) => m.count > 0),
    visibility: [...visMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    topPosts: [...countable].sort((a, b) => b.engagement - a.engagement).slice(0, 8),
    topTags: [...tagMap.entries()]
      .map(([name, v]) => ({ name, count: v.count, engagement: v.engagement }))
      .sort((a, b) => b.engagement - a.engagement || b.count - a.count)
      .slice(0, 12),
    posts: countable,
    analytical: buildInsightsAnalytical(countable),
  }
}

/**
 * CSV cell escape. Text cells starting with = + - @ (or tab / CR, which some
 * spreadsheet apps strip before evaluating) are prefixed with ' so Excel /
 * Sheets / LibreOffice treat them as text, not formulas (CSV injection).
 */
export function escapeCsv(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let s = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function insightPostsToCsv(rows: InsightPostRow[]): string {
  const cols: (keyof InsightPostRow)[] = [
    'id',
    'created_at',
    'date',
    'hour',
    'weekday',
    'weekday_name',
    'favourites',
    'reblogs',
    'replies',
    'quotes',
    'engagement',
    'visibility',
    'language',
    'kind',
    'has_media',
    'has_poll',
    'has_cw',
    'has_question',
    'char_count',
    'tags',
    'preview',
    'url',
  ]
  const header = cols.join(',')
  const body = rows.map((r) => cols.map((c) => escapeCsv(r[c] as string | number)).join(',')).join('\n')
  return `\uFEFF${header}\n${body}`
}

export function insightDaysToCsv(rows: InsightDayRow[]): string {
  const cols: (keyof InsightDayRow)[] = [
    'date',
    'posts',
    'engagement',
    'favourites',
    'reblogs',
    'replies',
  ]
  const header = cols.join(',')
  const body = rows.map((r) => cols.map((c) => escapeCsv(r[c])).join(',')).join('\n')
  return `\uFEFF${header}\n${body}`
}

export function insightHeatmapToCsv(rows: InsightHeatCell[]): string {
  const header = 'weekday,weekday_name,hour,posts'
  const body = rows
    .map((r) =>
      [r.weekday, escapeCsv(r.weekday_name), r.hour, r.posts].join(','),
    )
    .join('\n')
  return `\uFEFF${header}\n${body}`
}

/**
 * Format a Mastodon calendar date ("2024-05-02", e.g. last_status_at) in local
 * time. `new Date('2024-05-02')` is UTC midnight, which shows as the previous
 * day anywhere west of Greenwich. Full timestamps are formatted as-is.
 */
export function formatDateOnly(
  value: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, opts)
}

export function formatCompact(nVal: number): string {
  if (!Number.isFinite(nVal)) return '0'
  if (Math.abs(nVal) >= 10_000) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(nVal)
  }
  if (Number.isInteger(nVal)) return nVal.toLocaleString('en')
  return nVal.toFixed(1)
}

/** Integer slots that sum to `totalSlots` (largest-remainder / Hamilton method). */
export function largestRemainderSlots(counts: number[], totalSlots: number): number[] {
  if (totalSlots <= 0 || !counts.length) return counts.map(() => 0)
  const sum = counts.reduce((a, b) => a + b, 0) || 1
  const raw = counts.map((c) => (c / sum) * totalSlots)
  const slots = raw.map((r) => Math.floor(r))
  let remainder = totalSlots - slots.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - slots[i]! }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; k < remainder; k++) slots[order[k % order.length]!.i]! += 1
  return slots
}

export function formatInsightHour(hour: number): string {
  const h = Math.max(0, Math.min(23, Math.floor(hour)))
  return `${h}:00`
}

/**
 * Whether a capped fetch actually leaves the *requested* window incomplete: if the pages we got
 * already reach back past the window's start, a 7d or 30d view isn't "capped" just because the
 * 90d backfill was.
 */
export function windowTruncated(
  truncated: boolean,
  oldestLoadedMs: number | null,
  windowDays: number,
  now: number = Date.now(),
): boolean {
  if (!truncated) return false
  if (oldestLoadedMs === null || !Number.isFinite(oldestLoadedMs)) return true
  return oldestLoadedMs > now - windowDays * 86_400_000
}
