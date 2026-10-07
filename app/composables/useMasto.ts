/**
 * Shared Mastodon/GoToSocial API client helpers.
 * Single place for createRestAPIClient construction + cache.
 */

import { createRestAPIClient, type mastodon } from 'masto'
import { useInstancesStore } from '~/stores/instances'
import { resolvePublicInstanceUrl } from '~/utils/instances'

export type { mastodon }

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

function cachedClient(url: string, accessToken?: string | null): mastodon.rest.Client {
  const normalized = normalizeUrl(url)
  const key = cacheKey(normalized, accessToken)
  // Token change for this host — drop stale entries
  const prefix = `${normalized}\0`
  for (const existing of [...clientCache.keys()]) {
    if (existing.startsWith(prefix) && existing !== key) clientCache.delete(existing)
  }
  let client = clientCache.get(key)
  if (!client) {
    client = createRestAPIClient({
      url: normalized,
      accessToken: accessToken || undefined,
    })
    clientCache.set(key, client)
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

export function setReadAccountOverride(instanceId: string | null) {
  readAccountOverrideId = instanceId
}

/** Authenticated client for the active account */
export function activeClient(): mastodon.rest.Client {
  if (readAccountOverrideId) {
    try {
      return clientFor(readAccountOverrideId)
    } catch {
      /* fall through to active */
    }
  }
  const store = useInstancesStore()
  const account = store.activeAccount
  if (!account?.url || !account.accessToken) {
    throw new Error('Not authenticated')
  }
  return cachedClient(account.url, account.accessToken)
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
    const authed = store.getInstanceByUrl(preferredUrl)
    if (authed?.accessToken) {
      return cachedClient(preferredUrl, authed.accessToken)
    }
  }

  const resolved = resolvePublicInstanceUrl(preferred)
  const matching = store.getInstanceByUrl(resolved)
  return cachedClient(resolved, matching?.accessToken)
}

/** Composable wrapper for Nuxt auto-import convenience */
export function useMasto() {
  return { clientFor, activeClient, publicClient, clearClientCache }
}
