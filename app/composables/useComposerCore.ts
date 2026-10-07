/**
 * Shared composer primitives — length, IME-safe keys, drafts.
 * Full media tray / autocomplete / submit live in useComposeMedia + RealComposeBox.
 */

export { mastodonLength } from '~/utils/mastodonLength'
export { useDraft, type DraftVisibility } from '~/composables/useDraft'

/** True when the key event is part of an IME composition (do not submit). */
export function isImeEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229
}
