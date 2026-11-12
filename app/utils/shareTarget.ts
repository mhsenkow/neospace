/**
 * OS share sheet → New thread.
 * The PWA manifest's share_target (GET) lands on `/?compose=share&title&text&url`.
 * Home-screen shortcuts use `/?compose=1`. Thread pages own `?compose=1` themselves
 * (peek → full thread draft handoff).
 */

const SHARE_TEXT_MAX = 5000

function firstQuery(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

function cleanLine(raw: string, max = 2000): string {
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max)
}

/** Keep only http(s) links — share sheets can hand us anything. */
function httpUrl(raw: string): string {
  const url = cleanLine(raw, 2000)
  if (!/^https?:\/\//i.test(url)) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

/** Title, body, and link as one composer draft. Skips pieces already inside the body. */
export function composeShareText(input: { title?: string; text?: string; url?: string }): string {
  const title = cleanLine(input.title || '')
  const text = cleanLine(input.text || '', SHARE_TEXT_MAX)
  const url = httpUrl(input.url || '')
  const lines: string[] = []
  if (title && !text.toLowerCase().includes(title.toLowerCase())) lines.push(title)
  if (text) lines.push(text)
  const haystack = `${title}\n${text}`
  if (url && !haystack.includes(url)) lines.push(url)
  return lines.join('\n\n').slice(0, SHARE_TEXT_MAX)
}

export type ShareTargetIntent = { text: string }

/**
 * `null` when this navigation isn't a share/shortcut compose, or when the
 * status page should keep `?compose=1` for its own draft handoff.
 */
export function shareTargetIntent(path: string, query: Record<string, unknown>): ShareTargetIntent | null {
  const compose = firstQuery(query.compose)
  if (compose === '1') {
    if (path.startsWith('/status/')) return null
    return { text: '' }
  }
  if (compose !== 'share') return null
  return {
    text: composeShareText({
      title: firstQuery(query.title),
      text: firstQuery(query.text),
      url: firstQuery(query.url),
    }),
  }
}

const STASH_KEY = 'neospace_share_target_v1'

export function writeShareStash(text: string) {
  try {
    if (!text || typeof sessionStorage === 'undefined') return
    sessionStorage.setItem(STASH_KEY, text)
  } catch {
    /* private mode */
  }
}

/** Read-and-clear. Empty string is a stored value; null means nothing stashed. */
export function takeShareStash(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw = sessionStorage.getItem(STASH_KEY)
    if (raw == null) return null
    sessionStorage.removeItem(STASH_KEY)
    return raw
  } catch {
    return null
  }
}
