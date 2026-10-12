/**
 * Shared Mastodon/GoToSocial API client helpers.
 * Single place for createRestAPIClient construction + cache.
 */

import { createRestAPIClient, type mastodon } from 'masto'
import { useInstancesStore } from '~/stores/instances'
import { resolvePublicInstanceUrl } from '~/utils/instances'
import { guardMastoClient } from '~/utils/mastoGuard'

export type { mastodon }

/**
 * The only way to build a masto REST client in the app: every client gets the
 * `$select` path-segment guard (see utils/mastoGuard).
 */
export function createRestClient(
  config: Parameters<typeof createRestAPIClient>[0],
): mastodon.rest.Client {
  return guardMastoClient(createRestAPIClient(config))
}

const clientCache = new Map<string, mastodon.rest.Client>()

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, '')
}

function cacheKey(url: string, token?: string | null) {
  return `${normalizeUrl(url)}\0${token || ''}`
}

/** Drop cached clients. Pass a URL to clear only that host (any token). */
export function clearClientCache(url?: string) {
  if (!url) {
    clientCache.clear()
    return
  }
  const prefix = `${normalizeUrl(url)}\0`
  for (const key of [...clientCache.keys()]) {
    if (key.startsWith(prefix)) clientCache.delete(key)
  }
}

/** Small LRU bound — several accounts on one host each keep their own client. */
const CLIENT_CACHE_MAX = 16

/**
 * Per-request ceiling for cached clients. Without it one hung server keeps
 * `verifyAllInstances` (and so `isInitialized`) pending and every column blank.
 */
export const CLIENT_TIMEOUT_MS = 15_000

function cachedClient(url: string, accessToken?: string | null): mastodon.rest.Client {
  const normalized = normalizeUrl(url)
  const key = cacheKey(normalized, accessToken)
  let client = clientCache.get(key)
  if (client) {
    // Refresh recency (Map preserves insertion order)
    clientCache.delete(key)
    clientCache.set(key, client)
    return client
  }
  client = createRestClient({
    url: normalized,
    accessToken: accessToken || undefined,
    timeout: CLIENT_TIMEOUT_MS,
  })
  clientCache.set(key, client)
  while (clientCache.size > CLIENT_CACHE_MAX) {
    const oldest = clientCache.keys().next().value
    if (oldest === undefined) break
    clientCache.delete(oldest)
  }
  return client
}

/** Authenticated client for a specific connected instance */
export function clientFor(instanceId: string): mastodon.rest.Client {
  const store = useInstancesStore()
  const instance = store.instances.find((i) => i.id === instanceId)
  if (!instance) throw new Error('Instance not found')
  return cachedClient(instance.url, instance.accessToken)
}

/**
 * Transient read client for a route opened from another account's notification
 * without switching the global active account (and re-initing every column).
 */
let readAccountOverrideId: string | null = null
let readAccountOverrideOwner = 0

/**
 * Set the read override. Returns an ownership token; pass it to
 * clearReadAccountOverride so an outgoing page's unmount can't clear the
 * override the incoming page just set.
 */
export function setReadAccountOverride(instanceId: string | null): number {
  readAccountOverrideId = instanceId
  return ++readAccountOverrideOwner
}

/** Clear the override only if `owner` still holds it. */
export function clearReadAccountOverride(owner: number) {
  if (owner !== readAccountOverrideOwner) return
  readAccountOverrideId = null
}

/**
 * URL + token of the account activeClient() acts as (read override first,
 * then the active account). For raw-fetch endpoints that must stay on the same
 * account as client calls (media upload, delete).
 */
export function activeCredentials(): { url: string; accessToken: string } {
  const store = useInstancesStore()
  if (readAccountOverrideId) {
    const instance = store.instances.find((i) => i.id === readAccountOverrideId)
    if (instance?.url && instance.accessToken) {
      return { url: normalizeUrl(instance.url), accessToken: instance.accessToken }
    }
  }
  const account = store.activeAccount
  if (!account?.url || !account.accessToken) {
    throw new Error('Not authenticated')
  }
  return { url: normalizeUrl(account.url), accessToken: account.accessToken }
}

/**
 * Credentials for one specific connected account — ignores the active account and
 * the read override, so work started as account A (media uploads) stays with A.
 */
export function credentialsFor(accountId: string): { url: string; accessToken: string } {
  const store = useInstancesStore()
  const instance = store.instances.find((i) => i.id === accountId)
  if (!instance?.url || !instance.accessToken) throw new Error('That account is no longer signed in')
  return { url: normalizeUrl(instance.url), accessToken: instance.accessToken }
}

/** Authenticated client for the active account */
export function activeClient(): mastodon.rest.Client {
  const { url, accessToken } = activeCredentials()
  return cachedClient(url, accessToken)
}

/**
 * The signed-in slot to read a host as: the active account when it lives there, otherwise any
 * slot on that host that still has a token — `getInstanceByUrl` alone returns the *first* slot,
 * which is the wrong account (or an expired, token-less one) when two accounts share a server.
 */
export function readerForUrl(url: string): { accessToken: string } | null {
  const store = useInstancesStore()
  const target = normalizeUrl(url).toLowerCase()
  const sameHost = (u: string | undefined) => !!u && normalizeUrl(u).toLowerCase() === target
  const active = store.activeAccount
  if (active?.accessToken && sameHost(active.url)) return { accessToken: active.accessToken }
  const other = store.instances.find((i) => !!i.accessToken && sameHost(i.url))
  return other?.accessToken ? { accessToken: other.accessToken } : null
}

/**
 * Public (optionally authenticated) client for browsing.
 * If the preferred host has a token, use it as-is — even on auth-gated hosts
 * (mastodon.social etc.). Guest remap to fosstodon only applies when unauthenticated.
 */
export function publicClient(url?: string | null): mastodon.rest.Client {
  const store = useInstancesStore()
  const preferred = url || store.activeAccount?.url || null

  if (preferred) {
    const preferredUrl = normalizeUrl(preferred)
    const authed = readerForUrl(preferredUrl)
    if (authed?.accessToken) {
      return cachedClient(preferredUrl, authed.accessToken)
    }
  }

  const resolved = resolvePublicInstanceUrl(preferred)
  const matching = readerForUrl(resolved)
  return cachedClient(resolved, matching?.accessToken)
}

/** Composable wrapper for Nuxt auto-import convenience */
export function useMasto() {
  return { clientFor, activeClient, activeCredentials, publicClient, clearClientCache }
}
