/**
 * Progressive-disclosure signal inspection for posts and accounts.
 * Snowflake decode, federation origin, density metrics — pure functions.
 */

import { decodeEntities } from '~/utils/decodeEntities'

export type InspectStatusLike = {
  id: string
  uri?: string | null
  url?: string | null
  createdAt: string
  content?: string | null
  spoilerText?: string | null
  sensitive?: boolean | null
  visibility?: string | null
  language?: string | null
  inReplyToId?: string | null
  reblog?: unknown
  favouritesCount?: number | null
  reblogsCount?: number | null
  repliesCount?: number | null
  application?: { name?: string | null; website?: string | null } | null
  account?: {
    acct?: string | null
    url?: string | null
    followersCount?: number | null
  } | null
  mediaAttachments?: {
    type?: string | null
    url?: string | null
    meta?: unknown
    blurhash?: string | null
  }[] | null
  tags?: { name?: string | null }[] | null
  mentions?: { acct?: string | null }[] | null
  card?: { url?: string | null } | null
}

export type InspectAccountLike = {
  id?: string
  acct?: string | null
  url?: string | null
  createdAt?: string | null
  note?: string | null
  followersCount?: number | null
  followingCount?: number | null
  statusesCount?: number | null
  emojis?: unknown[] | null
  fields?: { name?: string | null; value?: string | null; verifiedAt?: string | null }[] | null
  bot?: boolean | null
  locked?: boolean | null
}

export type StatusSignals = {
  localId: string
  uri: string | null
  url: string | null
  originHost: string | null
  browsingHint: string | null
  snowflakeMs: number | null
  snowflakeIso: string | null
  createdAtIso: string
  snowflakeDeltaMs: number | null
  application: string | null
  language: string | null
  visibility: string
  charCount: number
  wordCount: number
  readingMinutes: number
  linkCount: number
  tagCount: number
  mentionCount: number
  hasCard: boolean
  hasCw: boolean
  isReply: boolean
  isBoost: boolean
  media: { type: string; count: number }[]
  engagement: { favs: number; boosts: number; replies: number }
}

export type AccountSignals = {
  acct: string
  host: string | null
  accountAgeDays: number | null
  postsPerDay: number | null
  followerFollowingRatio: number | null
  verifiedFieldCount: number
  customEmojiCount: number
  bot: boolean
  locked: boolean
  observed: {
    sampleSize: number
    clients: { name: string; count: number }[]
    replyRatio: number
    boostRatio: number
    mediaRatio: number
    medianHoursBetweenPosts: number | null
  } | null
}

const stripHtml = (html: string) =>
  decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()

const hostOf = (value?: string | null): string | null => {
  if (!value) return null
  try {
    if (value.includes('://')) return new URL(value).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    /* fall through */
  }
  const acct = value.replace(/^@/, '')
  if (acct.includes('@')) return acct.split('@').pop()!.toLowerCase()
  return null
}

/**
 * Mastodon snowflake: `(timestamp_ms - TWITTER_EPOCH) << 16` roughly —
 * Mastodon uses its own epoch (2015-01-01) with 16 bits of sequence.
 * See mastodon/lib/mastodon/snowflake.rb
 */
const MASTODON_EPOCH_MS = Date.UTC(2015, 0, 1)

export function decodeMastodonSnowflake(id: string): number | null {
  if (!/^\d{5,}$/.test(id)) return null
  try {
    const n = BigInt(id)
    const ms = Number(n >> 16n) + MASTODON_EPOCH_MS
    if (!Number.isFinite(ms) || ms < MASTODON_EPOCH_MS || ms > Date.now() + 86_400_000) return null
    return ms
  } catch {
    return null
  }
}

const countWords = (text: string) => {
  const t = text.trim()
  if (!t) return 0
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'word' })
    let n = 0
    for (const p of seg.segment(t)) if (p.isWordLike) n++
    return n
  }
  return (t.match(/[\p{L}\p{N}]+/gu) || []).length
}

const countLinks = (html: string) => (html.match(/<a\b/gi) || []).length

export function inspectStatusSignals(
  status: InspectStatusLike,
  opts?: { browsingHost?: string | null },
): StatusSignals {
  const body = (status.reblog as InspectStatusLike | null | undefined) || status
  const text = stripHtml(body.content || '')
  const snowflakeMs = decodeMastodonSnowflake(status.id)
  const createdMs = Date.parse(status.createdAt)
  const mediaMap = new Map<string, number>()
  for (const m of body.mediaAttachments || []) {
    const t = (m.type || 'unknown').toLowerCase()
    mediaMap.set(t, (mediaMap.get(t) || 0) + 1)
  }
  const words = countWords(text)
  return {
    localId: status.id,
    uri: status.uri || null,
    url: status.url || null,
    originHost: hostOf(status.uri || status.url || body.account?.url || body.account?.acct),
    browsingHint: opts?.browsingHost || null,
    snowflakeMs,
    snowflakeIso: snowflakeMs != null ? new Date(snowflakeMs).toISOString() : null,
    createdAtIso: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : status.createdAt,
    snowflakeDeltaMs:
      snowflakeMs != null && Number.isFinite(createdMs) ? snowflakeMs - createdMs : null,
    application: body.application?.name || null,
    language: (body.language || '').split('-')[0]?.toLowerCase() || null,
    visibility: body.visibility || 'public',
    charCount: text.length,
    wordCount: words,
    readingMinutes: Math.max(0.1, words / 200),
    linkCount: countLinks(body.content || ''),
    tagCount: (body.tags || []).filter((t) => t?.name).length,
    mentionCount: (body.mentions || []).filter((m) => m?.acct).length,
    hasCard: !!body.card?.url,
    hasCw: !!(body.sensitive || body.spoilerText?.trim()),
    isReply: !!body.inReplyToId,
    isBoost: !!status.reblog,
    media: [...mediaMap.entries()].map(([type, count]) => ({ type, count })),
    engagement: {
      favs: Math.max(0, Number(body.favouritesCount) || 0),
      boosts: Math.max(0, Number(body.reblogsCount) || 0),
      replies: Math.max(0, Number(body.repliesCount) || 0),
    },
  }
}

const median = (nums: number[]) => {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function inspectAccountSignals(
  account: InspectAccountLike,
  statuses?: InspectStatusLike[],
): AccountSignals {
  const created = account.createdAt ? Date.parse(account.createdAt) : NaN
  const ageDays = Number.isFinite(created)
    ? Math.max(0, (Date.now() - created) / 86_400_000)
    : null
  const statusesCount = Math.max(0, Number(account.statusesCount) || 0)
  const followers = Math.max(0, Number(account.followersCount) || 0)
  const following = Math.max(0, Number(account.followingCount) || 0)
  const verifiedFieldCount = (account.fields || []).filter((f) => !!f.verifiedAt).length

  let observed: AccountSignals['observed'] = null
  if (statuses?.length) {
    const clients = new Map<string, number>()
    let replies = 0
    let boosts = 0
    let media = 0
    const times: number[] = []
    for (const s of statuses) {
      if (s.reblog) boosts += 1
      else if (s.inReplyToId) replies += 1
      if ((s.mediaAttachments?.length || 0) > 0) media += 1
      const app = s.application?.name?.trim()
      if (app) clients.set(app, (clients.get(app) || 0) + 1)
      const t = Date.parse(s.createdAt)
      if (Number.isFinite(t)) times.push(t)
    }
    times.sort((a, b) => a - b)
    const gaps: number[] = []
    for (let i = 1; i < times.length; i++) gaps.push((times[i]! - times[i - 1]!) / 3_600_000)
    const n = statuses.length
    observed = {
      sampleSize: n,
      clients: [...clients.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      replyRatio: replies / n,
      boostRatio: boosts / n,
      mediaRatio: media / n,
      medianHoursBetweenPosts: median(gaps),
    }
  }

  return {
    acct: account.acct || '',
    host: hostOf(account.acct || account.url),
    accountAgeDays: ageDays,
    postsPerDay: ageDays && ageDays > 0 ? statusesCount / ageDays : null,
    followerFollowingRatio: following > 0 ? followers / following : followers > 0 ? Infinity : null,
    verifiedFieldCount,
    customEmojiCount: account.emojis?.length || 0,
    bot: !!account.bot,
    locked: !!account.locked,
    observed,
  }
}

export function signalsToJsonSummary(
  kind: 'status' | 'account',
  data: StatusSignals | AccountSignals,
): string {
  return JSON.stringify({ kind, ...data }, null, 2)
}

export function formatSignalNumber(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n === Infinity) return '∞'
  if (Math.abs(n) >= 100) return n.toFixed(0)
  return n.toFixed(digits)
}
