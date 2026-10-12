/**
 * Canonical post-deletion events.
 *
 * Deleting a post must remove every visible copy — and only that post. Local ids are
 * per-server, so a bare `id` match would also drop an unrelated post that happens to
 * share the id on another server. Copies are matched by canonical identity (ActivityPub
 * uri / url) or, for untagged copies, by id *on the same origin host* only.
 */

import { hostOf } from './federation'
import { statusIdentity } from './statusIdentity'

export interface DeletedStatusEvent {
  /** Stored instance id of the account that performed the delete */
  accountId: string
  /** Origin server URL the deleted status id belongs to */
  instanceUrl: string
  /** The status id on that server */
  statusId: string
  /** statusIdentity() of the deleted post (canonical uri/url) */
  identity: string
}

interface CopyLike {
  id: string
  uri?: string | null
  url?: string | null
  _instanceUrl?: string | null
  reblog?: {
    id: string
    uri?: string | null
    url?: string | null
    _instanceUrl?: string | null
  } | null
}

export function buildDeletedStatusEvent(
  deleted: { id: string; uri?: string | null; url?: string | null },
  account: { id: string; url: string },
): DeletedStatusEvent {
  return {
    accountId: account.id,
    instanceUrl: account.url,
    statusId: deleted.id,
    identity: statusIdentity({ id: deleted.id, uri: deleted.uri, url: deleted.url, _instanceUrl: account.url }),
  }
}

/** Does this copy (the row itself, or the post it boosts) refer to the deleted post? */
function copyMatches(
  copy: { id: string; uri?: string | null; url?: string | null },
  originUrl: string | null | undefined,
  event: DeletedStatusEvent,
): boolean {
  // Canonical identity wins when the copy has one
  if (copy.uri || copy.url) {
    return statusIdentity({ id: copy.id, uri: copy.uri, url: copy.url }) === event.identity
  }
  // No uri/url: the id is only comparable on the server that issued it
  const host = hostOf(originUrl)
  return !!host && host === hostOf(event.instanceUrl) && copy.id === event.statusId
}

export function matchesDeletedStatus(status: CopyLike, event: DeletedStatusEvent): boolean {
  if (copyMatches(status, status._instanceUrl, event)) return true
  const boosted = status.reblog
  // Boost rows carry the origin tag on the wrapper, not on the embedded original
  return !!boosted && copyMatches(boosted, boosted._instanceUrl || status._instanceUrl, event)
}

/** Drop every copy of the deleted post — returns the same array when nothing matched. */
export function dropDeletedStatus<T extends CopyLike>(list: T[], event: DeletedStatusEvent): T[] {
  const next = list.filter((s) => !matchesDeletedStatus(s, event))
  return next.length === list.length ? list : next
}
