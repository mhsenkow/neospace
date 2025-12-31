/**
 * NeoSpace Timeline Store
 * 
 * Manages fetching and caching timeline data from the Mastodon API.
 */

import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'
import { useAuthStore } from './auth'

type TimelineType = 'home' | 'local' | 'federated' | 'hashtag' | 'list'

interface TimelineState {
  statuses: mastodon.v1.Status[]
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  currentType: TimelineType
  hasMore: boolean
  // Pagination cursors
  minId: string | null
  maxId: string | null
}

export const useTimelineStore = defineStore('timeline', {
  state: (): TimelineState => ({
    statuses: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    currentType: 'home',
    hasMore: true,
    minId: null,
    maxId: null,
  }),

  getters: {
    isEmpty: (state): boolean => state.statuses.length === 0,
  },

  actions: {
    /**
     * Get an authenticated API client
     */
    getClient(): mastodon.rest.Client {
      const authStore = useAuthStore()
      
      if (!authStore.instanceUrl || !authStore.accessToken) {
        throw new Error('Not authenticated')
      }
      
      return createRestAPIClient({
        url: authStore.instanceUrl,
        accessToken: authStore.accessToken,
      })
    },

    /**
     * Fetch the home timeline
     */
    async fetchHomeTimeline(refresh = false) {
      const authStore = useAuthStore()
      if (!authStore.isAuthenticated) {
        this.error = 'Please log in to view your home timeline'
        return
      }

      if (refresh) {
        this.statuses = []
        this.maxId = null
        this.minId = null
        this.hasMore = true
      }

      this.isLoading = true
      this.error = null
      this.currentType = 'home'

      try {
        const client = this.getClient()
        const statuses = await client.v1.timelines.home.list({
          limit: 20,
        })

        this.statuses = statuses
        
        if (statuses.length > 0) {
          this.maxId = statuses[statuses.length - 1].id
          this.minId = statuses[0].id
        }
        
        // Timelines always have more history unless empty
        this.hasMore = statuses.length > 0
      } catch (e: any) {
        this.error = e.message || 'Failed to fetch timeline'
        console.error('Timeline fetch error:', e)
      } finally {
        this.isLoading = false
      }
    },

    /**
     * Fetch the local timeline (public, no auth needed)
     */
    async fetchLocalTimeline(instanceUrl?: string, refresh = false) {
      const authStore = useAuthStore()
      const url = instanceUrl || authStore.instanceUrl
      
      if (!url) {
        this.error = 'No instance URL provided'
        return
      }

      if (refresh) {
        this.statuses = []
        this.maxId = null
        this.minId = null
        this.hasMore = true
      }

      this.isLoading = true
      this.error = null
      this.currentType = 'local'

      try {
        const client = createRestAPIClient({
          url,
          accessToken: authStore.accessToken || undefined,
        })
        
        const statuses = await client.v1.timelines.public.list({
          local: true,
          limit: 20,
        })

        this.statuses = statuses
        
        if (statuses.length > 0) {
          this.maxId = statuses[statuses.length - 1].id
          this.minId = statuses[0].id
        }
        
        this.hasMore = statuses.length > 0
      } catch (e: any) {
        this.error = e.message || 'Failed to fetch local timeline'
        console.error('Local timeline fetch error:', e)
      } finally {
        this.isLoading = false
      }
    },

    /**
     * Fetch the federated timeline
     */
    async fetchFederatedTimeline(instanceUrl?: string, refresh = false) {
      const authStore = useAuthStore()
      const url = instanceUrl || authStore.instanceUrl
      
      if (!url) {
        this.error = 'No instance URL provided'
        return
      }

      if (refresh) {
        this.statuses = []
        this.maxId = null
        this.minId = null
        this.hasMore = true
      }

      this.isLoading = true
      this.error = null
      this.currentType = 'federated'

      try {
        const client = createRestAPIClient({
          url,
          accessToken: authStore.accessToken || undefined,
        })
        
        const statuses = await client.v1.timelines.public.list({
          local: false,
          limit: 20,
        })

        this.statuses = statuses
        
        if (statuses.length > 0) {
          this.maxId = statuses[statuses.length - 1].id
          this.minId = statuses[0].id
        }
        
        this.hasMore = statuses.length > 0
      } catch (e: any) {
        this.error = e.message || 'Failed to fetch federated timeline'
        console.error('Federated timeline fetch error:', e)
      } finally {
        this.isLoading = false
      }
    },

    /**
     * Load more statuses (pagination)
     */
    async loadMore() {
      if (this.isLoadingMore || !this.hasMore || !this.maxId) return
      
      const authStore = useAuthStore()
      if (!authStore.instanceUrl) return

      this.isLoadingMore = true

      try {
        const client = createRestAPIClient({
          url: authStore.instanceUrl,
          accessToken: authStore.accessToken || undefined,
        })

        let statuses: mastodon.v1.Status[] = []

        switch (this.currentType) {
          case 'home':
            statuses = await client.v1.timelines.home.list({
              maxId: this.maxId,
              limit: 20,
            })
            break
          case 'local':
            statuses = await client.v1.timelines.public.list({
              local: true,
              maxId: this.maxId,
              limit: 20,
            })
            break
          case 'federated':
            statuses = await client.v1.timelines.public.list({
              local: false,
              maxId: this.maxId,
              limit: 20,
            })
            break
        }

        if (statuses.length > 0) {
          this.statuses = [...this.statuses, ...statuses]
          this.maxId = statuses[statuses.length - 1].id
        }
        
        // Only stop if we got zero results - timelines always have more history
        this.hasMore = statuses.length > 0
      } catch (e: any) {
        console.error('Load more error:', e)
      } finally {
        this.isLoadingMore = false
      }
    },

    /**
     * Post a new status
     */
    async postStatus(content: string, options: {
      visibility?: 'public' | 'unlisted' | 'private' | 'direct'
      spoilerText?: string
      mediaIds?: string[]
      inReplyToId?: string
    } = {}) {
      const authStore = useAuthStore()
      if (!authStore.isAuthenticated) {
        throw new Error('Not authenticated')
      }

      const client = this.getClient()
      
      const status = await client.v1.statuses.create({
        status: content,
        visibility: options.visibility || 'public',
        spoilerText: options.spoilerText,
        mediaIds: options.mediaIds,
        inReplyToId: options.inReplyToId,
      })

      // Add to top of timeline
      this.statuses = [status, ...this.statuses]
      
      return status
    },

    /**
     * Resolve a status URL to get the local ID on the user's instance
     * This is needed when interacting with posts from other instances
     */
    async resolveStatus(statusUrl: string): Promise<string | null> {
      try {
        const client = this.getClient()
        const results = await client.v2.search.fetch({
          q: statusUrl,
          resolve: true,
          type: 'statuses',
          limit: 1,
        })
        
        if (results.statuses.length > 0) {
          return results.statuses[0].id
        }
        return null
      } catch (e) {
        console.warn('Failed to resolve status:', e)
        return null
      }
    },

    /**
     * Favourite a status
     * statusId: The status ID
     * statusUrl: The original URL of the status (for cross-instance resolution)
     */
    async favouriteStatus(statusId: string, statusUrl?: string) {
      const client = this.getClient()
      
      // Try with the provided ID first
      try {
        const updated = await client.v1.statuses.$select(statusId).favourite()
        
        // Update in list
        const index = this.statuses.findIndex(s => s.id === statusId)
        if (index !== -1) {
          this.statuses[index] = updated
        }
        
        return updated
      } catch (e: any) {
        // If 404 and we have a URL, try to resolve it
        if (e.status === 404 && statusUrl) {
          const localId = await this.resolveStatus(statusUrl)
          if (localId) {
            const updated = await client.v1.statuses.$select(localId).favourite()
            
            // Update in list using original ID
            const index = this.statuses.findIndex(s => s.id === statusId)
            if (index !== -1) {
              this.statuses[index] = { ...updated, id: statusId } // Keep original ID for UI consistency
            }
            
            return updated
          }
        }
        throw e
      }
    },

    /**
     * Unfavourite a status
     */
    async unfavouriteStatus(statusId: string, statusUrl?: string) {
      const client = this.getClient()
      
      try {
        const updated = await client.v1.statuses.$select(statusId).unfavourite()
        
        const index = this.statuses.findIndex(s => s.id === statusId)
        if (index !== -1) {
          this.statuses[index] = updated
        }
        
        return updated
      } catch (e: any) {
        if (e.status === 404 && statusUrl) {
          const localId = await this.resolveStatus(statusUrl)
          if (localId) {
            const updated = await client.v1.statuses.$select(localId).unfavourite()
            
            const index = this.statuses.findIndex(s => s.id === statusId)
            if (index !== -1) {
              this.statuses[index] = { ...updated, id: statusId }
            }
            
            return updated
          }
        }
        throw e
      }
    },

    /**
     * Boost/reblog a status
     */
    async boostStatus(statusId: string, statusUrl?: string) {
      const client = this.getClient()
      
      try {
        const updated = await client.v1.statuses.$select(statusId).reblog()
        
        const index = this.statuses.findIndex(s => s.id === statusId)
        if (index !== -1) {
          this.statuses[index] = updated.reblog || updated
        }
        
        return updated
      } catch (e: any) {
        if (e.status === 404 && statusUrl) {
          const localId = await this.resolveStatus(statusUrl)
          if (localId) {
            const updated = await client.v1.statuses.$select(localId).reblog()
            
            const index = this.statuses.findIndex(s => s.id === statusId)
            if (index !== -1) {
              this.statuses[index] = { ...(updated.reblog || updated), id: statusId }
            }
            
            return updated
          }
        }
        throw e
      }
    },

    /**
     * Unboost a status
     */
    async unboostStatus(statusId: string, statusUrl?: string) {
      const client = this.getClient()
      
      try {
        const updated = await client.v1.statuses.$select(statusId).unreblog()
        
        const index = this.statuses.findIndex(s => s.id === statusId)
        if (index !== -1) {
          this.statuses[index] = updated
        }
        
        return updated
      } catch (e: any) {
        if (e.status === 404 && statusUrl) {
          const localId = await this.resolveStatus(statusUrl)
          if (localId) {
            const updated = await client.v1.statuses.$select(localId).unreblog()
            
            const index = this.statuses.findIndex(s => s.id === statusId)
            if (index !== -1) {
              this.statuses[index] = { ...updated, id: statusId }
            }
            
            return updated
          }
        }
        throw e
      }
    },

    /**
     * Bookmark a status (Save)
     */
    async bookmarkStatus(statusId: string) {
      const client = this.getClient()
      const updated = await client.v1.statuses.$select(statusId).bookmark()
      
      const index = this.statuses.findIndex(s => s.id === statusId)
      if (index !== -1) {
        this.statuses[index] = updated
      }
      
      return updated
    },

    /**
     * Unbookmark a status
     */
    async unbookmarkStatus(statusId: string) {
      const client = this.getClient()
      const updated = await client.v1.statuses.$select(statusId).unbookmark()
      
      const index = this.statuses.findIndex(s => s.id === statusId)
      if (index !== -1) {
        this.statuses[index] = updated
      }
      
      return updated
    },

    /**
     * Mute an account
     */
    async muteAccount(accountId: string) {
      const client = this.getClient()
      await client.v1.accounts.$select(accountId).mute()
      
      // Remove their posts from timeline
      this.statuses = this.statuses.filter(s => 
        s.account.id !== accountId && 
        (!s.reblog || s.reblog.account.id !== accountId)
      )
    },

    /**
     * Unmute an account
     */
    async unmuteAccount(accountId: string) {
      const client = this.getClient()
      await client.v1.accounts.$select(accountId).unmute()
    },

    /**
     * Block an account
     */
    async blockAccount(accountId: string) {
      const client = this.getClient()
      await client.v1.accounts.$select(accountId).block()
      
      // Remove their posts from timeline
      this.statuses = this.statuses.filter(s => 
        s.account.id !== accountId && 
        (!s.reblog || s.reblog.account.id !== accountId)
      )
    },

    /**
     * Unblock an account
     */
    async unblockAccount(accountId: string) {
      const client = this.getClient()
      await client.v1.accounts.$select(accountId).unblock()
    },

    /**
     * Report a status
     */
    async reportStatus(statusId: string, accountId: string, comment?: string) {
      const client = this.getClient()
      await client.v1.reports.create({
        accountId,
        statusIds: [statusId],
        comment: comment || '',
      })
    },

    /**
     * Clear the timeline
     */
    clear() {
      this.statuses = []
      this.maxId = null
      this.minId = null
      this.hasMore = true
      this.error = null
    }
  }
})

