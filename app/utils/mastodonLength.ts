/**
 * Mastodon-style character counting for compose.
 * URLs count as 23; remote mentions count as @local; rest by grapheme.
 */

const URL_WEIGHT = 23

/** http(s) URLs, or @user / @user@domain mentions (URL alternative first). */
const TOKEN_RE =
  /https?:\/\/[^\s<>"'()]+|@[a-zA-Z0-9_]+(?:@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)?/g

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

export function mastodonLength(text: string): number {
  if (!text) return 0

  let count = 0
  let last = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) {
      count += graphemeLength(text.slice(last, m.index))
    }
    let token = m[0]
    if (token.startsWith('http')) {
      // Sentence punctuation after a link isn't part of it ("see https://x.co.")
      token = token.replace(/[.,:;!?]+$/, '')
      count += URL_WEIGHT
    } else {
      count += mentionWeight(token)
    }
    last = m.index + token.length
    TOKEN_RE.lastIndex = last
  }
  if (last < text.length) {
    count += graphemeLength(text.slice(last))
  }
  return count
}
