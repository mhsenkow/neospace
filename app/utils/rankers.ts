/**
 * Big-platform ranking, rebuilt for Mastodon — pure functions only.
 *
 * Each ranker follows what its company has published (or what leaked and was
 * confirmed), mapped onto the signals a Mastodon client can actually see:
 * public like / boost / reply counts, the author's follower count, post age,
 * media, hashtags, language, and *your* history (who you follow, who follows
 * back, what you've liked and bookmarked). Real platforms feed private
 * signals (watch time, clicks, impressions) into trained models; here each
 * model head is replaced by the closest public proxy, and the "why" line on
 * every post says which ones fired.
 *
 *  - X (twitter/the-algorithm, 2023): heavy-ranker weights — fav 0.5,
 *    retweet 1, reply 13.5, good profile click 12, good click 11,
 *    reply engaged by author 75, negative feedback −74 — plus author
 *    diversity, ~50/50 in/out-of-network with an out-of-network discount,
 *    and social proof required for out-of-network posts.
 *  - Facebook ("meaningful social interactions", 2018 internal docs): like 1,
 *    reaction / plain reshare 5, significant comment or reshare 30, scaled
 *    by closeness (friend 1, group 0.5, stranger 0.3); engagement-bait and
 *    clickbait demoted; friends and groups first.
 *  - TikTok ("Algo 101", confirmed 2021; newsroom 2020):
 *    Plike·Vlike + Pcomment·Vcomment + Eplaytime·Vplaytime + Pplay·Vplay
 *    over an interest graph — follower count is not a factor, never the
 *    same creator or "sound" (here: hashtag) twice in a row, and fresh
 *    posts get exploration slots.
 */

export type RankerId = 'x' | 'facebook' | 'tiktok'

export type CandidateSource = 'home' | 'trend' | 'tag' | 'local' | 'federated'

/** Minimal status shape the rankers read (masto Status satisfies it) */
export type RankStatus = {
  id: string
  uri?: string | null
  createdAt: string
  content?: string | null
  spoilerText?: string | null
  sensitive?: boolean | null
  language?: string | null
  favouritesCount?: number | null
  reblogsCount?: number | null
  repliesCount?: number | null
  inReplyToId?: string | null
  card?: { url?: string | null } | null
  mediaAttachments?: { type?: string | null; meta?: unknown }[] | null
  tags?: { name?: string | null }[] | null
  mentions?: { acct?: string | null }[] | null
  account?: { acct?: string | null; followersCount?: number | null; bot?: boolean | null } | null
  reblog?: RankStatus | null
  /** Set by the feed: which candidate source fetched it */
  _rankSource?: CandidateSource
}

export type RankContext = {
  selfAcct: string | null
  /** Everyone you follow (acct, lowercase) */
  following: Set<string>
  /** Follow each other — Facebook's "friends" */
  mutuals: Set<string>
  /** Authors you've liked / bookmarked, with counts (X's RealGraph stand-in) */
  likedAuthors: Map<string, number>
  /** Hashtags on posts you've liked / bookmarked */
  likedTags: Map<string, number>
  /** Words from posts you've liked / bookmarked (TikTok's interest graph stand-in) */
  likedWords: Map<string, number>
  followedTags: Set<string>
  viewerLang: string | null
  now: number
}

export type RankedItem<S extends RankStatus = RankStatus> = {
  status: S
  score: number
  /** Short human reasons, strongest first */
  why: string[]
}

export const RANKERS: Record<
  RankerId,
  {
    label: string
    short: string
    /** One-line tip for menus / tooltips */
    tip: string
    /** Fuller explainer for the algorithm editor */
    description: string
    sources: CandidateSource[]
    needsAuth: boolean
  }
> = {
  x: {
    label: 'X-style For You',
    short: 'X',
    tip: 'Like X/Twitter For You — replies count far more than likes, mixes people you follow with discoveries, and spreads authors out.',
    description:
      'Ranks like X’s open-sourced For You: a reply is worth ~27× a like, about half the feed is people you follow and half is discovery, and you rarely see the same author twice in a row.',
    sources: ['home', 'trend', 'tag', 'local'],
    needsAuth: true,
  },
  facebook: {
    label: 'Facebook-style Feed',
    short: 'Facebook',
    tip: 'Like a Facebook feed — friends and conversations first; comments beat likes; engagement-bait sinks.',
    description:
      'Ranks for meaningful social interactions: mutuals and close follows rise, a real conversation counts ~30× a like, and clickbait / engagement-bait is demoted.',
    sources: ['home', 'tag', 'trend'],
    needsAuth: true,
  },
  tiktok: {
    label: 'TikTok-style For You',
    short: 'TikTok',
    tip: 'Like TikTok For You — interest and media over who you follow; skips big accounts; never the same creator twice in a row.',
    description:
      'Ranks for interest, not follow graph: media-first posts, follower count ignored, exploration slots for unseen creators, and never the same author twice in a row.',
    sources: ['federated', 'trend', 'tag', 'local', 'home'],
    needsAuth: false,
  },
}

// ── Features ───────────────────────────────────────────────────────────────

const STOP = new Set(
  'the a an and or but if of to in on at for with from by is are was were be been it its this that these those i you he she we they me my your our their not no so as just like can will would there here what when who how why about into out up down over more most very really also than then too only some any all'.split(
    ' ',
  ),
)

const stripHtml = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .trim()

export function contentWords(text: string, max = 40): string[] {
  const out: string[] = []
  for (const w of text.toLowerCase().match(/[\p{L}][\p{L}\p{N}'_-]{2,}/gu) || []) {
    if (STOP.has(w) || w.startsWith('http')) continue
    out.push(w)
    if (out.length >= max) break
  }
  return out
}

const norm = (acct?: string | null) => (acct || '').replace(/^@/, '').toLowerCase()

type Features = {
  author: string
  boostedBy: string | null
  favs: number
  boosts: number
  replies: number
  followers: number
  ageH: number
  hasVideo: boolean
  hasImage: boolean
  videoSec: number
  tags: string[]
  words: string[]
  /** Plain text, lowercased (phrase checks need the stop words) */
  text: string
  textLen: number
  hasCard: boolean
  isReply: boolean
  isBot: boolean
  cw: boolean
  language: string | null
  mentionsYou: boolean
  /** Ends on / contains a question */
  asks: boolean
  source: CandidateSource
  /** Rough audience that could have seen it — normalises counts */
  reach: number
}

/** Squash a count into a 0–1 "probability" relative to the author's reach */
const p = (n: number, reach: number) => 1 - Math.exp(-n / reach)

export function features(s: RankStatus, ctx: RankContext): Features {
  const body = s.reblog || s
  const text = stripHtml(body.content || '')
  const media = body.mediaAttachments || []
  const video = media.find((m) => m.type === 'video' || m.type === 'gifv')
  const meta = (video?.meta || {}) as { original?: { duration?: number }; duration?: number }
  const followers = Math.max(0, Number(body.account?.followersCount) || 0)
  const created = Date.parse(body.createdAt || s.createdAt)
  const self = norm(ctx.selfAcct)
  return {
    author: norm(body.account?.acct),
    boostedBy: s.reblog ? norm(s.account?.acct) : null,
    favs: Number(body.favouritesCount) || 0,
    boosts: Number(body.reblogsCount) || 0,
    replies: Number(body.repliesCount) || 0,
    followers,
    ageH: Math.max(0, (ctx.now - (Number.isFinite(created) ? created : ctx.now)) / 3_600_000),
    hasVideo: !!video,
    hasImage: media.some((m) => m.type === 'image'),
    videoSec: Number(meta.original?.duration ?? meta.duration) || 0,
    tags: (body.tags || []).map((t) => (t.name || '').toLowerCase()).filter(Boolean),
    words: contentWords(text),
    text: text.toLowerCase(),
    textLen: text.length,
    hasCard: !!body.card?.url,
    isReply: !!body.inReplyToId,
    isBot: !!body.account?.bot,
    cw: !!(body.sensitive || body.spoilerText?.trim()),
    language: (body.language || '').split('-')[0]!.toLowerCase() || null,
    mentionsYou: !!self && (body.mentions || []).some((m) => norm(m.acct) === self || norm(m.acct).split('@')[0] === self.split('@')[0]),
    asks: /\?\s*(\S+\s*)?$|\?\s/.test(text),
    source: s._rankSource || 'federated',
    // ~√followers people actually see a post; a floor keeps tiny accounts sane
    reach: 8 + Math.sqrt(followers) * 2.5,
  }
}

const isFollowed = (acct: string, ctx: RankContext) =>
  ctx.following.has(acct) || ctx.following.has(acct.split('@')[0]!)

const isMutual = (acct: string, ctx: RankContext) => ctx.mutuals.has(acct) || ctx.mutuals.has(acct.split('@')[0]!)

const likedAuthorScore = (acct: string, ctx: RankContext) =>
  Math.min(1, (ctx.likedAuthors.get(acct) || ctx.likedAuthors.get(acct.split('@')[0]!) || 0) / 3)

/** 0–1 overlap with your interests (tags weigh more than words) */
export function interestScore(f: Pick<Features, 'tags' | 'words'>, ctx: RankContext): number {
  let s = 0
  for (const t of f.tags) s += (ctx.followedTags.has(t) ? 1.2 : 0) + Math.min(1, (ctx.likedTags.get(t) || 0) / 2)
  for (const w of f.words) s += Math.min(0.5, (ctx.likedWords.get(w) || 0) / 6)
  return Math.min(1, s / 2.5)
}

const ENGAGEMENT_BAIT =
  /\b(like if|boost if|share if|rt if|retweet if|comment below|tag (a|your) friend|share this|follow for more|smash (that|the) like|type amen)\b/i

// ── Diversity helpers ──────────────────────────────────────────────────────

/** Greedy pick: best remaining item that doesn't break the adjacency rule */
function noRepeatOrder<T>(items: T[], clash: (a: T, b: T) => boolean): T[] {
  const left = [...items]
  const out: T[] = []
  while (left.length) {
    const prev = out[out.length - 1]
    let i = prev ? left.findIndex((x) => !clash(prev, x)) : 0
    if (i < 0) i = 0
    out.push(left.splice(i, 1)[0]!)
  }
  return out
}

// ── X ──────────────────────────────────────────────────────────────────────

/** Published heavy-ranker weights (the-algorithm-ml, 2023) */
export const X_WEIGHTS = {
  fav: 0.5,
  retweet: 1,
  reply: 13.5,
  goodProfileClick: 12,
  goodClick: 11,
  replyEngagedByAuthor: 75,
  negativeFeedback: -74,
} as const

function rankX<S extends RankStatus>(statuses: S[], ctx: RankContext): RankedItem<S>[] {
  const scored: (RankedItem<S> & { f: Features; inNetwork: boolean })[] = []
  for (const s of statuses) {
    const f = features(s, ctx)
    const self = norm(ctx.selfAcct)
    if (f.author && f.author === self) continue
    const inNetwork = isFollowed(f.author, ctx) || (!!f.boostedBy && isFollowed(f.boostedBy, ctx))
    const tagHit = f.tags.some((t) => ctx.followedTags.has(t))
    const liked = likedAuthorScore(f.author, ctx)
    // Out-of-network needs social proof (someone / something you're linked to)
    if (!inNetwork && !tagHit && liked === 0 && f.source !== 'trend') continue

    const pFav = p(f.favs, f.reach)
    const pRt = p(f.boosts, f.reach * 0.6)
    const pReply = p(f.replies, f.reach * 0.35)
    const goodProfileClick = Math.max(liked, isFollowed(f.author, ctx) ? 0.15 : 0)
    const goodClick = Math.min(1, (f.textLen > 200 ? 0.35 : 0) + (f.hasCard ? 0.25 : 0) + pReply * 0.4)
    // The author answering *your* reply: likeliest when they mention you or ask in your network
    const authorEngages = f.mentionsYou ? 0.6 : inNetwork && f.asks ? 0.08 : 0
    const negative = Math.min(1, (f.isBot ? 0.25 : 0) + (f.tags.length > 6 ? 0.25 : 0) + (f.cw ? 0.05 : 0))

    const heads = [
      { w: X_WEIGHTS.fav * pFav, why: 'likes' },
      { w: X_WEIGHTS.retweet * pRt, why: 'reposts' },
      { w: X_WEIGHTS.reply * pReply, why: 'reply-heavy' },
      { w: X_WEIGHTS.goodProfileClick * goodProfileClick, why: 'an author you engage with' },
      { w: X_WEIGHTS.goodClick * goodClick, why: 'worth opening' },
      { w: X_WEIGHTS.replyEngagedByAuthor * authorEngages, why: 'the author may reply to you' },
    ]
    let score = heads.reduce((a, h) => a + h.w, 0) + X_WEIGHTS.negativeFeedback * negative * 0.1
    // Recency: Earlybird-style decay (half-life ~8h)
    score *= Math.pow(0.5, f.ageH / 8)
    if (!inNetwork) score *= 0.75
    const why = heads
      .filter((h) => h.w > 0.4)
      .sort((a, b) => b.w - a.w)
      .slice(0, 2)
      .map((h) => h.why)
    why.unshift(inNetwork ? 'in your network' : tagHit ? 'a tag you follow' : f.source === 'trend' ? 'trending' : 'social proof')
    scored.push({ status: s, score, why, f, inNetwork })
  }

  // Author diversity: each further post by the same author counts for less
  scored.sort((a, b) => b.score - a.score)
  const seenAuthor = new Map<string, number>()
  for (const item of scored) {
    const k = seenAuthor.get(item.f.author) || 0
    if (k) {
      item.score *= Math.max(0.25, Math.pow(0.5, k))
      item.why.push('author diversity')
    }
    seenAuthor.set(item.f.author, k + 1)
  }
  scored.sort((a, b) => b.score - a.score)

  // Content balance: interleave so roughly half is in-network
  const inN = scored.filter((x) => x.inNetwork)
  const outN = scored.filter((x) => !x.inNetwork)
  const mixed: typeof scored = []
  while (inN.length || outN.length) {
    const takeIn = inN.length && (!outN.length || mixed.filter((x) => x.inNetwork).length <= mixed.length / 2)
    mixed.push((takeIn ? inN : outN).shift()!)
  }
  return mixed.map(({ status, score, why }) => ({ status, score, why }))
}

// ── Facebook ───────────────────────────────────────────────────────────────

/** MSI point values from the 2018 internal docs */
export const FB_MSI = { like: 1, reshare: 5, significantComment: 30 } as const
/** Closeness multipliers: friend 1, group 0.5, stranger 0.3 (followed page between) */
export const FB_CLOSENESS = { friend: 1, following: 0.7, group: 0.5, stranger: 0.3 } as const

function rankFacebook<S extends RankStatus>(statuses: S[], ctx: RankContext): RankedItem<S>[] {
  const scored: (RankedItem<S> & { f: Features })[] = []
  for (const s of statuses) {
    const f = features(s, ctx)
    if (f.author && f.author === norm(ctx.selfAcct)) continue
    const why: string[] = []
    let closeness: number
    if (isMutual(f.author, ctx)) {
      closeness = FB_CLOSENESS.friend
      why.push('a friend')
    } else if (isFollowed(f.author, ctx)) {
      closeness = FB_CLOSENESS.following
      why.push('someone you follow')
    } else if (f.tags.some((t) => ctx.followedTags.has(t)) || f.source === 'tag') {
      closeness = FB_CLOSENESS.group
      why.push('your group')
    } else {
      closeness = FB_CLOSENESS.stranger
      why.push(f.source === 'trend' ? 'recommended' : 'suggested')
    }
    // A friend sharing it counts as a social connection to the post
    if (f.boostedBy && isMutual(f.boostedBy, ctx)) {
      closeness = Math.max(closeness, 0.85)
      why[0] = 'shared by a friend'
    }
    // EdgeRank-era affinity: people you interact with rise
    const affinity = 1 + likedAuthorScore(f.author, ctx) * 0.8

    // Replies are the "significant comments" (no way to see their length here)
    const msi =
      (FB_MSI.like * f.favs + FB_MSI.reshare * f.boosts + FB_MSI.significantComment * f.replies) / f.reach
    let score = (0.15 + Math.log1p(msi)) * closeness * affinity
    if (f.replies >= 3 && f.replies * FB_MSI.significantComment >= f.favs) why.push('a real conversation')
    if (affinity > 1.3) why.push('you interact with them')

    // Integrity demotions
    if (ENGAGEMENT_BAIT.test(f.text)) {
      score *= 0.25
      why.push('engagement bait (demoted)')
    }
    if (f.hasCard && f.textLen < 40) score *= 0.6
    // Friends' posts stay relevant longer than a page's
    score *= Math.pow(0.5, f.ageH / (closeness >= 0.85 ? 36 : 18))
    scored.push({ status: s, score, why: why.slice(0, 3), f })
  }
  scored.sort((a, b) => b.score - a.score)
  // No more than two in a row from the same person
  const out: typeof scored = []
  const left = [...scored]
  while (left.length) {
    const a = out[out.length - 1]?.f.author
    const b = out[out.length - 2]?.f.author
    let i = a && a === b ? left.findIndex((x) => x.f.author !== a) : 0
    if (i < 0) i = 0
    out.push(left.splice(i, 1)[0]!)
  }
  return out.map(({ status, score, why }) => ({ status, score, why }))
}

// ── TikTok ─────────────────────────────────────────────────────────────────

/** Value weights aren't public — these keep each term in a similar range, play-time strongest */
export const TIKTOK_VALUES = { like: 1, comment: 2, playtime: 3, play: 1 } as const

function rankTikTok<S extends RankStatus>(statuses: S[], ctx: RankContext, rand: () => number): RankedItem<S>[] {
  const scored: (RankedItem<S> & { f: Features; fresh: boolean })[] = []
  for (const s of statuses) {
    const f = features(s, ctx)
    if (f.author && f.author === norm(ctx.selfAcct)) continue
    if (f.isBot) continue
    // Follower count is "not a direct factor": rates use a flat audience, not reach
    const audience = 12 + Math.min(40, f.ageH * 4)
    const pLike = p(f.favs, audience)
    const pComment = p(f.replies, audience * 0.4)
    const pPlay = f.hasVideo ? 1 : f.hasImage ? 0.7 : 0.25
    const ePlaytime = f.hasVideo
      ? Math.min(1, (f.videoSec || 20) / 45)
      : f.hasImage
        ? 0.35
        : Math.min(0.3, f.textLen / 900)
    const base =
      pLike * TIKTOK_VALUES.like +
      pComment * TIKTOK_VALUES.comment +
      ePlaytime * TIKTOK_VALUES.playtime +
      pPlay * TIKTOK_VALUES.play
    const interest = interestScore(f, ctx)
    const langMatch = !f.language || !ctx.viewerLang || f.language === ctx.viewerLang ? 1 : 0.8
    let score = base * (1 + interest * 1.6) * langMatch * Math.pow(0.5, f.ageH / 48)
    if (f.cw) score *= 0.7
    const why: string[] = []
    if (interest > 0.25) why.push('matches what you like')
    if (f.hasVideo) why.push('video')
    else if (f.hasImage) why.push('picture')
    if (pComment > 0.3) why.push('people are commenting')
    else if (pLike > 0.4) why.push('people love it')
    scored.push({ status: s, score, why: why.slice(0, 2), f, fresh: f.favs + f.boosts + f.replies <= 1 && f.ageH < 6 })
  }
  scored.sort((a, b) => b.score - a.score)

  // Exploration: every 5th slot goes to a fresh, unproven post
  const fresh = scored.filter((x) => x.fresh)
  const proven = scored.filter((x) => !x.fresh)
  const mixed: typeof scored = []
  while (proven.length || fresh.length) {
    if (fresh.length && (mixed.length % 5 === 4 || !proven.length)) {
      const pick = fresh.splice(Math.floor(rand() * Math.min(fresh.length, 6)), 1)[0]!
      pick.why = ['new — giving it a chance', ...pick.why].slice(0, 2)
      mixed.push(pick)
    } else mixed.push(proven.shift()!)
  }

  // Never the same creator or the same "sound" (lead hashtag) back to back
  const ordered = noRepeatOrder(
    mixed,
    (a, b) => a.f.author === b.f.author || (!!a.f.tags[0] && a.f.tags[0] === b.f.tags[0]),
  )
  return ordered.map(({ status, score, why }) => ({ status, score, why }))
}

// ── Entry point ────────────────────────────────────────────────────────────

/** Rank candidates (deduped by the caller). `rand` only drives TikTok exploration. */
export function rankFeed<S extends RankStatus>(
  ranker: RankerId,
  candidates: S[],
  ctx: RankContext,
  rand: () => number = Math.random,
): RankedItem<S>[] {
  if (ranker === 'x') return rankX(candidates, ctx)
  if (ranker === 'facebook') return rankFacebook(candidates, ctx)
  return rankTikTok(candidates, ctx, rand)
}

/** Build the taste part of the context from posts you liked / bookmarked */
export function tasteFrom(statuses: RankStatus[]) {
  const likedAuthors = new Map<string, number>()
  const likedTags = new Map<string, number>()
  const likedWords = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => k && m.set(k, (m.get(k) || 0) + 1)
  for (const s of statuses) {
    const body = s.reblog || s
    bump(likedAuthors, norm(body.account?.acct))
    for (const t of body.tags || []) bump(likedTags, (t.name || '').toLowerCase())
    for (const w of contentWords(stripHtml(body.content || ''), 25)) bump(likedWords, w)
  }
  return { likedAuthors, likedTags, likedWords }
}

export function emptyRankContext(now = Date.now()): RankContext {
  return {
    selfAcct: null,
    following: new Set(),
    mutuals: new Set(),
    likedAuthors: new Map(),
    likedTags: new Map(),
    likedWords: new Map(),
    followedTags: new Set(),
    viewerLang:
      typeof navigator !== 'undefined' && navigator.language
        ? navigator.language.split('-')[0]!.toLowerCase()
        : null,
    now,
  }
}
