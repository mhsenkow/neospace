/**
 * Sanitize untrusted HTML from Mastodon (status content, display names, profile fields).
 * Federated HTML is only as safe as the remote instance — always purify client-side.
 */

import DOMPurify from 'dompurify'

const STATUS_TAGS = [
  'p', 'br', 'span', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
]

// No arbitrary `class` — remote HTML could spoof app overlay/chrome classes.
// Custom emoji uses class="invisible|ellipsis|…" from Mastodon; allowlist those.
const STATUS_ATTR = ['href', 'rel', 'target', 'translate']
const NAME_TAGS = ['span', 'img']
const NAME_ATTR = ['class', 'alt', 'src', 'title', 'width', 'height']

const SAFE_EMOJI_CLASSES = new Set([
  'invisible',
  'ellipsis',
  'mention',
  'hashtag',
  'u-url',
  'h-card',
  'quote-inline',
  'bbcode-spoiler',
  'spoiler-text',
])

function purify(dirty: string, tags: string[], attr: string[]): string {
  if (!dirty || typeof dirty !== 'string') return ''
  if (typeof window === 'undefined') {
    // SPA prerender / SSR stub — strip tags coarsely
    return dirty.replace(/<[^>]*>/g, '')
  }
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: attr,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  })
}

function purifyWithSafeClasses(dirty: string, tags: string[], attr: string[]): string {
  if (!dirty || typeof dirty !== 'string') return ''
  if (typeof window === 'undefined') {
    return dirty.replace(/<[^>]*>/g, '')
  }
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: [...attr, 'class'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  }).replace(/\sclass="([^"]*)"/gi, (_m, classes: string) => {
    const kept = classes
      .split(/\s+/)
      .filter((c) => SAFE_EMOJI_CLASSES.has(c) || /^custom-emoji/.test(c) || /^emoji/.test(c))
    return kept.length ? ` class="${kept.join(' ')}"` : ''
  })
}

/** Status / profile bio HTML (links, formatting, custom-emoji spans) */
export function sanitizeStatusHtml(html: string): string {
  return purifyWithSafeClasses(html, STATUS_TAGS, STATUS_ATTR)
}

/** Display name may include custom emoji <img>/<span> */
export function sanitizeDisplayName(html: string): string {
  return purifyWithSafeClasses(html, NAME_TAGS, NAME_ATTR.filter((a) => a !== 'class'))
}

/** Profile metadata field values */
export function sanitizeFieldHtml(html: string): string {
  return purifyWithSafeClasses(html, STATUS_TAGS, STATUS_ATTR)
}

/** Strip all tags → plain text (no innerHTML assignment) */
export function stripHtml(html: string): string {
  if (!html) return ''
  if (typeof window === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  } catch {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }
}
