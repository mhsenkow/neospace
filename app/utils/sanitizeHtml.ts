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

let linkHookInstalled = false

function ensureLinkHook() {
  if (linkHookInstalled || typeof window === 'undefined') return
  linkHookInstalled = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof HTMLAnchorElement) && node.nodeName !== 'A') return
    const el = node as HTMLAnchorElement
    el.setAttribute('target', '_blank')
    el.setAttribute('rel', 'noopener noreferrer nofollow')
  })
}

function purifyWithSafeClasses(dirty: string, tags: string[], attr: string[]): string {
  if (!dirty || typeof dirty !== 'string') return ''
  if (typeof window === 'undefined') {
    return dirty.replace(/<[^>]*>/g, '')
  }
  ensureLinkHook()
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: [...attr, 'class'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  }).replace(/\sclass="([^"]*)"/gi, (_m, classes: string) => {
    const kept = classes
      .split(/\s+/)
      .filter((c) => SAFE_EMOJI_CLASSES.has(c) || /^custom-emoji/.test(c) || /^emoji/.test(c))
    return kept.length ? ` class="${kept.join(' ')}"` : ''
  })
}

/**
 * Keep only <img class="emoji"> whose src is in the account/status emoji allowlist.
 * Without an allowlist, all imgs are stripped (blocks tracking pixels).
 */
function filterEmojiImgs(html: string, allowedUrls?: Iterable<string> | null): string {
  if (!html) return ''
  // Most display names have no images — skip the DOM parse
  if (!/<img\b/i.test(html)) return html
  const allow = allowedUrls ? new Set(allowedUrls) : null
  if (typeof window === 'undefined') {
    if (!allow?.size) return html.replace(/<img\b[^>]*>/gi, '')
    return html.replace(/<img\b[^>]*>/gi, (tag) => {
      const src = tag.match(/\bsrc="([^"]*)"/i)?.[1]
      const cls = tag.match(/\bclass="([^"]*)"/i)?.[1] || ''
      if (src && allow.has(src) && /\bemoji\b/.test(cls)) return tag
      return ''
    })
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const img of Array.from(doc.body.querySelectorAll('img'))) {
      const src = img.getAttribute('src') || ''
      const cls = img.getAttribute('class') || ''
      if (!/\bemoji\b/.test(cls) || !allow?.has(src)) {
        img.remove()
      }
    }
    return doc.body.innerHTML
  } catch {
    return html.replace(/<img\b[^>]*>/gi, '')
  }
}

/** Status / profile bio HTML (links, formatting, custom-emoji spans) */
export function sanitizeStatusHtml(html: string): string {
  return purifyWithSafeClasses(html, STATUS_TAGS, STATUS_ATTR)
}

/**
 * Display name may include custom emoji <img>/<span>.
 * Pass account emoji URLs so only those imgs survive.
 */
export function sanitizeDisplayName(
  html: string,
  allowedEmojiUrls?: Iterable<string> | null,
): string {
  const cleaned = purifyWithSafeClasses(html, NAME_TAGS, NAME_ATTR.filter((a) => a !== 'class'))
  return filterEmojiImgs(cleaned, allowedEmojiUrls)
}

/** Profile metadata field values */
export function sanitizeFieldHtml(html: string): string {
  return purifyWithSafeClasses(html, STATUS_TAGS, STATUS_ATTR)
}

/** Strip all tags → plain text (no innerHTML assignment) */
export { stripHtml } from './stripHtml'
