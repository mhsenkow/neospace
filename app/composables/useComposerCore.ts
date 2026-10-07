/**
 * Shared composer primitives — IME-safe keys.
 * Length: `~/utils/mastodonLength`. Drafts: `~/composables/useDraft`.
 * Media tray / autocomplete / submit live in useComposeMedia + RealComposeBox.
 */

/** True when the key event is part of an IME composition (do not submit). */
export function isImeEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229
}
