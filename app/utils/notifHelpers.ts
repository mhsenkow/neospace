/** Shared notification icon / label helpers */

import type { mastodon } from 'masto'
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
    case 'quoted_update': return 'edit'
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
    case 'quoted_update': return 'edited a post you quoted'
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

/**
 * Mastodon grouped notifications (`GET /api/v2/notifications`).
 * masto.js in this repo has no v2 notifications client, so this talks to the
 * instance with the same bearer token `clientFor` / `credentialsFor` use.
 * A server without the route is remembered for the session and the caller
 * falls back to `v1/notifications`.
 */

export type GroupedNotificationRow = mastodon.v1.Notification & {
  /** Set only when the server folded more than one notification into this row. */
  _groupKey?: string
  _serverGroupCount?: number
  /** Oldest id in this page of the group — pass as max_id to load older groups. */
  _pageMinId?: string
}

export type GroupedNotificationsPage =
  | { supported: true; items: GroupedNotificationRow[]; headers: Headers }
  | { supported: false; cached: boolean }

const UNSUPPORTED_STATUSES = new Set([404, 405, 410, 501])

/** Session cache: origins that answered 404 (or an unusable grouped payload). */
const unsupportedV2 = new Set<string>()

export class NotificationsV2UnsupportedError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Grouped notifications are not supported (${status})`)
    this.name = 'NotificationsV2UnsupportedError'
    this.status = status
  }
}

export function notificationsV2CacheKey(instanceUrl: string): string {
  return instanceUrl.trim().replace(/\/+$/, '')
}

export function notificationsV2IsUnsupported(instanceUrl: string): boolean {
  return unsupportedV2.has(notificationsV2CacheKey(instanceUrl))
}

export function rememberNotificationsV2Unsupported(instanceUrl: string): void {
  unsupportedV2.add(notificationsV2CacheKey(instanceUrl))
}

/** Tests reset this so one file's 404 doesn't stick for the rest of the worker. */
export function resetNotificationsV2Support(): void {
  unsupportedV2.clear()
}

function isUnsupportedStatus(status: number): boolean {
  return UNSUPPORTED_STATUSES.has(status)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function camelKey(key: string): string {
  if (!key.includes('_')) return key
  return key.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())
}

/** Mastodon JSON is snake_case; the activity page reads masto's camelCase shape. */
function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => camelize(item))
  const rec = asRecord(value)
  if (!rec) return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(rec)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const next = camelKey(key)
    if (next === '__proto__' || next === 'constructor' || next === 'prototype') continue
    out[next] = camelize(inner)
  }
  return out
}

function indexById(list: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>()
  if (!Array.isArray(list)) return map
  for (const item of list) {
    const camel = asRecord(camelize(item))
    const id = camel ? asString(camel.id) : null
    if (camel && id) map.set(id, camel)
  }
  return map
}

function accountFrom(raw: Record<string, unknown> | undefined, id: string): mastodon.v1.Account {
  const username = raw ? asString(raw.username) || '' : ''
  const base = {
    id: (raw && asString(raw.id)) || id || '0',
    username,
    acct: (raw && asString(raw.acct)) || username,
    displayName: (raw && asString(raw.displayName)) || username,
    avatar: (raw && asString(raw.avatar)) || '',
    url: (raw && asString(raw.url)) || '',
  }
  return { ...(raw || {}), ...base } as mastodon.v1.Account
}

function timestampOf(value: unknown): string {
  const iso = asString(value)
  if (iso && Number.isFinite(Date.parse(iso))) return iso
  return new Date(0).toISOString()
}

/**
 * Map `{ notification_groups, accounts, statuses }` into one row per group.
 * Returns null when the payload isn't the v2 shape (caller treats that as unsupported).
 */
export function notificationRowsFromGroups(payload: unknown): GroupedNotificationRow[] | null {
  const body = asRecord(payload)
  if (!body || !Array.isArray(body.notification_groups)) return null

  const accounts = indexById(body.partial_accounts)
  for (const [id, account] of indexById(body.accounts)) accounts.set(id, account)
  const statuses = indexById(body.statuses)

  const rows: GroupedNotificationRow[] = []
  for (const rawGroup of body.notification_groups) {
    const group = asRecord(rawGroup)
    if (!group) continue
    const id = asString(group.most_recent_notification_id)
    const type = asString(group.type)
    const groupKey = asString(group.group_key)
    if (!id || !type || !groupKey) continue

    const countRaw = group.notifications_count
    const count =
      typeof countRaw === 'number' && Number.isFinite(countRaw) ? Math.floor(countRaw) : 1
    if (count < 1) continue

    const sampleIds = asStringList(group.sample_account_ids)
    const headId = sampleIds[0] || ''
    const statusId = asString(group.status_id)
    const statusRaw = statusId ? statuses.get(statusId) : undefined
    const pageMinId = asString(group.page_min_id) || undefined
    const serverGroup = count > 1

    rows.push({
      id,
      type: type as mastodon.v1.Notification['type'],
      createdAt: timestampOf(group.latest_page_notification_at),
      account: accountFrom(headId ? accounts.get(headId) : undefined, headId || id),
      status: statusRaw ? (statusRaw as unknown as mastodon.v1.Status) : null,
      groupKey,
      ...(pageMinId ? { _pageMinId: pageMinId } : {}),
      ...(serverGroup ? { _groupKey: groupKey, _serverGroupCount: count } : {}),
    } as GroupedNotificationRow)
  }
  return rows
}

export type GroupedNotificationQuery = {
  limit: number
  maxId?: string
  types?: readonly string[]
}

export function groupedNotificationsQuery(params: GroupedNotificationQuery): string {
  const q = new URLSearchParams()
  q.set('limit', String(params.limit))
  if (params.maxId) q.set('max_id', params.maxId)
  if (params.types?.length) {
    for (const type of params.types) q.append('types[]', type)
  }
  return q.toString()
}

/** max_id from a Link rel=next header, if the server sent one. */
export function nextPageMaxId(headers: Headers): string | null {
  const link = headers.get('Link') || headers.get('link')
  if (!link) return null
  for (const part of link.split(',')) {
    if (!/rel=["']?next["']?/i.test(part)) continue
    const match = part.match(/<([^>]+)>/)
    if (!match?.[1]) return null
    try {
      return new URL(match[1], 'https://notifications.invalid').searchParams.get('max_id')
    } catch {
      return null
    }
  }
  return null
}

async function releaseBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel()
  } catch {
    // Already consumed, or no body.
  }
}

function groupKeyForPath(groupKey: string): string | null {
  const key = groupKey.trim()
  if (!key || key.length > 512) return null
  if (/[\u0000-\u001f\u007f\s/?#\\]/.test(key) || key.includes('..')) return null
  return key
}

export async function fetchGroupedNotifications(
  creds: { url: string; accessToken: string },
  params: GroupedNotificationQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<GroupedNotificationsPage> {
  const base = notificationsV2CacheKey(creds.url)
  if (!base || unsupportedV2.has(base)) return { supported: false, cached: true }

  const res = await fetchImpl(`${base}/api/v2/notifications?${groupedNotificationsQuery(params)}`, {
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    await releaseBody(res)
    if (isUnsupportedStatus(res.status)) {
      unsupportedV2.add(base)
      return { supported: false, cached: false }
    }
    throw new Error(`Grouped notifications failed (${res.status})`)
  }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    unsupportedV2.add(base)
    return { supported: false, cached: false }
  }

  const items = notificationRowsFromGroups(data)
  if (!items) {
    unsupportedV2.add(base)
    return { supported: false, cached: false }
  }
  return { supported: true, items, headers: res.headers }
}

/** One POST dismisses every notification the group folded together. */
export async function dismissNotificationGroup(
  creds: { url: string; accessToken: string },
  groupKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const key = groupKeyForPath(groupKey)
  if (!key) throw new Error('Bad notification group')
  const base = notificationsV2CacheKey(creds.url)
  const res = await fetchImpl(`${base}/api/v2/notifications/${encodeURIComponent(key)}/dismiss`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    await releaseBody(res)
    if (isUnsupportedStatus(res.status)) {
      if (base) unsupportedV2.add(base)
      throw new NotificationsV2UnsupportedError(res.status)
    }
    throw new Error(`Couldn’t dismiss notification group (${res.status})`)
  }
  await releaseBody(res)
}
