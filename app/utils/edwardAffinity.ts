/**
 * Personal relevance for Edward Mode — posts about / from your world
 * float closer and read bigger.
 */

export type EdwardAffinityContext = {
  /** Host of the server your follows / self handle are relative to (lowercase) */
  homeHost?: string | null
  /** Your acct lowercased, with or without @host */
  selfAcct: string | null
  selfUsername: string | null
  /** People you follow (acct lowercased) */
  following: Set<string>
  /** Hashtags you follow / groups you joined */
  tags: Set<string>
  /** Recent home-timeline authors (softer signal than full following) */
  homeAuthors: Set<string>
  /** Reader's language (BCP 47 primary subtag) — "in Español" is only news if it differs */
  viewerLang: string | null
}

export type EdwardAffinityInput = {
  authorAcct: string
  mentionAccts: string[]
  tagNames: string[]
  preview: string
  isBoost: boolean
}

const normAcct = (raw: string) =>
  raw.replace(/^@/, '').trim().toLowerCase()

/**
 * Canonical "who" key: lower-cased, no leading @, and bare when the account lives
 * on your own server (`bob` and `bob@your.host` match). Callers qualify handles
 * from other servers first (see lookupAcctFor) so a bare name always means *your* server.
 */
const canonAcct = (raw: string, homeHost: string | null | undefined) => {
  const a = normAcct(raw)
  const h = homeHost?.toLowerCase()
  return h && a.endsWith(`@${h}`) ? a.slice(0, -(h.length + 1)) : a
}

/**
 * Canonical keys of everyone you follow — scoring runs for every post in the
 * stream, so the set is normalised once, not per post. Rebuilt if the set grows
 * (it's filled before use).
 */
const followingKeysCache = new WeakMap<
  Set<string>,
  { size: number; home: string | null; keys: Set<string> }
>()
function followingKeys(following: Set<string>, homeHost: string | null): Set<string> {
  const hit = followingKeysCache.get(following)
  if (hit && hit.size === following.size && hit.home === homeHost) return hit.keys
  const keys = new Set<string>()
  for (const f of following) keys.add(canonAcct(f, homeHost))
  followingKeysCache.set(following, { size: following.size, home: homeHost, keys })
  return keys
}

/**
 * Does `name` appear as a whole word (optionally @-prefixed) in `text`?
 * Short handles ("the", "art", "dev") are ignored — they match ordinary prose.
 */
export function handleInText(text: string, name: string | null | undefined): boolean {
  const n = (name || '').trim().toLowerCase()
  if (n.length < 4 || !/^[\p{L}\p{N}_]+$/u.test(n)) return false
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])@?${n}(?![\\p{L}\\p{N}_])`, 'u')
  return re.test((text || '').toLowerCase())
}

export function emptyAffinityContext(): EdwardAffinityContext {
  return {
    selfAcct: null,
    selfUsername: null,
    following: new Set(),
    tags: new Set(),
    homeAuthors: new Set(),
    viewerLang:
      typeof navigator !== 'undefined' && navigator.language
        ? navigator.language.split('-')[0]!.toLowerCase()
        : null,
  }
}

/** Which personal signals fired — the score plus the "why" behind it */
export type EdwardAffinityDetail = {
  score: number
  self: boolean
  mentionsYou: boolean
  followsAuthor: boolean
  homeAuthor: boolean
  /** Followed tags this post carries */
  tagHits: string[]
}

/**
 * Score 0–1 how much this thought belongs in *your* stream.
 * Used to pull coins closer / larger.
 */
export function affinityScore(
  input: EdwardAffinityInput,
  ctx: EdwardAffinityContext | null | undefined,
): number {
  return affinityDetail(input, ctx).score
}

export function affinityDetail(
  input: EdwardAffinityInput,
  ctx: EdwardAffinityContext | null | undefined,
): EdwardAffinityDetail {
  const detail: EdwardAffinityDetail = {
    score: 0,
    self: false,
    mentionsYou: false,
    followsAuthor: false,
    homeAuthor: false,
    tagHits: [],
  }
  if (!ctx) return detail
  let score = 0

  const home = ctx.homeHost?.toLowerCase() || null
  const author = canonAcct(input.authorAcct, home)
  const self = ctx.selfAcct ? canonAcct(ctx.selfAcct, home) : null
  const selfLocal =
    ctx.selfUsername?.toLowerCase() || (self ? self.split('@')[0] || null : null)

  // You posted it — full handle, never just the part before the @
  if (self && author === self) {
    score += 0.55
    detail.self = true
  }

  // Someone you follow
  if (author && followingKeys(ctx.following, home).has(author)) {
    score += 0.38
    detail.followsAuthor = true
  } else if (author && followingKeys(ctx.homeAuthors, home).has(author)) {
    score += 0.18
    detail.homeAuthor = true
  }

  // Mentions you
  for (const m of input.mentionAccts) {
    const mn = canonAcct(m, home)
    if (!mn) continue
    if (self && mn === self) {
      score += 0.48
      detail.mentionsYou = true
      break
    }
  }

  // Tags you joined / follow
  let tagHits = 0
  for (const t of input.tagNames) {
    const key = t.replace(/^#/, '').toLowerCase()
    if (key && ctx.tags.has(key)) {
      tagHits++
      detail.tagHits.push(key)
    }
  }
  if (tagHits) score += Math.min(0.32, 0.16 * tagHits)

  // Soft: your handle appears in plain text
  if (handleInText(input.preview, selfLocal)) {
    score += 0.12
  }

  // Boosts of people you follow already counted via author of body —
  // slight bump if outer is boost of followed (handled by author of body)

  detail.score = Math.max(0, Math.min(1, score))
  return detail
}
