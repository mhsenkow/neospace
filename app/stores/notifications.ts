import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'
import { useAuthStore } from './auth'
import { useInstancesStore } from './instances'

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
      const authStore = useAuthStore()
      if (authStore.instanceUrl && authStore.accessToken) {
        return createRestAPIClient({
          url: authStore.instanceUrl,
          accessToken: authStore.accessToken,
        })
      }

      const instancesStore = useInstancesStore()
      const primary = instancesStore.primaryInstance
      if (primary?.accessToken) {
        return instancesStore.getClient(primary.id)
      }

      return null
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

      this.isLoading = true
      this.error = null

      try {
        const params: Record<string, unknown> = { limit: 30 }

        const items = await client.v1.notifications.list(params as any)

        this.notifications = items.map(n => ({ ...n } as ExtendedNotification))

        if (items.length > 0) {
          this.maxId = items[items.length - 1].id
          if (!this.lastReadId) {
            this.lastReadId = items[0].id
          }
        }
        this.hasMore = items.length >= 30
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
        await (client.v1.markers as any).create({
          notifications: { lastReadId: this.notifications[0]?.id },
        })
        this.unreadCount = 0
      } catch (e) {
        console.warn('Failed to mark notifications as read:', e)
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
