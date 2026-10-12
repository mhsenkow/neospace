/**
 * Does one of the user's server-side (v2) filters hide a hashtag?
 *
 * Honors what the filter says: expired filters don't apply, filters that don't
 * cover public views don't hide discovery, and `wholeWord` keywords match whole
 * tokens ("ai" hides #ai and #AI_art but not #rain or #taiwan).
 */

type FilterLike = {
  context?: string[] | null
  expiresAt?: string | null
  keywords?: { keyword?: string | null; wholeWord?: boolean | null }[] | null
}

/** Lowercased tokens of a tag: `_` and camelCase boundaries, plus the whole tag */
function tagTokens(name: string): string[] {
  const tokens = name.split(/[_\s]+/).flatMap((p) => p.split(/(?<=[a-z])(?=[A-Z])/))
  return [name.toLowerCase(), ...tokens.map((t) => t.toLowerCase()).filter(Boolean)]
}

export function tagIsFiltered(name: string, filters: FilterLike[] | null | undefined, now = Date.now()): boolean {
  if (!name || !filters?.length) return false
  const key = name.toLowerCase()
  const tokens = tagTokens(name)
  for (const f of filters) {
    if (f.expiresAt) {
      const t = Date.parse(f.expiresAt)
      if (Number.isFinite(t) && t <= now) continue
    }
    // Trending tags are a public surface
    if (f.context?.length && !f.context.includes('public')) continue
    for (const k of f.keywords || []) {
      const kw = (k.keyword || '').toLowerCase().trim().replace(/^#/, '')
      if (!kw) continue
      if (k.wholeWord ? tokens.includes(kw) : key.includes(kw)) return true
    }
  }
  return false
}
