/** Decode HTML entities and strip tags via DOMParser (browser only). */
export function stripHtml(html: string): string {
  if (!html) return ''
  if (typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

/** First N grapheme clusters — avoids splitting emoji surrogates. */
export function clipGraphemes(text: string, max: number): string {
  if (!text || max <= 0) return ''
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    let count = 0
    let out = ''
    for (const part of seg.segment(text)) {
      if (count >= max) break
      out += part.segment
      count++
    }
    return count >= max && out.length < text.length ? `${out}…` : out
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}
