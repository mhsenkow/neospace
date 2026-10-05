import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient } from '~/composables/useMasto'

export type NotificationFilterType = 'all' | 'mention' | 'favourite' | 'reblog' | 'follow' | 'poll' | 'status' | 'update'

export type SortOrder = 'newest' | 'oldest'

export interface ExtendedNotification extends mastodon.v1.Notification {
  _instanceUrl?: string
}

interface NotificationsState {
  notifications: ExtendedNotification[]
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  hasMore: boolean
  maxId: string | null
  filter: NotificationFilterType
  sortOrder: SortOrder
  unreadCount: number
  lastReadId: string | null
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

const LAST_READ_KEY = 'neospace_notif_last_read'

export const useNotificationsStore = defineStore('notifications', {
  state: (): NotificationsState => ({
    notifications: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: true,
    maxId: null,
    filter: 'all',
    sortOrder: 'newest',
    unreadCount: 0,
    lastReadId: null,
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
          items = items.filter(n => types.includes(n.type))
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
        if (saved) this.lastReadId = saved
      } catch {
        // ignore
      }
    },

    persistLastRead(id: string | null) {
      this.lastReadId = id
      if (typeof window === 'undefined' || !id) return
      try {
        localStorage.setItem(LAST_READ_KEY, id)
      } catch {
        // ignore
      }
    },

    recomputeUnread() {
      if (!this.lastReadId) {
        this.unreadCount = 0
        return
      }
      this.unreadCount = this.notifications.filter((n) => n.id > this.lastReadId!).length
    },

    /**
     * Lightweight badge refresh — used from layout without loading the full page.
     */
    async refreshUnreadBadge() {
      const instances = useInstancesStore()
      if (!instances.hasAuthenticatedInstance) {
        this.unreadCount = 0
        return
      }

      this.loadLastRead()
      const client = this.getClient()
      if (!client) return

      try {
        const items = await client.v1.notifications.list({ limit: 40 } as any)
        if (!items.length) {
          this.unreadCount = 0
          return
        }

        // First visit: treat current stack as read so badge doesn't explode
        if (!this.lastReadId) {
          this.persistLastRead(items[0].id)
          this.unreadCount = 0
          return
        }

        this.unreadCount = items.filter((n) => n.id > this.lastReadId!).length
      } catch (e) {
        console.warn('Unread badge refresh failed:', e)
      }
    },

    async fetchNotifications(refresh = false) {
      if (this.isLoading) return

      if (refresh) {
        this.notifications = []
        this.maxId = null
        this.hasMore = true
      }

      const client = this.getClient()
      if (!client) {
        this.error = 'Please log in to view notifications'
        return
      }

      this.loadLastRead()
      this.isLoading = true
      this.error = null

      try {
        const params: Record<string, unknown> = { limit: 30 }

        const items = await client.v1.notifications.list(params as any)

        this.notifications = items.map(n => ({ ...n } as ExtendedNotification))

        if (items.length > 0) {
          this.maxId = items[items.length - 1].id
          if (!this.lastReadId) {
            this.persistLastRead(items[0].id)
          }
        }
        this.hasMore = items.length >= 30
        this.recomputeUnread()
      } catch (e: any) {
        this.error = e.message || 'Failed to fetch notifications'
        console.error('Notifications fetch error:', e)
      } finally {
        this.isLoading = false
      }
    },

    async loadMore() {
      if (this.isLoadingMore || !this.hasMore || !this.maxId) return

      const client = this.getClient()
      if (!client) return

      this.isLoadingMore = true

      try {
        const params: Record<string, unknown> = {
          limit: 30,
          max_id: this.maxId,
        }

        const items = await client.v1.notifications.list(params as any)

        if (items.length > 0) {
          const newItems = items.map(n => ({ ...n } as ExtendedNotification))
          this.notifications.push(...newItems)
          this.maxId = items[items.length - 1].id
        }
        this.hasMore = items.length >= 30
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
      const client = this.getClient()
      if (!client) return

      try {
        const topId = this.notifications[0]?.id
        await (client.v1.markers as any).create({
          notifications: { lastReadId: topId },
        })
        if (topId) this.persistLastRead(topId)
        this.unreadCount = 0
      } catch (e) {
        console.warn('Failed to mark notifications as read:', e)
        // Still clear locally so the badge isn't stuck
        const topId = this.notifications[0]?.id
        if (topId) this.persistLastRead(topId)
        this.unreadCount = 0
      }
    },

    async dismissNotification(id: string) {
      const client = this.getClient()
      if (!client) return

      try {
        await client.v1.notifications.$select(id).dismiss()
        this.notifications = this.notifications.filter(n => n.id !== id)
      } catch (e) {
        console.error('Failed to dismiss notification:', e)
      }
    },

    async clearAll() {
      const client = this.getClient()
      if (!client) return

      try {
        await client.v1.notifications.clear()
        this.notifications = []
        this.unreadCount = 0
      } catch (e) {
        console.error('Failed to clear notifications:', e)
      }
    },
  },
})
