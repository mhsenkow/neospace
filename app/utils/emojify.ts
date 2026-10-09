/**
 * Custom emoji: escape untrusted text, then replace :shortcode: with
 * <img> tags using only URLs from the provided emoji list.
 */

export type EmojiInput = {
  shortcode: string
  url: string
  staticUrl?: string | null
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * @param text - Plain text (default) or already-sanitized HTML
 * @param emojis - Allowlisted custom emoji from the status/account
 * @param opts.escape - Escape HTML first (default true). Pass false for sanitized status HTML.
 */
export function emojify(
  text: string,
  emojis: EmojiInput[] | null | undefined,
  opts?: { escape?: boolean },
): string {
  if (!text) return ''
  const shouldEscape = opts?.escape !== false
  let out = shouldEscape ? escapeHtml(text) : text
  if (!emojis?.length) return out

  const byCode = new Map<string, string>()
  for (const e of emojis) {
    const code = e?.shortcode?.trim()
    const url = e?.url?.trim()
    if (!code || !url || !isHttpUrl(url)) continue
    byCode.set(code.toLowerCase(), url)
  }
  if (!byCode.size) return out

  // Skip whole tags (quote-aware) so `:code:` inside an attribute — e.g. a link
  // href in sanitized status HTML — can't have an <img> spliced into it.
  return out.replace(/(<(?:[^>"']|"[^"]*"|'[^']*')*>)|:([a-zA-Z0-9_]+):/g, (match, tag?: string, code?: string) => {
    if (tag || !code) return match
    const url = byCode.get(code.toLowerCase())
    if (!url) return match
    const safeSrc = escapeHtml(url)
    const alt = escapeHtml(`:${code}:`)
    return `<img class="emoji" src="${safeSrc}" alt="${alt}" title="${alt}" draggable="false" loading="lazy" decoding="async" />`
  })
}

/** Collect http(s) emoji URLs for sanitizer allowlists */
export function emojiUrlSet(emojis: EmojiInput[] | null | undefined): Set<string> {
  const urls = new Set<string>()
  if (!emojis?.length) return urls
  for (const e of emojis) {
    if (e?.url && isHttpUrl(e.url)) urls.add(e.url)
    if (e?.staticUrl && isHttpUrl(e.staticUrl)) urls.add(e.staticUrl)
  }
  return urls
}
