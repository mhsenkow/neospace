import type { mastodon } from 'masto'

/** Mastodon hashtag rules — Unicode letters, numbers, underscores; at least one non-digit. */
export const HASHTAG_RE = /^[\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*$/u

export function normalizeHashtagInput(raw: string): string {
  return raw.trim().replace(/^#/, '')
}

/** Mastodon-style tag identity: NFKC, lowercased, Latin accents folded (café ≡ cafe). */
export function tagKey(raw: string): string {
  const clean = normalizeHashtagInput(raw)
  return clean
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

export function isValidHashtag(tag: string): boolean {
  const clean = normalizeHashtagInput(tag)
  if (!clean || clean.length > 64) return false
  return HASHTAG_RE.test(clean)
}

export function tagHistorySummary(tag: mastodon.v1.Tag): string {
  const history = tag.history || []
  const nf = new Intl.NumberFormat(undefined)
  const people = history.reduce(
    (sum, day) => sum + Number((day as { accounts?: string | number }).accounts || 0),
    0,
  )
  const uses7d = history.reduce((sum, day) => sum + Number(day.uses || 0), 0)
  const parts: string[] = []
  if (people > 0) {
    parts.push(`${nf.format(people)} accounts (daily sum)`)
  }
  if (uses7d > 0) {
    parts.push(`${nf.format(uses7d)} ${uses7d === 1 ? 'post' : 'posts'} · last 7d`)
  } else if (history.length) parts.push('last 7d')
  return parts.join(' · ')
}
