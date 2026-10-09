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

type SearchBatch = { accounts: number; statuses: number; hashtags: number }

/**
 * Offset/has-more after a page. Mastodon applies `offset` to each result type
 * separately, so on the mixed tab advance by the fullest type — summing them
 * skipped results (16 people + 3 posts → next offset 19 lost people 17–19).
 */
export function nextSearchPage(tab: ExploreSearchTab, offset: number, batch: SearchBatch) {
  const len =
    tab === 'people'
      ? batch.accounts
      : tab === 'posts'
        ? batch.statuses
        : tab === 'tags'
          ? batch.hashtags
          : Math.max(batch.accounts, batch.statuses, batch.hashtags)
  return { offset: offset + len, hasMore: len >= PAGE_SIZE }
}

/** Append a page without repeating items the server shifted across the boundary */
export function appendUnique<T>(prev: T[], next: T[], key: (item: T) => string): T[] {
  if (!next.length) return prev
  const seen = new Set(prev.map(key))
  const out = prev.slice()
  for (const item of next) {
    const k = key(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

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
  /**
   * Bumps when the result set is replaced. Enrichment checks this rather than
   * its request ticket: a load-more (new ticket) must not discard page 1's
   * relationships, or Follow shows for people you already follow.
   */
  let resultsGen = 0
  /** Follow toggles in flight — a double tap would otherwise send two */
  const pendingFollows = new Set<string>()

  const shouldResolveQuery = (q: string) =>
    /@[\w.-]+@[\w.-]+/.test(q) || /^https?:\/\//i.test(q.trim())

  const clearResults = () => {
    searchRace.abort()
    resultsGen++
    // The aborted request's finally skips these (stale ticket) — reset here or
    // "Searching…" sticks after switching to Servers mid-search
    searchBusy.value = false
    loadMoreBusy.value = false
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

  const enrichPeople = async (accts: mastodon.v1.Account[], gen: number) => {
    if (!accts.length) return
    try {
      const client = activeClient()
      const ids = accts.map((a) => a.id)
      const rels = await client.v1.accounts.relationships.fetch({ id: ids })
      if (gen !== resultsGen) return
      const map: Record<string, mastodon.v1.Relationship> = {}
      for (const r of rels) map[r.id] = r
      relationships.value = { ...relationships.value, ...map }
    } catch {
      // optional enrichment
    }
  }

  const enrichTags = async (tags: mastodon.v1.Tag[], gen: number) => {
    if (!tags.length) return
    try {
      const client = activeClient()
      const rels = await Promise.all(
        tags.map((t) => client.v1.tags.$select(encodeURIComponent(t.name)).fetch().catch(() => null)),
      )
      if (gen !== resultsGen) return
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
      resultsGen++
      searchBusy.value = true
      searchError.value = null
      searchOffset.value = 0
    }

    try {
      const client = activeClient()
      const type = searchType(opts.tab.value)
      const offset = append ? searchOffset.value : 0
      const resolve = searchOpts?.resolve ?? shouldResolveQuery(trimmed)

      const gen = resultsGen
      const res = await client.v2.search.list(
        {
          q: trimmed,
          limit: PAGE_SIZE,
          offset,
          resolve,
          ...(type ? { type } : {}),
        },
        // Typing past "ab" → "abc" cancels the "ab" request outright
        { requestInit: { signal: ticket.signal } },
      )

      if (!ticket.isCurrent()) return

      const nextAccounts = res.accounts || []
      const nextStatuses = res.statuses || []
      const nextTags = res.hashtags || []

      if (append) {
        accounts.value = appendUnique(accounts.value, nextAccounts, (a) => a.id)
        statuses.value = appendUnique(statuses.value, nextStatuses, (s) => s.id)
        hashtags.value = appendUnique(hashtags.value, nextTags, (t) => t.name.toLowerCase())
      } else {
        accounts.value = nextAccounts
        statuses.value = nextStatuses
        hashtags.value = nextTags
        relationships.value = {}
        followedTags.value = new Set()
      }

      const page = nextSearchPage(opts.tab.value, offset, {
        accounts: nextAccounts.length,
        statuses: nextStatuses.length,
        hashtags: nextTags.length,
      })
      searchOffset.value = page.offset
      searchHasMore.value = page.hasMore

      if (nextAccounts.length) void enrichPeople(nextAccounts, gen)
      if (nextTags.length) void enrichTags(nextTags, gen)
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
    const pendingKey = `a:${account.id}`
    if (pendingFollows.has(pendingKey)) return
    pendingFollows.add(pendingKey)
    const rel = relationships.value[account.id]
    try {
      const client = activeClient()
      const next =
        rel?.following || rel?.requested
          ? await client.v1.accounts.$select(account.id).unfollow()
          : await client.v1.accounts.$select(account.id).follow()
      relationships.value = { ...relationships.value, [account.id]: next }
    } finally {
      pendingFollows.delete(pendingKey)
    }
  }

  const toggleFollowTag = async (tag: mastodon.v1.Tag) => {
    const key = tag.name.toLowerCase()
    const pendingKey = `t:${key}`
    if (pendingFollows.has(pendingKey)) return
    pendingFollows.add(pendingKey)
    const following = followedTags.value.has(key)
    try {
      const client = activeClient()
      // Server-supplied name, but masto.js joins it into the path unescaped
      const tagApi = client.v1.tags.$select(encodeURIComponent(tag.name))
      if (following) {
        await tagApi.unfollow()
        const next = new Set(followedTags.value)
        next.delete(key)
        followedTags.value = next
      } else {
        await tagApi.follow()
        followedTags.value = new Set([...followedTags.value, key])
      }
    } finally {
      pendingFollows.delete(pendingKey)
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
    // Cancel the in-flight request too (next() would open a fresh controller)
    searchRace.abort()
    resultsGen++
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
