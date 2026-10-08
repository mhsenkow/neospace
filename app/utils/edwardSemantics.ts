/**
 * Map Mastodon statuses → Edward Mode ball descriptors (color, size, badges).
 * Pure — no Pinia / DOM.
 */

import { stripHtml } from '~/utils/sanitizeHtml'
import { statusIdentity } from '~/utils/statusIdentity'

export type EdwardKind = 'original' | 'reply' | 'boost'

export type EdwardBadge = 'media' | 'poll' | 'cw'

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
  /** Hover / HUD label */
  label: string
  preview: string
  authorKey: string
  inReplyToId: string | null
  mediaUrl: string | null
  engagement: number
  createdAt: number
}

/** Semantic palette — deep-space cyan / amber / violet (not purple-glow cliché) */
const KIND_COLOR: Record<EdwardKind, [number, number, number]> = {
  original: [0.35, 0.82, 0.88], // cyan-teal
  reply: [0.95, 0.68, 0.32], // warm amber
  boost: [0.62, 0.48, 0.92], // soft violet
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
  mediaAttachments?: { previewUrl?: string | null; url?: string | null }[] | null
  account?: {
    acct?: string | null
    displayName?: string | null
    username?: string | null
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

  const preview = stripHtml(body.content || '').slice(0, 120)
  const displayName =
    (body.account?.displayName || body.account?.username || body.account?.acct || 'someone').trim()
  const label = displayName.slice(0, 48)

  const media = body.mediaAttachments?.[0]
  const mediaUrl = media?.previewUrl || media?.url || null

  // Size: calm base + log engagement so viral posts dominate without exploding
  const size = 0.22 + Math.log1p(engagement) * 0.11

  // Boosts: softer; CW: darker veil via lower opacity
  let opacity = kind === 'boost' ? 0.72 : 0.92
  if (badges.includes('cw')) opacity *= 0.55

  const color = [...KIND_COLOR[kind]] as [number, number, number]
  if (badges.includes('cw')) {
    color[0] *= 0.45
    color[1] *= 0.45
    color[2] *= 0.55
  }

  const created = Date.parse(status.createdAt)
  const authorKey = (body.account?.acct || body.account?.username || status.id).toLowerCase()

  return {
    identity: statusIdentity(status) || status.id,
    statusId: status.id,
    kind,
    color,
    size: Math.min(1.35, size),
    opacity,
    badges,
    label,
    preview,
    authorKey,
    inReplyToId: status.inReplyToId || body.inReplyToId || null,
    mediaUrl,
    engagement,
    createdAt: Number.isFinite(created) ? created : Date.now(),
  }
}

export const EDWARD_LEGEND: { kind: EdwardKind; label: string; swatch: string }[] = [
  { kind: 'original', label: 'thought', swatch: '#59d1e0' },
  { kind: 'reply', label: 'reply', swatch: '#f2ad52' },
  { kind: 'boost', label: 'boost', swatch: '#9e7aea' },
]
