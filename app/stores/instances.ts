/**
 * NeoSpace Multi-Instance / Accounts Store
 *
 * Single source of truth for connected instances and authenticated accounts.
 * Supports watching public timelines and multi-account OAuth.
 */

import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'
import {
  DEFAULT_PUBLIC_INSTANCE,
  isAuthGatedPublicHost,
} from '~/utils/instances'

export interface ConnectedInstance {
  id: string
  url: string
  name: string
  accessToken: string | null
  clientId: string | null
  clientSecret: string | null
  user: mastodon.v1.Account | null
  instanceInfo: {
    title?: string
    thumbnail?: string
    description?: string
  } | null
  isConnecting: boolean
  error: string | null
  lastFetched: string | null
}

export interface ExtendedStatus extends mastodon.v1.Status {
  _instanceId: string
  _instanceUrl: string
}

export interface InstanceApiInfo {
  title: string
  description: string
  stats?: {
    userCount?: number
    statusCount?: number
    domainCount?: number
  }
  registrations?: boolean
  languages?: string[]
  rules?: Array<{ id: string; text: string }>
}

interface MultiInstanceState {
  instances: ConnectedInstance[]
  activeAccountId: string | null
  activeInstanceFilter: string | null
  isLoading: boolean
  isInitialized: boolean
  previewingInstance: string | null
  previewLoading: boolean
  previewError: string | null
  previewTimeline: mastodon.v1.Status[]
  previewInstanceInfo: Record<string, InstanceApiInfo>
}

const STORAGE_KEY = 'neospace_instances'
const LEGACY_AUTH_KEY = 'neospace_auth'
const APP_NAME = 'NeoSpace'
const SCOPES = 'read write follow push'

const getRedirectUri = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000/auth/callback'
  return `${window.location.origin}/auth/callback`
}

const generateId = () => Math.random().toString(36).substring(2, 15)

function extractCustomCSS(user: mastodon.v1.Account | null): string {
  if (!user?.fields) return ''
  const cssField = user.fields.find((field) =>
    ['css', 'custom_css', 'theme', 'style', 'chaos_css'].includes(
      field.name.toLowerCase().replace(/[^a-z_]/g, ''),
    ),
  )
  return cssField?.value || ''
}

export const useInstancesStore = defineStore('instances', {
  state: (): MultiInstanceState => ({
    instances: [],
    activeAccountId: null,
    activeInstanceFilter: null,
    isLoading: false,
    isInitialized: false,
    previewingInstance: null,
    previewLoading: false,
    previewError: null,
    previewTimeline: [],
    previewInstanceInfo: {},
  }),

  getters: {
    connectedInstances: (state): ConnectedInstance[] => state.instances,

    authenticatedInstances: (state): ConnectedInstance[] =>
      state.instances.filter((i) => i.accessToken && i.user),

    watchingInstances: (state): ConnectedInstance[] =>
      state.instances.filter((i) => !i.accessToken),

    hasAuthenticatedInstance: (state): boolean =>
      state.instances.some((i) => i.accessToken && i.user),

    activeAccount(state): ConnectedInstance | null {
      if (state.activeAccountId) {
        const selected = state.instances.find(
          (i) => i.id === state.activeAccountId && i.accessToken && i.user,
        )
        if (selected) return selected
      }
      return state.instances.find((i) => i.accessToken && i.user) || null
    },

    primaryInstance(): ConnectedInstance | null {
      return this.activeAccount
    },

    isAuthenticated(): boolean {
      return !!this.activeAccount
    },

    instanceUrl(): string | null {
      return this.activeAccount?.url ?? null
    },

    accessToken(): string | null {
      return this.activeAccount?.accessToken ?? null
    },

    currentUser(): mastodon.v1.Account | null {
      return this.activeAccount?.user ?? null
    },

    userDisplayName(): string {
      const user = this.activeAccount?.user
      if (!user) return 'Guest'
      return user.displayName || user.username
    },

    userAvatar(): string | null {
      return this.activeAccount?.user?.avatar || null
    },

    userCustomCSS(): string {
      return extractCustomCSS(this.activeAccount?.user ?? null)
    },

    getInstanceById: (state) => (id: string): ConnectedInstance | undefined =>
      state.instances.find((i) => i.id === id),

    getInstanceByUrl: (state) => (url: string): ConnectedInstance | undefined => {
      const normalizedUrl = url.replace(/\/+$/, '').toLowerCase()
      return state.instances.find((i) => i.url.toLowerCase() === normalizedUrl)
    },

    getInstance: (state) => (domain: string): InstanceApiInfo | null => {
      return state.previewInstanceInfo[domain] || null
    },
  },

  actions: {
    loadFromStorage() {
      if (typeof window === 'undefined') return

      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const data = JSON.parse(saved)
          this.instances = (data.instances || []).map((i: ConnectedInstance) => ({
            ...i,
            isConnecting: false,
            error: null,
          }))
          this.activeInstanceFilter = data.activeInstanceFilter || null
          this.activeAccountId = data.activeAccountId || null
        }
      } catch (e) {
        console.error('Failed to load instances from storage:', e)
      }
    },

    saveToStorage() {
      if (typeof window === 'undefined') return

      try {
        const toSave = {
          instances: this.instances.map((i) => ({
            ...i,
            isConnecting: false,
            error: null,
          })),
          activeInstanceFilter: this.activeInstanceFilter,
          activeAccountId: this.activeAccountId,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
      } catch (e) {
        console.error('Failed to save instances to storage:', e)
      }
    },

    migrateLegacyAuth() {
      if (typeof window === 'undefined') return

      try {
        const raw = localStorage.getItem(LEGACY_AUTH_KEY)
        if (!raw) return

        const data = JSON.parse(raw)
        if (!data.instanceUrl || !data.accessToken) {
          localStorage.removeItem(LEGACY_AUTH_KEY)
          return
        }

        const url = String(data.instanceUrl).replace(/\/+$/, '')
        let instance = this.getInstanceByUrl(url)
        if (!instance) {
          instance = {
            id: generateId(),
            url,
            name: url.replace(/^https?:\/\//, ''),
            accessToken: data.accessToken,
            clientId: data.clientId || null,
            clientSecret: data.clientSecret || null,
            user: null,
            instanceInfo: null,
            isConnecting: false,
            error: null,
            lastFetched: null,
          }
          this.instances.push(instance)
        } else if (!instance.accessToken) {
          instance.accessToken = data.accessToken
          instance.clientId = data.clientId || instance.clientId
          instance.clientSecret = data.clientSecret || instance.clientSecret
        }

        if (!this.activeAccountId && instance) {
          this.activeAccountId = instance.id
        }

        this.saveToStorage()
        localStorage.removeItem(LEGACY_AUTH_KEY)
      } catch (e) {
        console.warn('Failed to migrate legacy auth:', e)
      }
    },

    setActiveAccount(instanceId: string | null) {
      this.activeAccountId = instanceId
      this.saveToStorage()
    },

    updateActiveAccount(user: mastodon.v1.Account) {
      const account = this.instances.find((i) => i.id === this.activeAccount?.id)
      if (!account) return
      account.user = user
      this.saveToStorage()
    },

    async addInstance(instanceUrl: string): Promise<ConnectedInstance> {
      const url = instanceUrl.replace(/\/+$/, '')

      const existing = this.getInstanceByUrl(url)
      if (existing) {
        throw new Error('Already watching this server')
      }

      const instance: ConnectedInstance = {
        id: generateId(),
        url,
        name: url.replace(/^https?:\/\//, ''),
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
        const client = createRestAPIClient({ url })
        const info = await client.v2.instance.fetch()

        instance.name = info.title || url.replace(/^https?:\/\//, '')
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

    removeInstance(instanceId: string) {
      const index = this.instances.findIndex((i) => i.id === instanceId)
      if (index !== -1) {
        this.instances.splice(index, 1)
        if (this.activeAccountId === instanceId) {
          this.activeAccountId = this.authenticatedInstances[0]?.id ?? null
        }
        this.saveToStorage()
      }
    },

    /**
     * Login flow for /login — add instance if needed, then start OAuth
     */
    async loginWithInstance(instanceUrl: string): Promise<string> {
      const url = instanceUrl.replace(/\/+$/, '')
      let instance = this.getInstanceByUrl(url)
      if (!instance) {
        instance = await this.addInstance(url)
      }
      return await this.startAuth(instance.id)
    },

    async startAuth(instanceId: string) {
      const instance = this.instances.find((i) => i.id === instanceId)
      if (!instance) throw new Error('Server not found')

      instance.isConnecting = true
      instance.error = null

      try {
        const client = createRestAPIClient({ url: instance.url })

        const app = await client.v1.apps.create({
          clientName: APP_NAME,
          redirectUris: getRedirectUri(),
          scopes: SCOPES,
          website: 'https://neospace.ibm.io',
        })

        instance.clientId = app.clientId ?? null
        instance.clientSecret = app.clientSecret ?? null

        if (typeof window !== 'undefined') {
          sessionStorage.setItem('neospace_auth_instance_id', instanceId)
        }

        this.saveToStorage()

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

    async completeAuth(code: string) {
      const instanceId =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('neospace_auth_instance_id')
          : null

      if (!instanceId) {
        throw new Error('No pending authentication')
      }

      const instance = this.instances.find((i) => i.id === instanceId)
      if (!instance) throw new Error('Instance not found')

      instance.isConnecting = true

      try {
        if (!instance.clientId || !instance.clientSecret) {
          throw new Error('Missing OAuth credentials')
        }

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

        const client = createRestAPIClient({
          url: instance.url,
          accessToken: instance.accessToken!,
        })

        instance.user = await client.v1.accounts.verifyCredentials()
        instance.isConnecting = false
        instance.error = null

        this.activeAccountId = instance.id

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

    async logoutInstance(instanceId: string) {
      const instance = this.instances.find((i) => i.id === instanceId)
      if (!instance) return

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
        } catch {
          // Ignore
        }
      }

      instance.accessToken = null
      instance.clientId = null
      instance.clientSecret = null
      instance.user = null

      if (this.activeAccountId === instanceId) {
        this.activeAccountId = this.authenticatedInstances[0]?.id ?? null
      }

      this.saveToStorage()
    },

    /** Log out of the active account */
    async logout() {
      const account = this.activeAccount
      if (account) {
        await this.logoutInstance(account.id)
      }
    },

    async verifyAllInstances() {
      const promises = this.instances
        .filter((i) => i.accessToken)
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
              instance.accessToken = null
              instance.user = null
            }
            instance.error = 'Session expired'
          }
        })

      await Promise.all(promises)

      if (
        this.activeAccountId &&
        !this.instances.some(
          (i) => i.id === this.activeAccountId && i.accessToken && i.user,
        )
      ) {
        this.activeAccountId = this.authenticatedInstances[0]?.id ?? null
      }

      this.saveToStorage()
    },

    setFilter(instanceId: string | null) {
      this.activeInstanceFilter = instanceId
    },

    async initialize() {
      this.loadFromStorage()
      this.migrateLegacyAuth()

      const gatedWatchOnly = this.instances.filter(
        (i) => !i.accessToken && isAuthGatedPublicHost(i.url),
      )
      for (const instance of gatedWatchOnly) {
        this.instances = this.instances.filter((i) => i.id !== instance.id)
      }
      if (gatedWatchOnly.length > 0) {
        this.saveToStorage()
      }

      if (this.instances.length === 0) {
        try {
          await this.addInstance(DEFAULT_PUBLIC_INSTANCE)
        } catch {
          console.warn('Failed to add default instance')
        }
      }

      await this.verifyAllInstances()
      this.isInitialized = true
    },

    getClient(instanceId: string): mastodon.rest.Client {
      const instance = this.instances.find((i) => i.id === instanceId)
      if (!instance) throw new Error('Instance not found')

      return createRestAPIClient({
        url: instance.url,
        accessToken: instance.accessToken || undefined,
      })
    },

    async fetchMergedTimeline(
      type: 'local' | 'federated' = 'local',
      limit: number = 20,
    ): Promise<ExtendedStatus[]> {
      const allStatuses: ExtendedStatus[] = []
      const errors: string[] = []

      const targets = this.activeInstanceFilter
        ? this.instances.filter((i) => i.id === this.activeInstanceFilter)
        : this.instances

      const fetchPromises = targets.map(async (instance) => {
        try {
          if (!instance.accessToken && isAuthGatedPublicHost(instance.url)) {
            errors.push(`${instance.name} requires login for public timelines`)
            return []
          }

          const client = createRestAPIClient({
            url: instance.url,
            accessToken: instance.accessToken || undefined,
          })

          const statuses = await client.v1.timelines.public.list({
            local: type === 'local',
            limit,
          })

          return statuses.map((s) => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          }))
        } catch (e: any) {
          const message = e?.message || 'Failed to fetch'
          console.warn(`Failed to fetch from ${instance.url}:`, e)
          errors.push(`${instance.name}: ${message}`)
          return []
        }
      })

      const results = await Promise.all(fetchPromises)
      results.forEach((statuses) => allStatuses.push(...statuses))

      if (allStatuses.length === 0 && errors.length > 0 && targets.length > 0) {
        throw new Error(
          errors[0]?.includes('requires login') || errors[0]?.includes('authenticated')
            ? 'This instance requires login to view timelines. Connect an account or add a different instance.'
            : errors[0] || 'Failed to fetch timeline',
        )
      }

      allStatuses.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )

      return allStatuses
    },

    async fetchMergedHomeTimeline(limit: number = 20): Promise<ExtendedStatus[]> {
      const allStatuses: ExtendedStatus[] = []
      const authInstances = this.instances.filter((i) => i.accessToken)

      const fetchPromises = authInstances.map(async (instance) => {
        try {
          const client = createRestAPIClient({
            url: instance.url,
            accessToken: instance.accessToken!,
          })

          const statuses = await client.v1.timelines.home.list({ limit })

          return statuses.map((s) => ({
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
      results.forEach((statuses) => allStatuses.push(...statuses))

      allStatuses.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )

      return allStatuses
    },

    async fetchInstanceInfo(domain: string): Promise<InstanceApiInfo | null> {
      if (this.previewInstanceInfo[domain]) {
        return this.previewInstanceInfo[domain]
      }

      try {
        const url = `https://${domain}`
        const client = createRestAPIClient({ url })
        const info = await client.v2.instance.fetch()
        const apiInfo: InstanceApiInfo = {
          title: info.title,
          description: info.description || '',
          stats: {
            userCount: info.usage?.users?.activeMonth,
          },
          registrations: info.registrations?.enabled,
          languages: info.languages,
          rules: info.rules?.map((r) => ({ id: r.id, text: r.text })),
        }

        this.previewInstanceInfo[domain] = apiInfo
        return apiInfo
      } catch (e) {
        console.warn(`Failed to fetch instance info for ${domain}:`, e)
        return null
      }
    },

    async openPreview(domain: string) {
      this.previewingInstance = domain
      this.previewLoading = true
      this.previewError = null
      this.previewTimeline = []

      try {
        const url = `https://${domain}`
        const client = createRestAPIClient({ url })

        const info = await client.v2.instance.fetch()
        this.previewInstanceInfo[domain] = {
          title: info.title,
          description: info.description || '',
          stats: {
            userCount: info.usage?.users?.activeMonth,
          },
          registrations: info.registrations?.enabled,
          languages: info.languages,
          rules: info.rules?.map((r) => ({ id: r.id, text: r.text })),
        }

        try {
          this.previewTimeline = await client.v1.timelines.public.list({
            local: true,
            limit: 10,
          })
        } catch {
          // Auth-gated public timelines — preview still shows instance info
          this.previewTimeline = []
        }
      } catch (e: any) {
        this.previewError = e.message || 'Failed to load instance'
      } finally {
        this.previewLoading = false
      }
    },

    closePreview() {
      this.previewingInstance = null
      this.previewTimeline = []
      this.previewError = null
    },
  },
})
