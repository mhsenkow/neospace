import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient, clientFor } from '~/composables/useMasto'

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

export interface ExtendedNotification extends mastodon.v1.Notification {
  /** Stable list key across accounts (instanceId:id) */
  _key: string
  _instanceId: string
  _instanceUrl?: string
}

interface NotificationsState {
  notifications: ExtendedNotification[]
  isLoading: boolean
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
  }
}

export const useNotificationsStore = defineStore('notifications', {
  state: (): NotificationsState => ({
    notifications: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: true,
    cursors: {},
    filter: 'all',
    sortOrder: 'newest',
    unreadCount: 0,
    lastReadByInstance: {},
  }),

  getters: {
    isEmpty: (state): boolean => state.notifications.length === 0,

    badgeLabel: (state): string => {
      if (state.unreadCount <= 0) return ''
      return state.unreadCount > 99 ? '99+' : String(state.unreadCount)
    },

    filteredNotifications: (state): ExtendedNotification[] => {
      let items = [...state.notifications]

      if (state.filter !== 'all') {
        const types = FILTER_TO_TYPES[state.filter]
        if (types) {
          items = items.filter((n) => types.includes(n.type))
        }
      }

      items.sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime()
        const timeB = new Date(b.createdAt).getTime()
        return state.sortOrder === 'newest' ? timeB - timeA : timeA - timeB
      })

      return items
    },

    groupedByTime(): Record<string, ExtendedNotification[]> {
      const groups: Record<string, ExtendedNotification[]> = {}
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const yesterdayStart = new Date(todayStart.getTime() - 86400000)
      const weekStart = new Date(todayStart.getTime() - 7 * 86400000)

      for (const notif of this.filteredNotifications) {
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

        if (!groups[label]) groups[label] = []
        groups[label].push(notif)
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
        const last = this.lastReadByInstance[n._instanceId]
        if (!last || n.id > last) total += 1
      }
      // First visit per account: don't explode badge — seed from loaded list tops
      this.unreadCount = total
    },

    /**
     * Lightweight badge refresh — polls every authenticated account.
     */
    async refreshUnreadBadge() {
      const instances = useInstancesStore()
      const authed = instances.authenticatedInstances
      if (!authed.length) {
        this.unreadCount = 0
        return
      }

      this.loadLastRead()
      let total = 0
      const map = { ...this.lastReadByInstance }

      await Promise.all(
        authed.map(async (inst) => {
          try {
            const client = createRestAPIClient({
              url: inst.url,
              accessToken: inst.accessToken!,
            })
            const items = await client.v1.notifications.list({ limit: 40 } as any)
            if (!items.length) return

            const last = map[inst.id]
            if (!last) {
              // First visit: treat current stack as read so badge doesn't explode
              map[inst.id] = items[0]!.id
              return
            }
            total += items.filter((n) => n.id > last).length
          } catch (e) {
            console.warn(`Unread badge refresh failed for ${inst.url}:`, e)
          }
        }),
      )

      this.lastReadByInstance = map
      this.persistLastReadMap()
      this.unreadCount = total
    },

    async fetchNotifications(refresh = false) {
      if (this.isLoading) return

      if (refresh) {
        this.notifications = []
        this.cursors = {}
        this.hasMore = true
      }

      const instances = useInstancesStore()
      const authed = instances.authenticatedInstances
      if (!authed.length) {
        this.error = 'Please log in to view notifications'
        return
      }

      this.loadLastRead()
      this.isLoading = true
      this.error = null

      try {
        const batches = await Promise.all(
          authed.map(async (inst) => {
            try {
              const client = createRestAPIClient({
                url: inst.url,
                accessToken: inst.accessToken!,
              })
              const items = await client.v1.notifications.list({ limit: 30 } as any)
              if (items.length && !this.lastReadByInstance[inst.id]) {
                this.persistLastRead(inst.id, items[0]!.id)
              }
              return {
                instanceId: inst.id,
                instanceUrl: inst.url,
                items,
              }
            } catch (e: any) {
              console.warn(`Notifications fetch failed for ${inst.url}:`, e)
              return { instanceId: inst.id, instanceUrl: inst.url, items: [] as mastodon.v1.Notification[] }
            }
          }),
        )

        const merged: ExtendedNotification[] = []
        const nextCursors: Record<string, string> = {}
        let anyFull = false

        for (const batch of batches) {
          for (const n of batch.items) {
            merged.push(tagNotification(n, batch.instanceId, batch.instanceUrl))
          }
          if (batch.items.length > 0) {
            nextCursors[batch.instanceId] = batch.items[batch.items.length - 1]!.id
          }
          if (batch.items.length >= 30) anyFull = true
        }

        merged.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        this.notifications = merged
        this.cursors = nextCursors
        this.hasMore = anyFull
        this.recomputeUnread()
      } catch (e: any) {
        this.error = e.message || 'Failed to fetch notifications'
        console.error('Notifications fetch error:', e)
      } finally {
        this.isLoading = false
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

      this.isLoadingMore = true

      try {
        const batches = await Promise.all(
          withCursor.map(async (inst) => {
            try {
              const client = createRestAPIClient({
                url: inst.url,
                accessToken: inst.accessToken!,
              })
              const items = await client.v1.notifications.list({
                limit: 30,
                max_id: this.cursors[inst.id],
              } as any)
              return { instanceId: inst.id, instanceUrl: inst.url, items }
            } catch (e) {
              console.warn(`Load more notifications failed for ${inst.url}:`, e)
              return { instanceId: inst.id, instanceUrl: inst.url, items: [] as mastodon.v1.Notification[] }
            }
          }),
        )

        const seen = new Set(this.notifications.map((n) => n._key))
        let anyFull = false
        const nextCursors = { ...this.cursors }

        for (const batch of batches) {
          for (const n of batch.items) {
            const tagged = tagNotification(n, batch.instanceId, batch.instanceUrl)
            if (!seen.has(tagged._key)) {
              this.notifications.push(tagged)
              seen.add(tagged._key)
            }
          }
          if (batch.items.length > 0) {
            nextCursors[batch.instanceId] = batch.items[batch.items.length - 1]!.id
          } else {
            delete nextCursors[batch.instanceId]
          }
          if (batch.items.length >= 30) anyFull = true
        }

        this.cursors = nextCursors
        this.hasMore = anyFull && Object.keys(nextCursors).length > 0
      } catch (e: any) {
        console.error('Load more notifications error:', e)
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
      const instances = useInstancesStore()
      const byInstance = new Map<string, string>()
      for (const n of this.notifications) {
        if (!byInstance.has(n._instanceId)) {
          byInstance.set(n._instanceId, n.id)
        }
      }

      await Promise.all(
        [...byInstance.entries()].map(async ([instanceId, topId]) => {
          try {
            const client = clientFor(instanceId)
            await (client.v1.markers as any).create({
              notifications: { lastReadId: topId },
            })
          } catch (e) {
            console.warn(`Failed to mark notifications read on ${instanceId}:`, e)
          }
          this.persistLastRead(instanceId, topId)
        }),
      )

      // Also seed accounts with no loaded notifs from authenticated list
      for (const inst of instances.authenticatedInstances) {
        if (!this.lastReadByInstance[inst.id] && byInstance.has(inst.id)) {
          /* already persisted above */
        }
      }

      this.unreadCount = 0
    },

    async dismissNotification(keyOrId: string) {
      const notif =
        this.notifications.find((n) => n._key === keyOrId) ||
        this.notifications.find((n) => n.id === keyOrId)
      if (!notif) return

      try {
        const client = clientFor(notif._instanceId)
        await client.v1.notifications.$select(notif.id).dismiss()
        this.notifications = this.notifications.filter((n) => n._key !== notif._key)
        this.recomputeUnread()
      } catch (e) {
        console.error('Failed to dismiss notification:', e)
      }
    },

    async clearAll() {
      const instances = useInstancesStore()
      const authed = instances.authenticatedInstances
      if (!authed.length) return

      try {
        await Promise.all(
          authed.map(async (inst) => {
            try {
              const client = clientFor(inst.id)
              await client.v1.notifications.clear()
            } catch (e) {
              console.warn(`Failed to clear notifications on ${inst.url}:`, e)
            }
          }),
        )
        this.notifications = []
        this.unreadCount = 0
        this.cursors = {}
      } catch (e) {
        console.error('Failed to clear notifications:', e)
      }
    },
  },
})
