/**
 * Map Mastodon statuses → Edward Mode ball descriptors (color, size, badges, mood).
 * Pure — no Pinia / DOM.
 */

import { stripHtml } from '~/utils/stripHtml'
import { statusIdentity } from '~/utils/statusIdentity'
import { faceMoodFor, faceSpecFor, type EdwardFaceMood } from '~/utils/edwardFaces'
import {
  affinityDetail,
  type EdwardAffinityContext,
} from '~/utils/edwardAffinity'

export type EdwardKind = 'original' | 'reply' | 'boost'

export type EdwardBadge = 'media' | 'poll' | 'cw' | 'link' | 'bot'

/** Which of your feeds brought the post in */
export type EdwardSource = 'firehose' | 'home' | 'tag' | 'trend'

/** One line of "why is this here / what is it" — shown as chips */
export type EdwardReason = {
  glyph: string
  text: string
  /** you = personal link, source = which feed, nuance = what the post is like */
  kind: 'you' | 'source' | 'nuance'
}

export const EDWARD_SOURCE_GLYPH: Record<EdwardSource, string> = {
  firehose: '≋',
  home: '⌂',
  tag: '#',
  trend: '↑',
}

export type EdwardBallDescriptor = {
  identity: string
  statusId: string
  kind: EdwardKind
  /** RGB 0–1 */
  color: [number, number, number]
  /** Core radius in scene units */
  size: number
  opacity: number
  badges: EdwardBadge[]
  mood: EdwardFaceMood
  moodWhy: string
  /** Hover / HUD label */
  label: string
  preview: string
  authorKey: string
  acct: string
  inReplyToId: string | null
  mediaUrl: string | null
  engagement: number
  /** Per-kind engagement for previews (♥ / ↻ / ↩) */
  counts?: { fav: number; boost: number; reply: number }
  createdAt: number
  topTag: string | null
  hasCard: boolean
  isBot: boolean
  instanceHost: string | null
  /** 0–1 how much this relates to you — drives size / proximity */
  affinity: number
  /** Feed it came from (home / followed tag / trending / firehose) */
  source: EdwardSource
  /** Followed tag whose timeline brought it in */
  sourceTag: string | null
  /** Post language (primary subtag) when the server knows it */
  language: string | null
  /** 🧵 / "1/" style thread opener */
  isThread: boolean
  /** Rough reading time in minutes (0 for short posts) */
  readMinutes: number
  /** Why it's here + what it's like, most personal first (≤ 4) */
  reasons: EdwardReason[]
  /** Short enough for a thought-bubble overlay */
  isShort: boolean
  shortText: string | null
  /**
   * Explore sort rank — -1 = stream order (no boost),
   * 0 = top of current sort, higher = further down.
   */
  exploreRank: number
  /** 1 = top of sort, 0 = bottom — drives spatial pull */
  exploreRankNorm: number
}

/** Semantic palette — candy fills still come from face specs; this is fallback RGB */
const KIND_COLOR: Record<EdwardKind, [number, number, number]> = {
  original: [0.35, 0.82, 0.88],
  reply: [0.95, 0.68, 0.32],
  boost: [0.62, 0.48, 0.92],
}

const n = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0

export type EdwardStatusLike = {
  id: string
  uri?: string | null
  url?: string | null
  createdAt: string
  content?: string | null
  spoilerText?: string | null
  sensitive?: boolean | null
  favouritesCount?: number | null
  reblogsCount?: number | null
  repliesCount?: number | null
  inReplyToId?: string | null
  reblog?: EdwardStatusLike | null
  poll?: unknown
  card?: { url?: string | null; title?: string | null } | null
  mediaAttachments?: { previewUrl?: string | null; url?: string | null }[] | null
  mentions?: { acct?: string | null; username?: string | null }[] | null
  tags?: { name?: string | null }[] | null
  account?: {
    acct?: string | null
    displayName?: string | null
    username?: string | null
    bot?: boolean | null
  } | null
  language?: string | null
  _instanceUrl?: string | null
  /** Set by the Edward stream: which feed fetched it */
  _edSource?: EdwardSource | null
  _edTag?: string | null
}

function resolveBody(status: EdwardStatusLike): EdwardStatusLike {
  return status.reblog || status
}

export function statusKind(status: EdwardStatusLike): EdwardKind {
  if (status.reblog) return 'boost'
  if (status.inReplyToId) return 'reply'
  return 'original'
}

function hostOf(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/**
 * Handle to look an author up by on *your* server. `account.acct` is relative
 * to the server that served the post: a local `bob` on the source server is a
 * different person from `bob` on yours, so a bare lookup there would follow /
 * mute / block the wrong account. Qualify with the profile's host (else the
 * source server's) unless the post came from your own server.
 */
export function lookupAcctFor(
  acct: string | null | undefined,
  accountUrl: string | null | undefined,
  sourceUrl: string | null | undefined,
  activeUrl: string | null | undefined,
): string {
  const a = (acct || '').replace(/^@/, '').trim()
  if (!a || a.includes('@')) return a
  const sourceHost = hostOf(sourceUrl)?.toLowerCase() || null
  const activeHost = hostOf(activeUrl)?.toLowerCase() || null
  if (sourceHost && sourceHost === activeHost) return a
  const host = hostOf(accountUrl)?.toLowerCase() || sourceHost
  return host ? `${a}@${host}` : a
}

/**
 * Bot faces track Mastodon's `account.bot` flag, plus obvious self-marks
 * in handle / display name (e.g. `_bot`, `[bot]`). Unmarked stealth bots
 * will still slip through — that's a fediverse limit, not a face bug.
 */
export function accountLooksBot(
  account?: {
    acct?: string | null
    displayName?: string | null
    username?: string | null
    bot?: boolean | null
  } | null,
): boolean {
  if (!account) return false
  if (account.bot) return true

  const handle = (account.acct || account.username || '')
    .toLowerCase()
    .replace(/^@/, '')
    .split('@')[0] || ''
  const name = (account.displayName || '').toLowerCase()

  if (/\[bot\]|\(bot\)|｛bot｝|🤖/.test(name)) return true
  if (/(^|[\s._-])bot([\s._-]|$)/.test(name)) return true
  if (/(^|_)bot(_|$)/.test(handle)) return true
  if (/_bot$|^bot_|-bot$|^bot-/.test(handle)) return true

  return false
}

export function statusToEdwardBall(
  status: EdwardStatusLike,
  affinityCtx?: EdwardAffinityContext | null,
): EdwardBallDescriptor {
  const body = resolveBody(status)
  const kind = statusKind(status)
  const favourites = n(body.favouritesCount)
  const reblogs = n(body.reblogsCount)
  const replies = n(body.repliesCount)
  const engagement = favourites + reblogs + replies
  const isBot = accountLooksBot(body.account)

  const badges: EdwardBadge[] = []
  if ((body.mediaAttachments?.length || 0) > 0) badges.push('media')
  if (body.poll) badges.push('poll')
  if (body.sensitive || (body.spoilerText && body.spoilerText.trim())) badges.push('cw')
  if (body.card?.url) badges.push('link')
  if (isBot) badges.push('bot')

  const fullText = stripHtml(body.content || '')
  const preview = fullText.slice(0, 160)
  // Include spoiler text in spicy/mood sniff so CW'd spicy still maps
  const moodText = `${body.spoilerText || ''} ${preview}`.trim()
  // Plain-text contexts (canvas chip, deck) can't show custom emoji — drop the
  // :shortcodes: rather than printing ":v_enby: :v_trans:" as the name
  const displayName =
    (body.account?.displayName || '').replace(/:[a-zA-Z0-9_]+:/g, '').replace(/\s+/g, ' ').trim() ||
    body.account?.username ||
    body.account?.acct ||
    'someone'
  const label = displayName.slice(0, 48)
  const acct = (body.account?.acct || '').replace(/^@/, '')

  const media = body.mediaAttachments?.[0]
  const mediaUrl = media?.previewUrl || media?.url || null
  const tagNames = (body.tags || [])
    .map((t) => (t?.name || '').replace(/^#/, '').trim())
    .filter(Boolean)
  const topTag = tagNames[0] || null
  const mentionAccts = (body.mentions || [])
    .map((m) => m?.acct || m?.username || '')
    .filter(Boolean)

  const aff = affinityDetail(
    {
      authorAcct: acct,
      mentionAccts,
      tagNames,
      preview: moodText,
      isBoost: kind === 'boost',
    },
    affinityCtx,
  )
  const affinity = aff.score

  // Engagement + personal affinity → size
  const size = Math.min(
    1.55,
    0.22 + Math.log1p(engagement) * 0.1 + affinity * 0.55,
  )

  let opacity = kind === 'boost' ? 0.78 : 0.95
  if (badges.includes('cw') && !['eggplant', 'peach', 'kitty', 'booby'].includes(
    faceMoodFor({
      kind,
      badges,
      engagement,
      text: moodText,
      hasCard: !!body.card?.url,
      isBot,
    }),
  )) {
    opacity *= 0.6
  }

  const signals = {
    kind,
    badges,
    engagement,
    text: moodText,
    hasCard: !!body.card?.url,
    isBot,
    mentionCount: mentionAccts.length,
    tagCount: tagNames.length,
  }
  const spec = faceSpecFor(signals)
  const mood = faceMoodFor(signals)

  const hex = spec.fill.replace('#', '')
  const color: [number, number, number] = [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ]

  const created = Date.parse(status.createdAt)
  const authorKey = (body.account?.acct || body.account?.username || status.id).toLowerCase()

  const source: EdwardSource = status._edSource || 'firehose'
  const sourceTag = status._edTag || null
  const language = (body.language || '').split('-')[0]!.toLowerCase() || null
  const words = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0
  const readMinutes = words > 90 ? Math.max(1, Math.round(words / 200)) : 0
  const isThread = /^\s*(🧵|\(?1\s*\/\s*\d*\)?[\s:.)])/u.test(fullText) || /🧵\s*$/u.test(fullText.trim())
  const reasons = reasonsFor({
    aff,
    acct,
    source,
    sourceTag,
    instanceHost: hostOf(status._instanceUrl) || hostOf(body.url || body.uri),
    counts: { fav: favourites, boost: reblogs, reply: replies },
    kind,
    isBot,
    mood: faceMoodFor(signals),
    language,
    viewerLang: affinityCtx?.viewerLang ?? null,
    readMinutes,
    isThread,
    createdAt: Number.isFinite(created) ? created : Date.now(),
  })

  return {
    identity: statusIdentity(status) || status.id,
    statusId: status.id,
    kind,
    color: Number.isFinite(color[0]) ? color : KIND_COLOR[kind],
    size,
    opacity,
    badges,
    mood,
    moodWhy: affinity > 0.35 ? `${spec.why} · you` : spec.why,
    label,
    preview,
    authorKey,
    acct,
    inReplyToId: status.inReplyToId || body.inReplyToId || null,
    mediaUrl,
    engagement,
    counts: { fav: favourites, boost: reblogs, reply: replies },
    createdAt: Number.isFinite(created) ? created : Date.now(),
    topTag,
    hasCard: !!body.card?.url,
    isBot,
    instanceHost: hostOf(status._instanceUrl) || hostOf(body.url || body.uri),
    affinity,
    source,
    sourceTag,
    language,
    isThread,
    readMinutes,
    reasons,
    isShort: preview.length > 0 && preview.length <= 72,
    shortText: preview.length > 0 && preview.length <= 72 ? preview : null,
    exploreRank: -1,
    exploreRankNorm: 0,
  }
}

const languageName = (code: string): string => {
  try {
    const names = new Intl.DisplayNames(
      [typeof navigator !== 'undefined' ? navigator.language : 'en'],
      { type: 'language' },
    )
    return names.of(code) || code
  } catch {
    return code
  }
}

/**
 * Why a post is in your stream, then what it's like — most personal first.
 * Pure: everything it needs is passed in, so it's cached with the descriptor.
 */
export function reasonsFor(x: {
  aff: ReturnType<typeof affinityDetail>
  acct: string
  source: EdwardSource
  sourceTag: string | null
  instanceHost: string | null
  counts: { fav: number; boost: number; reply: number }
  kind: EdwardKind
  isBot: boolean
  mood: EdwardFaceMood
  language: string | null
  viewerLang: string | null
  readMinutes: number
  isThread: boolean
  createdAt: number
  now?: number
}): EdwardReason[] {
  const out: EdwardReason[] = []
  const handle = x.acct.split('@')[0] || x.acct
  if (x.aff.self) out.push({ glyph: '★', text: 'you posted this', kind: 'you' })
  if (x.aff.mentionsYou) out.push({ glyph: '@', text: 'mentions you', kind: 'you' })
  if (x.aff.followsAuthor) out.push({ glyph: '♥', text: `you follow @${handle}`, kind: 'you' })
  for (const t of x.aff.tagHits.slice(0, 2)) out.push({ glyph: '#', text: `you follow #${t}`, kind: 'you' })
  if (x.aff.homeAuthor && !x.aff.followsAuthor) {
    out.push({ glyph: '⌂', text: `@${handle} is around your home`, kind: 'you' })
  }

  if (x.source === 'home' && !x.aff.followsAuthor && !x.aff.self) {
    out.push({ glyph: '⌂', text: x.kind === 'boost' ? 'boosted into your home' : 'from your home', kind: 'source' })
  } else if (x.source === 'tag' && x.sourceTag && !x.aff.tagHits.includes(x.sourceTag)) {
    out.push({ glyph: '#', text: `from #${x.sourceTag}`, kind: 'source' })
  } else if (x.source === 'trend') {
    out.push({ glyph: '↑', text: x.instanceHost ? `trending on ${x.instanceHost}` : 'trending', kind: 'source' })
  }

  const now = x.now ?? Date.now()
  const total = x.counts.fav + x.counts.boost + x.counts.reply
  if (x.isBot) out.push({ glyph: '▣', text: 'a bot', kind: 'nuance' })
  if (x.counts.reply >= 3 && x.counts.reply >= x.counts.fav) {
    out.push({ glyph: '↩', text: `sparks talk · ${x.counts.reply} replies`, kind: 'nuance' })
  } else if (total >= 50) {
    out.push({ glyph: '✺', text: `loud · ${total} reactions`, kind: 'nuance' })
  } else if (total === 0 && now - x.createdAt > 10 * 60_000 && !x.isBot) {
    out.push({ glyph: '✧', text: 'nobody has noticed yet', kind: 'nuance' })
  }
  if (x.isThread) out.push({ glyph: '🧵', text: 'a thread', kind: 'nuance' })
  else if (x.readMinutes) out.push({ glyph: '≡', text: `long read · ~${x.readMinutes} min`, kind: 'nuance' })
  if (x.mood === 'ask') out.push({ glyph: '?', text: 'asking something', kind: 'nuance' })
  if (x.language && x.viewerLang && x.language !== x.viewerLang) {
    out.push({ glyph: '文', text: `in ${languageName(x.language)}`, kind: 'nuance' })
  }
  return out.slice(0, 4)
}

export const EDWARD_LEGEND: { kind: EdwardKind; label: string; swatch: string }[] = [
  { kind: 'original', label: 'thought', swatch: '#59d1e0' },
  { kind: 'reply', label: 'reply', swatch: '#f2ad52' },
  { kind: 'boost', label: 'boost', swatch: '#9e7aea' },
]
