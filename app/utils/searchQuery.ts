/**
 * Search query understanding for Explore — intent detection, Mastodon post
 * operators, match highlighting, and curated-server ranking.
 */

import type { CuratedInstance } from '~/composables/useCuratedInstances'

export type SearchIntent =
  | { kind: 'url'; url: string }
  | { kind: 'handle'; acct: string; remote: boolean }
  | { kind: 'tag'; tag: string }
  | { kind: 'host'; host: string }
  | { kind: 'text' }

const URL_RE = /^https?:\/\/\S+$/i
const REMOTE_HANDLE_RE = /^@?([\w.-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})$/i
const LOCAL_HANDLE_RE = /^@([\w.]+)$/
const TAG_RE = /^#([\p{L}\p{N}_]+)$/u
const HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i
/** A bare word Mastodon would accept as a hashtag (tag-timeline fallback) */
const TAG_WORD_RE = /^[\p{L}][\p{L}\p{N}_]*$/u

/** What the person typed, so each tab can answer it the right way */
export function detectIntent(raw: string): SearchIntent {
  const q = raw.trim()
  if (URL_RE.test(q)) return { kind: 'url', url: q }
  const remote = q.match(REMOTE_HANDLE_RE)
  if (remote) return { kind: 'handle', acct: `${remote[1]}@${remote[2]!.toLowerCase()}`, remote: true }
  const local = q.match(LOCAL_HANDLE_RE)
  if (local) return { kind: 'handle', acct: local[1]!, remote: false }
  const tag = q.match(TAG_RE)
  if (tag) return { kind: 'tag', tag: tag[1]! }
  if (HOST_RE.test(q)) return { kind: 'host', host: q.toLowerCase() }
  return { kind: 'text' }
}

/** Tag a query could browse as a timeline: `#linux` or a single word `linux` */
export function tagFromQuery(raw: string): string | null {
  const q = raw.trim()
  const intent = detectIntent(q)
  if (intent.kind === 'tag') return intent.tag
  return TAG_WORD_RE.test(q) && q.length <= 64 ? q : null
}

// ── Post operators (Mastodon 4.2+ full-text search) ─────────────────────────

const OPERATOR_RE = /(^|\s)-?(from|has|is|language|before|after|during|in):\S+/i

export function hasPostOperators(q: string): boolean {
  return OPERATOR_RE.test(q)
}

export type PostSince = '' | 'day' | 'week' | 'month' | 'year'

export interface PostFilters {
  fromMe: boolean
  media: boolean
  poll: boolean
  links: boolean
  noReplies: boolean
  since: PostSince
}

export const emptyPostFilters = (): PostFilters => ({
  fromMe: false,
  media: false,
  poll: false,
  links: false,
  noReplies: false,
  since: '',
})

export function activePostFilterCount(f: PostFilters): number {
  return [f.fromMe, f.media, f.poll, f.links, f.noReplies, !!f.since].filter(Boolean).length
}

const SINCE_DAYS: Record<Exclude<PostSince, ''>, number> = { day: 1, week: 7, month: 31, year: 365 }

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** Fold filter chips into Mastodon operators, skipping ones already typed */
export function buildPostQuery(q: string, f: PostFilters, now = new Date()): string {
  const has = (re: RegExp) => re.test(q)
  const ops: string[] = []
  if (f.fromMe && !has(/(^|\s)from:/i)) ops.push('from:me')
  if (f.media && !has(/(^|\s)has:media/i)) ops.push('has:media')
  if (f.poll && !has(/(^|\s)has:poll/i)) ops.push('has:poll')
  if (f.links && !has(/(^|\s)has:link/i)) ops.push('has:link')
  if (f.noReplies && !has(/(^|\s)-?is:reply/i)) ops.push('-is:reply')
  if (f.since && !has(/(^|\s)(after|during):/i)) {
    const d = new Date(now.getTime() - SINCE_DAYS[f.since] * 86_400_000)
    ops.push(`after:${isoDay(d)}`)
  }
  return [q.trim(), ...ops].filter(Boolean).join(' ')
}

/** Tappable operator examples for the Posts tab */
export const POST_OPERATOR_TIPS: { insert: string; label: string }[] = [
  { insert: 'from:me', label: 'Your posts' },
  { insert: 'has:media', label: 'With media' },
  { insert: 'has:poll', label: 'Polls' },
  { insert: '-is:reply', label: 'No replies' },
  { insert: 'language:en', label: 'In English' },
  { insert: `after:${isoDay(new Date(Date.now() - 7 * 86_400_000))}`, label: 'Past week' },
]

// ── Highlighting ───────────────────────────────────────────────────────────

export type HighlightPart = { text: string; hit: boolean }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Words worth highlighting: drop operators, sigils, and 1-letter noise */
export function highlightTerms(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter((w) => !OPERATOR_RE.test(` ${w}`))
    .map((w) => w.replace(/^[@#]/, '').replace(/@.*$/, ''))
    .filter((w) => w.length >= 2)
}

export function splitHighlight(text: string, terms: string[]): HighlightPart[] {
  if (!text || !terms.length) return [{ text, hit: false }]
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi')
  const out: HighlightPart[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: text.slice(last, i), hit: false })
    out.push({ text: m[0], hit: true })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out.length ? out : [{ text, hit: false }]
}

// ── Curated servers ────────────────────────────────────────────────────────

/**
 * Rank curated servers: every word must match somewhere; domain/name hits beat
 * tag hits beat description hits.
 */
export function rankServers(list: CuratedInstance[], raw: string): CuratedInstance[] {
  const words = raw.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return list
  const scored: { inst: CuratedInstance; score: number }[] = []
  for (const inst of list) {
    const domain = inst.domain.toLowerCase()
    const name = inst.name.toLowerCase()
    const tags = (inst.tags || []).map((t) => t.toLowerCase())
    const blurb = `${inst.vibe} ${inst.blurb} ${inst.category}`.toLowerCase()
    const desc = inst.description.toLowerCase()
    let score = 0
    let all = true
    for (const w of words) {
      let s = 0
      if (domain === w || name === w) s = 100
      else if (domain.startsWith(w) || name.startsWith(w)) s = 60
      else if (domain.includes(w) || name.includes(w)) s = 40
      else if (tags.includes(w)) s = 35
      else if (tags.some((t) => t.startsWith(w))) s = 25
      else if (blurb.includes(w)) s = 15
      else if (desc.includes(w)) s = 8
      if (!s) {
        all = false
        break
      }
      score += s
    }
    if (all) scored.push({ inst, score: score + (inst.featured ? 3 : 0) })
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.inst)
}

// ── Formatting ─────────────────────────────────────────────────────────────

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

export function formatCount(n: number | undefined | null): string {
  return compactNumber.format(Number(n) || 0)
}
