/**
 * Own-post management guards (delete / pin / redraft).
 *
 * A status id is only meaningful on the server that issued it, and an account id only
 * on that account's server. Management actions therefore require *proven* provenance:
 * the post must carry an origin tag matching the acting account's server AND its author
 * id must be the acting account's id. A post with no origin tag — or one fetched from
 * another server — never qualifies, even when the ids happen to collide.
 */

import { hostOf } from './federation'

/** The account an action is bound to — captured before any await, revalidated after. */
export interface ActingAccount {
  /** Stored instance id (key into the instances store) */
  id: string
  /** Server URL the account belongs to */
  url: string
  /** The account's own Mastodon account id on that server */
  userId: string
}

interface OwnershipStatus {
  account: { id: string }
  _instanceId?: string | null
  _instanceUrl?: string | null
}

/**
 * `row` is the card's outer status (a boost wrapper carries the origin tag);
 * `shown` is the post being acted on (the reblogged original on a boost row).
 */
export function provenOwnStatus(
  shown: OwnershipStatus,
  row: OwnershipStatus,
  account: ActingAccount | null | undefined,
): boolean {
  if (!account?.userId || !account.url) return false
  if (shown.account.id !== account.userId) return false

  const origin = shown._instanceUrl || row._instanceUrl || ''
  const originId = shown._instanceId || row._instanceId || ''
  if (originId && originId === account.id) return true
  const originHost = hostOf(origin)
  // Missing / unparseable provenance fails closed
  return !!originHost && originHost === hostOf(account.url)
}

/** Same account still acting on the same server (token holder unchanged). */
export function sameActingAccount(
  captured: ActingAccount | null | undefined,
  current: ActingAccount | null | undefined,
): boolean {
  return (
    !!captured &&
    !!current &&
    captured.id === current.id &&
    captured.userId === current.userId &&
    hostOf(captured.url) === hostOf(current.url)
  )
}
