/**
 * Search query understanding for Explore — intent detection, Mastodon post
 * operators, match highlighting, and curated-server ranking.
 */

import type { CuratedInstance } from '~/composables/useCuratedInstances'
import { formatCompact } from '~/utils/insights'

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
/** Scheme-less share-sheet link: `host.tld/path` (the path is what makes it a link) */
const BARE_URL_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S+$/i
/**
 * File / language extensions that look like a TLD but are never a fediverse server
 * ("node.js", "vue.js", "config.json", "main.ts") — those are searches, not hosts.
 */
const NOT_A_TLD = /\.(?:js|jsx|ts|tsx|mjs|cjs|json|css|scss|html|htm|php|java|vue|txt|yml|yaml|toml|exe|zip|pdf|png|jpe?g|gif|svg|mp3|mp4|docx?|csv|xml)$/i
/** A bare word Mastodon would accept as a hashtag (tag-timeline fallback) */
const TAG_WORD_RE = /^[\p{L}][\p{L}\p{N}_]*$/u

/** What the person typed, so each tab can answer it the right way */
export function detectIntent(raw: string): SearchIntent {
  const q = raw.trim()
  if (URL_RE.test(q)) return { kind: 'url', url: q }
  // "mastodon.social/@user/1234" pasted from a mobile share sheet
  if (BARE_URL_RE.test(q) && !NOT_A_TLD.test(q.split('/')[0]!)) return { kind: 'url', url: `https://${q}` }
  const remote = q.match(REMOTE_HANDLE_RE)
  if (remote) return { kind: 'handle', acct: `${remote[1]}@${remote[2]!.toLowerCase()}`, remote: true }
  const local = q.match(LOCAL_HANDLE_RE)
  if (local) return { kind: 'handle', acct: local[1]!, remote: false }
  const tag = q.match(TAG_RE)
  if (tag) return { kind: 'tag', tag: tag[1]! }
  if (HOST_RE.test(q) && !NOT_A_TLD.test(q)) return { kind: 'host', host: q.toLowerCase() }
  return { kind: 'text' }
}

/** The text to send to server search: scheme-less links get `https://` so they resolve */
export function resolvableQuery(raw: string): string {
  const intent = detectIntent(raw)
  return intent.kind === 'url' ? intent.url : raw
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

/** Local calendar date for Mastodon `after:` (exclusive — use day before the window). */
export function localIsoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function afterDateForSince(since: Exclude<PostSince, ''>, now = new Date()): string {
  // Mastodon `after:` is exclusive by date — subtract one extra day for the window length
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - (SINCE_DAYS[since] + 1))
  return localIsoDay(d)
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
    ops.push(`after:${afterDateForSince(f.since, now)}`)
  }
  return [q.trim(), ...ops].filter(Boolean).join(' ')
}

/** Tappable operator examples for the Posts tab — dates computed fresh per call */
export function postOperatorTips(now = new Date(), languageCode = 'en'): { insert: string; label: string }[] {
  const lang = languageCode.trim() || 'en'
  return [
    { insert: 'from:me', label: 'Your posts' },
    { insert: 'has:media', label: 'With media' },
    { insert: 'has:poll', label: 'Polls' },
    { insert: '-is:reply', label: 'No replies' },
    { insert: `language:${lang}`, label: `In ${lang}` },
    { insert: `after:${afterDateForSince('week', now)}`, label: 'Past week' },
  ]
}

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

export function formatCount(n: number | undefined | null): string {
  return formatCompact(Number(n) || 0)
}

const pluralRules = new Intl.PluralRules(undefined)

/** "1 post" / "1.2K posts" — compact number plus the right singular/plural noun. */
export function formatCountLabel(n: number | undefined | null, one: string, other = `${one}s`): string {
  const value = Number(n) || 0
  return `${formatCompact(value)} ${pluralRules.select(value) === 'one' ? one : other}`
}

/** Mastodon search wants 2+ ASCII chars; a single CJK (etc.) character is enough. */
export function searchQueryTooShort(raw: string): boolean {
  const q = raw.trim()
  if (q.length >= 2) return false
  if (!q.length) return true
  return !/[^\u0000-\u007F]/.test(q)
}
