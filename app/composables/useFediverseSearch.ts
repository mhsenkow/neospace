/**
 * Fediverse search for Explore — stale guards, offset paging, relationships.
 */

import type { mastodon } from 'masto'
import { ref, watch, onUnmounted, type Ref } from 'vue'
import { activeClient } from '~/composables/useMasto'
import { createRaceGuard } from '~/composables/useRace'
import { mapErrorToMessage } from '~/utils/friendlyError'

export type ExploreSearchTab = 'all' | 'people' | 'posts' | 'tags' | 'servers'

const PAGE_SIZE = 16

export function useFediverseSearch(opts: {
  query: Ref<string>
  tab: Ref<ExploreSearchTab>
  isSignedIn: Ref<boolean>
}) {
  const searchBusy = ref(false)
  const searchError = ref<string | null>(null)
  const accounts = ref<mastodon.v1.Account[]>([])
  const statuses = ref<mastodon.v1.Status[]>([])
  const hashtags = ref<mastodon.v1.Tag[]>([])
  const relationships = ref<Record<string, mastodon.v1.Relationship>>({})
  const followedTags = ref<Set<string>>(new Set())
  const searchOffset = ref(0)
  const searchHasMore = ref(false)
  const loadMoreBusy = ref(false)

  const searchRace = createRaceGuard()
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const shouldResolveQuery = (q: string) =>
    /@[\w.-]+@[\w.-]+/.test(q) || /^https?:\/\//i.test(q.trim())

  const clearResults = () => {
    searchRace.abort()
    accounts.value = []
    statuses.value = []
    hashtags.value = []
    relationships.value = {}
    followedTags.value = new Set()
    searchError.value = null
    searchOffset.value = 0
    searchHasMore.value = false
  }

  const searchType = (tab: ExploreSearchTab) => {
    if (tab === 'people') return 'accounts' as const
    if (tab === 'posts') return 'statuses' as const
    if (tab === 'tags') return 'hashtags' as const
    return undefined
  }

  const enrichPeople = async (accts: mastodon.v1.Account[], ticket: ReturnType<typeof searchRace.next>) => {
    if (!accts.length) return
    try {
      const client = activeClient()
      const ids = accts.map((a) => a.id)
      const rels = await client.v1.accounts.relationships.fetch({ id: ids })
      if (!ticket.isCurrent()) return
      const map: Record<string, mastodon.v1.Relationship> = {}
      for (const r of rels) map[r.id] = r
      relationships.value = { ...relationships.value, ...map }
    } catch {
      // optional enrichment
    }
  }

  const enrichTags = async (tags: mastodon.v1.Tag[], ticket: ReturnType<typeof searchRace.next>) => {
    if (!tags.length) return
    try {
      const client = activeClient()
      const rels = await Promise.all(
        tags.map((t) => client.v1.tags.$select(t.name).fetch().catch(() => null)),
      )
      if (!ticket.isCurrent()) return
      const next = new Set(followedTags.value)
      rels.forEach((tag, i) => {
        if (tag?.following) next.add(tags[i]!.name.toLowerCase())
      })
      followedTags.value = next
    } catch {
      // optional
    }
  }

  const runSearch = async (q: string, searchOpts?: { resolve?: boolean; append?: boolean }) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      clearResults()
      return
    }
    if (opts.tab.value === 'servers' || !opts.isSignedIn.value) {
      clearResults()
      return
    }

    const append = searchOpts?.append ?? false
    const ticket = searchRace.next()
    if (append) loadMoreBusy.value = true
    else {
      searchBusy.value = true
      searchError.value = null
      searchOffset.value = 0
    }

    try {
      const client = activeClient()
      const type = searchType(opts.tab.value)
      const offset = append ? searchOffset.value : 0
      const resolve = searchOpts?.resolve ?? shouldResolveQuery(trimmed)

      const res = await client.v2.search.list({
        q: trimmed,
        limit: PAGE_SIZE,
        offset,
        resolve,
        ...(type ? { type } : {}),
      })

      if (!ticket.isCurrent()) return

      const nextAccounts = res.accounts || []
      const nextStatuses = res.statuses || []
      const nextTags = res.hashtags || []

      if (append) {
        accounts.value = [...accounts.value, ...nextAccounts]
        statuses.value = [...statuses.value, ...nextStatuses]
        hashtags.value = [...hashtags.value, ...nextTags]
      } else {
        accounts.value = nextAccounts
        statuses.value = nextStatuses
        hashtags.value = nextTags
        relationships.value = {}
        followedTags.value = new Set()
      }

      const batchLen =
        opts.tab.value === 'people'
          ? nextAccounts.length
          : opts.tab.value === 'posts'
            ? nextStatuses.length
            : opts.tab.value === 'tags'
              ? nextTags.length
              : nextAccounts.length + nextStatuses.length + nextTags.length

      searchOffset.value = offset + batchLen
      searchHasMore.value = batchLen >= PAGE_SIZE

      if (nextAccounts.length) void enrichPeople(nextAccounts, ticket)
      if (nextTags.length) void enrichTags(nextTags, ticket)
    } catch (e: unknown) {
      if (!ticket.isCurrent()) return
      if ((e as { name?: string })?.name === 'AbortError') return
      const friendly = mapErrorToMessage(e)
      if (!append) {
        searchError.value = friendly.detail || friendly.title || 'Search failed'
        accounts.value = []
        statuses.value = []
        hashtags.value = []
      }
    } finally {
      if (ticket.isCurrent()) {
        searchBusy.value = false
        loadMoreBusy.value = false
      }
    }
  }

  const loadMore = () => {
    if (!searchHasMore.value || searchBusy.value || loadMoreBusy.value) return
    void runSearch(opts.query.value, { append: true })
  }

  const scheduleSearch = (debounceMs = 260) => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      if (opts.tab.value !== 'servers') void runSearch(opts.query.value)
      else clearResults()
    }, debounceMs)
  }

  const toggleFollowAccount = async (account: mastodon.v1.Account) => {
    const rel = relationships.value[account.id]
    const client = activeClient()
    try {
      if (rel?.following || rel?.requested) {
        const next = await client.v1.accounts.$select(account.id).unfollow()
        relationships.value = { ...relationships.value, [account.id]: next }
      } else {
        const next = await client.v1.accounts.$select(account.id).follow()
        relationships.value = { ...relationships.value, [account.id]: next }
      }
    } catch (e) {
      throw e
    }
  }

  const toggleFollowTag = async (tag: mastodon.v1.Tag) => {
    const key = tag.name.toLowerCase()
    const client = activeClient()
    const following = followedTags.value.has(key)
    try {
      if (following) {
        await client.v1.tags.$select(tag.name).unfollow()
        const next = new Set(followedTags.value)
        next.delete(key)
        followedTags.value = next
      } else {
        await client.v1.tags.$select(tag.name).follow()
        followedTags.value = new Set([...followedTags.value, key])
      }
    } catch (e) {
      throw e
    }
  }

  watch(
    () => opts.tab.value,
    () => {
      if (opts.query.value.trim().length >= 2 && opts.tab.value !== 'servers' && opts.isSignedIn.value) {
        void runSearch(opts.query.value)
      }
    },
  )

  watch(opts.isSignedIn, (ok) => {
    if (ok && opts.query.value.trim().length >= 2 && opts.tab.value !== 'servers') {
      void runSearch(opts.query.value)
    }
  })

  onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer)
    searchRace.next()
  })

  return {
    searchBusy,
    searchError,
    accounts,
    statuses,
    hashtags,
    relationships,
    followedTags,
    searchHasMore,
    loadMoreBusy,
    clearResults,
    runSearch,
    loadMore,
    scheduleSearch,
    shouldResolveQuery,
    toggleFollowAccount,
    toggleFollowTag,
  }
}
