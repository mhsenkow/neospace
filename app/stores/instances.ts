/**
 * NeoSpace Multi-Instance / Accounts Store
 *
 * Single source of truth for connected instances and authenticated accounts.
 * Supports watching public timelines and multi-account OAuth.
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import {
  beginOAuthChallenge,
  consumeOAuthChallenge,
  clearPendingAuth,
  stashClientSecret,
  persistClientSecret,
  readClientSecret,
  clearClientSecret,
} from '~/utils/oauthPkce'
import { useToastStore } from '~/stores/toast'
import { logError, logWarn } from '~/utils/log'
import { extractProfileCss } from '~/utils/profileCss'
import {
  DEFAULT_PUBLIC_INSTANCE,
  friendlyServerError,
  hostnameOf,
  isAuthGatedPublicHost,
  notePublicTimelineAuthFailure,
  resolvePublicInstanceUrl,
} from '~/utils/instances'
import { dedupeStatusesByIdentity } from '~/utils/statusIdentity'
import {
  mapInstanceConfig,
  mapV2InstanceInfo,
  pollLimitsFrom,
  type PollLimits,
  type ConnectedInstanceInfo,
  type InstanceApiInfo,
} from '~/utils/instanceInfo'
import {
  DEFAULT_MAX_ATTACHMENTS,
  DEFAULT_MAX_FILE_BYTES,
  MEDIA_ALT_MAX,
} from '~/utils/composeConstants'
import {
  clearCachedOAuthApp,
  OAUTH_FETCH_TIMEOUT_MS,
  oauthFetch,
  parseOAuthResponse,
  readCachedOAuthApp,
  requireAccessToken,
  writeCachedOAuthApp,
} from '~/utils/oauthApp'
import {
  freezeCapabilities,
  isCapabilitiesStale,
  isFeatureAvailable,
  serverSettingsUrl,
  UNKNOWN_CAPABILITIES,
  type ServerCapabilities,
  type SettingsTopic,
} from '~/utils/serverCapabilities'
import { clearClientCache, clientFor, createRestClient, publicClient } from '~/composables/useMasto'

export interface ConnectedInstance {
  id: string
  url: string
  name: string
  accessToken: string | null
  clientId: string | null
  clientSecret: string | null
  user: mastodon.v1.Account | null
  instanceInfo: ConnectedInstanceInfo | null
  isConnecting: boolean
  error: string | null
  lastFetched: string | null
  /** Token revoked/expired — keep profile under Signed in until user re-auths */
  sessionExpired?: boolean
}

export interface ExtendedStatus extends mastodon.v1.Status {
  _instanceId: string
  _instanceUrl: string
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
  /** Shown when the active account changes after a token dies */
  authNotice: string | null
}

const STORAGE_KEY = 'neospace_instances'
const LEGACY_AUTH_KEY = 'neospace_auth'
const STORAGE_VERSION = 1
const APP_NAME = 'NeoSpace'
const SCOPES = 'read write follow push'
/** Directory / preview / add-server probes — masto has no default timeout */
const PEEK_TIMEOUT_MS = 8_000

/** sessionStorage flag: this tab/window already chose its posting account for the session */
const SESSION_STARTED_KEY = 'neospace_session_started'

/**
 * "Main" account semantics: a fresh launch (new tab / PWA start — no session flag yet) posts as
 * the main account; later reloads in the same session keep whatever the user switched to.
 */
export function launchAccountId(opts: {
  activeId: string | null
  primaryId: string | null
  authenticatedIds: string[]
  sessionStarted: boolean
}): string | null {
  if (opts.sessionStarted) return opts.activeId
  if (opts.primaryId && opts.authenticatedIds.includes(opts.primaryId)) return opts.primaryId
  return opts.activeId
}

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
/** Tokens verified by completeAuth moments ago — the OAuth callback's follow-up initialize() skips them */
const RECENT_VERIFY_MS = 60_000
const recentlyVerified = new Map<string, { token: string; at: number }>()
/** Coalesces concurrent initialize() callers (layout + notifications cold load, etc.) */
let initPromise: Promise<void> | null = null
let storageReloadTimer: ReturnType<typeof setTimeout> | null = null

const INSTANCE_INFO_TTL_MS = 10 * 60_000
const INSTANCE_INFO_FAIL_TTL_MS = 120_000
type InstanceInfoCacheEntry = { at: number; ok: boolean; value: InstanceApiInfo | null }
const instanceInfoRemoteCache = new Map<string, InstanceInfoCacheEntry>()
/** Explore / directory browsing can touch hundreds of hosts — keep both caches bounded */
const INSTANCE_INFO_CACHE_MAX = 200
const PREVIEW_INFO_MAX = 60

function rememberRemoteInstanceInfo(key: string, entry: InstanceInfoCacheEntry) {
  instanceInfoRemoteCache.delete(key)
  instanceInfoRemoteCache.set(key, entry)
  while (instanceInfoRemoteCache.size > INSTANCE_INFO_CACHE_MAX) {
    const oldest = instanceInfoRemoteCache.keys().next().value
    if (oldest === undefined) break
    instanceInfoRemoteCache.delete(oldest)
  }
}

const getRedirectUri = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000/auth/callback'
  return `${window.location.origin}/auth/callback`
}

const generateId = () => Math.random().toString(36).substring(2, 15)

function extractCustomCSS(user: mastodon.v1.Account | null): string {
  return extractProfileCss(user?.fields)
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
    authNotice: null,
  }),

  getters: {
    connectedInstances: (state): ConnectedInstance[] => state.instances,

    authenticatedInstances: (state): ConnectedInstance[] =>
      state.instances.filter((i) => i.accessToken && i.user && !i.sessionExpired),

    /** Signed-in or expired sessions — never pure watch-only rows */
    signedInInstances: (state): ConnectedInstance[] =>
      state.instances.filter((i) => i.user),

    watchingInstances: (state): ConnectedInstance[] =>
      state.instances.filter((i) => !i.accessToken && !i.user),

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

    /** Characters each URL costs toward the limit (null = counted in full). */
    statusUrlWeight(): number | null {
      const w = this.activeAccount?.instanceInfo?.urlWeight
      return w === undefined ? 23 : w
    },

    /** Media attachment limits from the active instance configuration. */
    composeMediaLimits(): {
      maxAttachments: number
      maxFileBytes: number
      altMax: number
    } {
      const info = this.activeAccount?.instanceInfo
      const maxAttachments =
        typeof info?.maxMediaAttachments === 'number' &&
        info.maxMediaAttachments >= 1 &&
        info.maxMediaAttachments <= 20
          ? info.maxMediaAttachments
          : DEFAULT_MAX_ATTACHMENTS
      const imageLimit =
        typeof info?.imageSizeLimit === 'number' && info.imageSizeLimit > 0
          ? info.imageSizeLimit
          : DEFAULT_MAX_FILE_BYTES
      const videoLimit =
        typeof info?.videoSizeLimit === 'number' && info.videoSizeLimit > 0
          ? info.videoSizeLimit
          : imageLimit
      const maxFileBytes = Math.max(imageLimit, videoLimit)
      const altMax =
        typeof info?.mediaDescriptionLimit === 'number' &&
        info.mediaDescriptionLimit >= 100
          ? info.mediaDescriptionLimit
          : MEDIA_ALT_MAX
      return { maxAttachments, maxFileBytes, altMax }
    },

    /** Software + feature flags for the active posting account (unknown until probed). */
    serverCapabilities(): ServerCapabilities {
      const caps = this.activeAccount?.instanceInfo?.capabilities
      return caps ? freezeCapabilities(caps) : UNKNOWN_CAPABILITIES
    },

    /** Hide scheduling only when the server positively lacks it. */
    canSchedulePosts(): boolean {
      return isFeatureAvailable(this.serverCapabilities.scheduledStatuses)
    },

    /** Poll option count / length / duration limits of the active posting server */
    composePollLimits(): PollLimits {
      return pollLimitsFrom(this.activeAccount?.instanceInfo?.polls)
    },

    canCreatePolls(): boolean {
      return isFeatureAvailable(this.serverCapabilities.polls)
    },

    /** Web settings page on the active server for a topic, or null if none is known. */
    serverSettingsLink() {
      return (topic: SettingsTopic): string | null =>
        serverSettingsUrl(this.serverCapabilities, this.activeAccount?.url, topic)
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
            if (!!inst.accessToken && !prev.accessToken) {
              const idx = kept.indexOf(prev)
              if (idx !== -1) {
                kept[idx] = { ...inst, id: prev.id, url: prev.url }
                seen.set(key, kept[idx]!)
              }
            } else if (!!inst.user && !prev.user && !prev.accessToken) {
              const idx = kept.indexOf(prev)
              if (idx !== -1) {
                kept[idx] = { ...inst, id: prev.id, url: prev.url }
                seen.set(key, kept[idx]!)
              }
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
          this.applyLaunchAccount()
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
            if (idx !== -1) {
              remoteKept[idx] = { ...prev, ...inst, url: prev.url, id: prev.id }
              seen.set(key, remoteKept[idx]!)
            }
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

        // Active account is per-tab: another tab switching accounts must not
        // yank this tab's columns over. Only adopt the remote one if ours is gone.
        const localActiveKept =
          !!this.activeAccountId && this.instances.some((i) => i.id === this.activeAccountId)
        if (!localActiveKept) {
          this.activeAccountId =
            remoteActive && this.instances.some((i) => i.id === remoteActive) ? remoteActive : null
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

    /** Fresh launch → post as the main account (see launchAccountId). */
    applyLaunchAccount() {
      if (typeof sessionStorage === 'undefined') return
      let started = false
      try {
        started = sessionStorage.getItem(SESSION_STARTED_KEY) === '1'
        sessionStorage.setItem(SESSION_STARTED_KEY, '1')
      } catch {
        return
      }
      this.activeAccountId = launchAccountId({
        activeId: this.activeAccountId,
        primaryId: this.primaryAccountId,
        authenticatedIds: this.authenticatedInstances.map((i) => i.id),
        sessionStarted: started,
      })
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
      // Toasts (and their Undo closures) belong to the account that raised them
      if (instanceId !== this.activeAccountId) useToastStore().clear()
      this.activeAccountId = instanceId
      this.authNotice = null
      this.saveToStorage()
    },

    dismissAuthNotice() {
      this.authNotice = null
    },

    updateActiveAccount(user: mastodon.v1.Account, instanceId?: string) {
      const targetId = instanceId ?? this.activeAccount?.id
      if (!targetId) return
      const account = this.instances.find((i) => i.id === targetId)
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
        const client = createRestClient({ url, timeout: PEEK_TIMEOUT_MS })
        const info = await client.v2.instance.fetch()

        instance.name = info.title || url.replace(/^https?:\/\//, '')
        instance.instanceInfo = mapInstanceConfig(info)
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
    async loginWithInstance(
      instanceUrl: string,
      opts?: { addMode?: boolean; returnTo?: string | null },
    ): Promise<string> {
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
      return await this.startAuth(instance.id, opts)
    },

    async startAuth(
      instanceId: string,
      opts?: { addMode?: boolean; returnTo?: string | null },
    ) {
      const instance = this.instances.find((i) => i.id === instanceId)
      if (!instance) throw new Error('Server not found')

      instance.isConnecting = true
      instance.error = null

      try {
        const host = instance.url.replace(/^https?:\/\//, '').toLowerCase()
        // Reuse a registration only if it was made for this callback URI and scope set
        const identity = { redirectUri: getRedirectUri(), scopes: SCOPES }
        const cached = readCachedOAuthApp(host, identity)

        if (cached) {
          instance.clientId = cached.clientId
          instance.clientSecret = null
          stashClientSecret(instanceId, cached.clientSecret)
        } else {
          const client = createRestClient({ url: instance.url, timeout: OAUTH_FETCH_TIMEOUT_MS })
          const app = await client.v1.apps.create({
            clientName: APP_NAME,
            redirectUris: getRedirectUri(),
            scopes: SCOPES,
            website: 'https://neospace.ibm.io',
          })
          instance.clientId = app.clientId ?? null
          instance.clientSecret = null
          if (app.clientId && app.clientSecret) {
            stashClientSecret(instanceId, app.clientSecret)
            writeCachedOAuthApp(host, app.clientId, app.clientSecret, identity)
          }
        }

        if (typeof window !== 'undefined') {
          sessionStorage.setItem('neospace_auth_instance_id', instanceId)
        }

        this.saveToStorage()

        const { state, codeChallenge } = await beginOAuthChallenge({
          instanceId,
          host,
          addMode: opts?.addMode,
          returnTo: opts?.returnTo ?? null,
        })

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

    async completeAuth(
      code: string,
      stateFromQuery: string | null = null,
      opts?: { signal?: AbortSignal },
    ) {
      const challenge = consumeOAuthChallenge(stateFromQuery)
      if (!challenge.ok) {
        throw new Error(challenge.error || 'Invalid OAuth state')
      }
      if (!challenge.codeVerifier) {
        throw new Error('Missing PKCE verifier')
      }

      const instanceId =
        challenge.pending?.instanceId ||
        (typeof window !== 'undefined'
          ? sessionStorage.getItem('neospace_auth_instance_id')
          : null)

      if (!instanceId) {
        throw new Error('No pending authentication')
      }

      const instance = this.instances.find((i) => i.id === instanceId)
      if (!instance) throw new Error('Instance not found')

      const hadTokenBefore = !!instance.accessToken
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
          code_verifier: challenge.codeVerifier,
        }

        const response = await oauthFetch(`${instance.url}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tokenBody),
          signal: opts?.signal,
        })

        if (!response.ok) {
          const error = await parseOAuthResponse(response)
          const code = String(error.error || '')
          if (code === 'invalid_client') {
            clearCachedOAuthApp(instance.url.replace(/^https?:\/\//, ''))
          }
          throw new Error(
            String(error.error_description || error.error || 'Token exchange failed'),
          )
        }

        // A 200 that isn't a token object (proxy/HTML page, null, array, wrong types) must
        // not leave a half-signed-in slot — and must not revoke the token we still have
        const data = { access_token: requireAccessToken(await parseOAuthResponse(response)) }
        // Revoke any previous token on this slot before overwriting
        const previousToken = instance.accessToken
        if (previousToken && previousToken !== data.access_token && instance.clientId) {
          try {
            await oauthFetch(`${instance.url}/oauth/revoke`, {
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
        instance.sessionExpired = false
        instance.clientSecret = null
        // Keep secret for logout revoke across tabs/sessions
        persistClientSecret(instanceId, clientSecret)

        const client = createRestClient({
          url: instance.url,
          timeout: OAUTH_FETCH_TIMEOUT_MS,
          accessToken: instance.accessToken!,
        })

        instance.user = await client.v1.accounts.verifyCredentials()
        recentlyVerified.set(instance.id, { token: instance.accessToken!, at: Date.now() })
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
        // Single-use: forget only this attempt — other tabs' pending sign-ins stay intact
        if (challenge.pending) clearPendingAuth(challenge.pending.state)

        this.saveToStorage()
        return { instance, pending: challenge.pending ?? null }
      } catch (e: any) {
        instance.error = e.message || 'Authentication failed'
        instance.isConnecting = false
        if (!hadTokenBefore && !instance.accessToken) {
          this.removeInstance(instanceId)
        }
        throw e
      }
    },

    async logoutInstance(instanceId: string) {
      const instance = this.instances.find((i) => i.id === instanceId)
      if (!instance) return

      const loggedOutUserId = instance.user?.id || null

      const clientSecret = instance.clientSecret || readClientSecret(instanceId)
      if (instance.accessToken && instance.clientId && clientSecret) {
        try {
          await oauthFetch(`${instance.url}/oauth/revoke`, {
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
        // The signed-out account's toasts (and Undo closures) must not outlive it
        useToastStore().clear()
      }
      if (this.primaryAccountId === instanceId) {
        this.primaryAccountId = this.authenticatedInstances[0]?.id ?? null
      }

      this.saveToStorage()

      if (loggedOutUserId) {
        const { purgeRecentSearches } = await import('~/composables/useRecentSearches')
        purgeRecentSearches(loggedOutUserId)
      }
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

    /** Refresh cached server limits/branding for one account (non-fatal, not awaited at startup). */
    async refreshInstanceInfo(instanceId: string, client: mastodon.rest.Client) {
      try {
        const info = await client.v2.instance.fetch()
        // Look up again — the list may have been replaced (storage merge) meanwhile
        const instance = this.instances.find((i) => i.id === instanceId)
        if (!instance) return
        instance.instanceInfo = mapInstanceConfig(info, instance.instanceInfo)
        this.saveToStorage()
      } catch (e) {
        logWarn(`Instance info refresh failed for ${instanceId}:`, e)
      }
    },

    async verifyAllInstances() {
      const promises = this.instances
        .filter((i) => i.accessToken)
        .map(async (instance) => {
          try {
            const client = clientFor(instance.id)
            const recent = recentlyVerified.get(instance.id)
            recentlyVerified.delete(instance.id)
            if (
              recent &&
              instance.user &&
              recent.token === instance.accessToken &&
              Date.now() - recent.at < RECENT_VERIFY_MS
            ) {
              if (isCapabilitiesStale(instance.instanceInfo?.capabilitiesProbedAt)) {
                void this.refreshInstanceInfo(instance.id, client)
              }
              return
            }
            instance.user = await client.v1.accounts.verifyCredentials()
            instance.error = null
            // Full verify always re-probes instance metadata (limits + capabilities).
            void this.refreshInstanceInfo(instance.id, client)
          } catch (e: any) {
            const status = e?.status ?? e?.statusCode
            if (status === 401 || status === 403) {
              instance.accessToken = null
              instance.sessionExpired = true
              instance.error = 'Session expired — sign in again'
            } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
              instance.error = 'Offline — couldn’t verify your session'
            } else if (status >= 500) {
              instance.error = 'Server error — try again later'
            } else {
              instance.error = 'Couldn’t verify your session'
            }
          }
        })

      await Promise.all(promises)

      const staleActive = this.activeAccountId
      if (
        staleActive &&
        !this.instances.some(
          (i) => i.id === staleActive && i.accessToken && i.user && !i.sessionExpired,
        )
      ) {
        const expired = this.instances.find((i) => i.id === staleActive)
        const next = this.authenticatedInstances[0] ?? null
        if (expired?.user && next) {
          this.authNotice = `Session for ${expired.user.displayName || expired.user.username} expired — now posting as ${next.user?.displayName || next.user?.username || next.name}.`
        } else if (expired?.user) {
          this.authNotice = `Session for ${expired.user.displayName || expired.user.username} expired — sign in again.`
        }
        this.activeAccountId = next?.id ?? null
      }

      this.saveToStorage()
    },

    setFilter(instanceId: string | null) {
      this.activeInstanceFilter = instanceId
    },

    async initialize() {
      if (this.isInitialized) return
      // Coalesce concurrent callers (layout + notifications cold load, etc.)
      if (initPromise) {
        await initPromise
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

      initPromise = run
      try {
        await run
      } finally {
        initPromise = null
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
      opts?: { since?: boolean },
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
          const cursor = cursors?.[instance.id] ?? legacyMaxId

          const statuses = await client.v1.timelines.public.list({
            local: type === 'local',
            limit,
            ...(cursor ? (opts?.since ? { sinceId: cursor } : { maxId: cursor }) : {}),
          })

          return statuses.map((s) => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          }))
        } catch (e: any) {
          notePublicTimelineAuthFailure(instance.url, e, { authenticated: !!instance.accessToken })
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
      opts?: { since?: boolean },
    ): Promise<ExtendedStatus[]> {
      const allStatuses: ExtendedStatus[] = []
      // Active profile’s home only — multi-account merge made feeds feel identical.
      const active = this.activeAccount
      const authInstances = active?.accessToken
        ? [active]
        : this.instances.filter((i) => i.accessToken)

      const failures: unknown[] = []
      const fetchPromises = authInstances.map(async (instance) => {
        try {
          const client = clientFor(instance.id)

          const cursor = cursors?.[instance.id]
          const statuses = await client.v1.timelines.home.list({
            limit,
            ...(cursor ? (opts?.since ? { sinceId: cursor } : { maxId: cursor }) : {}),
          })

          return statuses.map((s) => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          }))
        } catch (e) {
          logWarn(`Failed to fetch home from ${instance.url}:`, e)
          failures.push(e)
          return []
        }
      })

      const results = await Promise.all(fetchPromises)
      // Every account failed — surface it so the column shows error/retry instead of "empty"
      if (authInstances.length && failures.length === authInstances.length) {
        throw failures[0]
      }
      results.forEach((statuses) => allStatuses.push(...statuses))

      allStatuses.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )

      return dedupeStatusesByIdentity(allStatuses).slice(0, Math.max(limit, limit * Math.max(1, authInstances.length)))
    },

    /** Insert into the reactive preview map, evicting the oldest hosts past the cap */
    _rememberPreviewInfo(key: string, info: InstanceApiInfo) {
      const map = this.previewInstanceInfo
      delete map[key]
      map[key] = info
      const keys = Object.keys(map)
      for (let i = 0; i < keys.length - PREVIEW_INFO_MAX; i++) delete map[keys[i]!]
    },

    /**
     * Public server summary. `opts.cacheFailure: false` keeps a failed lookup out of the
     * 2-minute failure cache — a host the user is still typing ("mastodon.s") shouldn't be
     * remembered as dead once they finish it.
     */
    async fetchInstanceInfo(
      domain: string,
      opts?: { cacheFailure?: boolean },
    ): Promise<InstanceApiInfo | null> {
      const key = domain.toLowerCase()
      if (this.previewInstanceInfo[key]) {
        return this.previewInstanceInfo[key]
      }

      const cached = instanceInfoRemoteCache.get(key)
      if (cached) {
        const ttl = cached.ok ? INSTANCE_INFO_TTL_MS : INSTANCE_INFO_FAIL_TTL_MS
        if (Date.now() - cached.at < ttl) {
          if (cached.ok && cached.value) {
            this._rememberPreviewInfo(key, cached.value)
          }
          return cached.value
        }
      }

      try {
        const url = `https://${domain}`
        const client = createRestClient({ url, timeout: PEEK_TIMEOUT_MS })
        const info = await client.v2.instance.fetch()
        const apiInfo = mapV2InstanceInfo(info)
        rememberRemoteInstanceInfo(key, { at: Date.now(), ok: true, value: apiInfo })
        this._rememberPreviewInfo(key, apiInfo)
        return apiInfo
      } catch (e) {
        logWarn(`Failed to fetch instance info for ${domain}:`, e)
        if (opts?.cacheFailure !== false) {
          rememberRemoteInstanceInfo(key, { at: Date.now(), ok: false, value: null })
        }
        return null
      }
    },

    async openPreview(domain: string) {
      const ticket = domain
      this.previewingInstance = domain
      this.previewLoading = true
      this.previewError = null
      this.previewTimeline = []

      try {
        const url = `https://${domain}`
        const client = createRestClient({ url, timeout: PEEK_TIMEOUT_MS })

        const info = await client.v2.instance.fetch()
        if (this.previewingInstance !== ticket) return
        this._rememberPreviewInfo(domain, mapV2InstanceInfo(info))

        try {
          const timeline = await client.v1.timelines.public.list({
            local: true,
            limit: 10,
          })
          if (this.previewingInstance !== ticket) return
          this.previewTimeline = timeline
        } catch {
          // Auth-gated public timelines — preview still shows instance info
          if (this.previewingInstance === ticket) this.previewTimeline = []
        }
      } catch (e: any) {
        if (this.previewingInstance === ticket) {
          this.previewError = friendlyServerError(e)
        }
      } finally {
        if (this.previewingInstance === ticket) this.previewLoading = false
      }
    },

    closePreview() {
      this.previewingInstance = null
      this.previewTimeline = []
      this.previewError = null
    },
  },
})
