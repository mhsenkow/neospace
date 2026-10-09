/**
 * Cross-network presence links on a Mastodon profile.
 * Stored as regular metadata fields so others can see them too.
 */

import { stripHtml } from '~/utils/stripHtml'

export type PresenceKind = 'mastodon' | 'bluesky' | 'seenu' | 'website'

export type PresenceLink = {
  kind: PresenceKind
  label: string
  href: string
  /** Short handle/host shown in tooltips */
  hint: string
}

const SOURCE_LABELS: Record<Exclude<PresenceKind, 'mastodon'>, string> = {
  bluesky: 'Bluesky',
  seenu: 'SeenU',
  website: 'Website',
}

const FIELD_ALIASES: Record<Exclude<PresenceKind, 'mastodon'>, string[]> = {
  bluesky: ['bluesky', 'bsky', 'blueskyapp'],
  seenu: ['seenu', 'seenuio'],
  website: ['website', 'web', 'homepage', 'url', 'site'],
}

export function normalizeFieldKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function decodeHtmlEntities(url: string): string {
  return url
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function extractHttpUrl(raw: string): string | null {
  const plain = stripHtml(raw || '')
  const hrefMatch = raw?.match(/href=["'](https?:\/\/[^"']+)["']/i)
  if (hrefMatch?.[1]) return decodeHtmlEntities(hrefMatch[1])
  const bare = plain.match(/https?:\/\/[^\s<>"']+/i)
  return bare?.[0] ? decodeHtmlEntities(bare[0]) : null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export function kindFromUrl(url: string): Exclude<PresenceKind, 'mastodon'> | null {
  const host = hostOf(url)
  if (!host) return null
  if (host === 'bsky.app' || host.endsWith('.bsky.social') || host === 'bsky.social') return 'bluesky'
  if (host === 'seenu.io' || host.endsWith('.seenu.io')) return 'seenu'
  return 'website'
}

export function kindFromFieldName(name: string): Exclude<PresenceKind, 'mastodon'> | null {
  const key = normalizeFieldKey(name)
  for (const [kind, aliases] of Object.entries(FIELD_ALIASES) as [
    Exclude<PresenceKind, 'mastodon'>,
    string[],
  ][]) {
    if (aliases.includes(key)) return kind
  }
  return null
}

/** Turn a handle or URL into a canonical profile URL for a network. */
export function normalizePresenceInput(
  kind: Exclude<PresenceKind, 'mastodon'>,
  raw: string,
): string {
  const value = raw.trim()
  if (!value) return ''
  if (/^(javascript|data|vbscript):/i.test(value)) return ''
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
      return value.replace(/\/+$/, '')
    } catch {
      return ''
    }
  }

  if (kind === 'bluesky') {
    const handle = value.replace(/^@/, '')
    if (!handle) return ''
    return `https://bsky.app/profile/${handle}`
  }

  if (kind === 'seenu') {
    if (/^https?:\/\//i.test(value)) {
      try {
        const u = new URL(value)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
        const host = u.hostname.replace(/^www\./, '').toLowerCase()
        if (host !== 'seenu.io' && !host.endsWith('.seenu.io')) return ''
        return value.replace(/\/+$/, '')
      } catch {
        return ''
      }
    }
    const handle = value.replace(/^@/, '').replace(/^seenu\.io\//i, '')
    if (!handle || handle.includes('.') || handle.includes('/')) return ''
    return `https://seenu.io/${handle}`
  }

  // website — only http(s) or a host-looking string (never javascript:/data:)
  if (/^(javascript|data|vbscript):/i.test(value)) return ''
  if (value.includes('.') && !/^\w+:/i.test(value)) {
    const href = `https://${value.replace(/^https?:\/\//i, '')}`
    try {
      const u = new URL(href)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
      return href.replace(/\/+$/, '')
    } catch {
      return ''
    }
  }
  // Never return a raw non-URL string (could be javascript: after decode tricks)
  return ''
}

export function hintFromHref(href: string): string {
  try {
    const u = new URL(href)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    if (host === 'bsky.app' && path.startsWith('/profile/')) {
      return path.slice('/profile/'.length)
    }
    if (host === 'seenu.io' && path.length > 1) {
      return path.slice(1)
    }
    return path && path !== '/' ? `${host}${path}` : host
  } catch {
    return href
  }
}

type FieldLike = { name?: string | null; value?: string | null }

export function isPresenceField(field: FieldLike): boolean {
  if (kindFromFieldName(field.name || '')) return true
  const url = extractHttpUrl(field.value || '')
  if (!url) return false
  const kind = kindFromUrl(url)
  return kind === 'bluesky' || kind === 'seenu'
}

export function readPresenceDraft(fields: FieldLike[]): {
  bluesky: string
  seenu: string
  website: string
} {
  const draft = { bluesky: '', seenu: '', website: '' }
  for (const f of fields) {
    const byName = kindFromFieldName(f.name || '')
    const url = extractHttpUrl(f.value || '') || stripHtml(f.value || '').trim()
    if (byName && url && !draft[byName]) {
      draft[byName] = url
      continue
    }
    if (url) {
      const byUrl = kindFromUrl(url)
      if (byUrl && !draft[byUrl]) draft[byUrl] = url
    }
  }
  return draft
}

export function profileFieldLimit(maxFromInstance?: number | null): number {
  const n = maxFromInstance ?? 4
  return Number.isFinite(n) && n > 0 ? Math.min(n, 16) : 4
}

/** Merge dedicated source inputs into Mastodon fieldsAttributes list. */
export function mergePresenceIntoFields(
  fields: { name: string; value: string }[],
  draft: { bluesky: string; seenu: string; website: string },
  maxFields = 4,
): { name: string; value: string }[] {
  const presence: { name: string; value: string }[] = []
  const claimedHrefs = new Set<string>()
  const order: Exclude<PresenceKind, 'mastodon'>[] = ['bluesky', 'seenu', 'website']
  for (const kind of order) {
    const href = normalizePresenceInput(kind, draft[kind])
    if (!href) continue
    presence.push({ name: SOURCE_LABELS[kind], value: href })
    claimedHrefs.add(href)
  }

  // Keep non-presence fields + unmatched presence (e.g. a second website) as Other
  const other: { name: string; value: string }[] = []
  for (const f of fields) {
    if (!isPresenceField(f)) {
      other.push(f)
      continue
    }
    const raw = extractHttpUrl(f.value || '') || stripHtml(f.value || '').trim()
    if (!raw) continue
    const byName = kindFromFieldName(f.name || '')
    const fromUrl = kindFromUrl(raw)
    const kind = byName || fromUrl
    if (!kind) {
      other.push({ name: f.name?.trim() || 'Other', value: raw })
      continue
    }
    const href = normalizePresenceInput(kind, raw)
    if (!href || claimedHrefs.has(href)) continue
    other.push({ name: f.name?.trim() || 'Other', value: href })
  }

  const cap = profileFieldLimit(maxFields)
  const room = Math.max(0, cap - other.length)
  return [...other.slice(0, cap), ...presence.slice(0, room)].slice(0, cap)
}

export function buildPresenceLinks(opts: {
  mastodonUrl?: string | null
  fields?: FieldLike[] | null
}): PresenceLink[] {
  const links: PresenceLink[] = []
  const seen = new Set<PresenceKind>()

  if (opts.mastodonUrl) {
    links.push({
      kind: 'mastodon',
      label: 'Mastodon',
      href: opts.mastodonUrl,
      hint: hintFromHref(opts.mastodonUrl),
    })
    seen.add('mastodon')
  }

  const draft = readPresenceDraft(opts.fields || [])
  for (const kind of ['bluesky', 'seenu', 'website'] as const) {
    const raw = draft[kind]
    if (!raw) continue
    const href = normalizePresenceInput(kind, raw)
    if (!href || seen.has(kind)) continue
    // Avoid duplicating mastodon URL as "website"
    if (kind === 'website' && opts.mastodonUrl && href === opts.mastodonUrl) continue
    links.push({
      kind,
      label: SOURCE_LABELS[kind],
      href,
      hint: hintFromHref(href),
    })
    seen.add(kind)
  }

  return links
}
