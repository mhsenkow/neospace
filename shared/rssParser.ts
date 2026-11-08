/**
 * Lightweight RSS 2.0 / Atom / RDF parser for Cloudflare Workers (no DOMParser).
 * Shared by `functions/api/rss.ts` and unit tests.
 */

export type RssItem = {
  id: string
  title: string
  url: string
  summaryHtml: string
  authorName: string
  authorHandle: string
  publishedAt: string
  imageUrl: string | null
  feedTitle: string
  siteUrl: string
}

export type ParsedRssFeed = {
  title: string
  siteUrl: string
  items: RssItem[]
}

const MAX_ITEMS = 40
const MAX_SUMMARY = 2_000
const MAX_TITLE = 280

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16)
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : ''
    })
    .replace(/&amp;/g, '&')
}

function stripTags(html: string): string {
  return decodeXmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstTag(block: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(
      `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
      'i',
    )
    const m = block.match(re)
    if (m?.[1] != null) return decodeXmlEntities(m[1].trim())
    // Self-closing / attribute-only (Atom link)
    const attrRe = new RegExp(`<${name}\\s+([^>]+?)\\s*/?>`, 'i')
    const am = block.match(attrRe)
    if (am?.[1]) {
      const href = am[1].match(/\b(?:href|url)=["']([^"']+)["']/i)
      if (href?.[1]) return decodeXmlEntities(href[1].trim())
    }
  }
  return ''
}

function atomLink(block: string, relPrefer = 'alternate'): string {
  const re = /<link\s+([^>]+?)\/?>/gi
  let m: RegExpExecArray | null
  let fallback = ''
  while ((m = re.exec(block))) {
    const attrs = m[1] || ''
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    const rel = attrs.match(/\brel=["']([^"']+)["']/i)?.[1] || 'alternate'
    if (rel === relPrefer) return decodeXmlEntities(href.trim())
    if (!fallback && (rel === 'alternate' || rel === 'self' || !attrs.includes('rel='))) {
      fallback = decodeXmlEntities(href.trim())
    }
  }
  return fallback
}

function enclosureImage(block: string): string | null {
  const media = block.match(
    /<media:content\s+([^>]+?)\/?>/i,
  ) || block.match(/<media:thumbnail\s+([^>]+?)\/?>/i)
  if (media?.[1]) {
    const url = media[1].match(/\burl=["']([^"']+)["']/i)?.[1]
    const type = media[1].match(/\btype=["']([^"']+)["']/i)?.[1] || ''
    if (url && (!type || type.startsWith('image/'))) return decodeXmlEntities(url)
  }
  const enc = block.match(/<enclosure\s+([^>]+?)\/?>/i)
  if (enc?.[1]) {
    const url = enc[1].match(/\burl=["']([^"']+)["']/i)?.[1]
    const type = enc[1].match(/\btype=["']([^"']+)["']/i)?.[1] || ''
    if (url && type.startsWith('image/')) return decodeXmlEntities(url)
  }
  // First <img src> inside description/content
  const img = block.match(/<img[^>]+src=["']([^"']+)["']/i)
  return img?.[1] ? decodeXmlEntities(img[1]) : null
}

function collectBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) && out.length < MAX_ITEMS + 2) {
    if (m[1]) out.push(m[1])
  }
  return out
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeDate(raw: string): string {
  if (!raw) return new Date().toISOString()
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function summarize(raw: string): string {
  const decoded = decodeXmlEntities(raw).trim()
  if (!decoded) return ''
  // Keep a little HTML if it already looks like markup; otherwise escape as text
  if (/<[a-z][\s\S]*>/i.test(decoded)) {
    return decoded.slice(0, MAX_SUMMARY)
  }
  const text = stripTags(decoded).slice(0, MAX_SUMMARY)
  return text ? `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : ''
}

/**
 * Parse an RSS 2.0, Atom, or RDF feed document into normalized items.
 */
export function parseRssXml(xml: string, sourceUrl: string): ParsedRssFeed {
  const cleaned = xml.replace(/^\uFEFF/, '').trim()
  if (!cleaned) {
    return { title: hostOf(sourceUrl) || 'Feed', siteUrl: sourceUrl, items: [] }
  }

  const channel =
    cleaned.match(/<channel(?:\s[^>]*)?>([\s\S]*?)<item[\s>]/i)?.[1] ||
    cleaned.match(/<feed(?:\s[^>]*)?>([\s\S]*?)<entry[\s>]/i)?.[1] ||
    ''

  const feedTitle =
    firstTag(channel || cleaned, ['title']).slice(0, MAX_TITLE) ||
    hostOf(sourceUrl) ||
    'Feed'
  const siteUrl =
    atomLink(channel || cleaned, 'alternate') ||
    firstTag(channel || cleaned, ['link', 'atom:link']) ||
    sourceUrl

  const isAtom = /<feed[\s>]/i.test(cleaned) || /<entry[\s>]/i.test(cleaned)
  const blocks = isAtom ? collectBlocks(cleaned, 'entry') : collectBlocks(cleaned, 'item')

  const items: RssItem[] = []
  for (const block of blocks) {
    if (items.length >= MAX_ITEMS) break
    const title = firstTag(block, ['title']).slice(0, MAX_TITLE) || 'Untitled'
    const url =
      atomLink(block, 'alternate') ||
      firstTag(block, ['link', 'atom:link', 'guid', 'id']) ||
      ''
    if (!url && !title) continue
    const summaryRaw =
      firstTag(block, [
        'content:encoded',
        'content',
        'description',
        'summary',
        'media:description',
      ]) || ''
    const authorRaw =
      firstTag(block, ['dc:creator', 'creator', 'itunes:author']) ||
      firstTag(firstTag(block, ['author']) || '', ['name']) ||
      firstTag(block, ['author', 'name']) ||
      ''
    const authorName = stripTags(authorRaw).slice(0, 120) || feedTitle
    const publishedAt = normalizeDate(
      firstTag(block, ['pubDate', 'published', 'updated', 'dc:date', 'date']),
    )
    const id =
      firstTag(block, ['guid', 'id']) ||
      url ||
      `${title}|${publishedAt}`
    const host = hostOf(url || siteUrl || sourceUrl)
    items.push({
      id: id.slice(0, 400),
      title,
      url: (url || siteUrl || sourceUrl).slice(0, 2_000),
      summaryHtml: summarize(summaryRaw),
      authorName,
      authorHandle: host ? `${authorName.replace(/\s+/g, '').slice(0, 32) || 'feed'}@${host}` : authorName.slice(0, 64),
      publishedAt,
      imageUrl: enclosureImage(block),
      feedTitle,
      siteUrl: siteUrl.slice(0, 2_000),
    })
  }

  return { title: feedTitle, siteUrl: siteUrl.slice(0, 2_000), items }
}

/** Hostnames / IP literals that must never be fetched (SSRF). */
export function isBlockedRssHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    host.endsWith('.corp')
  ) {
    return true
  }

  // IPv4 literals
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const parts = v4.slice(1).map(Number)
    if (parts.some((n) => n > 255)) return true
    const [a, b] = parts
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b! >= 16 && b! <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b! >= 64 && b! <= 127) return true // CGNAT
    return false
  }

  // IPv6 (with or without brackets)
  const v6 = host.replace(/^\[|\]$/g, '')
  if (v6.includes(':')) {
    const h = v6.toLowerCase()
    if (h === '::1' || h === '::') return true
    if (h.startsWith('fc') || h.startsWith('fd')) return true // ULA
    if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
      return true // link-local
    }
    if (h.startsWith('::ffff:')) {
      // IPv4-mapped — re-check the embedded v4
      const mapped = h.slice('::ffff:'.length)
      return isBlockedRssHost(mapped)
    }
    return false
  }

  return false
}

/**
 * Validate a user-supplied feed URL before fetching.
 * Returns a normalized absolute URL string, or null if rejected.
 */
export function sanitizeRssFetchUrl(raw: string): string | null {
  const trimmed = raw.trim().slice(0, 2_000)
  if (!trimmed) return null
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password) return null
  if (isBlockedRssHost(u.hostname)) return null
  // Drop hash; keep query (many feeds need it)
  u.hash = ''
  return u.toString()
}
