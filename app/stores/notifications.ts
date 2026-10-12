import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient, clientFor } from '~/composables/useMasto'
import { logWarn, logError } from '~/utils/log'
import { compareId, idGreater } from '~/utils/compareId'
import {
  collapseConsecutiveNotifications,
  type CollapsedNotification,
} from '~/utils/notifGroup'
import { withinFrontier } from '~/utils/notifHelpers'

export type NotificationFilterType =
  | 'all'
  | 'mention'
  | 'favourite'
  | 'reblog'
  | 'follow'
  | 'poll'
  | 'status'
  | 'update'

export type SortOrder = 'newest' | 'oldest'

// masto v7's Notification is a union (one member per type) — interfaces can't
// extend unions, so intersect instead; narrowing on `type` keeps working.
export type ExtendedNotification = mastodon.v1.Notification & {
  /** Stable list key across accounts (instanceId:id) */
  _key: string
  _instanceId: string
  _instanceUrl?: string
  /** Pre-parsed createdAt for sorting */
  _tsMs: number
}

interface NotificationsState {
  notifications: ExtendedNotification[]
  isLoading: boolean
  /** Bumps to invalidate in-flight fetches when a refresh is requested mid-flight */
  fetchGeneration: number
  isLoadingMore: boolean
  error: string | null
  hasMore: boolean
  /** Per-instance max_id cursors for load-more */
  cursors: Record<string, string>
  /** Per-instance: does an older page exist? Drives the merge frontier (rows below it are held) */
  moreByInstance: Record<string, boolean>
  filter: NotificationFilterType
  sortOrder: SortOrder
  unreadCount: number
  /** Last good server unread_count per account — stands in when a later response is unusable */
  badgeByInstance: Record<string, number>
  /** Per-account last-read notification ids */
  lastReadByInstance: Record<string, string>
  /** Hosts that failed during the last fetch (partial failure banner) */
  failedHosts: string[]
}

const FILTER_TO_TYPES: Record<NotificationFilterType, string[] | undefined> = {
  all: undefined,
  mention: ['mention'],
  favourite: ['favourite'],
  reblog: ['reblog'],
  follow: ['follow', 'follow_request'],
  poll: ['poll'],
  status: ['status'],
  update: ['update'],
}

/** Server-side `types[]` for a filter tab (undefined = everything) */
export function typesForFilter(filter: NotificationFilterType): mastodon.v1.NotificationType[] | undefined {
  return FILTER_TO_TYPES[filter] as mastodon.v1.NotificationType[] | undefined
}

const LAST_READ_KEY = 'neospace_notif_last_read_v2'
const LEGACY_LAST_READ_KEY = 'neospace_notif_last_read'

function tagNotification(
  n: mastodon.v1.Notification,
  instanceId: string,
  instanceUrl: string,
): ExtendedNotification {
  return {
    ...n,
    _key: `${instanceId}:${n.id}`,
    _instanceId: instanceId,
    _instanceUrl: instanceUrl,
    _tsMs: new Date(n.createdAt).getTime(),
  }
}

/**
 * Bumped by markAllRead / clearAll so a server unread_count fetch that started
 * before the read marker moved can't land afterwards and resurrect the badge.
 */
let badgeSeq = 0

const BADGE_POLL_MS = 60_000
const BADGE_POLL_BACKOFF_MAX_MS = 5 * 60_000
let badgePollTimer: ReturnType<typeof setTimeout> | null = null
let badgePollFailures = 0

/** Next poll delay: steady while healthy, doubling (capped) after consecutive failures */
export function badgePollDelay(failures: number): number {
  return Math.min(BADGE_POLL_BACKOFF_MAX_MS, BADGE_POLL_MS * 2 ** Math.max(0, failures))
}

/** A usable unread count is a finite, non-negative integer — anything else is a bad payload */
export function parseUnreadCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** Newest-first by time; id breaks ties so equal timestamps keep a stable order */
function byNewest(a: ExtendedNotification, b: ExtendedNotification): number {
  return b._tsMs - a._tsMs || compareId(b.id, a.id)
}

function linkHasNext(headers: Headers): boolean {
  const link = headers.get('Link') || headers.get('link')
  return !!link && /rel=["']?next["']?/i.test(link)
}

export const useNotificationsStore = defineStore('notifications', {
  state: (): NotificationsState => ({
    notifications: [],
    isLoading: false,
    fetchGeneration: 0,
    isLoadingMore: false,
    error: null,
    hasMore: true,
    cursors: {},
    moreByInstance: {},
    filter: 'all',
    sortOrder: 'newest',
    unreadCount: 0,
    badgeByInstance: {},
    lastReadByInstance: {},
    failedHosts: [],
  }),

  getters: {
    isEmpty: (state): boolean => state.notifications.length === 0,

    badgeLabel: (state): string => {
      // `!(n > 0)` also catches NaN, which `n <= 0` lets through
      if (!(state.unreadCount > 0)) return ''
      return state.unreadCount > 99 ? '99+' : String(state.unreadCount)
    },

    filteredNotifications: (state): ExtendedNotification[] => {
      // Older rows are held back until every account with pages left has caught up to them
      let items = withinFrontier(state.notifications, state.moreByInstance)

      if (state.filter !== 'all') {
        const types = FILTER_TO_TYPES[state.filter]
        if (types) {
          items = items.filter((n) => types.includes(n.type))
        }
      }

      if (state.sortOrder === 'newest') {
        if (state.filter === 'all') return items
        return [...items].sort((a, b) => b._tsMs - a._tsMs)
      }

      return [...items].sort((a, b) => a._tsMs - b._tsMs)
    },

    /** Filtered + consecutive same type/status collapsed into one row */
    collapsedNotifications(): CollapsedNotification<ExtendedNotification>[] {
      return collapseConsecutiveNotifications(this.filteredNotifications)
    },

    groupedByTime(): Record<string, CollapsedNotification<ExtendedNotification>[]> {
      const groups: Record<string, CollapsedNotification<ExtendedNotification>[]> = {}
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const yesterdayStart = new Date(todayStart.getTime() - 86400000)
      const weekStart = new Date(todayStart.getTime() - 7 * 86400000)

      for (const notif of this.collapsedNotifications) {
        const date = new Date(notif.createdAt)
        let label: string

        if (date >= todayStart) {
          label = 'Today'
        } else if (date >= yesterdayStart) {
          label = 'Yesterday'
        } else if (date >= weekStart) {
          label = 'This Week'
        } else {
          label = 'Older'
        }

        ;(groups[label] ??= []).push(notif)
      }

      return groups
    },
  },

  actions: {
    getClient(): mastodon.rest.Client | null {
      try {
        return activeClient()
      } catch {
        return null
      }
    },

    loadLastRead() {
      if (typeof window === 'undefined') return
      try {
        const saved = localStorage.getItem(LAST_READ_KEY)
        if (saved) {
          const parsed = JSON.parse(saved) as Record<string, string>
          if (parsed && typeof parsed === 'object') {
            this.lastReadByInstance = parsed
            return
          }
        }
        // Migrate single-id legacy key onto the active account once
        const legacy = localStorage.getItem(LEGACY_LAST_READ_KEY)
        if (legacy) {
          const instances = useInstancesStore()
          const activeId = instances.activeAccount?.id
          if (activeId) {
            this.lastReadByInstance = { [activeId]: legacy }
            this.persistLastReadMap()
          }
          localStorage.removeItem(LEGACY_LAST_READ_KEY)
        }
      } catch {
        // ignore
      }
    },

    persistLastReadMap() {
      if (typeof window === 'undefined') return
      try {
        localStorage.setItem(LAST_READ_KEY, JSON.stringify(this.lastReadByInstance))
      } catch {
        // ignore
      }
    },

    persistLastRead(instanceId: string, id: string) {
      this.lastReadByInstance = { ...this.lastReadByInstance, [instanceId]: id }
      this.persistLastReadMap()
    },

    recomputeUnread() {
      // A filtered list holds one type's rows — counting it would shrink the badge.
      // The server's unread_count is the truth then.
      if (this.filter !== 'all') {
        void this.refreshUnreadBadge()
        return
      }
      let total = 0
      for (const n of this.notifications) {
        if (this.isUnread(n)) total += 1
      }
      this.unreadCount = total
    },

    /** Unread rows loaded for one account (read marker vs list) */
    localUnreadFor(instanceId: string): number {
      let n = 0
      for (const row of this.notifications) {
        if (row._instanceId === instanceId && this.isUnread(row)) n += 1
      }
      return n
    },

    /**
     * After the list changed (fetch / load more): the list only holds ~30 rows per account,
     * so it must not replace the server's unread_count (up to 1000) — the title would drop
     * from "(150)" to "(30)" the moment the page opens. Rows only drive row styling then.
     */
    reconcileUnreadWithList() {
      if (this.filter !== 'all') {
        void this.refreshUnreadBadge()
        return
      }
      const authed = useInstancesStore().authenticatedInstances
      const known = authed.length > 0 && authed.every((i) => typeof this.badgeByInstance[i.id] === 'number')
      if (!known) {
        this.recomputeUnread()
        return
      }
      let server = 0
      for (const i of authed) server += this.badgeByInstance[i.id]!
      let local = 0
      for (const n of this.notifications) if (this.isUnread(n)) local += 1
      this.unreadCount = Math.max(server, local)
    },

    /** Shift the badge by the unread rows that left / came back, keeping the server's larger count */
    adjustUnread(rows: ExtendedNotification[], sign: 1 | -1) {
      if (this.filter !== 'all') {
        this.recomputeUnread()
        return
      }
      const perInstance: Record<string, number> = {}
      for (const n of rows) {
        if (this.isUnread(n)) perInstance[n._instanceId] = (perInstance[n._instanceId] ?? 0) + 1
      }
      let delta = 0
      const next = { ...this.badgeByInstance }
      for (const [id, n] of Object.entries(perInstance)) {
        delta += n
        if (typeof next[id] === 'number') next[id] = Math.max(0, next[id]! + sign * n)
      }
      if (!delta) return
      this.badgeByInstance = next
      this.unreadCount = Math.max(0, this.unreadCount + sign * delta)
    },

    isUnread(n: ExtendedNotification): boolean {
      const last = this.lastReadByInstance[n._instanceId]
      return !last || idGreater(n.id, last)
    },

    /** Invalidate in-flight badge refreshes and forget remembered counts (read marker moved) */
    resetBadge() {
      badgeSeq += 1
      this.badgeByInstance = {}
    },

    /**
     * Lightweight badge refresh via /notifications/unread_count.
     */
    /** Resolves true when every account answered usably (drives the poll's backoff) */
    async refreshUnreadBadge(): Promise<boolean> {
      const seq = ++badgeSeq
      const instances = useInstancesStore()
      const authed = instances.authenticatedInstances
      if (!authed.length) {
        this.unreadCount = 0
        return true
      }

      // Per-account result so a malformed answer from one server can't corrupt the sum
      const counts = await Promise.all(
        authed.map(async (inst) => {
          let count: number | null = null
          try {
            const client = clientFor(inst.id)
            const res = await client.v1.notifications.unreadCount.fetch({ limit: 1000 })
            count = parseUnreadCount((res as { count?: unknown } | null)?.count)
            if (count === null) logWarn(`Ignoring malformed unread count from ${inst.url}`)
          } catch (e) {
            logWarn(`Unread badge refresh failed for ${inst.url}:`, e)
          }
          return { id: inst.id, count }
        }),
      )

      if (seq !== badgeSeq) return true
      let total = 0
      const remembered: Record<string, number> = {}
      for (const { id, count } of counts) {
        // Endpoint missing (GoToSocial / Akkoma) or never answered: fall back to the read
        // marker + loaded rows instead of pinning the badge at 0 forever
        const fallback = this.filter === 'all' ? this.localUnreadFor(id) : 0
        const value = count ?? this.badgeByInstance[id] ?? fallback
        remembered[id] = value
        total += value
      }
      this.badgeByInstance = remembered
      this.unreadCount = total
      return counts.every((c) => c.count !== null)
    },

    /**
     * Keep the Activity badge fresh while the tab is visible. Self-rescheduling so a
     * failing server backs off (1m → 5m) instead of being hammered; hidden tabs skip the
     * fetch (visibilitychange refreshes on return).
     */
    startBadgePolling() {
      if (badgePollTimer) return
      badgePollFailures = 0
      const schedule = () => {
        badgePollTimer = setTimeout(async () => {
          const visible = typeof document === 'undefined' || document.visibilityState === 'visible'
          if (visible && useInstancesStore().hasAuthenticatedInstance) {
            const ok = await this.refreshUnreadBadge()
            badgePollFailures = ok ? 0 : badgePollFailures + 1
          }
          // stopBadgePolling during the fetch must not re-arm the timer
          if (badgePollTimer) schedule()
        }, badgePollDelay(badgePollFailures))
      }
      schedule()
    },

    stopBadgePolling() {
      if (badgePollTimer) clearTimeout(badgePollTimer)
      badgePollTimer = null
      badgePollFailures = 0
    },

    async fetchNotifications(_refresh = false) {
      const gen = ++this.fetchGeneration

      const instances = useInstancesStore()
      const authed = instances.authenticatedInstances
      if (!authed.length) {
        if (gen === this.fetchGeneration) {
          this.error = 'Please log in to view notifications'
          this.isLoading = false
        }
        return
      }

      this.loadLastRead()
      this.isLoading = true
      this.error = null
      this.failedHosts = []

      try {
        const batches = await Promise.all(
          authed.map(async (inst) => {
            try {
              const client = clientFor(inst.id)
              const types = typesForFilter(this.filter)
              const [res, marker] = await Promise.all([
                client.v1.notifications.list.$raw({ limit: 30, ...(types ? { types } : {}) }),
                // Server read marker — moved by other clients and by markAllRead
                client.v1.markers
                  .fetch({ timeline: ['notifications'] })
                  .catch(() => null),
              ])
              const items = res.data
              const serverLast = marker?.notifications?.lastReadId
              const localLast = this.lastReadByInstance[inst.id]
              if (serverLast && (!localLast || idGreater(serverLast, localLast))) {
                // Read elsewhere (another client / device) — don't show them as unread here
                this.persistLastRead(inst.id, serverLast)
              } else if (items.length && !localLast && this.filter === 'all') {
                this.persistLastRead(inst.id, items[0]!.id)
              }
              return {
                instanceId: inst.id,
                instanceUrl: inst.url,
                items,
                hasNext: linkHasNext(res.headers) || items.length >= 30,
                ok: true as const,
              }
            } catch (e: any) {
              logWarn(`Notifications fetch failed for ${inst.url}:`, e)
              return {
                instanceId: inst.id,
                instanceUrl: inst.url,
                items: [] as mastodon.v1.Notification[],
                hasNext: false,
                ok: false as const,
              }
            }
          }),
        )

        const merged: ExtendedNotification[] = []
        const nextCursors: Record<string, string> = {}
        const nextMore: Record<string, boolean> = {}
        const failed: string[] = []
        let anyHasNext = false
        let anyOk = false

        for (const batch of batches) {
          if (!batch.ok) {
            try {
              failed.push(new URL(batch.instanceUrl).hostname)
            } catch {
              failed.push(batch.instanceUrl)
            }
            continue
          }
          anyOk = true
          for (const n of batch.items) {
            merged.push(tagNotification(n, batch.instanceId, batch.instanceUrl))
          }
          if (batch.items.length > 0) {
            nextCursors[batch.instanceId] = batch.items[batch.items.length - 1]!.id
          }
          nextMore[batch.instanceId] = batch.hasNext
          if (batch.hasNext) anyHasNext = true
        }

        if (gen !== this.fetchGeneration) return

        this.failedHosts = failed
        this.moreByInstance = nextMore
        merged.sort(byNewest)
        this.notifications = merged
        this.cursors = nextCursors
        this.hasMore = anyHasNext
        this.reconcileUnreadWithList()
        if (!anyOk && failed.length) {
          this.error = 'Couldn’t load notifications from any account'
        }
      } catch (e: any) {
        if (gen === this.fetchGeneration) {
          this.error = e.message || 'Failed to fetch notifications'
          logError('Notifications fetch error:', e)
        }
      } finally {
        if (gen === this.fetchGeneration) {
          this.isLoading = false
        }
      }
    },

    async loadMore(depth = 0) {
      if (this.isLoadingMore || !this.hasMore) return
      let stalled = false
      const instances = useInstancesStore()
      const authed = instances.authenticatedInstances
      if (!authed.length) return

      const withCursor = authed.filter((i) => this.cursors[i.id])
      if (!withCursor.length) {
        this.hasMore = false
        return
      }

      const gen = this.fetchGeneration
      this.isLoadingMore = true

      try {
        const batches = await Promise.all(
          withCursor.map(async (inst) => {
            try {
              const client = clientFor(inst.id)
              const types = typesForFilter(this.filter)
              const res = await client.v1.notifications.list.$raw({
                limit: 30,
                maxId: this.cursors[inst.id]!,
                ...(types ? { types } : {}),
              })
              return {
                instanceId: inst.id,
                instanceUrl: inst.url,
                items: res.data,
                hasNext: linkHasNext(res.headers) || res.data.length >= 30,
              }
            } catch (e) {
              logWarn(`Load more notifications failed for ${inst.url}:`, e)
              return {
                instanceId: inst.id,
                instanceUrl: inst.url,
                items: [] as mastodon.v1.Notification[],
                hasNext: false,
              }
            }
          }),
        )

        // A refresh started mid-load replaced the list + cursors — drop this page
        if (gen !== this.fetchGeneration) return

        const seen = new Set(this.notifications.map((n) => n._key))
        let anyHasNext = false
        const nextCursors = { ...this.cursors }
        const nextMore = { ...this.moreByInstance }
        const shownBefore = this.filteredNotifications.length
        const fresh: ExtendedNotification[] = []

        for (const batch of batches) {
          for (const n of batch.items) {
            const tagged = tagNotification(n, batch.instanceId, batch.instanceUrl)
            if (!seen.has(tagged._key)) {
              fresh.push(tagged)
              seen.add(tagged._key)
            }
          }
          if (batch.items.length > 0) {
            nextCursors[batch.instanceId] = batch.items[batch.items.length - 1]!.id
          } else {
            delete nextCursors[batch.instanceId]
          }
          nextMore[batch.instanceId] = batch.items.length > 0 && batch.hasNext
          if (batch.hasNext) anyHasNext = true
        }
        this.moreByInstance = nextMore

        if (fresh.length) {
          // Accounts page independently — re-sort so 'all'/'newest' stays chronological
          this.notifications = [...this.notifications, ...fresh].sort(byNewest)
          this.reconcileUnreadWithList()
        }
        this.cursors = nextCursors
        this.hasMore = anyHasNext && Object.keys(nextCursors).length > 0
        // Every new row landed below the frontier: keep paging so the reader isn't left at a dead end
        stalled = this.hasMore && this.filteredNotifications.length <= shownBefore
      } catch (e: any) {
        if (gen === this.fetchGeneration) logError('Load more notifications error:', e)
      } finally {
        this.isLoadingMore = false
      }
      if (stalled && depth < 3) await this.loadMore(depth + 1)
    },

    setFilter(filter: NotificationFilterType) {
      this.filter = filter
    },

    setSortOrder(order: SortOrder) {
      this.sortOrder = order
    },

    async markAllRead() {
      // Highest id per account (ids, not timestamps, are what markers compare)
      const byInstance = new Map<string, string>()
      for (const n of this.notifications) {
        const top = byInstance.get(n._instanceId)
        if (!top || idGreater(n.id, top)) byInstance.set(n._instanceId, n.id)
      }
      // A filtered list only holds one type — its newest row isn't the account's newest,
      // and marking up to it would leave newer rows of other types unread.
      if (this.filter !== 'all') {
        byInstance.clear()
        await Promise.all(
          useInstancesStore().authenticatedInstances.map(async (inst) => {
            try {
              const [newest] = await clientFor(inst.id).v1.notifications.list({ limit: 1 })
              if (newest) byInstance.set(inst.id, newest.id)
            } catch (e) {
              logWarn(`Couldn’t find newest notification on ${inst.url}:`, e)
            }
          }),
        )
      }
      // Never move a marker backwards (e.g. newest rows dismissed / read elsewhere)
      for (const [instanceId, topId] of byInstance) {
        const last = this.lastReadByInstance[instanceId]
        if (last && idGreater(last, topId)) byInstance.delete(instanceId)
      }
      // Nothing loaded (fetch failed / never opened) — keep the server badge as-is
      if (!byInstance.size) return
      this.resetBadge()

      const results = await Promise.all(
        [...byInstance.entries()].map(async ([instanceId, topId]) => {
          try {
            const client = clientFor(instanceId)
            await client.v1.markers.create({
              notifications: { lastReadId: topId },
            })
            return { instanceId, topId, ok: true as const }
          } catch (e) {
            logWarn(`Failed to mark notifications read on ${instanceId}:`, e)
            return { instanceId, topId, ok: false as const }
          }
        }),
      )

      // Discard badge refreshes that started while markers were being written
      this.resetBadge()
      for (const r of results) {
        if (r.ok) this.persistLastRead(r.instanceId, r.topId)
      }

      if (results.every((r) => r.ok)) {
        this.unreadCount = 0
      } else {
        this.recomputeUnread()
      }
    },

    async dismissNotification(keyOrId: string) {
      const notif =
        this.notifications.find((n) => n._key === keyOrId) ||
        this.notifications.find((n) => n.id === keyOrId)
      if (!notif) return
      await this.dismissNotifications([notif._key])
    },

    /**
     * Optimistically remove rows (e.g. every notification folded into a grouped
     * row), then dismiss on the server. Failures are re-inserted individually —
     * restoring a whole-list snapshot would undo concurrent dismisses/refreshes.
     */
    async dismissNotifications(keys: string[]) {
      const wanted = new Set(keys)
      const removed = this.notifications.filter((n) => wanted.has(n._key))
      if (!removed.length) return
      this.notifications = this.notifications.filter((n) => !wanted.has(n._key))
      this.adjustUnread(removed, -1)
      const gen = this.fetchGeneration

      const results = await Promise.allSettled(
        removed.map(async (n) => clientFor(n._instanceId).v1.notifications.$select(n.id).dismiss()),
      )
      const failed = removed.filter((_, i) => results[i]!.status === 'rejected')
      if (!failed.length) return
      // A refresh since then already reflects the server — don't resurrect into it
      if (gen === this.fetchGeneration) {
        const present = new Set(this.notifications.map((n) => n._key))
        const back = failed.filter((n) => !present.has(n._key))
        if (back.length) {
          this.notifications = [...this.notifications, ...back].sort(byNewest)
          this.adjustUnread(back, 1)
        }
      }
      const first = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      logError('Failed to dismiss notification:', first?.reason)
      throw first?.reason ?? new Error('Couldn’t dismiss notification')
    },

    /**
     * Clear every account's notifications. Only rows of accounts that actually cleared are
     * dropped locally; the result names the ones that failed so the caller can say so.
     */
    async clearAll(): Promise<{ failedHosts: string[] }> {
      const instances = useInstancesStore()
      const authed = instances.authenticatedInstances
      if (!authed.length) return { failedHosts: [] }

      const prev = {
        notifications: this.notifications,
        unreadCount: this.unreadCount,
        cursors: { ...this.cursors },
      }

      try {
        const results = await Promise.allSettled(
          authed.map(async (inst) => {
            const client = clientFor(inst.id)
            await client.v1.notifications.clear()
          }),
        )
        const anyOk = results.some((r) => r.status === 'fulfilled')
        if (!anyOk) {
          throw new Error('Couldn’t clear notifications')
        }
        this.resetBadge()
        const okIds = new Set(authed.filter((_, i) => results[i]!.status === 'fulfilled').map((i) => i.id))
        const failedInstances = authed.filter((i) => !okIds.has(i.id))
        this.notifications = this.notifications.filter((n) => !okIds.has(n._instanceId))
        const cursors = { ...this.cursors }
        for (const id of okIds) delete cursors[id]
        this.cursors = cursors
        if (failedInstances.length) {
          // Failed accounts still hold theirs — the badge counts only what remains
          this.recomputeUnread()
        } else {
          this.unreadCount = 0
        }
        const failedHosts = failedInstances.map((i) => {
          try {
            return new URL(i.url).hostname
          } catch {
            return i.url
          }
        })
        return { failedHosts }
      } catch (e) {
        this.notifications = prev.notifications
        this.unreadCount = prev.unreadCount
        this.cursors = prev.cursors
        logError('Failed to clear notifications:', e)
        throw e
      }
    },
  },
})
