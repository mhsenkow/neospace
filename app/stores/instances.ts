import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'

interface InstanceInfo {
  domain: string
  title: string
  description: string
  thumbnail?: string
  stats?: {
    userCount: number
    statusCount: number
  }
  rules?: Array<{ id: string; text: string }>
  languages?: string[]
  registrations?: boolean
}

interface InstanceState {
  instanceCache: Map<string, InstanceInfo>
  timelineCache: Map<string, mastodon.v1.Status[]>
  loading: Set<string>
  previewingInstance: string | null
  previewTimeline: mastodon.v1.Status[]
  previewLoading: boolean
  previewError: string | null
}

export const useInstancesStore = defineStore('instances', {
  state: (): InstanceState => ({
    instanceCache: new Map(),
    timelineCache: new Map(),
    loading: new Set(),
    previewingInstance: null,
    previewTimeline: [],
    previewLoading: false,
    previewError: null
  }),

  getters: {
    isLoading: (state) => (domain: string) => state.loading.has(domain),
    getInstance: (state) => (domain: string) => state.instanceCache.get(domain),
    getTimeline: (state) => (domain: string) => state.timelineCache.get(domain)
  },

  actions: {
    async fetchInstanceInfo(domain: string) {
      if (this.instanceCache.has(domain) || this.loading.has(domain)) {
        return this.instanceCache.get(domain)
      }

      this.loading.add(domain)

      try {
        // Create a client for this instance (no auth needed for public info)
        const client = createRestAPIClient({
          url: `https://${domain}`
        })

        const instance = await client.v2.instance.fetch()
        
        const info: InstanceInfo = {
          domain,
          title: instance.title,
          description: instance.description || '',
          thumbnail: instance.thumbnail?.url,
          stats: {
            userCount: instance.usage?.users?.activeMonth || 0,
            statusCount: 0
          },
          rules: instance.rules?.map(r => ({ id: r.id, text: r.text })) || [],
          languages: instance.languages || [],
          registrations: instance.registrations?.enabled
        }

        this.instanceCache.set(domain, info)
        return info
      } catch (error) {
        console.error(`Failed to fetch instance info for ${domain}:`, error)
        // Return minimal info on error
        const fallback: InstanceInfo = {
          domain,
          title: domain,
          description: 'Could not load instance info'
        }
        this.instanceCache.set(domain, fallback)
        return fallback
      } finally {
        this.loading.delete(domain)
      }
    },

    async fetchPublicTimeline(domain: string, limit = 20) {
      try {
        const client = createRestAPIClient({
          url: `https://${domain}`
        })

        const statuses = await client.v1.timelines.public.list({
          limit,
          local: true // Get local timeline for this instance
        })

        this.timelineCache.set(domain, statuses as unknown as mastodon.v1.Status[])
        return statuses
      } catch (error) {
        console.error(`Failed to fetch timeline for ${domain}:`, error)
        return []
      }
    },

    async openPreview(domain: string) {
      this.previewingInstance = domain
      this.previewLoading = true
      this.previewError = null
      this.previewTimeline = []

      try {
        // Fetch both instance info and timeline
        await this.fetchInstanceInfo(domain)
        const timeline = await this.fetchPublicTimeline(domain)
        this.previewTimeline = timeline as unknown as mastodon.v1.Status[]
      } catch (error) {
        this.previewError = 'Failed to load instance preview'
      } finally {
        this.previewLoading = false
      }
    },

    closePreview() {
      this.previewingInstance = null
      this.previewTimeline = []
      this.previewError = null
    }
  }
})

