/**
 * Client-side algorithm recipes — filter a source timeline by rules.
 * Shareable as a compact base64url payload (curators → followers).
 */

import type { mastodon } from 'masto'

export type AlgorithmSource = 'home' | 'local' | 'federated'

export interface AlgorithmRecipe {
  id: string
  name: string
  description?: string
  source: AlgorithmSource
  mediaOnly?: boolean
  noReblogs?: boolean
  noReplies?: boolean
  includeTags?: string[]
  excludeTags?: string[]
  includeKeywords?: string[]
  excludeKeywords?: string[]
  /** Curator attribution (set when sharing / importing) */
  authorAcct?: string
  authorName?: string
  /** Built-in presets cannot be deleted */
  builtin?: boolean
  createdAt: number
  updatedAt: number
}

/** Compact wire format for share URLs */
export type AlgorithmSharePayload = {
  v: 1
  n: string
  d?: string
  s: AlgorithmSource
  m?: 1
  nb?: 1
  nr?: 1
  it?: string[]
  et?: string[]
  ik?: string[]
  ek?: string[]
  a?: string
  an?: string
}

export const ALGORITHM_SOURCES: { value: AlgorithmSource; label: string; needsAuth: boolean }[] = [
  { value: 'home', label: 'For You (home)', needsAuth: true },
  { value: 'local', label: 'Local', needsAuth: false },
  { value: 'federated', label: 'Federated', needsAuth: false },
]

const TAG_RE = /^[a-z0-9_]+$/i

export function normalizeTagList(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : (raw || '')
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#/, '').trim().toLowerCase())
        .filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of parts) {
    const tag = t.replace(/^#/, '').trim().toLowerCase()
    if (!tag || !TAG_RE.test(tag) || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 12) break
  }
  return out
}

export function normalizeKeywordList(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : (raw || '')
        .split(/[,]+/)
        .map((k) => k.trim())
        .filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  for (const k of parts) {
    const key = k.trim().toLowerCase()
    if (!key || key.length > 64 || seen.has(key)) continue
    seen.add(key)
    out.push(k.trim())
    if (out.length >= 12) break
  }
  return out
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function displayStatus(status: mastodon.v1.Status): mastodon.v1.Status {
  return status.reblog ?? status
}

/** Does this status pass the recipe filters? */
export function statusMatchesRecipe(
  status: mastodon.v1.Status,
  recipe: Pick<
    AlgorithmRecipe,
    | 'mediaOnly'
    | 'noReblogs'
    | 'noReplies'
    | 'includeTags'
    | 'excludeTags'
    | 'includeKeywords'
    | 'excludeKeywords'
  >,
): boolean {
  if (recipe.noReblogs && status.reblog) return false

  const body = displayStatus(status)
  if (recipe.noReplies && body.inReplyToId) return false
  if (recipe.mediaOnly && !(body.mediaAttachments?.length > 0)) return false

  const tags = (body.tags || []).map((t) => t.name.toLowerCase())
  const includeTags = recipe.includeTags || []
  const excludeTags = recipe.excludeTags || []
  if (includeTags.length && !includeTags.some((t) => tags.includes(t))) return false
  if (excludeTags.length && excludeTags.some((t) => tags.includes(t))) return false

  const text = stripHtml(body.content || '').toLowerCase()
  const includeKeywords = (recipe.includeKeywords || []).map((k) => k.toLowerCase())
  const excludeKeywords = (recipe.excludeKeywords || []).map((k) => k.toLowerCase())
  if (includeKeywords.length && !includeKeywords.some((k) => text.includes(k))) return false
  if (excludeKeywords.length && excludeKeywords.some((k) => text.includes(k))) return false

  return true
}

export function recipeToSharePayload(recipe: AlgorithmRecipe): AlgorithmSharePayload {
  const payload: AlgorithmSharePayload = {
    v: 1,
    n: recipe.name.slice(0, 48),
    s: recipe.source,
  }
  if (recipe.description?.trim()) payload.d = recipe.description.trim().slice(0, 160)
  if (recipe.mediaOnly) payload.m = 1
  if (recipe.noReblogs) payload.nb = 1
  if (recipe.noReplies) payload.nr = 1
  if (recipe.includeTags?.length) payload.it = recipe.includeTags
  if (recipe.excludeTags?.length) payload.et = recipe.excludeTags
  if (recipe.includeKeywords?.length) payload.ik = recipe.includeKeywords
  if (recipe.excludeKeywords?.length) payload.ek = recipe.excludeKeywords
  if (recipe.authorAcct) payload.a = recipe.authorAcct.slice(0, 80)
  if (recipe.authorName) payload.an = recipe.authorName.slice(0, 80)
  return payload
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  if (typeof btoa === 'undefined') {
    throw new Error('base64 encode unavailable')
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(raw: string): Uint8Array {
  if (typeof atob === 'undefined') {
    throw new Error('base64 decode unavailable')
  }
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodeAlgorithmShare(recipe: AlgorithmRecipe): string {
  const json = JSON.stringify(recipeToSharePayload(recipe))
  const bytes = new TextEncoder().encode(json)
  return bytesToBase64Url(bytes)
}

export function decodeAlgorithmShare(raw: string): AlgorithmSharePayload | null {
  try {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.length > 4000) return null
    const bytes = base64UrlToBytes(trimmed)
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json) as AlgorithmSharePayload
    if (parsed?.v !== 1 || typeof parsed.n !== 'string' || !parsed.n.trim()) return null
    if (parsed.s !== 'home' && parsed.s !== 'local' && parsed.s !== 'federated') return null
    return parsed
  } catch {
    return null
  }
}

export function sharePayloadToRecipe(payload: AlgorithmSharePayload, id?: string): AlgorithmRecipe {
  const now = Date.now()
  return {
    id: id || `algo_${Math.random().toString(36).slice(2, 10)}`,
    name: payload.n.trim().slice(0, 48),
    description: payload.d?.trim().slice(0, 160) || undefined,
    source: payload.s,
    mediaOnly: payload.m === 1,
    noReblogs: payload.nb === 1,
    noReplies: payload.nr === 1,
    includeTags: normalizeTagList(payload.it),
    excludeTags: normalizeTagList(payload.et),
    includeKeywords: normalizeKeywordList(payload.ik),
    excludeKeywords: normalizeKeywordList(payload.ek),
    authorAcct: payload.a?.trim() || undefined,
    authorName: payload.an?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }
}

export function buildShareUrl(origin: string, recipe: AlgorithmRecipe): string {
  const base = origin.replace(/\/$/, '')
  return `${base}/algorithms/import?r=${encodeAlgorithmShare(recipe)}`
}

export function recipeSummary(recipe: AlgorithmRecipe): string {
  const bits: string[] = []
  bits.push(
    recipe.source === 'home' ? 'For You' : recipe.source === 'local' ? 'Local' : 'Federated',
  )
  if (recipe.mediaOnly) bits.push('media')
  if (recipe.noReblogs) bits.push('no boosts')
  if (recipe.noReplies) bits.push('no replies')
  if (recipe.includeTags?.length) bits.push(`#${recipe.includeTags.slice(0, 3).join(' #')}`)
  if (recipe.includeKeywords?.length) bits.push(`“${recipe.includeKeywords[0]}”`)
  return bits.join(' · ')
}

export function builtinRecipes(): AlgorithmRecipe[] {
  const now = Date.now()
  return [
    {
      id: 'builtin-media',
      name: 'Media',
      description: 'Posts with images or video from your home feed',
      source: 'home',
      mediaOnly: true,
      builtin: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'builtin-originals',
      name: 'Originals',
      description: 'Home feed without boosts',
      source: 'home',
      noReblogs: true,
      builtin: true,
      createdAt: now,
      updatedAt: now,
    },
  ]
}
