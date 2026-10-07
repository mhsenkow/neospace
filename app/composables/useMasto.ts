/**
 * Shared Mastodon/GoToSocial API client helpers.
 * Single place for createRestAPIClient construction.
 */

import { createRestAPIClient, type mastodon } from 'masto'
import { useInstancesStore } from '~/stores/instances'
import { resolvePublicInstanceUrl } from '~/utils/instances'

export type { mastodon }

/** Authenticated client for a specific connected instance */
export function clientFor(instanceId: string): mastodon.rest.Client {
  const store = useInstancesStore()
  const instance = store.instances.find((i) => i.id === instanceId)
  if (!instance) throw new Error('Instance not found')
  return createRestAPIClient({
    url: instance.url,
    accessToken: instance.accessToken || undefined,
  })
}

/** Authenticated client for the active account */
export function activeClient(): mastodon.rest.Client {
  const store = useInstancesStore()
  const account = store.activeAccount
  if (!account?.url || !account.accessToken) {
    throw new Error('Not authenticated')
  }
  return createRestAPIClient({
    url: account.url,
    accessToken: account.accessToken,
  })
}

/**
 * Public (optionally authenticated) client for browsing.
 * If the preferred host has a token, use it as-is — even on auth-gated hosts
 * (mastodon.social etc.). Guest remap to fosstodon only applies when unauthenticated.
 */
export function publicClient(url?: string | null): mastodon.rest.Client {
  const store = useInstancesStore()
  const preferred =
    url ||
    store.activeAccount?.url ||
    store.instances[0]?.url ||
    null

  if (preferred) {
    const preferredUrl = preferred.replace(/\/+$/, '')
    const authed = store.getInstanceByUrl(preferredUrl)
    if (authed?.accessToken) {
      return createRestAPIClient({
        url: preferredUrl,
        accessToken: authed.accessToken,
      })
    }
  }

  const resolved = resolvePublicInstanceUrl(preferred)
  const matching = store.getInstanceByUrl(resolved)
  return createRestAPIClient({
    url: resolved,
    accessToken: matching?.accessToken || undefined,
  })
}

/** Composable wrapper for Nuxt auto-import convenience */
export function useMasto() {
  return { clientFor, activeClient, publicClient }
}
