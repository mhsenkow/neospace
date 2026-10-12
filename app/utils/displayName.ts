import { emojify, emojiUrlSet, type EmojiInput } from '~/utils/emojify'
import { sanitizeDisplayName } from '~/utils/sanitizeHtml'

type NamedAccount = {
  displayName?: string | null
  username?: string | null
  emojis?: EmojiInput[] | null
}

/**
 * Display name as sanitized HTML with the account's custom emoji rendered
 * (use with v-html in rich contexts; plain-text contexts use `plainDisplayName`).
 */
export function richDisplayName(account: NamedAccount | null | undefined): string {
  const raw = account?.displayName || account?.username || ''
  const emojis = account?.emojis || []
  return sanitizeDisplayName(emojify(raw, emojis), emojiUrlSet(emojis))
}

/**
 * Display names in plain-text contexts (toasts, confirm bodies, aria labels).
 * Custom-emoji shortcodes (`:blobcat:`) can't render there — drop them instead of showing them literally.
 */
export function plainDisplayName(name: string | null | undefined, fallback = ''): string {
  const raw = (name || '').trim()
  const stripped = raw
    .replace(/:[a-zA-Z0-9_]{2,}:/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // A name that was *only* emoji shortcodes falls back rather than going blank
  return stripped || fallback || raw
}
