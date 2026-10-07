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
  tags: string
  preview: string
  url: string
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
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const stripTags = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
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
  const preview = stripTags(status.content || '').slice(0, 140)

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
    tags: tags.join(';'),
    preview,
    url: status.url || '',
  }
}

export function buildInsightsReport(opts: {
  account: InsightAccountLike
  statuses: InsightStatusLike[]
  windowDays: InsightsWindowDays
  truncated?: boolean
  now?: Date
}): InsightsReport {
  const now = opts.now || new Date()
  const cutoff = new Date(now.getTime() - opts.windowDays * 86_400_000)
  const rows = opts.statuses
    .map(statusToInsightRow)
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
  }
}

function escapeCsv(value: string | number): string {
  let s = String(value ?? '')
  if (/^[=+\-@]/.test(s)) s = `'${s}`
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

export function formatCompact(nVal: number): string {
  if (!Number.isFinite(nVal)) return '0'
  if (Math.abs(nVal) >= 10_000) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(nVal)
  }
  if (Number.isInteger(nVal)) return nVal.toLocaleString('en')
  return nVal.toFixed(1)
}
