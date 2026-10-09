import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient, clientFor } from '~/composables/useMasto'
import { logWarn } from '~/utils/log'
import { compareId, idGreater } from '~/utils/compareId'
import {
  collapseConsecutiveNotifications,
  type CollapsedNotification,
} from '~/utils/notifGroup'

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
  filter: NotificationFilterType
  sortOrder: SortOrder
  unreadCount: number
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
    filter: 'all',
    sortOrder: 'newest',
    unreadCount: 0,
    lastReadByInstance: {},
    failedHosts: [],
  }),

  getters: {
    isEmpty: (state): boolean => state.notifications.length === 0,

    badgeLabel: (state): string => {
      if (state.unreadCount <= 0) return ''
      return state.unreadCount > 99 ? '99+' : String(state.unreadCount)
    },

    filteredNotifications: (state): ExtendedNotification[] => {
      let items = state.notifications

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
      let total = 0
      for (const n of this.notifications) {
        if (this.isUnread(n)) total += 1
      }
      this.unreadCount = total
    },

    isUnread(n: ExtendedNotification): boolean {
      const last = this.lastReadByInstance[n._instanceId]
      return !last || idGreater(n.id, last)
    },

    /**
     * Lightweight badge refresh via /notifications/unread_count.
     */
    async refreshUnreadBadge() {
      const seq = ++badgeSeq
      const instances = useInstancesStore()
      const authed = instances.authenticatedInstances
      if (!authed.length) {
        this.unreadCount = 0
        return
      }

      let total = 0
      await Promise.all(
        authed.map(async (inst) => {
          try {
            const client = clientFor(inst.id)
            const { count } = await client.v1.notifications.unreadCount.fetch({ limit: 1000 })
            total += count
          } catch (e) {
            logWarn(`Unread badge refresh failed for ${inst.url}:`, e)
          }
        }),
      )

      if (seq !== badgeSeq) return
      this.unreadCount = total
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
              const [res, marker] = await Promise.all([
                client.v1.notifications.list.$raw({ limit: 30 }),
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
              } else if (items.length && !localLast) {
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
          if (batch.hasNext) anyHasNext = true
        }

        if (gen !== this.fetchGeneration) return

        this.failedHosts = failed
        merged.sort(byNewest)
        this.notifications = merged
        this.cursors = nextCursors
        this.hasMore = anyHasNext
        this.recomputeUnread()
        if (!anyOk && failed.length) {
          this.error = 'Couldn’t load notifications from any account'
        }
      } catch (e: any) {
        if (gen === this.fetchGeneration) {
          this.error = e.message || 'Failed to fetch notifications'
          console.error('Notifications fetch error:', e)
        }
      } finally {
        if (gen === this.fetchGeneration) {
          this.isLoading = false
        }
      }
    },

    async loadMore() {
      if (this.isLoadingMore || !this.hasMore) return
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
              const res = await client.v1.notifications.list.$raw({
                limit: 30,
                maxId: this.cursors[inst.id]!,
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
          if (batch.hasNext) anyHasNext = true
        }

        if (fresh.length) {
          // Accounts page independently — re-sort so 'all'/'newest' stays chronological
          this.notifications = [...this.notifications, ...fresh].sort(byNewest)
          this.recomputeUnread()
        }
        this.cursors = nextCursors
        this.hasMore = anyHasNext && Object.keys(nextCursors).length > 0
      } catch (e: any) {
        if (gen === this.fetchGeneration) console.error('Load more notifications error:', e)
      } finally {
        this.isLoadingMore = false
      }
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
      // Never move a marker backwards (e.g. newest rows dismissed / read elsewhere)
      for (const [instanceId, topId] of byInstance) {
        const last = this.lastReadByInstance[instanceId]
        if (last && idGreater(last, topId)) byInstance.delete(instanceId)
      }
      // Nothing loaded (fetch failed / never opened) — keep the server badge as-is
      if (!byInstance.size) return
      badgeSeq += 1

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
      badgeSeq += 1
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
      this.recomputeUnread()
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
          this.recomputeUnread()
        }
      }
      const first = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      console.error('Failed to dismiss notification:', first?.reason)
      throw first?.reason ?? new Error('Couldn’t dismiss notification')
    },

    async clearAll() {
      const instances = useInstancesStore()
      const authed = instances.authenticatedInstances
      if (!authed.length) return

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
        badgeSeq += 1
        this.notifications = []
        this.unreadCount = 0
        this.cursors = {}
      } catch (e) {
        this.notifications = prev.notifications
        this.unreadCount = prev.unreadCount
        this.cursors = prev.cursors
        console.error('Failed to clear notifications:', e)
        throw e
      }
    },
  },
})
