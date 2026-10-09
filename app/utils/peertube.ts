/**
 * PeerTube watch → embed URL helpers (decentralized hosts; path-based detect).
 */

/** Directory of public instances / how to join */
export const PEERTUBE_JOIN_URL = 'https://joinpeertube.org/'

const ID = '[^/?#]+'

/** Build a same-origin PeerTube iframe src from a watch / short / embed URL. */
export function peerTubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    const path = u.pathname.replace(/\/+$/, '') || '/'

    let m = path.match(new RegExp(`^/videos/embed/(${ID})$`, 'i'))
    if (m) return `${u.origin}/videos/embed/${m[1]}`

    m = path.match(new RegExp(`^/videos/watch/(${ID})$`, 'i'))
    if (m) return `${u.origin}/videos/embed/${m[1]}`

    // Short video link — not /w/p/ (playlist)
    m = path.match(new RegExp(`^/w/(${ID})$`, 'i'))
    if (m && m[1]!.toLowerCase() !== 'p') return `${u.origin}/videos/embed/${m[1]}`

    m = path.match(new RegExp(`^/w/p/(${ID})$`, 'i'))
    if (m) return `${u.origin}/video-playlists/embed/${m[1]}`

    m = path.match(new RegExp(`^/video-playlists/(?:watch|embed)/(${ID})$`, 'i'))
    if (m) return `${u.origin}/video-playlists/embed/${m[1]}`

    return null
  } catch {
    return null
  }
}

export function isPeerTubeProvider(name?: string | null): boolean {
  return !!name && /peertube/i.test(name)
}

/** Pull https iframe src from Mastodon preview-card HTML (never trust other schemes). */
export function extractHttpsIframeSrc(html: string | null | undefined): string | null {
  if (!html) return null
  const m = html.match(/\bsrc\s*=\s*["'](https:\/\/[^"']+)["']/i)
  if (!m?.[1]) return null
  try {
    const u = new URL(m[1])
    return u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

type CardLike = {
  url: string
  type?: string | null
  html?: string | null
  embedUrl?: string | null
  providerName?: string | null
}

/** Resolve a PeerTube-only embed URL from a Mastodon preview card. */
export function resolvePeerTubeEmbed(card: CardLike): string | null {
  const fromUrl = peerTubeEmbedUrl(card.url)
  if (fromUrl) return fromUrl

  if (card.embedUrl) {
    const fromEmbed = peerTubeEmbedUrl(card.embedUrl)
    if (fromEmbed) return fromEmbed
  }

  if (isPeerTubeProvider(card.providerName) || card.type === 'video') {
    const fromHtml = extractHttpsIframeSrc(card.html)
    if (fromHtml) {
      const normalized = peerTubeEmbedUrl(fromHtml)
      if (normalized) return normalized
      if (isPeerTubeProvider(card.providerName)) return fromHtml
    }
  }

  return null
}
