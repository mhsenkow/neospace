/**
 * Shared relationship cache for feed cards / activity — batch-fetch and
 * optimistic follow so many cards can show a + badge without N+1 storms.
 */
import type { mastodon } from 'masto'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { activeClient } from '~/composables/useMasto'
import { useInstancesStore } from '~/stores/instances'
import { logWarn } from '~/utils/log'

const cache = reactive(new Map<string, mastodon.v1.Relationship>())
const pending = new Set<string>()
const settled = reactive(new Set<string>())
let flushTimer: ReturnType<typeof setTimeout> | null = null
const queue = new Set<string>()

const flush = async () => {
  flushTimer = null
  const ids = [...queue].filter((id) => id && !pending.has(id) && !settled.has(id))
  queue.clear()
  if (!ids.length) return
  const instances = useInstancesStore()
  if (!instances.hasAuthenticatedInstance) {
    for (const id of ids) settled.add(id)
    return
  }
  for (const id of ids) pending.add(id)
  try {
    const client = activeClient()
    // Mastodon caps relationship lookups; chunk to stay polite
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40)
      const rels = await client.v1.accounts.relationships.fetch({ id: chunk })
      for (const rel of rels) {
        cache.set(rel.id, rel)
        settled.add(rel.id)
      }
      for (const id of chunk) {
        if (!settled.has(id)) settled.add(id)
      }
    }
  } catch (e) {
    logWarn('relationship cache fetch failed', e)
    for (const id of ids) settled.add(id)
  } finally {
    for (const id of ids) pending.delete(id)
  }
}

export function useRelationshipCache() {
  const instances = useInstancesStore()

  const relationshipOf = (accountId: MaybeRefOrGetter<string | null | undefined>) =>
    computed(() => {
      const id = toValue(accountId)
      return id ? cache.get(id) || null : null
    })

  const isSettled = (accountId: MaybeRefOrGetter<string | null | undefined>) =>
    computed(() => {
      const id = toValue(accountId)
      return !!id && settled.has(id)
    })

  const ensure = (accountId: string | null | undefined) => {
    if (!accountId || settled.has(accountId) || pending.has(accountId) || queue.has(accountId)) return
    if (accountId === instances.currentUser?.id) {
      settled.add(accountId)
      return
    }
    queue.add(accountId)
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), 80)
  }

  const follow = async (accountId: string) => {
    if (!accountId || !instances.hasAuthenticatedInstance) return null
    const prev = cache.get(accountId)
    const optimistic: mastodon.v1.Relationship = {
      ...(prev || ({ id: accountId } as mastodon.v1.Relationship)),
      following: !prev?.following && !prev?.requested ? true : !!prev?.following,
      requested: !prev?.following && !!instances.currentUser ? false : !!prev?.requested,
    }
    // Locked accounts usually land as requested — keep optimistic following for open accounts
    cache.set(accountId, optimistic)
    try {
      const client = activeClient()
      if (prev?.following || prev?.requested) {
        const updated = await client.v1.accounts.$select(accountId).unfollow()
        cache.set(accountId, updated)
        return updated
      }
      const updated = await client.v1.accounts.$select(accountId).follow()
      cache.set(accountId, updated)
      return updated
    } catch (e) {
      if (prev) cache.set(accountId, prev)
      else cache.delete(accountId)
      throw e
    } finally {
      settled.add(accountId)
    }
  }

  return { relationshipOf, isSettled, ensure, follow, cache }
}
