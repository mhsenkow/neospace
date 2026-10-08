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

export function emptyAffinityContext(): EdwardAffinityContext {
  return {
    selfAcct: null,
    selfUsername: null,
    following: new Set(),
    tags: new Set(),
    homeAuthors: new Set(),
  }
}

/**
 * Score 0–1 how much this thought belongs in *your* stream.
 * Used to pull coins closer / larger.
 */
export function affinityScore(
  input: EdwardAffinityInput,
  ctx: EdwardAffinityContext | null | undefined,
): number {
  if (!ctx) return 0
  let score = 0

  const author = normAcct(input.authorAcct)
  const authorLocal = localPart(author)
  const self = ctx.selfAcct ? normAcct(ctx.selfAcct) : null
  const selfLocal = ctx.selfUsername?.toLowerCase() || (self ? localPart(self) : null)

  // You posted it
  if (self && (author === self || authorLocal === selfLocal)) {
    score += 0.55
  }

  // Someone you follow
  if (
    author &&
    (ctx.following.has(author) ||
      ctx.following.has(authorLocal) ||
      [...ctx.following].some((f) => localPart(f) === authorLocal && authorLocal.length > 1))
  ) {
    score += 0.38
  } else if (author && ctx.homeAuthors.has(author)) {
    score += 0.18
  }

  // Mentions you
  for (const m of input.mentionAccts) {
    const mn = normAcct(m)
    if (!mn) continue
    if (self && (mn === self || localPart(mn) === selfLocal)) {
      score += 0.48
      break
    }
  }

  // Tags you joined / follow
  let tagHits = 0
  for (const t of input.tagNames) {
    const key = t.replace(/^#/, '').toLowerCase()
    if (key && ctx.tags.has(key)) {
      tagHits++
    }
  }
  if (tagHits) score += Math.min(0.32, 0.16 * tagHits)

  // Soft: your handle appears in plain text
  if (selfLocal && selfLocal.length > 2 && input.preview.toLowerCase().includes(selfLocal)) {
    score += 0.12
  }

  // Boosts of people you follow already counted via author of body —
  // slight bump if outer is boost of followed (handled by author of body)

  return Math.max(0, Math.min(1, score))
}
