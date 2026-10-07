import type { mastodon } from 'masto'

/** Mastodon hashtag rules — letters, numbers, underscores; no leading digits-only junk. */
const HASHTAG_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/

export function normalizeHashtagInput(raw: string): string {
  return raw.trim().replace(/^#/, '')
}

export function isValidHashtag(tag: string): boolean {
  const clean = normalizeHashtagInput(tag)
  if (!clean || clean.length > 64) return false
  return HASHTAG_RE.test(clean)
}

export function tagHistorySummary(tag: mastodon.v1.Tag): string {
  const history = tag.history || []
  const people = history.reduce(
    (sum, day) => sum + Number((day as { accounts?: string | number }).accounts || 0),
    0,
  )
  const uses7d = history.reduce((sum, day) => sum + Number(day.uses || 0), 0)
  const parts: string[] = []
  if (people > 0) parts.push(`${people} ${people === 1 ? 'person' : 'people'}`)
  if (uses7d > 0) parts.push(`${uses7d} posts · last 7d`)
  else if (history.length) parts.push('last 7d')
  return parts.join(' · ')
}
