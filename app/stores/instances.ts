/**
 * NeoSpace Multi-Instance / Accounts Store
 *
 * Single source of truth for connected instances and authenticated accounts.
 * Supports watching public timelines and multi-account OAuth.
 */

import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'
import {
  beginOAuthChallenge,
  consumeOAuthChallenge,
  stashClientSecret,
  persistClientSecret,
  readClientSecret,
  clearClientSecret,
} from '~/utils/oauthPkce'
import { logError, logWarn } from '~/utils/log'
import {
  DEFAULT_PUBLIC_INSTANCE,
  hostnameOf,
  isAuthGatedPublicHost,
  resolvePublicInstanceUrl,
} from '~/utils/instances'
import { dedupeStatusesByIdentity } from '~/utils/statusIdentity'
import { clearClientCache, clientFor, publicClient } from '~/composables/useMasto'

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
    /** From v2 instance configuration.statuses.max_characters */
    maxCharacters?: number
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
  /** First / home identity for this NeoSpace session — other logins hang off it */
  primaryAccountId: string | null
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
const STORAGE_VERSION = 1
const APP_NAME = 'NeoSpace'
const SCOPES = 'read write follow push'

/** Accept raw blobs or `{ v: 1, ... }` wrappers */
function unwrapStoragePayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (typeof obj.v === 'number' && obj.v >= 1) {
    const { v: _v, ...rest } = obj
    return rest
  }
  return obj
}

let storageListenerBound = false
let storageReloadTimer: ReturnType<typeof setTimeout> | null = null

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
    primaryAccountId: null,
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

    /** Main NeoSpace identity — other server logins are linked under this session */
    primaryAccount(state): ConnectedInstance | null {
      if (state.primaryAccountId) {
        const primary = state.instances.find(
          (i) => i.id === state.primaryAccountId && i.accessToken && i.user,
        )
        if (primary) return primary
      }
      return (
        state.instances.find((i) => i.accessToken && i.user) ?? null
      )
    },

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

    /** Status character limit for the active posting account (Mastodon default 500). */
    statusMaxCharacters(): number {
      const n = this.activeAccount?.instanceInfo?.maxCharacters
      if (typeof n === 'number' && n >= 100 && n <= 100_000) return n
      return 500
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
          const data = unwrapStoragePayload(JSON.parse(saved))
          if (!data) return
          const raw = ((data.instances as ConnectedInstance[]) || []).map((i: ConnectedInstance) => ({
            ...i,
            clientSecret: null,
            isConnecting: false,
            error: null,
          })) as ConnectedInstance[]
          // Keep multiple accounts on the same server; only collapse empty duplicates
          const seen = new Map<string, ConnectedInstance>()
          const kept: ConnectedInstance[] = []
          for (const inst of raw) {
            const urlKey = (inst.url || '').replace(/\/+$/, '').toLowerCase()
            if (!urlKey) continue
            const userKey = inst.user?.id || inst.id
            const key = `${urlKey}::${userKey}`
            const prev = seen.get(key)
            if (!prev) {
              seen.set(key, inst)
              kept.push(inst)
              continue
            }
            // Same slot — prefer authenticated + richer user
            if (
              (!!inst.accessToken && !prev.accessToken) ||
              (!!inst.user && !prev.user)
            ) {
              const idx = kept.indexOf(prev)
              if (idx !== -1) kept[idx] = { ...prev, ...inst, url: prev.url, id: prev.id }
              seen.set(key, kept[idx]!)
            }
          }
          this.instances = kept
          this.activeInstanceFilter = (data.activeInstanceFilter as string | null) || null
          this.activeAccountId = (data.activeAccountId as string | null) || null
          this.primaryAccountId = (data.primaryAccountId as string | null) || null
          // Stale filter id → empty target list → blank Local/Federated with no error
          if (
            this.activeInstanceFilter &&
            !this.instances.some((i) => i.id === this.activeInstanceFilter)
          ) {
            this.activeInstanceFilter = null
          }
          this.ensurePrimaryAccount()
          clearClientCache()
        }
      } catch (e) {
        logError('Failed to load instances from storage:', e)
      }
    },

    saveToStorage() {
      if (typeof window === 'undefined') return

      try {
        // Never persist clientSecret — XSS would steal revoke ability + app credentials
        const toSave = {
          v: STORAGE_VERSION,
          instances: this.instances.map((i) => ({
            ...i,
            clientSecret: null,
            isConnecting: false,
            error: null,
          })),
          activeInstanceFilter: this.activeInstanceFilter,
          activeAccountId: this.activeAccountId,
          primaryAccountId: this.primaryAccountId,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
      } catch (e) {
        logError('Failed to save instances to storage:', e)
      }
    },

    /**
     * Cross-tab sync: merge remote instances by id instead of wiping local state.
     * Preserves in-flight UI fields (isConnecting, clientSecret) on matching ids.
     */
    mergeFromStorage() {
      if (typeof window === 'undefined') return

      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (!saved) return
        const data = unwrapStoragePayload(JSON.parse(saved))
        if (!data) return

        const raw = ((data.instances as ConnectedInstance[]) || []).map((i: ConnectedInstance) => ({
          ...i,
          clientSecret: null,
          isConnecting: false,
          error: null,
        })) as ConnectedInstance[]

        const seen = new Map<string, ConnectedInstance>()
        const remoteKept: ConnectedInstance[] = []
        for (const inst of raw) {
          const urlKey = (inst.url || '').replace(/\/+$/, '').toLowerCase()
          if (!urlKey) continue
          const userKey = inst.user?.id || inst.id
          const key = `${urlKey}::${userKey}`
          const prev = seen.get(key)
          if (!prev) {
            seen.set(key, inst)
            remoteKept.push(inst)
            continue
          }
          if (
            (!!inst.accessToken && !prev.accessToken) ||
            (!!inst.user && !prev.user)
          ) {
            const idx = remoteKept.indexOf(prev)
            if (idx !== -1) remoteKept[idx] = { ...prev, ...inst, url: prev.url, id: prev.id }
            seen.set(key, remoteKept[idx]!)
          }
        }

        const localById = new Map(this.instances.map((i) => [i.id, i]))
        const merged: ConnectedInstance[] = []
        for (const remote of remoteKept) {
          const local = localById.get(remote.id)
          if (local) {
            merged.push({
              ...remote,
              // Keep tab-local ephemeral / session-only fields
              isConnecting: local.isConnecting,
              error: local.isConnecting ? local.error : remote.error,
              clientSecret: local.clientSecret ?? remote.clientSecret,
            })
          } else {
            merged.push(remote)
          }
        }

        this.instances = merged

        const remoteFilter = (data.activeInstanceFilter as string | null) || null
        const remoteActive = (data.activeAccountId as string | null) || null
        const remotePrimary = (data.primaryAccountId as string | null) || null

        if (
          remoteFilter &&
          this.instances.some((i) => i.id === remoteFilter)
        ) {
          this.activeInstanceFilter = remoteFilter
        } else if (
          this.activeInstanceFilter &&
          !this.instances.some((i) => i.id === this.activeInstanceFilter)
        ) {
          this.activeInstanceFilter = null
        }

        if (remoteActive && this.instances.some((i) => i.id === remoteActive)) {
          this.activeAccountId = remoteActive
        } else if (
          this.activeAccountId &&
          !this.instances.some((i) => i.id === this.activeAccountId)
        ) {
          this.activeAccountId = null
        }

        if (remotePrimary && this.instances.some((i) => i.id === remotePrimary)) {
          this.primaryAccountId = remotePrimary
        }

        this.ensurePrimaryAccount()
        clearClientCache()
      } catch (e) {
        logError('Failed to merge instances from storage:', e)
        this.loadFromStorage()
      }
    },

    /** Other tabs changed accounts — merge by id after a short debounce */
    bindStorageListener() {
      if (typeof window === 'undefined' || storageListenerBound) return
      storageListenerBound = true
      window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY || e.newValue == null) return
        if (storageReloadTimer) clearTimeout(storageReloadTimer)
        storageReloadTimer = setTimeout(() => {
          storageReloadTimer = null
          this.mergeFromStorage()
        }, 200)
      })
    },

    /** Keep a stable "main" identity for the NeoSpace session */
    ensurePrimaryAccount() {
      const authed = this.authenticatedInstances
      if (!authed.length) {
        this.primaryAccountId = null
        return
      }
      if (
        !this.primaryAccountId ||
        !authed.some((i) => i.id === this.primaryAccountId)
      ) {
        this.primaryAccountId = authed[0]!.id
      }
    },

    setPrimaryAccount(instanceId: string) {
      if (!this.authenticatedInstances.some((i) => i.id === instanceId)) return
      this.primaryAccountId = instanceId
      this.saveToStorage()
    },

    /** Threads-style quick swap through signed-in accounts */
    cycleActiveAccount(): ConnectedInstance | null {
      const authed = this.authenticatedInstances
      if (authed.length < 2) return this.activeAccount
      const idx = authed.findIndex((i) => i.id === this.activeAccount?.id)
      const next = authed[(idx + 1) % authed.length]!
      this.setActiveAccount(next.id)
      return next
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
        this.ensurePrimaryAccount()

        this.saveToStorage()
        localStorage.removeItem(LEGACY_AUTH_KEY)
      } catch (e) {
        logWarn('Failed to migrate legacy auth:', e)
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

    async addInstance(
      instanceUrl: string,
      opts?: { allowDuplicateUrl?: boolean },
    ): Promise<ConnectedInstance> {
      const url = instanceUrl.replace(/\/+$/, '')

      const existing = this.getInstanceByUrl(url)
      if (existing && !opts?.allowDuplicateUrl) {
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

      // Probe first — only persist if the server responds
      try {
        const client = createRestAPIClient({ url })
        const info = await client.v2.instance.fetch()

        instance.name = info.title || url.replace(/^https?:\/\//, '')
        instance.instanceInfo = {
          title: info.title,
          thumbnail: info.thumbnail?.url,
          description: info.description,
          maxCharacters: info.configuration?.statuses?.maxCharacters,
        }
        instance.isConnecting = false
        instance.lastFetched = new Date().toISOString()

        this.instances.push(instance)
        this.saveToStorage()
        return instance
      } catch (e: any) {
        throw new Error(e?.message || 'Failed to connect')
      }
    },

    removeInstance(instanceId: string) {
      const index = this.instances.findIndex((i) => i.id === instanceId)
      if (index !== -1) {
        this.instances.splice(index, 1)
        if (this.activeAccountId === instanceId) {
          this.activeAccountId = this.authenticatedInstances[0]?.id ?? null
        }
        if (this.primaryAccountId === instanceId) {
          this.primaryAccountId = this.authenticatedInstances[0]?.id ?? null
        }
        this.ensurePrimaryAccount()
        this.saveToStorage()
      }
    },

    /**
     * Login flow for /login — add instance if needed, then start OAuth.
     * If this server already has a signed-in account, open a new slot so we
     * don't silently overwrite (and orphan) the previous token.
     */
    async loginWithInstance(instanceUrl: string): Promise<string> {
      const url = instanceUrl.replace(/\/+$/, '')
      const existing = this.getInstanceByUrl(url)
      let instance: ConnectedInstance
      if (existing?.accessToken) {
        instance = await this.addInstance(url, { allowDuplicateUrl: true })
      } else if (existing) {
        instance = existing
      } else {
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
        // Keep secret in sessionStorage only — never long-term localStorage
        instance.clientSecret = null
        if (app.clientSecret) stashClientSecret(instanceId, app.clientSecret)

        if (typeof window !== 'undefined') {
          sessionStorage.setItem('neospace_auth_instance_id', instanceId)
        }

        this.saveToStorage()

        const { state, codeChallenge } = await beginOAuthChallenge()

        const params = new URLSearchParams({
          client_id: instance.clientId!,
          redirect_uri: getRedirectUri(),
          response_type: 'code',
          scope: SCOPES,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        })

        return `${instance.url}/oauth/authorize?${params.toString()}`
      } catch (e: any) {
        instance.error = e.message || 'Failed to start auth'
        instance.isConnecting = false
        throw e
      }
    },

    async completeAuth(code: string, stateFromQuery: string | null = null) {
      const instanceId =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('neospace_auth_instance_id')
          : null

      if (!instanceId) {
        throw new Error('No pending authentication')
      }

      const challenge = consumeOAuthChallenge(stateFromQuery)
      if (!challenge.ok) {
        throw new Error(challenge.error || 'Invalid OAuth state')
      }

      const instance = this.instances.find((i) => i.id === instanceId)
      if (!instance) throw new Error('Instance not found')

      instance.isConnecting = true

      try {
        const clientSecret = readClientSecret(instanceId)
        if (!instance.clientId || !clientSecret) {
          throw new Error('Missing OAuth credentials')
        }

        const tokenBody: Record<string, string> = {
          client_id: instance.clientId,
          client_secret: clientSecret,
          redirect_uri: getRedirectUri(),
          grant_type: 'authorization_code',
          code,
          scope: SCOPES,
        }
        if (challenge.codeVerifier) {
          tokenBody.code_verifier = challenge.codeVerifier
        }

        const response = await fetch(`${instance.url}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tokenBody),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error_description || error.error || 'Token exchange failed')
        }

        const data = await response.json()
        // Revoke any previous token on this slot before overwriting
        const previousToken = instance.accessToken
        if (previousToken && previousToken !== data.access_token && instance.clientId) {
          try {
            await fetch(`${instance.url}/oauth/revoke`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                client_id: instance.clientId,
                client_secret: clientSecret,
                token: previousToken,
              }),
            })
          } catch {
            /* still replace local session */
          }
        }
        instance.accessToken = data.access_token
        instance.clientSecret = null
        // Keep secret for logout revoke across tabs/sessions
        persistClientSecret(instanceId, clientSecret)

        const client = createRestAPIClient({
          url: instance.url,
          accessToken: instance.accessToken!,
        })

        instance.user = await client.v1.accounts.verifyCredentials()
        instance.isConnecting = false
        instance.error = null

        this.activeAccountId = instance.id
        // First signed-in account becomes the session main; later adds stay linked under it
        if (!this.primaryAccountId) {
          this.primaryAccountId = instance.id
        } else {
          this.ensurePrimaryAccount()
        }

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

      const clientSecret = instance.clientSecret || readClientSecret(instanceId)
      if (instance.accessToken && instance.clientId && clientSecret) {
        try {
          await fetch(`${instance.url}/oauth/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: instance.clientId,
              client_secret: clientSecret,
              token: instance.accessToken,
            }),
          })
        } catch {
          // Ignore — still clear local session
        }
      }

      instance.accessToken = null
      instance.clientId = null
      instance.clientSecret = null
      instance.user = null
      clearClientSecret(instanceId)

      if (this.activeAccountId === instanceId) {
        this.activeAccountId = this.authenticatedInstances[0]?.id ?? null
      }
      if (this.primaryAccountId === instanceId) {
        this.primaryAccountId = this.authenticatedInstances[0]?.id ?? null
      }

      this.saveToStorage()
    },

    /** Revoke tokens then drop the instance from NeoSpace */
    async removeAccount(instanceId: string) {
      await this.logoutInstance(instanceId)
      this.removeInstance(instanceId)
    },

    /** Log out of the active account */
    async logout() {
      const account = this.activeAccount
      if (account) {
        await this.logoutInstance(account.id)
      }
    },

    /** Revoke and clear every signed-in account */
    async logoutAll() {
      const ids = this.authenticatedInstances.map((i) => i.id)
      for (const id of ids) {
        await this.logoutInstance(id)
      }
    },

    /**
     * Wipe NeoSpace local device data (drafts, settings, columns, etc.).
     * Does not revoke remote tokens — call logoutAll first if needed.
     */
    clearLocalDeviceData() {
      if (typeof localStorage === 'undefined') return
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && (k.startsWith('neospace') || k.startsWith('neo_'))) keys.push(k)
      }
      for (const k of keys) localStorage.removeItem(k)
      try {
        sessionStorage.clear()
      } catch {
        /* ignore */
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
            // Refresh compose limit when possible (older saved instances may lack it)
            try {
              const info = await client.v2.instance.fetch()
              instance.instanceInfo = {
                ...(instance.instanceInfo || {}),
                title: info.title || instance.instanceInfo?.title,
                thumbnail: info.thumbnail?.url || instance.instanceInfo?.thumbnail,
                description: info.description || instance.instanceInfo?.description,
                maxCharacters: info.configuration?.statuses?.maxCharacters,
              }
            } catch {
              /* non-fatal */
            }
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
      if (this.isInitialized) return
      // Coalesce concurrent callers (layout + notifications cold load, etc.)
      const inflight = (this as { _initPromise?: Promise<void> })._initPromise
      if (inflight) {
        await inflight
        return
      }

      const run = (async () => {
        this.loadFromStorage()
        this.bindStorageListener()
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
            logWarn('Failed to add default instance')
          }
        }

        await this.verifyAllInstances()

        // Token may have been cleared during verify — drop gated watch-only leftovers
        const orphanGated = this.instances.filter(
          (i) => !i.accessToken && isAuthGatedPublicHost(i.url),
        )
        if (orphanGated.length) {
          const drop = new Set(orphanGated.map((i) => i.id))
          this.instances = this.instances.filter((i) => !drop.has(i.id))
          if (
            this.activeInstanceFilter &&
            drop.has(this.activeInstanceFilter)
          ) {
            this.activeInstanceFilter = null
          }
          this.saveToStorage()
        }

        if (this.instances.length === 0) {
          try {
            await this.addInstance(DEFAULT_PUBLIC_INSTANCE)
          } catch {
            logWarn('Failed to add default instance after verify')
          }
        }

        this.ensurePrimaryAccount()
        this.isInitialized = true
      })()

      ;(this as { _initPromise?: Promise<void> })._initPromise = run
      try {
        await run
      } finally {
        delete (this as { _initPromise?: Promise<void> })._initPromise
      }
    },

    getClient(instanceId: string): mastodon.rest.Client {
      return clientFor(instanceId)
    },

    /** Local/Federated follow the active profile’s server (not a merge of every watch). */
    publicTimelineTargets(): ConnectedInstance[] {
      if (this.activeInstanceFilter) {
        const filtered = this.instances.filter((i) => i.id === this.activeInstanceFilter)
        if (filtered.length) return filtered
        // Stale id — clear so we don't keep requesting nothing
        this.activeInstanceFilter = null
      }
      const active = this.activeAccount
      if (active) return [active]
      return this.instances
    },

    /** Open-server fallback when the active host blocks unauthenticated public timelines. */
    async fetchPublicTimelineFallback(
      type: 'local' | 'federated',
      limit: number,
      maxId?: string,
    ): Promise<ExtendedStatus[]> {
      try {
        const url = resolvePublicInstanceUrl(
          type === 'federated' ? null : this.activeAccount?.url || this.instances[0]?.url,
        )
        const client = publicClient(url)
        const statuses = await client.v1.timelines.public.list({
          local: type === 'local',
          limit,
          ...(maxId ? { maxId } : {}),
        })
        return statuses.map((s) => ({
          ...s,
          _instanceId: `public:${hostnameOf(url) || 'fallback'}`,
          _instanceUrl: url,
        }))
      } catch (e) {
        logWarn('Public timeline fallback failed:', e)
        return []
      }
    },

    async fetchMergedTimeline(
      type: 'local' | 'federated' = 'local',
      limit: number = 20,
      maxIdOrCursors?: string | Record<string, string>,
    ): Promise<ExtendedStatus[]> {
      const allStatuses: ExtendedStatus[] = []
      const errors: string[] = []

      const targets = this.publicTimelineTargets()
      const cursors =
        maxIdOrCursors && typeof maxIdOrCursors === 'object' ? maxIdOrCursors : null
      const legacyMaxId = typeof maxIdOrCursors === 'string' ? maxIdOrCursors : undefined

      if (!targets.length) {
        const fallback = await this.fetchPublicTimelineFallback(type, limit, legacyMaxId)
        if (fallback.length) return fallback
        throw new Error('No servers available for this timeline. Add an instance or sign in.')
      }

      const fetchPromises = targets.map(async (instance) => {
        try {
          if (!instance.accessToken && isAuthGatedPublicHost(instance.url)) {
            errors.push(`${instance.name} requires login for public timelines`)
            return []
          }

          const client = this.getClient(instance.id)
          const maxId = cursors?.[instance.id] ?? legacyMaxId

          const statuses = await client.v1.timelines.public.list({
            local: type === 'local',
            limit,
            ...(maxId ? { maxId } : {}),
          })

          return statuses.map((s) => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          }))
        } catch (e: any) {
          const message = e?.message || 'Failed to fetch'
          logWarn(`Failed to fetch from ${instance.url}:`, e)
          errors.push(`${instance.name}: ${message}`)
          return []
        }
      })

      const results = await Promise.all(fetchPromises)
      results.forEach((statuses) => allStatuses.push(...statuses))

      if (allStatuses.length === 0) {
        // mastodon.social etc. often 422 without a usable token — don't leave Federated blank
        const fallback = await this.fetchPublicTimelineFallback(type, limit, legacyMaxId)
        if (fallback.length) return fallback

        if (errors.length > 0) {
          throw new Error(
            errors[0]?.includes('requires login') ||
              errors[0]?.includes('authenticated') ||
              errors[0]?.includes('authenticated user')
              ? 'This instance requires login to view timelines. Connect an account or add a different instance.'
              : errors[0] || 'Failed to fetch timeline',
          )
        }
      }

      allStatuses.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )

      return dedupeStatusesByIdentity(allStatuses).slice(0, limit)
    },

    async fetchMergedHomeTimeline(
      limit: number = 20,
      cursors?: Record<string, string>,
    ): Promise<ExtendedStatus[]> {
      const allStatuses: ExtendedStatus[] = []
      // Active profile’s home only — multi-account merge made feeds feel identical.
      const active = this.activeAccount
      const authInstances = active?.accessToken
        ? [active]
        : this.instances.filter((i) => i.accessToken)

      const fetchPromises = authInstances.map(async (instance) => {
        try {
          const client = createRestAPIClient({
            url: instance.url,
            accessToken: instance.accessToken!,
          })

          const maxId = cursors?.[instance.id]
          const statuses = await client.v1.timelines.home.list({
            limit,
            ...(maxId ? { maxId } : {}),
          })

          return statuses.map((s) => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          }))
        } catch (e) {
          logWarn(`Failed to fetch home from ${instance.url}:`, e)
          return []
        }
      })

      const results = await Promise.all(fetchPromises)
      results.forEach((statuses) => allStatuses.push(...statuses))

      allStatuses.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )

      return dedupeStatusesByIdentity(allStatuses).slice(0, Math.max(limit, limit * Math.max(1, authInstances.length)))
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
        logWarn(`Failed to fetch instance info for ${domain}:`, e)
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
