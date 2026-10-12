/**
 * Delete & redraft support: typed source lookups and a recoverable snapshot.
 *
 * The snapshot lives in the normal account-scoped draft store under a `redraft:<id>`
 * slot. The composer opens that same slot, clears it once the replacement is posted
 * and drops it on a confirmed discard — so until then a crash or closed tab still
 * leaves the text recoverable (see "find drafts").
 */

import { draftStorageKey, writeDraft, type DraftSaveResult, type DraftVisibility } from '~/composables/useDraft'
import { classifyFederationError } from './federation'
import { httpStatusFrom } from './friendlyError'

export type StatusSourceFailure = 'unsupported' | 'auth' | 'network' | 'unknown'

export type StatusSourceOutcome =
  | { ok: true; text: string; spoilerText: string }
  | { ok: false; reason: StatusSourceFailure; error: unknown }

/**
 * Only a definite "this server has no /source endpoint" counts as unsupported.
 * Offline, rate limits and 5xx are transient; 401/403 mean the token can't act.
 */
export function classifyStatusSourceError(err: unknown): StatusSourceFailure {
  const status = httpStatusFrom(err)
  if (status === 401 || status === 403) return 'auth'
  // Mastodon < 3.5 and forks without the route answer 404 / 405 / 501
  if (status === 404 || status === 405 || status === 501) return 'unsupported'
  const failure = classifyFederationError(err)
  if (failure === 'offline' || failure === 'timeout' || failure === 'rate-limited') return 'network'
  return 'unknown'
}

export const redraftSlot = (statusId: string) => `redraft:${statusId}`

export interface RedraftSnapshot {
  text: string
  spoilerText: string
  visibility: DraftVisibility
}

/** Persist before the destructive call; a failed save means the delete must not run. */
export function saveRedraftSnapshot(
  accountId: string,
  statusId: string,
  snapshot: RedraftSnapshot,
): DraftSaveResult {
  if (!snapshot.text.trim() && !snapshot.spoilerText.trim()) {
    // writeDraft would treat an empty draft as "remove" — nothing to protect, nothing saved
    return { ok: true }
  }
  return writeDraft(draftStorageKey(accountId, redraftSlot(statusId)), {
    text: snapshot.text,
    spoiler: snapshot.spoilerText,
    visibility: snapshot.visibility,
  })
}

/** Remove a snapshot whose delete definitely did not happen (the post still exists). */
export function discardRedraftSnapshot(accountId: string, statusId: string) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(draftStorageKey(accountId, redraftSlot(statusId)))
  } catch {
    // storage unavailable — nothing was saved either
  }
}
