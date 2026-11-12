/**
 * Cross-server / cross-account follow (and relationship) helpers.
 *
 * People discovered on a watched server (or via multi-server search) carry
 * that server's numeric ids. Acting through activeClient() with a foreign id
 * 404s or follows the wrong local account — so we always canonicalize to
 * `user@host`, resolve on the chosen signed-in account, then follow.
 */

import type { mastodon } from 'masto'
import { computed, reactive } from 'vue'
import { clientFor } from '~/composables/useMasto'
import { useInstancesStore, type ConnectedInstance } from '~/stores/instances'
import { accountsMatch, hostOf } from '~/utils/federation'
import { logWarn } from '~/utils/log'
import type { SourcedAccount } from '~/utils/searchMerge'

const relCache = reactive(new Map<string, mastodon.v1.Relationship>())
const pendingKeys = new Set<string>()

const cacheKey = (instanceId: string, acct: string) =>
  `${instanceId}|${acct.replace(/^@/, '').trim().toLowerCase()}`

/** Full `user@host` for lookup on any Mastodon server */
export function canonicalAcct(
  account: Pick<mastodon.v1.Account, 'acct' | 'username' | 'url'>,
  sourceHost?: string | null,
): string {
  const raw = (account.acct || account.username || '').replace(/^@/, '').trim()
  if (!raw) return ''
  if (raw.includes('@')) return raw.toLowerCase()

  const fromSource = (sourceHost || '').replace(/^@/, '').trim().toLowerCase()
  if (fromSource) return `${raw}@${fromSource}`.toLowerCase()

  const fromUrl = hostOf(account.url)
  if (fromUrl) return `${raw}@${fromUrl}`.toLowerCase()

  return raw.toLowerCase()
}

export function sourceHostOf(account: SourcedAccount, fallback?: string | null): string | null {
  if (account._sourceUrl) return hostOf(account._sourceUrl) || null
  if (fallback) return hostOf(fallback) || fallback.replace(/^https?:\/\//, '').split('/')[0] || null
  if (account.acct?.includes('@')) return account.acct.split('@')[1] || null
  return hostOf(account.url) || null
}

async function resolveOnClient(
  client: mastodon.rest.Client,
  want: string,
  homeHost?: string | null,
): Promise<mastodon.v1.Account | null> {
  try {
    const found = await client.v1.accounts.lookup({ acct: want })
    if (found && accountsMatch(want, found.acct, homeHost)) return found
  } catch {
    /* fall through */
  }
  try {
    const results = await client.v1.accounts.search.list({
      q: want,
      resolve: true,
      limit: 5,
    })
    return results.find((a) => accountsMatch(want, a.acct, homeHost)) || null
  } catch (e) {
    logWarn('cross-account resolve failed', e)
    return null
  }
}

export function useCrossAccountAction() {
  const instances = useInstancesStore()

  const signedInAccounts = computed(() => instances.authenticatedInstances)

  const canPickAccount = computed(() => signedInAccounts.value.length > 1)

  const relationshipFor = (instanceId: string, acct: string) =>
    computed(() => relCache.get(cacheKey(instanceId, acct)) || null)

  const ensureRelationship = async (
    instanceId: string,
    account: SourcedAccount,
    sourceHost?: string | null,
  ) => {
    const acct = canonicalAcct(account, sourceHostOf(account, sourceHost))
    if (!acct) return null
    const key = cacheKey(instanceId, acct)
    if (relCache.has(key) || pendingKeys.has(key)) return relCache.get(key) || null

    const instance = instances.instances.find((i) => i.id === instanceId)
    if (!instance?.accessToken) return null

    pendingKeys.add(key)
    try {
      const client = clientFor(instanceId)
      const homeHost = hostOf(instance.url)
      const resolved = await resolveOnClient(client, acct, homeHost)
      if (!resolved) return null
      const rels = await client.v1.accounts.relationships.fetch({ id: [resolved.id] })
      const rel = rels[0] || null
      if (rel) relCache.set(key, rel)
      return rel
    } catch (e) {
      logWarn('cross-account relationship fetch failed', e)
      return null
    } finally {
      pendingKeys.delete(key)
    }
  }

  /**
   * Follow / unfollow as a specific signed-in account. Resolves the remote
   * handle on that account's server first so foreign snowflake ids never leak.
   */
  const toggleFollowAs = async (
    instanceId: string,
    account: SourcedAccount,
    sourceHost?: string | null,
  ): Promise<mastodon.v1.Relationship | null> => {
    const instance = instances.instances.find((i) => i.id === instanceId)
    if (!instance?.accessToken) throw new Error('That account is no longer signed in')

    const acct = canonicalAcct(account, sourceHostOf(account, sourceHost))
    if (!acct) throw new Error('Couldn’t figure out that account’s handle')

    // Don't follow yourself on the same slot
    const selfAcct = canonicalAcct(
      {
        acct: instance.user?.acct || instance.user?.username || '',
        username: instance.user?.username || '',
        url: instance.user?.url || instance.url,
      },
      hostOf(instance.url),
    )
    if (selfAcct && accountsMatch(acct, selfAcct, hostOf(instance.url))) {
      throw new Error('That’s your own account')
    }

    const client = clientFor(instanceId)
    const homeHost = hostOf(instance.url)
    const resolved = await resolveOnClient(client, acct, homeHost)
    if (!resolved) throw new Error(`Couldn’t find @${acct} on ${homeHost || 'your server'}`)

    const key = cacheKey(instanceId, acct)
    let current: mastodon.v1.Relationship | null | undefined = relCache.get(key)
    if (!current) {
      try {
        const rels = await client.v1.accounts.relationships.fetch({ id: [resolved.id] })
        current = rels[0] || null
      } catch {
        current = null
      }
    }

    const following = !!current?.following || !!current?.requested
    const next = following
      ? await client.v1.accounts.$select(resolved.id).unfollow()
      : await client.v1.accounts.$select(resolved.id).follow()
    relCache.set(key, next)
    return next
  }

  /** Follow/unfollow as the global active account (with cross-server resolve). */
  const toggleFollow = async (account: SourcedAccount, sourceHost?: string | null) => {
    const active = instances.activeAccount
    if (!active?.accessToken) throw new Error('Sign in to follow people')
    return toggleFollowAs(active.id, account, sourceHost)
  }

  const followLabel = (rel: mastodon.v1.Relationship | null | undefined, locked = false) => {
    if (rel?.following) return 'Following'
    if (rel?.requested) return 'Requested'
    return locked ? 'Request' : 'Follow'
  }

  const accountHandle = (instance: ConnectedInstance) => {
    const acct = instance.user?.acct || instance.user?.username || ''
    const host = hostOf(instance.url)
    if (!acct) return host || instance.name
    return acct.includes('@') ? `@${acct}` : `@${acct}@${host}`
  }

  return {
    signedInAccounts,
    canPickAccount,
    relationshipFor,
    ensureRelationship,
    toggleFollowAs,
    toggleFollow,
    followLabel,
    accountHandle,
    canonicalAcct,
    sourceHostOf,
  }
}
