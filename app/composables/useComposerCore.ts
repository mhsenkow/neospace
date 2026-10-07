/**
 * Shared composer primitives — IME-safe keys.
 * Length/drafts: import from ~/utils/mastodonLength and ~/composables/useDraft.
 */

/** True when the key event is part of an IME composition (do not submit). */
export function isImeEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229
}
