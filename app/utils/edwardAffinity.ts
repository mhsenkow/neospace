/**
 * Personal relevance for Edward Mode — posts about / from your world
 * float closer and read bigger.
 */

export type EdwardAffinityContext = {
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

const localPart = (acct: string) => {
  const n = normAcct(acct)
  const i = n.indexOf('@')
  return i >= 0 ? n.slice(0, i) : n
}

/**
 * Local parts of everyone you follow — scoring runs for every post in the
 * stream, and spreading + scanning the (up to 300) follow set per post was
 * O(posts × follows). Rebuilt if the set grows (it's filled before use).
 */
const localPartsCache = new WeakMap<Set<string>, { size: number; parts: Set<string> }>()
function followingLocalParts(following: Set<string>): Set<string> {
  const hit = localPartsCache.get(following)
  if (hit && hit.size === following.size) return hit.parts
  const parts = new Set<string>()
  for (const f of following) parts.add(localPart(f))
  localPartsCache.set(following, { size: following.size, parts })
  return parts
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

  const author = normAcct(input.authorAcct)
  const authorLocal = localPart(author)
  const self = ctx.selfAcct ? normAcct(ctx.selfAcct) : null
  const selfLocal = ctx.selfUsername?.toLowerCase() || (self ? localPart(self) : null)

  // You posted it
  if (self && (author === self || authorLocal === selfLocal)) {
    score += 0.55
    detail.self = true
  }

  // Someone you follow
  if (
    author &&
    (ctx.following.has(author) ||
      ctx.following.has(authorLocal) ||
      (authorLocal.length > 1 && followingLocalParts(ctx.following).has(authorLocal)))
  ) {
    score += 0.38
    detail.followsAuthor = true
  } else if (author && ctx.homeAuthors.has(author)) {
    score += 0.18
    detail.homeAuthor = true
  }

  // Mentions you
  for (const m of input.mentionAccts) {
    const mn = normAcct(m)
    if (!mn) continue
    if (self && (mn === self || localPart(mn) === selfLocal)) {
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
  if (selfLocal && selfLocal.length > 2 && input.preview.toLowerCase().includes(selfLocal)) {
    score += 0.12
  }

  // Boosts of people you follow already counted via author of body —
  // slight bump if outer is boost of followed (handled by author of body)

  detail.score = Math.max(0, Math.min(1, score))
  return detail
}
