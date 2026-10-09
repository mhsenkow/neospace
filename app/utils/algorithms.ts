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

/**
 * Lists arrive from share links and localStorage — untrusted. Keep only
 * strings so a crafted `{"it":[1]}` can't throw inside `.replace` / `.trim`.
 */
function stringParts(raw: unknown, split: RegExp): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string')
  if (typeof raw !== 'string') return []
  return raw.split(split).filter(Boolean)
}

export function normalizeTagList(raw: string | string[] | undefined): string[] {
  const parts = stringParts(raw, /[\s,]+/)
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
  const parts = stringParts(raw, /[,]+/)
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
    // Optional text fields get `.trim()`ed on import — drop anything that isn't a string
    for (const key of ['d', 'a', 'an'] as const) {
      if (parsed[key] !== undefined && typeof parsed[key] !== 'string') delete parsed[key]
    }
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
    // Encode caps these at 80; a hand-built link may not
    authorAcct: payload.a?.trim().slice(0, 80) || undefined,
    authorName: payload.an?.trim().slice(0, 80) || undefined,
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

/** Partial recipe + suggested title from a natural-language sentence. */
export type ParsedAlgorithmSentence = {
  name: string
  description: string
  source: AlgorithmSource
  mediaOnly: boolean
  noReblogs: boolean
  noReplies: boolean
  includeTags: string[]
  excludeTags: string[]
  includeKeywords: string[]
  excludeKeywords: string[]
  /** Human chips for the preview UI */
  chips: string[]
}

const STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'with',
  'without',
  'from',
  'on',
  'in',
  'of',
  'to',
  'for',
  'my',
  'me',
  'i',
  'show',
  'see',
  'want',
  'just',
  'only',
  'please',
  'posts',
  'post',
  'feed',
  'timeline',
  'things',
  'stuff',
  'about',
  'that',
  'this',
  'those',
  'these',
  'any',
  'all',
  'some',
  'except',
  'excluding',
  'no',
  'not',
  'dont',
  "don't",
  'skip',
  'hide',
  'minus',
  'plus',
  'also',
  'like',
  'as',
  'is',
  'are',
  'be',
  'it',
  'its',
  "it's",
  'get',
  'give',
  'using',
  'use',
  'via',
  'into',
  'over',
  'under',
  'more',
  'less',
  'than',
  'then',
  'when',
  'where',
  'who',
  'what',
  'how',
  'why',
])

/**
 * Deterministic NL → recipe rules. No network / model — pattern + keyword extract.
 * Examples:
 *  - "cat photos on local, no boosts"
 *  - "tech news but no politics"
 *  - "federated #foss media only without replies"
 */
export function parseAlgorithmSentence(raw: string): ParsedAlgorithmSentence {
  const text = raw.trim().replace(/\s+/g, ' ')
  const lower = text.toLowerCase()

  let source: AlgorithmSource = 'home'
  if (/\b(federated|fediverse|public timeline|firehose)\b/.test(lower)) source = 'federated'
  else if (/\b(local|this server|my server|instance)\b/.test(lower)) source = 'local'
  else if (/\b(for you|home|following)\b/.test(lower)) source = 'home'

  const mediaOnly =
    /\b(media only|photos?|images?|pics?|pictures?|videos?|with media|has media)\b/.test(lower)
  const noReblogs =
    /\b(no boosts?|without boosts?|no reblogs?|without reblogs?|originals?|no retweets?)\b/.test(
      lower,
    )
  const noReplies = /\b(no replies?|without replies?|hide replies?|top[- ]level)\b/.test(lower)

  // Explicit hashtags
  const allTags = [...text.matchAll(/#([a-z0-9_]{2,})/gi)].map((m) => m[1]!.toLowerCase())
  const includeTags: string[] = []
  const excludeTags: string[] = []

  // "no #politics" / "without #nsfw" / "except #x"
  const exclTagRe =
    /(?:\bno|without|except|excluding|hide|skip|minus)\s+#([a-z0-9_]{2,})/gi
  for (const m of text.matchAll(exclTagRe)) {
    excludeTags.push(m[1]!.toLowerCase())
  }
  for (const t of allTags) {
    if (!excludeTags.includes(t) && !includeTags.includes(t)) includeTags.push(t)
  }

  // Quoted phrases
  const includeKeywords: string[] = []
  const excludeKeywords: string[] = []
  for (const m of text.matchAll(/"([^"]{2,64})"|'([^']{2,64})'/g)) {
    const phrase = (m[1] || m[2] || '').trim()
    if (phrase) includeKeywords.push(phrase)
  }

  // Exclusion phrases: "no politics", "but no spoilers", "without ads"
  const exclKwRe =
    /(?:\bno|without|except|excluding|hide|skip|minus|but\s+no)\s+([a-z][a-z0-9][\w\s-]{0,40}?)(?=\s*(?:,|\.|$|but|and|with|from|on|#)|$)/gi
  for (const m of lower.matchAll(exclKwRe)) {
    let chunk = (m[1] || '').trim()
    // Strip trailing filter words that aren't content
    chunk = chunk
      .replace(
        /\b(boosts?|reblogs?|replies?|photos?|images?|pics?|videos?|media|posts?|feed|timeline)\b/g,
        '',
      )
      .replace(/#\w+/g, '')
      .trim()
    for (const part of chunk.split(/[,\s]+/).filter(Boolean)) {
      if (part.length < 2 || STOP.has(part)) continue
      if (!excludeKeywords.some((k) => k.toLowerCase() === part)) excludeKeywords.push(part)
    }
  }

  // Inclusion after "about / with / show me / just"
  const aboutRe =
    /(?:about|with|show\s+me|i\s+want|just|only)\s+([a-z0-9][\w\s#,-]{1,48}?)(?=\s*(?:,|\.|$|but|without|except|no\s+|from|on\s+(?:local|home|federated))|$)/gi
  for (const m of lower.matchAll(aboutRe)) {
    let chunk = (m[1] || '').trim()
    chunk = chunk
      .replace(
        /\b(photos?|images?|pics?|videos?|media|boosts?|reblogs?|replies?|posts?)\b/g,
        '',
      )
      .replace(/#\w+/g, '')
      .trim()
    for (const part of chunk.split(/[,\s]+/).filter(Boolean)) {
      if (part.length < 2 || STOP.has(part)) continue
      if (excludeKeywords.some((k) => k.toLowerCase() === part)) continue
      if (!includeKeywords.some((k) => k.toLowerCase() === part)) includeKeywords.push(part)
    }
  }

  // Fallback: leftover content words if we still have nothing to include
  if (!includeTags.length && !includeKeywords.length) {
    const stripped = lower
      .replace(/#[a-z0-9_]+/g, ' ')
      .replace(/["'][^"']+["']/g, ' ')
      .replace(
        /\b(federated|local|home|for you|following|instance|server|media only|photos?|images?|pics?|videos?|no boosts?|without boosts?|no reblogs?|originals?|no replies?|without replies?|show me|i want|timeline|feed|posts?)\b/g,
        ' ',
      )
      .replace(
        /(?:\bno|without|except|excluding|hide|skip|minus|but\s+no)\s+[a-z][\w\s-]{0,40}/g,
        ' ',
      )
    for (const part of stripped.split(/[^\w]+/).filter(Boolean)) {
      if (part.length < 3 || STOP.has(part)) continue
      if (!includeKeywords.some((k) => k.toLowerCase() === part)) includeKeywords.push(part)
      if (includeKeywords.length >= 6) break
    }
  }

  const chips: string[] = []
  chips.push(source === 'home' ? 'For You' : source === 'local' ? 'Local' : 'Federated')
  if (mediaOnly) chips.push('Media')
  if (noReblogs) chips.push('No boosts')
  if (noReplies) chips.push('No replies')
  for (const t of includeTags.slice(0, 4)) chips.push(`#${t}`)
  for (const t of excludeTags.slice(0, 3)) chips.push(`−#${t}`)
  for (const k of includeKeywords.slice(0, 4)) chips.push(k)
  for (const k of excludeKeywords.slice(0, 3)) chips.push(`−${k}`)

  // Suggested name
  let name = ''
  if (includeTags[0]) name = `#${includeTags[0]}`
  else if (includeKeywords[0]) {
    name = includeKeywords[0].replace(/\b\w/g, (c) => c.toUpperCase())
  } else if (mediaOnly) name = 'Media'
  else if (noReblogs) name = 'Originals'
  else name = source === 'local' ? 'Local pick' : source === 'federated' ? 'Federated pick' : 'My feed'
  if (excludeKeywords[0] || excludeTags[0]) {
    const ex = excludeTags[0] ? `#${excludeTags[0]}` : excludeKeywords[0]
    if (name.length < 28) name = `${name}, no ${ex}`
  }
  name = name.slice(0, 48)

  const description = text.slice(0, 160)

  return {
    name,
    description,
    source,
    mediaOnly,
    noReblogs,
    noReplies,
    includeTags: normalizeTagList(includeTags),
    excludeTags: normalizeTagList(excludeTags),
    includeKeywords: normalizeKeywordList(includeKeywords),
    excludeKeywords: normalizeKeywordList(excludeKeywords),
    chips,
  }
}

export const ALGORITHM_SENTENCE_EXAMPLES = [
  'Cat photos on local, no boosts',
  'Tech news but no politics',
  'Federated #foss media only',
  'Show me climate without replies',
] as const

