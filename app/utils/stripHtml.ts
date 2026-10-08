const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Decode HTML entities and strip tags via DOMParser (browser only). */
export function stripHtml(html: string): string {
  if (!html) return ''
  // Plain text (most display names, many previews) — skip a DOM parse
  if (!html.includes('<') && !html.includes('&')) return collapse(html)
  if (typeof DOMParser === 'undefined') {
    return collapse(html.replace(/<[^>]*>/g, ' '))
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return collapse(doc.body.textContent || '')
  } catch {
    return collapse(html.replace(/<[^>]*>/g, ' '))
  }
}

let segmenter: Intl.Segmenter | null = null

/** First N grapheme clusters — avoids splitting emoji surrogates. */
export function clipGraphemes(text: string, max: number): string {
  if (!text || max <= 0) return ''
  if (text.length <= max) return text
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    let count = 0
    let out = ''
    for (const part of segmenter.segment(text)) {
      if (count >= max) break
      out += part.segment
      count++
    }
    return count >= max && out.length < text.length ? `${out}…` : out
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}
