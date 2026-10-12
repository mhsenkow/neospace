/** Shared notification icon / label helpers */

import type { RouteLocationRaw } from 'vue-router'
import type { NeoIconName } from '~/utils/neoIcons'

type NotificationRouteInput = {
  type: string
  account?: { acct?: string } | null
  status?: { id?: string; url?: string | null; uri?: string | null } | null
  _instanceId?: string
}

/** Deep-link target for a notification row (Activity column + board portal). */
export function notificationRoute(notif: NotificationRouteInput): RouteLocationRaw | null {
  const via = notif._instanceId ? { account: notif._instanceId } : {}
  if (notif.type === 'follow' || notif.type === 'follow_request') {
    const acct = notif.account?.acct
    if (acct) return { path: '/profile', query: { user: acct, ...via } }
  }
  const status = notif.status
  if (status?.id) {
    const url = status.url || status.uri
    return {
      path: `/status/${status.id}`,
      query: { ...(url ? { url } : {}), ...via },
    }
  }
  const acct = notif.account?.acct
  if (acct) return { path: '/profile', query: { user: acct, ...via } }
  return null
}

export function notifIconName(type: string): NeoIconName {
  switch (type) {
    case 'mention': return 'mention'
    case 'favourite': return 'heart'
    case 'reblog': return 'reblog'
    case 'follow': return 'user'
    case 'follow_request': return 'lock'
    case 'poll': return 'poll'
    case 'status': return 'pen'
    case 'update': return 'edit'
    case 'admin.sign_up': return 'user'
    case 'admin.report': return 'alert'
    case 'severed_relationships': return 'ban'
    case 'moderation_warning': return 'alert'
    case 'annual_report': return 'sparkle'
    case 'quote': return 'reblog'
    default: return 'bell'
  }
}

/**
 * Server-generated notices carry the recipient's *own* account — there is no actor to
 * name or link to ("YourName severed a relationship" with your own avatar).
 */
const ACTORLESS_TYPES = new Set(['severed_relationships', 'moderation_warning', 'annual_report'])

export const notifHasActor = (type: string): boolean => !ACTORLESS_TYPES.has(type)

/** Label read after the actor's name — or, for actorless notices, the whole sentence */
export function notifLabel(type: string): string {
  switch (type) {
    case 'mention': return 'mentioned you'
    case 'favourite': return 'liked your post'
    case 'reblog': return 'boosted your post'
    case 'follow': return 'followed you'
    case 'follow_request': return 'requested to follow you'
    case 'poll': return 'ended a poll'
    case 'status': return 'posted'
    case 'update': return 'edited a post'
    case 'admin.sign_up': return 'signed up (admin notice)'
    case 'admin.report': return 'submitted a report (admin notice)'
    case 'severed_relationships': return 'A relationship with another server was severed'
    case 'moderation_warning': return 'You received a moderation warning'
    case 'annual_report': return 'Your annual report is ready'
    case 'quote': return 'quoted your post'
    default: return 'notification'
  }
}

const FILTER_LABELS: Record<string, string> = {
  mention: 'Mentions',
  favourite: 'Likes',
  reblog: 'Boosts',
  follow: 'Follows',
  poll: 'Polls',
  status: 'Posts',
  update: 'Edits',
}

/**
 * Describes a non-default Activity view ("Mentions · Oldest first") so a column that shares
 * the /notifications filter/sort can show what is narrowing it. Null when nothing is applied.
 */
export function notificationViewLabel(filter: string, sortOrder: string): string | null {
  const parts: string[] = []
  const label = FILTER_LABELS[filter]
  if (label) parts.push(label)
  if (sortOrder === 'oldest') parts.push('Oldest first')
  return parts.length ? parts.join(' · ') : null
}

/**
 * Accounts page independently, but the list is merged by time. A quiet account's month-old
 * row would sit between a busy account's last-hour rows, and "load more" would then insert the
 * busy account's older rows *above* it — rows jumping under the reader.
 *
 * The frontier is the newest "oldest loaded row" among accounts that still have older pages:
 * nothing older than that can be shown yet, because an account with pages left may still owe
 * rows between here and there. Returns null when every account is fully loaded.
 */
export function notificationFrontier(
  rows: ReadonlyArray<{ _instanceId: string; _tsMs: number }>,
  moreByInstance: Readonly<Record<string, boolean>>,
): number | null {
  const oldest = new Map<string, number>()
  for (const r of rows) {
    if (!moreByInstance[r._instanceId]) continue
    const prev = oldest.get(r._instanceId)
    if (prev === undefined || r._tsMs < prev) oldest.set(r._instanceId, r._tsMs)
  }
  if (!oldest.size) return null
  return Math.max(...oldest.values())
}

/** Rows safe to show now (see notificationFrontier); returns the same array when nothing is held. */
export function withinFrontier<T extends { _instanceId: string; _tsMs: number }>(
  rows: T[],
  moreByInstance: Readonly<Record<string, boolean>>,
): T[] {
  const frontier = notificationFrontier(rows, moreByInstance)
  if (frontier === null) return rows
  const shown = rows.filter((r) => r._tsMs >= frontier)
  return shown.length === rows.length ? rows : shown
}
