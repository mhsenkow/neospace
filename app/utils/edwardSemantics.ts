/**
 * Map Mastodon statuses → Edward Mode ball descriptors (color, size, badges, mood).
 * Pure — no Pinia / DOM.
 */

import { stripHtml } from '~/utils/sanitizeHtml'
import { statusIdentity } from '~/utils/statusIdentity'
import { faceMoodFor, faceSpecFor, type EdwardFaceMood } from '~/utils/edwardFaces'

export type EdwardKind = 'original' | 'reply' | 'boost'

export type EdwardBadge = 'media' | 'poll' | 'cw' | 'link' | 'bot'

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
  createdAt: number
  topTag: string | null
  hasCard: boolean
  isBot: boolean
  instanceHost: string | null
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
  mentions?: unknown[] | null
  tags?: { name?: string | null }[] | null
  account?: {
    acct?: string | null
    displayName?: string | null
    username?: string | null
    bot?: boolean | null
  } | null
  _instanceUrl?: string | null
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

export function statusToEdwardBall(status: EdwardStatusLike): EdwardBallDescriptor {
  const body = resolveBody(status)
  const kind = statusKind(status)
  const favourites = n(body.favouritesCount)
  const reblogs = n(body.reblogsCount)
  const replies = n(body.repliesCount)
  const engagement = favourites + reblogs + replies

  const badges: EdwardBadge[] = []
  if ((body.mediaAttachments?.length || 0) > 0) badges.push('media')
  if (body.poll) badges.push('poll')
  if (body.sensitive || (body.spoilerText && body.spoilerText.trim())) badges.push('cw')
  if (body.card?.url) badges.push('link')
  if (body.account?.bot) badges.push('bot')

  const preview = stripHtml(body.content || '').slice(0, 160)
  const displayName =
    (body.account?.displayName || body.account?.username || body.account?.acct || 'someone').trim()
  const label = displayName.slice(0, 48)
  const acct = (body.account?.acct || '').replace(/^@/, '')

  const media = body.mediaAttachments?.[0]
  const mediaUrl = media?.previewUrl || media?.url || null
  const topTag =
    (body.tags || [])
      .map((t) => (t?.name || '').replace(/^#/, '').trim())
      .filter(Boolean)[0] || null

  const size = 0.22 + Math.log1p(engagement) * 0.11

  let opacity = kind === 'boost' ? 0.78 : 0.95
  if (badges.includes('cw')) opacity *= 0.6

  const spec = faceSpecFor({
    kind,
    badges,
    engagement,
    text: preview,
    hasCard: !!body.card?.url,
    isBot: !!body.account?.bot,
    mentionCount: body.mentions?.length || 0,
    tagCount: body.tags?.length || 0,
  })

  const mood = faceMoodFor({
    kind,
    badges,
    engagement,
    text: preview,
    hasCard: !!body.card?.url,
    isBot: !!body.account?.bot,
    mentionCount: body.mentions?.length || 0,
    tagCount: body.tags?.length || 0,
  })

  // Tint ball color from face fill hex
  const hex = spec.fill.replace('#', '')
  const color: [number, number, number] = [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ]

  const created = Date.parse(status.createdAt)
  const authorKey = (body.account?.acct || body.account?.username || status.id).toLowerCase()

  return {
    identity: statusIdentity(status) || status.id,
    statusId: status.id,
    kind,
    color: Number.isFinite(color[0]) ? color : KIND_COLOR[kind],
    size: Math.min(1.35, size),
    opacity,
    badges,
    mood,
    moodWhy: spec.why,
    label,
    preview,
    authorKey,
    acct,
    inReplyToId: status.inReplyToId || body.inReplyToId || null,
    mediaUrl,
    engagement,
    createdAt: Number.isFinite(created) ? created : Date.now(),
    topTag,
    hasCard: !!body.card?.url,
    isBot: !!body.account?.bot,
    instanceHost: hostOf(status._instanceUrl) || hostOf(body.url || body.uri),
  }
}

export const EDWARD_LEGEND: { kind: EdwardKind; label: string; swatch: string }[] = [
  { kind: 'original', label: 'thought', swatch: '#59d1e0' },
  { kind: 'reply', label: 'reply', swatch: '#f2ad52' },
  { kind: 'boost', label: 'boost', swatch: '#9e7aea' },
]
