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

/**
 * Collapse consecutive notifications that share type + status id (+ instance).
 * Follow/follow_request without a status are not grouped by status.
 */
export function collapseConsecutiveNotifications<T extends GroupableNotification>(
  items: T[],
): CollapsedNotification<T>[] {
  const out: CollapsedNotification<T>[] = []
  for (const n of items) {
    const statusId = n.status?.id || null
    const prev = out[out.length - 1]
    const canGroup =
      !!statusId &&
      !!prev &&
      prev.type === n.type &&
      prev.status?.id === statusId &&
      (prev._instanceId || '') === (n._instanceId || '')

    if (canGroup && prev) {
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
