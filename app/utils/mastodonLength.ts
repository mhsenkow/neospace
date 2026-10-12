/**
 * Mastodon-style character counting for compose.
 * URLs count as 23 (or the server's reserved weight); remote mentions count as
 * @local; rest by grapheme.
 */

/** Mastodon's default characters reserved per URL */
export const DEFAULT_URL_WEIGHT = 23

const MENTION_RE =
  /^@[a-zA-Z0-9_]+(?:@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)?/

/** Built once — this runs on every keystroke, several times per call */
let segmenter: Intl.Segmenter | null | undefined

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    try {
      segmenter =
        typeof Intl !== 'undefined' && 'Segmenter' in Intl
          ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
          : null
    } catch {
      segmenter = null
    }
  }
  return segmenter
}

function graphemeLength(str: string): number {
  if (!str) return 0
  try {
    const seg = getSegmenter()
    if (seg) {
      let n = 0
      for (const _ of seg.segment(str)) n += 1
      return n
    }
  } catch {
    // fall through
  }
  return [...str].length
}

function mentionWeight(token: string): number {
  // @user@domain → count as @user; @user → full token
  const parts = token.split('@')
  const local = parts[1] || ''
  return graphemeLength(`@${local}`)
}

/** Read an http(s) URL allowing balanced parentheses in the path (twitter-text style). */
function readHttpUrl(text: string, from: number): string | null {
  if (!text.startsWith('http://', from) && !text.startsWith('https://', from)) return null
  let i = from + (text.startsWith('https://', from) ? 8 : 7)
  let depth = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === '(') depth++
    else if (c === ')') {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && /[\s<>"']/.test(c)) break
    i++
  }
  return text.slice(from, i)
}

function nextSpecialIndex(text: string, from: number): number {
  let next = text.length
  for (let i = from; i < text.length; i++) {
    if (text[i] === '@') return i
    if (text.startsWith('http://', i) || text.startsWith('https://', i)) return i
  }
  return next
}

/**
 * @param opts.urlWeight - Characters each URL costs. Defaults to Mastodon's 23; pass
 *   `null` for servers that count URLs in full (GoToSocial, Akkoma/Pleroma).
 */
export function mastodonLength(text: string, opts?: { urlWeight?: number | null }): number {
  if (!text) return 0
  const urlWeight = opts?.urlWeight === undefined ? DEFAULT_URL_WEIGHT : opts.urlWeight

  let count = 0
  let i = 0
  while (i < text.length) {
    const url = readHttpUrl(text, i)
    if (url) {
      let token = url.replace(/[.,:;!?]+$/, '')
      count += urlWeight === null ? graphemeLength(token) : urlWeight
      i += token.length
      continue
    }

    const rest = text.slice(i)
    const mention = MENTION_RE.exec(rest)
    if (mention && mention.index === 0) {
      count += mentionWeight(mention[0])
      i += mention[0].length
      continue
    }

    const next = nextSpecialIndex(text, i)
    if (next > i) {
      count += graphemeLength(text.slice(i, next))
      i = next
    } else {
      count += graphemeLength(text[i]!)
      i += 1
    }
  }
  return count
}
