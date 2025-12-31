/**
 * NeoSpace Multi-Instance Store
 * 
 * Manages connections to multiple Mastodon/ActivityPub instances.
 * Supports both authenticated accounts and "watching" instances without login.
 */

import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'

export interface ConnectedInstance {
  id: string // Unique identifier
  url: string // Base URL (e.g., https://mastodon.social)
  name: string // Display name (e.g., "Mastodon Social")
  // Auth (optional - null means just watching public timelines)
  accessToken: string | null
  clientId: string | null
  clientSecret: string | null
  // User info (if authenticated)
  user: mastodon.v1.Account | null
  // Instance info
  instanceInfo: {
    title?: string
  thumbnail?: string
    description?: string
  } | null
  // Status
  isConnecting: boolean
  error: string | null
  lastFetched: string | null
}

export interface ExtendedStatus extends mastodon.v1.Status {
  _instanceId: string // Track which instance this came from
  _instanceUrl: string
}

interface MultiInstanceState {
  instances: ConnectedInstance[]
  activeInstanceFilter: string | null // null = show all, or instance ID
  isLoading: boolean
}

const STORAGE_KEY = 'neospace_instances'
const APP_NAME = 'NeoSpace'
const SCOPES = 'read write follow push'

// Helper to get redirect URI
const getRedirectUri = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000/auth/callback'
  return `${window.location.origin}/auth/callback`
}

// Generate a simple unique ID
const generateId = () => Math.random().toString(36).substring(2, 15)

export const useInstancesStore = defineStore('instances', {
  state: (): MultiInstanceState => ({
    instances: [],
    activeInstanceFilter: null,
    isLoading: false,
  }),

  getters: {
    // Get all connected instances
    connectedInstances: (state): ConnectedInstance[] => state.instances,
    
    // Get only authenticated instances
    authenticatedInstances: (state): ConnectedInstance[] => 
      state.instances.filter(i => i.accessToken && i.user),
    
    // Get only watching (non-authenticated) instances
    watchingInstances: (state): ConnectedInstance[] => 
      state.instances.filter(i => !i.accessToken),
    
    // Check if any instance is authenticated
    hasAuthenticatedInstance: (state): boolean => 
      state.instances.some(i => i.accessToken && i.user),
    
    // Get primary instance (first authenticated one)
    primaryInstance: (state): ConnectedInstance | null => 
      state.instances.find(i => i.accessToken && i.user) || null,
    
    // Get instance by ID
    getInstance: (state) => (id: string): ConnectedInstance | undefined =>
      state.instances.find(i => i.id === id),
    
    // Get instance by URL
    getInstanceByUrl: (state) => (url: string): ConnectedInstance | undefined => {
      const normalizedUrl = url.replace(/\/+$/, '').toLowerCase()
      return state.instances.find(i => 
        i.url.toLowerCase() === normalizedUrl
      )
    },
  },

  actions: {
    /**
     * Load saved instances from localStorage
     */
    loadFromStorage() {
      if (typeof window === 'undefined') return
      
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const data = JSON.parse(saved)
          // Restore instances, but reset transient state
          this.instances = (data.instances || []).map((i: ConnectedInstance) => ({
            ...i,
            isConnecting: false,
            error: null,
          }))
          this.activeInstanceFilter = data.activeInstanceFilter || null
        }
      } catch (e) {
        console.error('Failed to load instances from storage:', e)
      }
    },

    /**
     * Save instances to localStorage
     */
    saveToStorage() {
      if (typeof window === 'undefined') return
      
      try {
        // Don't save transient state
        const toSave = {
          instances: this.instances.map(i => ({
            ...i,
            isConnecting: false,
            error: null,
          })),
          activeInstanceFilter: this.activeInstanceFilter,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
      } catch (e) {
        console.error('Failed to save instances to storage:', e)
      }
    },

    /**
     * Add a new instance (just watching, no auth)
     */
    async addInstance(instanceUrl: string): Promise<ConnectedInstance> {
      const url = instanceUrl.replace(/\/+$/, '')
      
      // Check if already connected
      const existing = this.getInstanceByUrl(url)
      if (existing) {
        throw new Error('Already connected to this instance')
      }
      
      const instance: ConnectedInstance = {
        id: generateId(),
        url,
        name: url.replace('https://', ''),
        accessToken: null,
        clientId: null,
        clientSecret: null,
        user: null,
        instanceInfo: null,
        isConnecting: true,
        error: null,
        lastFetched: null,
      }
      
      this.instances.push(instance)
      
      try {
        // Fetch instance info
        const client = createRestAPIClient({ url })
        const info = await client.v2.instance.fetch()
        
        instance.name = info.title || url.replace('https://', '')
        instance.instanceInfo = {
          title: info.title,
          thumbnail: info.thumbnail?.url,
          description: info.description,
        }
        instance.isConnecting = false
        instance.lastFetched = new Date().toISOString()
        
        this.saveToStorage()
        return instance
      } catch (e: any) {
        instance.error = e.message || 'Failed to connect'
        instance.isConnecting = false
        throw e
      }
    },

    /**
     * Remove an instance
     */
    removeInstance(instanceId: string) {
      const index = this.instances.findIndex(i => i.id === instanceId)
      if (index !== -1) {
        this.instances.splice(index, 1)
        this.saveToStorage()
      }
    },

    /**
     * Start OAuth flow for an instance (to log in)
     */
    async startAuth(instanceId: string) {
      const instance = this.instances.find(i => i.id === instanceId)
      if (!instance) throw new Error('Instance not found')
      
      instance.isConnecting = true
      instance.error = null
      
      try {
        const client = createRestAPIClient({ url: instance.url })
        
        // Register the OAuth app
        const app = await client.v1.apps.create({
          clientName: APP_NAME,
          redirectUris: getRedirectUri(),
          scopes: SCOPES,
          website: 'https://neospace.social',
        })
        
        instance.clientId = app.clientId ?? null
        instance.clientSecret = app.clientSecret ?? null
        
        // Store which instance we're authenticating
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('neospace_auth_instance_id', instanceId)
        }
        
        this.saveToStorage()
        
        // Build auth URL
        const params = new URLSearchParams({
          client_id: instance.clientId!,
          redirect_uri: getRedirectUri(),
          response_type: 'code',
          scope: SCOPES,
        })
        
        return `${instance.url}/oauth/authorize?${params.toString()}`
      } catch (e: any) {
        instance.error = e.message || 'Failed to start auth'
        instance.isConnecting = false
        throw e
      }
    },

    /**
     * Complete OAuth flow after callback
     */
    async completeAuth(code: string) {
      // Get the instance ID from session storage
      const instanceId = typeof window !== 'undefined' 
        ? sessionStorage.getItem('neospace_auth_instance_id')
        : null
        
      if (!instanceId) {
        throw new Error('No pending authentication')
      }
      
      const instance = this.instances.find(i => i.id === instanceId)
      if (!instance) throw new Error('Instance not found')
      
      instance.isConnecting = true
      
      try {
        if (!instance.clientId || !instance.clientSecret) {
          throw new Error('Missing OAuth credentials')
        }
        
        // Exchange code for token
        const response = await fetch(`${instance.url}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: instance.clientId,
            client_secret: instance.clientSecret,
            redirect_uri: getRedirectUri(),
            grant_type: 'authorization_code',
            code,
            scope: SCOPES,
          }),
        })
        
        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error_description || error.error || 'Token exchange failed')
        }
        
        const data = await response.json()
        instance.accessToken = data.access_token
        
        // Fetch user info
        const client = createRestAPIClient({
          url: instance.url,
          accessToken: instance.accessToken!,
        })
        
        instance.user = await client.v1.accounts.verifyCredentials()
        instance.isConnecting = false
        instance.error = null
        
        // Clear session storage
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('neospace_auth_instance_id')
        }
        
        this.saveToStorage()
        return instance
      } catch (e: any) {
        instance.error = e.message || 'Authentication failed'
        instance.isConnecting = false
        throw e
      }
    },

    /**
     * Logout from an instance (but keep watching)
     */
    async logoutInstance(instanceId: string) {
      const instance = this.instances.find(i => i.id === instanceId)
      if (!instance) return
      
      // Revoke token if possible
      if (instance.accessToken && instance.clientId && instance.clientSecret) {
        try {
          await fetch(`${instance.url}/oauth/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: instance.clientId,
              client_secret: instance.clientSecret,
              token: instance.accessToken,
            }),
          })
        } catch (e) {
          // Ignore
        }
      }
      
      instance.accessToken = null
      instance.clientId = null
      instance.clientSecret = null
      instance.user = null
      
      this.saveToStorage()
    },

    /**
     * Verify all authenticated instances (refresh user data)
     */
    async verifyAllInstances() {
      const promises = this.instances
        .filter(i => i.accessToken)
        .map(async (instance) => {
          try {
            const client = createRestAPIClient({
              url: instance.url,
              accessToken: instance.accessToken!,
            })
            instance.user = await client.v1.accounts.verifyCredentials()
            instance.error = null
          } catch (e: any) {
            if (e.status === 401 || e.status === 403) {
              // Token invalid, logout
              instance.accessToken = null
              instance.user = null
            }
            instance.error = 'Session expired'
          }
        })
      
      await Promise.all(promises)
      this.saveToStorage()
    },

    /**
     * Set the active instance filter
     */
    setFilter(instanceId: string | null) {
      this.activeInstanceFilter = instanceId
    },

    /**
     * Initialize: load from storage and verify
     */
    async initialize() {
      this.loadFromStorage()
      
      // If no instances, add default one for viewing
      if (this.instances.length === 0) {
        try {
          await this.addInstance('https://mastodon.social')
        } catch (e) {
          console.warn('Failed to add default instance')
        }
      }
      
      // Verify authenticated instances
      await this.verifyAllInstances()
    },

    /**
     * Get API client for an instance
     */
    getClient(instanceId: string): mastodon.rest.Client {
      const instance = this.instances.find(i => i.id === instanceId)
      if (!instance) throw new Error('Instance not found')
      
      return createRestAPIClient({
        url: instance.url,
        accessToken: instance.accessToken || undefined,
      })
    },

    /**
     * Fetch merged timeline from all instances
     */
    async fetchMergedTimeline(
      type: 'local' | 'federated' = 'local',
      limit: number = 20
    ): Promise<ExtendedStatus[]> {
      const allStatuses: ExtendedStatus[] = []
      
      const fetchPromises = this.instances.map(async (instance) => {
        try {
          const client = createRestAPIClient({
            url: instance.url,
            accessToken: instance.accessToken || undefined,
          })
          
          const statuses = await client.v1.timelines.public.list({
            local: type === 'local',
            limit,
          })
          
          // Add instance metadata to each status
          return statuses.map(s => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          }))
        } catch (e) {
          console.warn(`Failed to fetch from ${instance.url}:`, e)
          return []
        }
      })
      
      const results = await Promise.all(fetchPromises)
      
      // Merge all statuses
      results.forEach(statuses => allStatuses.push(...statuses))
      
      // Sort by created date (newest first)
      allStatuses.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      
      return allStatuses
    },

    /**
     * Fetch home timeline (only from authenticated instances)
     */
    async fetchMergedHomeTimeline(limit: number = 20): Promise<ExtendedStatus[]> {
      const allStatuses: ExtendedStatus[] = []
      
      const authInstances = this.instances.filter(i => i.accessToken)
      
      const fetchPromises = authInstances.map(async (instance) => {
        try {
          const client = createRestAPIClient({
            url: instance.url,
            accessToken: instance.accessToken!,
          })
          
          const statuses = await client.v1.timelines.home.list({ limit })
          
          return statuses.map(s => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          }))
        } catch (e) {
          console.warn(`Failed to fetch home from ${instance.url}:`, e)
          return []
        }
      })
      
      const results = await Promise.all(fetchPromises)
      results.forEach(statuses => allStatuses.push(...statuses))
      
      // Sort by created date
      allStatuses.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      
      return allStatuses
    },
  },
})
