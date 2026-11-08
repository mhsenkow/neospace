/**
 * Feed Packs — named 8-column boards you can switch and share.
 */

import type { AlgorithmRecipe, AlgorithmSharePayload } from '~/utils/algorithms'
import { recipeToSharePayload, sharePayloadToRecipe } from '~/utils/algorithms'
import type { ColumnConfig, ColumnFeedType } from '~/stores/columns'
import { MAX_COLUMNS } from '~/stores/columns'

export const MAX_PACKS = 8
export const PACKS_STORAGE_KEY = 'neospace_packs_v1'

export type FeedPack = {
  id: string
  name: string
  description?: string
  icon?: string
  columns: ColumnConfig[]
  updatedAt: number
}

export type PackShareColumn = {
  /** Compact token: home | local | federated | group:tag | algo:id | list:id | rss:url | … */
  t: string
  /** Optional chrome title (list / rss) */
  n?: string
}

/** Compact wire format for /packs/import?p= */
export type PackSharePayload = {
  v: 1
  n: string
  d?: string
  a?: string
  an?: string
  c: PackShareColumn[]
  /** Embedded custom algorithm recipes keyed by id */
  al?: Record<string, AlgorithmSharePayload>
}

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

export function newPackId() {
  return `pack_${generateId()}`
}

export function columnToShareToken(c: ColumnConfig): PackShareColumn {
  if (c.feedType === 'group' && c.groupTag) {
    return { t: `group:${c.groupTag}` }
  }
  if (c.feedType === 'algorithm' && c.algorithmId) {
    return { t: `algo:${c.algorithmId}` }
  }
  if (c.feedType === 'list' && c.listId) {
    return { t: `list:${c.listId}`, n: c.listTitle }
  }
  if (c.feedType === 'rss' && c.rssUrl) {
    return { t: `rss:${c.rssUrl}`, n: c.rssTitle }
  }
  if (c.serverHost && (c.feedType === 'local' || c.feedType === 'federated')) {
    return { t: `${c.feedType}@host:${c.serverHost}` }
  }
  if (c.instanceId && (c.feedType === 'local' || c.feedType === 'federated' || c.feedType === 'home')) {
    return { t: `${c.feedType}@${c.instanceId}` }
  }
  return { t: c.feedType }
}

export function shareTokenToColumn(token: PackShareColumn): ColumnConfig | null {
  const part = token.t?.trim()
  if (!part) return null
  if (part.startsWith('group:')) {
    const tag = part.slice(6).trim()
    if (!tag) return null
    return { id: generateId(), feedType: 'group', groupTag: tag, viewMode: 'flow' }
  }
  if (part.startsWith('algo:')) {
    const algorithmId = part.slice(5).trim()
    if (!algorithmId) return null
    return { id: generateId(), feedType: 'algorithm', algorithmId, viewMode: 'flow' }
  }
  if (part.startsWith('list:')) {
    const listId = part.slice(5).trim()
    if (!listId) return null
    return {
      id: generateId(),
      feedType: 'list',
      listId,
      listTitle: token.n?.trim() || undefined,
      viewMode: 'flow',
    }
  }
  if (part.startsWith('rss:')) {
    const rssUrl = part.slice(4).trim()
    if (!rssUrl || !/^https?:\/\//i.test(rssUrl)) return null
    return {
      id: generateId(),
      feedType: 'rss',
      rssUrl,
      rssTitle: token.n?.trim() || undefined,
      viewMode: 'flow',
    }
  }
  const pinned = part.match(/^(local|federated|home)@(host:)?(.+)$/i)
  if (pinned) {
    const feedType = pinned[1]!.toLowerCase() as ColumnFeedType
    const hostPin = !!pinned[2]
    const value = pinned[3]!.trim()
    if (!value) return null
    const col: ColumnConfig = { id: generateId(), feedType, viewMode: 'flow' }
    if (hostPin) col.serverHost = value.toLowerCase()
    else col.instanceId = value
    return col
  }
  const known: ColumnFeedType[] = [
    'home',
    'local',
    'federated',
    'favourites',
    'bookmarks',
    'profile',
    'search',
    'notifications',
    'messages',
  ]
  if ((known as string[]).includes(part)) {
    return { id: generateId(), feedType: part as ColumnFeedType, viewMode: 'flow' }
  }
  return null
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(raw: string): Uint8Array {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodePackShare(
  pack: FeedPack,
  opts?: {
    authorAcct?: string
    authorName?: string
    algorithms?: AlgorithmRecipe[]
  },
): string {
  const al: Record<string, AlgorithmSharePayload> = {}
  for (const col of pack.columns) {
    if (col.feedType !== 'algorithm' || !col.algorithmId) continue
    const recipe = opts?.algorithms?.find((r) => r.id === col.algorithmId)
    if (recipe && !recipe.builtin) {
      al[recipe.id] = recipeToSharePayload(recipe)
    }
  }
  const payload: PackSharePayload = {
    v: 1,
    n: pack.name.trim().slice(0, 48) || 'Pack',
    d: pack.description?.trim().slice(0, 160) || undefined,
    a: opts?.authorAcct?.trim().slice(0, 80) || undefined,
    an: opts?.authorName?.trim().slice(0, 80) || undefined,
    c: pack.columns.slice(0, MAX_COLUMNS).map(columnToShareToken),
  }
  if (Object.keys(al).length) payload.al = al
  const json = JSON.stringify(payload)
  return bytesToBase64Url(new TextEncoder().encode(json))
}

export type DecodePackShareResult =
  | { ok: true; payload: PackSharePayload }
  | { ok: false; reason: 'invalid' | 'version' }

export function tryDecodePackShare(raw: string): DecodePackShareResult {
  try {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.length > 12_000) return { ok: false, reason: 'invalid' }
    const json = new TextDecoder().decode(base64UrlToBytes(trimmed))
    const parsed = JSON.parse(json) as PackSharePayload & { v?: number }
    if (typeof parsed?.v === 'number' && parsed.v > 1) return { ok: false, reason: 'version' }
    if (parsed?.v !== 1 || typeof parsed.n !== 'string' || !parsed.n.trim()) {
      return { ok: false, reason: 'invalid' }
    }
    if (!Array.isArray(parsed.c) || !parsed.c.length) return { ok: false, reason: 'invalid' }
    return { ok: true, payload: parsed }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

export function packShareToFeedPack(
  payload: PackSharePayload,
): { pack: FeedPack; algorithms: AlgorithmRecipe[] } {
  const columns: ColumnConfig[] = []
  for (const token of payload.c) {
    if (columns.length >= MAX_COLUMNS) break
    if (!token || typeof token !== 'object' || typeof token.t !== 'string') continue
    const col = shareTokenToColumn(token)
    if (col) columns.push(col)
  }
  const algorithms: AlgorithmRecipe[] = []
  if (payload.al && typeof payload.al === 'object') {
    for (const [id, share] of Object.entries(payload.al)) {
      try {
        if (!share || typeof share !== 'object' || share.v !== 1) continue
        if (typeof share.n !== 'string' || !share.n.trim()) continue
        if (share.s !== 'home' && share.s !== 'local' && share.s !== 'federated') continue
        const recipeId = id.startsWith('algo_') ? id : `algo_${id}`
        algorithms.push(sharePayloadToRecipe(share, recipeId))
      } catch {
        /* skip bad recipe */
      }
    }
  }
  return {
    pack: {
      id: newPackId(),
      name: payload.n.trim().slice(0, 48) || 'Pack',
      description: payload.d?.trim().slice(0, 160) || undefined,
      columns: columns.length ? columns : [{ id: generateId(), feedType: 'local', viewMode: 'flow' }],
      updatedAt: Date.now(),
    },
    algorithms,
  }
}

export function buildPackShareUrl(origin: string, encoded: string): string {
  const base = origin.replace(/\/$/, '')
  return `${base}/packs/import?p=${encoded}`
}

export type StarterPackTemplate = {
  id: string
  name: string
  description: string
  columns: Omit<ColumnConfig, 'id'>[]
}

export const STARTER_PACKS: StarterPackTemplate[] = [
  {
    id: 'starter-fediverse',
    name: 'Fediverse Pulse',
    description: 'Home, Local, Federated, and a News group to start.',
    columns: [
      { feedType: 'home', viewMode: 'flow' },
      { feedType: 'local', viewMode: 'flow' },
      { feedType: 'federated', viewMode: 'flow' },
      { feedType: 'group', groupTag: 'news', viewMode: 'flow' },
    ],
  },
  {
    id: 'starter-tech-rss',
    name: 'Tech & Open Web',
    description: 'Federated tech chatter plus a few classic RSS longreads.',
    columns: [
      { feedType: 'federated', viewMode: 'flow' },
      { feedType: 'group', groupTag: 'technology', viewMode: 'flow' },
      {
        feedType: 'rss',
        rssUrl: 'https://hnrss.org/frontpage',
        rssTitle: 'Hacker News',
        viewMode: 'flow',
      },
      {
        feedType: 'rss',
        rssUrl: 'https://www.theverge.com/rss/index.xml',
        rssTitle: 'The Verge',
        viewMode: 'flow',
      },
    ],
  },
  {
    id: 'starter-art',
    name: 'Art & Visuals',
    description: 'Creative corners of the Fediverse.',
    columns: [
      { feedType: 'group', groupTag: 'art', viewMode: 'flow' },
      { feedType: 'group', groupTag: 'photography', viewMode: 'flow' },
      { feedType: 'local', viewMode: 'flow' },
      { feedType: 'favourites', viewMode: 'flow' },
    ],
  },
]

export function starterToPack(template: StarterPackTemplate): FeedPack {
  return {
    id: newPackId(),
    name: template.name,
    description: template.description,
    columns: template.columns.map((c) => ({
      ...c,
      id: generateId(),
      viewMode: c.viewMode || 'flow',
    })),
    updatedAt: Date.now(),
  }
}

export function defaultDailyPack(columns: ColumnConfig[]): FeedPack {
  return {
    id: newPackId(),
    name: 'Daily',
    description: 'Your main board',
    columns: columns.slice(0, MAX_COLUMNS),
    updatedAt: Date.now(),
  }
}
