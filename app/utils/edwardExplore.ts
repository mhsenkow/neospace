/**
 * Edward Mode explore console — parse search / filter / sort queries
 * against emoticoin ball descriptors.
 */

import type { EdwardBallDescriptor, EdwardBadge, EdwardKind, EdwardSource } from '~/utils/edwardSemantics'
import type { EdwardFaceMood } from '~/utils/edwardFaces'

export type EdwardSortMode = 'stream' | 'near' | 'new' | 'loud' | 'you' | 'gems' | 'shuffle'

export type EdwardExploreParsed = {
  /** Free-text tokens (match preview / author / tag) */
  text: string[]
  moods: Set<EdwardFaceMood>
  kinds: Set<EdwardKind>
  badges: Set<EdwardBadge>
  /** Negated badges — e.g. `-bot` / `nobot` hides bot faces */
  excludeBadges: Set<EdwardBadge>
  tags: Set<string>
  authors: Set<string>
  /** Server hosts (from srv:host chips) */
  servers: Set<string>
  /** Affinity threshold — "you" / "related" */
  minAffinity: number
  /** "quiet" — only posts almost nobody has engaged with yet */
  maxEngagement: number | null
  /** src:home / src:tags / src:trending / src:firehose */
  sources: Set<EdwardSource>
  /** lang:xx — and -lang:xx to hide one */
  languages: Set<string>
  excludeLanguages: Set<string>
  /** -mood:anger … */
  excludeMoods: Set<EdwardFaceMood>
  /** thread openers only */
  threads: boolean
  /** long reads only */
  long: boolean
  /** conversations: 3+ replies */
  talk: boolean
  /** Explicit sort from query, if any */
  sort: EdwardSortMode | null
  /** Raw leftover for display */
  raw: string
}

const MOOD_ALIASES: Record<string, EdwardFaceMood> = {
  thought: 'curious',
  curious: 'curious',
  reply: 'yapping',
  yapping: 'yapping',
  boost: 'starry',
  starry: 'starry',
  media: 'sparkle',
  sparkle: 'sparkle',
  poll: 'hmm',
  hmm: 'hmm',
  cw: 'shy',
  shy: 'shy',
  viral: 'manic',
  manic: 'manic',
  laugh: 'giggle',
  giggle: 'giggle',
  love: 'swoon',
  swoon: 'swoon',
  heart: 'swoon',
  rage: 'rage',
  heat: 'rage',
  sad: 'sad',
  ask: 'ask',
  link: 'linky',
  linky: 'linky',
  bot: 'bot',
  spicy: 'eggplant',
  eggplant: 'eggplant',
  peach: 'peach',
  kitty: 'kitty',
  booby: 'booby',
  anger: 'anger',
  mad: 'anger',
  fear: 'fear',
  smug: 'smug',
  sleepy: 'sleepy',
  party: 'party',
  confused: 'confused',
  huh: 'confused',
  sick: 'sick',
  cool: 'cool',
}

const KIND_ALIASES: Record<string, EdwardKind> = {
  original: 'original',
  thought: 'original',
  reply: 'reply',
  boost: 'boost',
  reblog: 'boost',
}

const BADGE_ALIASES: Record<string, EdwardBadge> = {
  media: 'media',
  pic: 'media',
  photo: 'media',
  poll: 'poll',
  cw: 'cw',
  nsfw: 'cw',
  link: 'link',
  bot: 'bot',
}

const SORT_ALIASES: Record<string, EdwardSortMode> = {
  stream: 'stream',
  near: 'near',
  close: 'near',
  new: 'new',
  recent: 'new',
  loud: 'loud',
  hot: 'loud',
  viral: 'loud',
  you: 'you',
  related: 'you',
  affinity: 'you',
  gems: 'gems',
  gem: 'gems',
  hidden: 'gems',
  shuffle: 'shuffle',
  random: 'shuffle',
  surprise: 'shuffle',
}

export const EDWARD_SORT_LABELS: Record<EdwardSortMode, string> = {
  stream: 'stream',
  near: 'near · you',
  new: 'newest',
  loud: 'loudest',
  you: 'related',
  gems: 'hidden gems',
  shuffle: 'shuffle',
}

/** Sort row order in the console (stream first = no reordering) */
export const EDWARD_SORT_ORDER: EdwardSortMode[] = ['stream', 'gems', 'shuffle', 'you', 'new', 'loud', 'near']

export const EDWARD_SORT_HINTS: Record<EdwardSortMode, string> = {
  stream: 'as it arrives',
  gems: 'thoughtful posts nobody has noticed yet',
  shuffle: 'random order — tap again to reshuffle',
  you: 'closest to who and what you follow',
  new: 'freshest first',
  loud: 'most engagement first',
  near: 'related and big, pulled close',
}

export const EDWARD_EXPLORE_CHIPS: {
  label: string
  query: string
  hint: string
  /** Behind the "more" toggle unless active */
  more?: boolean
}[] = [
  { label: 'no bots', query: '-bot', hint: 'hide marked & obvious bots' },
  { label: 'you', query: 'you', hint: 'related to you' },
  { label: 'quiet', query: 'quiet', hint: 'barely noticed yet' },
  { label: 'media', query: 'media', hint: 'pics & video' },
  { label: 'words', query: '-media', hint: 'text only, no pictures' },
  { label: 'asks', query: 'mood:ask', hint: 'questions' },
  { label: 'links', query: 'link', hint: 'articles & link cards', more: true },
  { label: 'polls', query: 'poll', hint: 'polls', more: true },
  { label: 'threads', query: 'threads', hint: '🧵 thread openers', more: true },
  { label: 'long', query: 'long', hint: 'long reads', more: true },
  { label: 'talk', query: 'talk', hint: 'posts sparking conversation' },
  { label: 'replies', query: 'kind:reply', hint: 'replies in a conversation', more: true },
  { label: 'love', query: 'mood:love', hint: 'heart energy', more: true },
  { label: 'anger', query: 'mood:anger', hint: 'mad faces', more: true },
  { label: 'bots', query: 'bot', hint: 'only bot accounts', more: true },
]

/** Where posts came from — chips in the console */
export const EDWARD_SOURCE_CHIPS: { source: EdwardSource; label: string; query: string; glyph: string }[] = [
  { source: 'home', label: 'home', query: 'src:home', glyph: '⌂' },
  { source: 'tag', label: 'your tags', query: 'src:tags', glyph: '#' },
  { source: 'trend', label: 'trending', query: 'src:trending', glyph: '↑' },
  { source: 'firehose', label: 'firehose', query: 'src:firehose', glyph: '≋' },
]

/**
 * Ed's channels — one tap sets a whole mood of filter + sort. `{lang}` is
 * swapped for the reader's language at runtime.
 */
export const EDWARD_CHANNELS: { id: string; label: string; glyph: string; query: string; sort: EdwardSortMode; hint: string }[] = [
  { id: 'calm', label: 'calm waters', glyph: '〜', query: '-bot -cw -mood:anger -mood:rage', sort: 'gems', hint: 'gentle, no bots, no heat' },
  { id: 'people', label: 'my people', glyph: '⌂', query: 'src:home', sort: 'you', hint: 'your home and the folks in it' },
  { id: 'wonder', label: 'wonder', glyph: '✧', query: 'media quiet -bot', sort: 'shuffle', hint: 'unseen pictures, shuffled' },
  { id: 'chatter', label: 'chatter', glyph: '↩', query: 'talk -bot', sort: 'loud', hint: 'conversations happening now' },
  { id: 'deep', label: 'deep reads', glyph: '≡', query: 'long -bot', sort: 'gems', hint: 'long posts worth the scroll' },
  { id: 'far', label: 'far away', glyph: '文', query: '-lang:{lang} -bot', sort: 'shuffle', hint: 'other languages, other places' },
]

/** Rotating placeholders — teach the grammar by example */
export const EDWARD_EXPLORE_PLACEHOLDERS = [
  'try: -bot · anger · #art · you · sort:loud',
  'tap no bots · hide the ▣▣ faces · ←→ scrub',
  'mood:love · kind:reply · sort:near · lens circle',
  'type a word, #tag, @someone, or srv:instance',
  'src:home · src:trending · lang:es · -mood:anger',
  'chaos below · filters above · dive when something hits',
]

const emptyParsed = (raw: string): EdwardExploreParsed => ({
  text: [],
  moods: new Set(),
  kinds: new Set(),
  badges: new Set(),
  excludeBadges: new Set(),
  tags: new Set(),
  authors: new Set(),
  servers: new Set(),
  minAffinity: 0,
  maxEngagement: null,
  sources: new Set(),
  languages: new Set(),
  excludeLanguages: new Set(),
  excludeMoods: new Set(),
  threads: false,
  long: false,
  talk: false,
  sort: null,
  raw,
})

const SOURCE_ALIASES: Record<string, EdwardSource> = {
  home: 'home',
  following: 'home',
  tag: 'tag',
  tags: 'tag',
  groups: 'tag',
  trend: 'trend',
  trends: 'trend',
  trending: 'trend',
  firehose: 'firehose',
  fire: 'firehose',
  public: 'firehose',
}

export function parseEdwardExplore(input: string): EdwardExploreParsed {
  const raw = input.trim()
  const out = emptyParsed(raw)
  if (!raw) return out

  const tokens = raw.match(/(?:[^\s"]+|"[^"]*")+/g) || []
  for (const rawTok of tokens) {
    const tok = rawTok.replace(/^"|"$/g, '').trim()
    if (!tok) continue
    const lower = tok.toLowerCase()

    if (lower === 'you' || lower === 'related' || lower === 'mine') {
      out.minAffinity = Math.max(out.minAffinity, 0.28)
      continue
    }

    if (lower === 'quiet' || lower === 'unseen' || lower === 'overlooked') {
      out.maxEngagement = 2
      continue
    }

    if (lower === 'thread' || lower === 'threads') {
      out.threads = true
      continue
    }
    if (lower === 'long' || lower === 'longread' || lower === 'reads') {
      out.long = true
      continue
    }
    if (lower === 'talk' || lower === 'chatty' || lower === 'convo') {
      out.talk = true
      continue
    }

    if (lower.startsWith('src:') || lower.startsWith('from:')) {
      const src = SOURCE_ALIASES[lower.replace(/^src:|^from:/, '')]
      if (src) out.sources.add(src)
      continue
    }

    if (lower.startsWith('lang:') || lower.startsWith('-lang:')) {
      const neg = lower.startsWith('-')
      const code = lower.replace(/^-?lang:/, '').split('-')[0]!
      if (code) (neg ? out.excludeLanguages : out.languages).add(code)
      continue
    }

    if (lower.startsWith('-mood:')) {
      const mood = MOOD_ALIASES[lower.slice(6)]
      if (mood) out.excludeMoods.add(mood)
      continue
    }

    // Hide bots — first-class, because the stream is thick with them
    if (
      lower === 'nobot' ||
      lower === 'nobots' ||
      lower === 'humans' ||
      lower === '-bot' ||
      lower === '-bots'
    ) {
      out.excludeBadges.add('bot')
      out.badges.delete('bot')
      continue
    }

    // Generic badge negation: -media, -cw, …
    if (lower.startsWith('-')) {
      const key = lower.slice(1)
      const badge = BADGE_ALIASES[key]
      if (badge) {
        out.excludeBadges.add(badge)
        out.badges.delete(badge)
        continue
      }
    }

    if (lower.startsWith('srv:') || lower.startsWith('server:')) {
      const host = lower.replace(/^srv:|^server:/, '').replace(/^www\./, '')
      if (host) out.servers.add(host)
      continue
    }

    if (lower.startsWith('sort:')) {
      const key = lower.slice(5)
      const sort = SORT_ALIASES[key]
      if (sort) out.sort = sort
      continue
    }

    if (lower.startsWith('mood:')) {
      const key = lower.slice(5)
      const mood = MOOD_ALIASES[key]
      if (mood) out.moods.add(mood)
      continue
    }

    if (lower.startsWith('kind:')) {
      const key = lower.slice(5)
      const kind = KIND_ALIASES[key]
      if (kind) out.kinds.add(kind)
      continue
    }

    if (lower.startsWith('#')) {
      const tag = lower.slice(1).replace(/[^a-z0-9_]/g, '')
      if (tag) out.tags.add(tag)
      continue
    }

    if (lower.startsWith('@')) {
      const acct = lower.slice(1).replace(/^@/, '')
      if (acct) out.authors.add(acct)
      continue
    }

    // Bare aliases
    if (MOOD_ALIASES[lower] && !KIND_ALIASES[lower] && !BADGE_ALIASES[lower]) {
      out.moods.add(MOOD_ALIASES[lower]!)
      continue
    }
    if (KIND_ALIASES[lower] && (lower === 'reply' || lower === 'boost' || lower === 'reblog' || lower === 'original')) {
      out.kinds.add(KIND_ALIASES[lower]!)
      continue
    }
    if (BADGE_ALIASES[lower]) {
      const badge = BADGE_ALIASES[lower]!
      // Tapping "bots" after "no bots" should flip to show-only
      out.excludeBadges.delete(badge)
      out.badges.add(badge)
      continue
    }
    if (SORT_ALIASES[lower] && ['near', 'loud', 'new', 'gems', 'shuffle', 'surprise'].includes(lower)) {
      out.sort = SORT_ALIASES[lower]!
      continue
    }

    out.text.push(lower)
  }

  return out
}

export function ballMatchesExplore(
  ball: EdwardBallDescriptor,
  q: EdwardExploreParsed,
): boolean {
  if (!q.raw) return true

  if (q.minAffinity > 0 && ball.affinity < q.minAffinity) return false
  if (q.maxEngagement !== null && ball.engagement > q.maxEngagement) return false
  if (q.sources.size && !q.sources.has(ball.source ?? 'firehose')) return false
  if (q.languages.size && !(ball.language && q.languages.has(ball.language))) return false
  if (q.excludeLanguages.size && ball.language && q.excludeLanguages.has(ball.language)) return false
  if (q.excludeMoods.size && q.excludeMoods.has(ball.mood)) return false
  if (q.threads && !ball.isThread) return false
  if (q.long && !(ball.readMinutes > 0)) return false
  if (q.talk && (ball.counts?.reply ?? 0) < 3) return false

  if (q.moods.size && !q.moods.has(ball.mood)) return false
  if (q.kinds.size && !q.kinds.has(ball.kind)) return false
  if (q.badges.size) {
    for (const b of q.badges) {
      if (!ball.badges.includes(b)) return false
    }
  }
  if (q.excludeBadges.size) {
    for (const b of q.excludeBadges) {
      if (ball.badges.includes(b) || (b === 'bot' && ball.isBot)) return false
    }
  }
  if (q.tags.size) {
    const tag = (ball.topTag || '').toLowerCase()
    let hit = false
    for (const t of q.tags) {
      if (tag === t || ball.preview.toLowerCase().includes(`#${t}`)) {
        hit = true
        break
      }
    }
    if (!hit) return false
  }
  if (q.authors.size) {
    const acct = ball.acct.toLowerCase()
    const key = ball.authorKey.toLowerCase()
    const label = ball.label.toLowerCase()
    let hit = false
    for (const a of q.authors) {
      if (acct.includes(a) || key.includes(a) || label.includes(a)) {
        hit = true
        break
      }
    }
    if (!hit) return false
  }

  if (q.servers.size) {
    const host = (ball.instanceHost || '').toLowerCase().replace(/^www\./, '')
    let hit = false
    for (const s of q.servers) {
      if (host === s || host.endsWith(`.${s}`) || host.includes(s)) {
        hit = true
        break
      }
    }
    if (!hit) return false
  }

  for (const t of q.text) {
    const hay = `${ball.preview} ${ball.label} ${ball.acct} ${ball.topTag || ''} ${ball.mood} ${ball.moodWhy}`.toLowerCase()
    if (!hay.includes(t)) return false
  }

  return true
}

/**
 * Hidden-gem score: substance (length, an original thought, a picture) over
 * attention (engagement). Bots and content-warned posts sink.
 */
export function gemScore(b: EdwardBallDescriptor): number {
  const substance = Math.min(1, b.preview.length / 180)
  const quiet = 1 / (1 + b.engagement)
  let s = substance * 1.2 + quiet
  if (b.kind === 'original') s += 0.25
  if (b.kind === 'boost') s -= 0.3
  if (b.mediaUrl && !b.badges.includes('cw')) s += 0.2
  if (b.isBot) s -= 1.2
  if (b.badges.includes('cw')) s -= 0.3
  if (b.preview.length < 24 && !b.mediaUrl) s -= 0.6
  return s
}

const seededRank = (identity: string, seed: number) => {
  let h = 2166136261 ^ seed
  for (let i = 0; i < identity.length; i++) {
    h ^= identity.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

export function sortEdwardBalls(
  balls: EdwardBallDescriptor[],
  mode: EdwardSortMode,
  shuffleSeed = 0,
): EdwardBallDescriptor[] {
  const list = [...balls]
  switch (mode) {
    case 'gems':
      return list.sort((a, b) => gemScore(b) - gemScore(a))
    case 'shuffle':
      // Stable per seed — the stream re-sorts every poll; a reshuffle is a new seed
      return list.sort((a, b) => seededRank(a.identity, shuffleSeed) - seededRank(b.identity, shuffleSeed))
    case 'near':
      return list.sort((a, b) => b.affinity * 2 + b.size - (a.affinity * 2 + a.size))
    case 'new':
      return list.sort((a, b) => b.createdAt - a.createdAt)
    case 'loud':
      return list.sort((a, b) => b.engagement - a.engagement)
    case 'you':
      return list.sort((a, b) => b.affinity - a.affinity || b.engagement - a.engagement)
    case 'stream':
    default:
      return list
  }
}

export function filterAndSortBalls(
  balls: EdwardBallDescriptor[],
  query: string,
  sortFallback: EdwardSortMode,
  shuffleSeed = 0,
): { balls: EdwardBallDescriptor[]; parsed: EdwardExploreParsed; sort: EdwardSortMode } {
  const parsed = parseEdwardExplore(query)
  const sort = parsed.sort || sortFallback
  const filtered = balls.filter((b) => ballMatchesExplore(b, parsed))
  const sorted = sortEdwardBalls(filtered, sort, shuffleSeed)
  const n = Math.max(1, sorted.length - 1)
  // Stamp rank so the canvas can pull top results closer / bigger
  const ranked = sorted.map((b, i) => ({
    ...b,
    exploreRank: sort === 'stream' ? -1 : i,
    exploreRankNorm: sort === 'stream' ? 0 : 1 - i / n,
  }))
  return {
    balls: ranked,
    parsed,
    sort,
  }
}

export function cycleEdwardSort(current: EdwardSortMode): EdwardSortMode {
  const order = EDWARD_SORT_ORDER
  const i = order.indexOf(current)
  return order[(i + 1) % order.length]!
}

/** Summarize active filters for the HUD crumb */
export function describeEdwardExplore(
  parsed: EdwardExploreParsed,
  sort: EdwardSortMode,
  matched: number,
  total: number,
): string {
  const bits: string[] = []
  if (parsed.moods.size) bits.push([...parsed.moods].join('+'))
  if (parsed.kinds.size) bits.push([...parsed.kinds].join('+'))
  if (parsed.badges.size) bits.push([...parsed.badges].join('+'))
  if (parsed.excludeBadges.size) {
    bits.push([...parsed.excludeBadges].map((b) => `-${b}`).join(' '))
  }
  if (parsed.tags.size) bits.push([...parsed.tags].map((t) => `#${t}`).join(' '))
  if (parsed.authors.size) bits.push([...parsed.authors].map((a) => `@${a}`).join(' '))
  if (parsed.servers.size) bits.push([...parsed.servers].map((s) => `srv:${s}`).join(' '))
  if (parsed.minAffinity > 0) bits.push('you')
  if (parsed.maxEngagement !== null) bits.push('quiet')
  if (parsed.sources.size) bits.push([...parsed.sources].map((s) => `src:${s}`).join(' '))
  if (parsed.languages.size) bits.push([...parsed.languages].map((l) => `lang:${l}`).join(' '))
  if (parsed.excludeLanguages.size) bits.push([...parsed.excludeLanguages].map((l) => `-lang:${l}`).join(' '))
  if (parsed.excludeMoods.size) bits.push([...parsed.excludeMoods].map((m) => `-${m}`).join(' '))
  if (parsed.threads) bits.push('threads')
  if (parsed.long) bits.push('long')
  if (parsed.talk) bits.push('talk')
  if (parsed.text.length) bits.push(`“${parsed.text.join(' ')}”`)
  const filter = bits.length ? bits.join(' · ') : 'all'
  return `${matched}/${total} · ${filter} · ${EDWARD_SORT_LABELS[sort]}`
}
