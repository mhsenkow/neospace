/**
 * Client-side notification collapse: consecutive same type + status → one row.
 */

export type GroupableNotification = {
  type: string
  createdAt: string
  status?: { id?: string | null } | null
  account?: { displayName?: string | null; username?: string; acct?: string } | null
  _instanceId?: string
  _key?: string
}

export type CollapsedNotification<T extends GroupableNotification = GroupableNotification> = T & {
  /** How many raw notifications this row represents */
  _groupCount: number
  /** Extra notifications folded into this row (excludes the head) */
  _groupedKeys: string[]
}

const ACTOR_ONLY_TYPES = new Set(['follow', 'follow_request'])

/**
 * Collapse consecutive notifications that share type + status id (+ instance).
 * Follow / follow_request have no status — consecutive rows from the same
 * instance still fold into one, matching Mastodon's grouped inbox.
 */
export function collapseConsecutiveNotifications<T extends GroupableNotification>(
  items: T[],
): CollapsedNotification<T>[] {
  const out: CollapsedNotification<T>[] = []
  for (const n of items) {
    const statusId = n.status?.id || null
    const prev = out[out.length - 1]
    const sameInstance = !!prev && (prev._instanceId || '') === (n._instanceId || '')
    const sameType = !!prev && prev.type === n.type
    const canGroupByStatus = !!statusId && sameType && sameInstance && prev.status?.id === statusId
    const canGroupFollows =
      !statusId &&
      sameType &&
      sameInstance &&
      ACTOR_ONLY_TYPES.has(n.type) &&
      !prev.status?.id

    if ((canGroupByStatus || canGroupFollows) && prev) {
      prev._groupCount += 1
      if (n._key) prev._groupedKeys.push(n._key)
      continue
    }

    out.push({
      ...n,
      _groupCount: 1,
      _groupedKeys: [],
    })
  }
  return out
}

/** e.g. "Alice and 3 others" */
export function groupActorLabel(
  headName: string,
  groupCount: number,
): string {
  if (groupCount <= 1) return headName
  const others = groupCount - 1
  return `${headName} and ${others} other${others === 1 ? '' : 's'}`
}
