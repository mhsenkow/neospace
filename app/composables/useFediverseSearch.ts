/**
 * Fediverse search for Explore — one engine, tuned per tab.
 *
 * - Signed in: fan-out across the active account, linked accounts, watched
 *   servers, and (when the query targets a host) that remote public API.
 * - Scope pill can pin the search to one account or `host:domain`.
 * - Guest: the watched/public server — people + tags only (Mastodon refuses
 *   `offset`/`resolve` without auth), with #tag timelines standing in for posts.
 * - All: a capped preview of each type plus a "top hit"; type tabs page by
 *   their own offset on the primary (preferred) target.
 * - Results are cached briefly so tab flips and Back are instant.
 */

import type { mastodon } from 'masto'
import { ref, watch, onUnmounted, type Ref } from 'vue'
import { onDeletedStatus } from '~/composables/useDeletedStatus'
import { dropDeletedStatus } from '~/utils/deletedStatus'
import { activeClient, activeCredentials, clientFor, publicClient } from '~/composables/useMasto'
import { createRaceGuard } from '~/composables/useRace'
import { useCrossAccountAction } from '~/composables/useCrossAccountAction'
import { mapErrorToMessage } from '~/utils/friendlyError'
import { resolvePublicInstanceUrl } from '~/utils/instances'
import { useInstancesStore } from '~/stores/instances'
import {
  mergeAccountsByCanonical,
  mergeHashtagsByName,
  mergeStatusesByIdentity,
  type SourcedAccount,
  type SourcedStatus,
} from '~/utils/searchMerge'
import {
  buildPostQuery,
  detectIntent,
  hasPostOperators,
  hostSearchText,
  resolvableQuery,
  tagFromQuery,
  type PostFilters,
} from '~/utils/searchQuery'

export type ExploreSearchTab = 'all' | 'people' | 'posts' | 'tags' | 'servers'

export type TopHit =
  | { kind: 'account'; account: mastodon.v1.Account }
  | { kind: 'status'; status: mastodon.v1.Status }
  | { kind: 'tag'; tag: mastodon.v1.Tag }

/** Results per page on a type tab */
const PAGE_SIZE = 16
/** Results per type on All (preview + "See all") */
export const ALL_PREVIEW = 8
const CACHE_TTL_MS = 90_000
const CACHE_MAX = 40

type Snapshot = {
  at: number
  accounts: mastodon.v1.Account[]
  statuses: mastodon.v1.Status[]
  hashtags: mastodon.v1.Tag[]
  tagTimeline: mastodon.v1.Status[]
  tagTimelineTag: string | null
  topHit: TopHit | null
  hasMore: boolean
  offset: number
  postsLimited: boolean
}

/** Module-level so results survive leaving and re-entering Explore */
const cache = new Map<string, Snapshot>()

function cacheGet(key: string): Snapshot | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit
}

function cacheSet(key: string, snap: Snapshot) {
  cache.delete(key)
  cache.set(key, snap)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

const typeFor = (tab: ExploreSearchTab) =>
  tab === 'people' ? ('accounts' as const) : tab === 'posts' ? ('statuses' as const) : tab === 'tags' ? ('hashtags' as const) : undefined

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

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Recent public posts for a tag; empty on failure (tag timelines are garnish) */
async function tagTimelineOf(client: mastodon.rest.Client, tag: string, limit: number) {
  try {
    return await client.v1.timelines.tag.$select(encodeURIComponent(tag)).list({ limit })
  } catch {
    return [] as mastodon.v1.Status[]
  }
}

export type SearchScope = 'everywhere' | string

type FanTarget = {
  id: string
  url: string
  client: mastodon.rest.Client
  guest: boolean
  prefer: boolean
}

export function useFediverseSearch(opts: {
  query: Ref<string>
  tab: Ref<ExploreSearchTab>
  isSignedIn: Ref<boolean>
  postFilters: Ref<PostFilters>
  peopleFollowingOnly: Ref<boolean>
  /** `everywhere` | signed-in instance id | `host:domain` */
  searchScope?: Ref<SearchScope>
}) {
  const instancesStore = useInstancesStore()
  const cross = useCrossAccountAction()
  const scopeRef = opts.searchScope

  const searchBusy = ref(false)
  const searchError = ref<string | null>(null)
  const accounts = ref<mastodon.v1.Account[]>([])
  const statuses = ref<mastodon.v1.Status[]>([])
  const hashtags = ref<mastodon.v1.Tag[]>([])
  /** Recent posts for a #tag — guests, and servers without full-text search */
  const tagTimeline = ref<mastodon.v1.Status[]>([])
  const tagTimelineTag = ref<string | null>(null)
  const topHit = ref<TopHit | null>(null)
  /** Signed-in post search came back empty for plain words (opt-in index / no ES) */
  const postsLimited = ref(false)
  const relationships = ref<Record<string, mastodon.v1.Relationship>>({})
  const followedTags = ref<Set<string>>(new Set())
  const searchHasMore = ref(false)
  const loadMoreBusy = ref(false)
  /** A load-more failed — show "Couldn't load more · Retry" instead of ending silently */
  const loadMoreError = ref(false)
  /** The query the visible results answer (lags typing until they land) */
  const resultsFor = ref('')
  let offset = 0
  /** Identical request already on the wire (tab watcher + typing can both ask) */
  let inflightKey: string | null = null

  const searchRace = createRaceGuard()
  /** Enrichment outside a search (cache hits, suggestions) — never stale-gated */
  const always = { isCurrent: () => true }
  type Ticket = { isCurrent: () => boolean; signal?: AbortSignal }
  /**
   * Bumps when the result set is replaced. Enrichment checks this rather than
   * its request ticket: a load-more (new ticket) must not discard page 1's
   * relationships, or Follow shows for people you already follow.
   */
  let resultsGen = 0
  const genTicket = (gen = resultsGen): Ticket => ({ isCurrent: () => gen === resultsGen })

  const scopeValue = () => scopeRef?.value || 'everywhere'

  /** Primary answering server (paging / top-hit / guest fallback) */
  const primarySource = (): FanTarget => {
    if (opts.isSignedIn.value) {
      try {
        const { url } = activeCredentials()
        return { id: instancesStore.activeAccountId || 'active', client: activeClient(), url, guest: false, prefer: true }
      } catch {
        // Signed in elsewhere, but the active account is watch-only — search as a guest
      }
    }
    const url = resolvePublicInstanceUrl(instancesStore.activeAccount?.url)
    return { id: 'public', client: publicClient(url), url, guest: true, prefer: true }
  }

  /** Fan-out targets for the current scope + query intent */
  const fanTargets = (q: string): FanTarget[] => {
    const scope = scopeValue()
    const intent = detectIntent(q)
    const seen = new Set<string>()
    const out: FanTarget[] = []

    const push = (t: FanTarget) => {
      const key = `${t.url}|${t.guest ? 'g' : 'u'}|${t.id}`
      if (seen.has(key)) return
      seen.add(key)
      out.push(t)
    }

    if (scope !== 'everywhere') {
      if (scope.startsWith('host:')) {
        const host = scope.slice(5).toLowerCase()
        const url = `https://${host}`
        push({ id: `host:${host}`, url, client: publicClient(url), guest: true, prefer: true })
        // Also search the active account with resolve so remote handles land as local IDs
        if (opts.isSignedIn.value) {
          try {
            push({ ...primarySource(), prefer: false })
          } catch { /* */ }
        }
        return out
      }
      const inst = instancesStore.instances.find((i) => i.id === scope)
      if (inst?.accessToken) {
        push({
          id: inst.id,
          url: inst.url,
          client: clientFor(inst.id),
          guest: false,
          prefer: true,
        })
        return out
      }
    }

    // everywhere (default)
    try {
      push(primarySource())
    } catch { /* */ }

    if (opts.isSignedIn.value) {
      for (const inst of instancesStore.authenticatedInstances) {
        if (inst.id === instancesStore.activeAccountId) continue
        try {
          push({
            id: inst.id,
            url: inst.url,
            client: clientFor(inst.id),
            guest: false,
            prefer: false,
          })
        } catch { /* */ }
      }
      for (const inst of instancesStore.watchingInstances) {
        push({
          id: inst.id,
          url: inst.url,
          client: publicClient(inst.url),
          guest: true,
          prefer: false,
        })
      }
    }

    // Typed / mentioned host — probe its public API too
    let hostHint: string | null = intent.kind === 'host' ? intent.host : null
    if (!hostHint && intent.kind === 'handle' && intent.remote) {
      hostHint = intent.acct.split('@')[1] || null
    }
    if (hostHint) {
      const url = `https://${hostHint}`
      push({ id: `host:${hostHint}`, url, client: publicClient(url), guest: true, prefer: false })
    }

    return out.length ? out : [primarySource()]
  }

  /** Posts carry their origin so likes/boosts/thread routing use the right server */
  const withOrigin = (list: mastodon.v1.Status[], url: string, id?: string): SourcedStatus[] =>
    list.map((s) => ({ ...s, _instanceUrl: url, ...(id ? { _instanceId: id } : {}) }) as SourcedStatus)

  const sentQuery = (q: string) => {
    const base = opts.tab.value === 'posts' ? buildPostQuery(q, opts.postFilters.value) : resolvableQuery(q)
    // Host-only queries also search people/tags for domain tokens
    if (detectIntent(q).kind === 'host') {
      const tokens = hostSearchText(q)
      return tokens && tokens !== base ? tokens : base
    }
    return base
  }

  // Keyed by account + scope: `from:me` / "People I follow" differ between two
  // linked accounts on the same instance.
  const cacheKey = (url: string, q: string) =>
    [
      url,
      instancesStore.activeAccountId ?? '',
      scopeValue(),
      opts.isSignedIn.value ? 'u' : 'g',
      opts.tab.value,
      sentQuery(q),
      opts.peopleFollowingOnly.value ? 'f' : '',
    ].join('|')

  const clearResults = () => {
    searchRace.abort()
    resultsGen++
    inflightKey = null
    accounts.value = []
    statuses.value = []
    hashtags.value = []
    tagTimeline.value = []
    tagTimelineTag.value = null
    topHit.value = null
    postsLimited.value = false
    searchError.value = null
    searchHasMore.value = false
    searchBusy.value = false
    loadMoreBusy.value = false
    loadMoreError.value = false
    resultsFor.value = ''
    offset = 0
  }

  const applySnapshot = (s: Snapshot) => {
    accounts.value = s.accounts
    statuses.value = s.statuses
    hashtags.value = s.hashtags
    tagTimeline.value = s.tagTimeline
    tagTimelineTag.value = s.tagTimelineTag
    topHit.value = s.topHit
    searchHasMore.value = s.hasMore
    postsLimited.value = s.postsLimited
    offset = s.offset
  }

  const enrichPeople = async (accts: mastodon.v1.Account[], ticket: Ticket) => {
    if (!accts.length || !opts.isSignedIn.value) return
    const missing = accts.filter((a) => !relationships.value[a.id]).map((a) => a.id)
    if (!missing.length) return
    try {
      const rels = await activeClient().v1.accounts.relationships.fetch({ id: missing })
      if (!ticket.isCurrent()) return
      const map: Record<string, mastodon.v1.Relationship> = {}
      for (const r of rels) map[r.id] = r
      relationships.value = { ...relationships.value, ...map }
    } catch {
      // optional enrichment
    }
  }

  /**
   * Mastodon 4+ includes `following` on tags for signed-in requests — use it.
   * Only older servers fall back to a per-tag lookup (capped).
   */
  const enrichTags = async (tags: mastodon.v1.Tag[], ticket: Ticket) => {
    if (!tags.length || !opts.isSignedIn.value) return
    const next = new Set(followedTags.value)
    const unknown: mastodon.v1.Tag[] = []
    for (const t of tags) {
      const f = (t as { following?: boolean }).following
      if (f === true) next.add(t.name.toLowerCase())
      else if (f === false) next.delete(t.name.toLowerCase())
      else unknown.push(t)
    }
    followedTags.value = next
    if (!unknown.length) return
    try {
      const client = activeClient()
      const rels = await Promise.all(
        unknown.slice(0, 8).map((t) => client.v1.tags.$select(encodeURIComponent(t.name)).fetch().catch(() => null)),
      )
      if (!ticket.isCurrent()) return
      const merged = new Set(followedTags.value)
      for (const tag of rels) if (tag?.following) merged.add(tag.name.toLowerCase())
      followedTags.value = merged
    } catch {
      // optional
    }
  }

  const pickTopHit = async (
    q: string,
    res: { accounts: mastodon.v1.Account[]; statuses: mastodon.v1.Status[]; hashtags: mastodon.v1.Tag[] },
    client: mastodon.rest.Client,
    url: string,
  ): Promise<TopHit | null> => {
    const intent = detectIntent(q)
    if (intent.kind === 'url') {
      if (res.statuses.length === 1 && !res.accounts.length) return { kind: 'status', status: res.statuses[0]! }
      if (res.accounts.length === 1) return { kind: 'account', account: res.accounts[0]! }
      return null
    }
    if (intent.kind === 'handle') {
      const want = intent.acct.toLowerCase()
      const host = new URL(url).hostname.toLowerCase()
      const exact = res.accounts.find((a) => {
        const acct = a.acct.toLowerCase()
        return acct === want || `${acct}@${host}` === want || acct === `${want}@${host}`
      })
      if (exact) return { kind: 'account', account: exact }
      // Guests can't resolve via search — lookup still knows accounts the server has seen
      try {
        const account = await client.v1.accounts.lookup({ acct: intent.acct })
        return account ? { kind: 'account', account } : null
      } catch {
        return null
      }
    }
    const tag = tagFromQuery(q)
    if (tag) {
      const exact = res.hashtags.find((t) => sameTag(t.name, tag))
      if (exact && (intent.kind === 'tag' || res.accounts.every((a) => !sameTag(a.username, tag)))) {
        return { kind: 'tag', tag: exact }
      }
    }
    return null
  }

  const runSearch = async (q: string, searchOpts?: { resolve?: boolean; append?: boolean }) => {
    const trimmed = q.trim()
    const tab = opts.tab.value
    if (trimmed.length < 2 || tab === 'servers') {
      clearResults()
      return
    }

    let targets: FanTarget[]
    try {
      targets = fanTargets(trimmed)
    } catch {
      clearResults()
      return
    }
    const primary = targets.find((t) => t.prefer) || targets[0]
    if (!primary) {
      clearResults()
      return
    }

    const append = searchOpts?.append ?? false
    // Load-more pages only the primary (auth) target — fan-out is for first page discovery
    const key = cacheKey(primary.url, trimmed)
    if (!append && !searchOpts?.resolve) {
      const cached = cacheGet(key)
      if (cached) {
        searchRace.abort()
        inflightKey = null
        applySnapshot(cached)
        searchBusy.value = false
        searchError.value = null
        resultsFor.value = trimmed
        const people = cached.topHit?.kind === 'account' ? [cached.topHit.account, ...cached.accounts] : cached.accounts
        void enrichPeople(people, always)
        void enrichTags(cached.hashtags, always)
        return
      }
    }

    const wireKey = `${key}|${append ? `+${offset}` : ''}|${searchOpts?.resolve ? 'r' : ''}`
    if (wireKey === inflightKey) return
    inflightKey = wireKey

    const ticket = searchRace.next()
    if (append) {
      loadMoreBusy.value = true
      loadMoreError.value = false
    } else {
      resultsGen++
      loadMoreError.value = false
      searchBusy.value = true
      searchError.value = null
    }
    const enrichTicket = genTicket()

    const intent = detectIntent(trimmed)
    const type = typeFor(tab)
    const isAll = tab === 'all'
    const limit = isAll ? ALL_PREVIEW : PAGE_SIZE
    const pageOffset = append ? offset : 0
    const tagForTimeline = tagFromQuery(trimmed)
    const qSent = sentQuery(trimmed)

    const searchOne = async (t: FanTarget) => {
      const resolve =
        !t.guest && (searchOpts?.resolve ?? (intent.kind === 'url' || (intent.kind === 'handle' && intent.remote)))
      // Guests can't search post text — skip straight to the tag timeline
      if (t.guest && tab === 'posts') {
        return {
          target: t,
          accounts: [] as SourcedAccount[],
          statuses: [] as SourcedStatus[],
          hashtags: [] as mastodon.v1.Tag[],
        }
      }
      try {
        const res = await t.client.v2.search.list(
          {
            q: qSent,
            limit,
            resolve,
            // Only the preferred target pages; fan-out always requests page 1
            ...(!t.guest && !isAll && t.prefer && append ? { offset: pageOffset } : {}),
            ...(type ? { type } : {}),
            ...(tab === 'people' && opts.peopleFollowingOnly.value && !t.guest && t.prefer
              ? { following: true }
              : {}),
          },
          { requestInit: { signal: ticket.signal } },
        )
        return {
          target: t,
          accounts: (res.accounts || []).map(
            (a) => ({ ...a, _sourceUrl: t.url }) as SourcedAccount,
          ),
          statuses: withOrigin(res.statuses || [], t.url, t.id),
          hashtags: res.hashtags || [],
        }
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') throw e
        return {
          target: t,
          accounts: [] as SourcedAccount[],
          statuses: [] as SourcedStatus[],
          hashtags: [] as mastodon.v1.Tag[],
        }
      }
    }

    try {
      const fanList = append ? [primary] : targets
      const batches = await Promise.all(fanList.map(searchOne))
      if (!ticket.isCurrent()) return

      const preferredHost = (() => {
        try {
          return new URL(primary.url).hostname
        } catch {
          return null
        }
      })()

      let nextAccounts = mergeAccountsByCanonical(
        batches.map((b) => ({
          accounts: b.accounts,
          sourceUrl: b.target.url,
          prefer: b.target.prefer,
        })),
        preferredHost,
      )
      let nextStatuses = mergeStatusesByIdentity(batches.map((b) => b.statuses))
      let nextTags = mergeHashtagsByName(batches.map((b) => b.hashtags))

      // Cap All-tab previews after merge
      if (isAll && !append) {
        nextAccounts = nextAccounts.slice(0, ALL_PREVIEW)
        nextStatuses = nextStatuses.slice(0, ALL_PREVIEW)
        nextTags = nextTags.slice(0, ALL_PREVIEW)
      }

      if (append) {
        accounts.value = appendUnique(accounts.value, nextAccounts, (a) => a.id)
        statuses.value = appendUnique(statuses.value, nextStatuses, (s) => s.id)
        hashtags.value = appendUnique(hashtags.value, nextTags, (t) => t.name.toLowerCase())
      } else {
        if (tagForTimeline) {
          const i = nextTags.findIndex((t) => sameTag(t.name, tagForTimeline))
          if (i > 0) nextTags = [nextTags[i]!, ...nextTags.slice(0, i), ...nextTags.slice(i + 1)]
        }
        accounts.value = nextAccounts
        statuses.value = nextStatuses
        hashtags.value = nextTags
      }

      const primaryBatch = batches.find((b) => b.target.id === primary.id) || batches[0]!
      const page = nextSearchPage(tab, pageOffset, {
        accounts: primaryBatch.accounts.length,
        statuses: primaryBatch.statuses.length,
        hashtags: primaryBatch.hashtags.length,
      })
      offset = page.offset
      searchHasMore.value = !isAll && !primary.guest && page.hasMore

      if (!append) {
        postsLimited.value =
          !primary.guest &&
          (tab === 'posts' || isAll) &&
          !nextStatuses.length &&
          intent.kind === 'text' &&
          !hasPostOperators(trimmed)

        const wantsTimeline =
          !!tagForTimeline && (tab === 'posts' || isAll) && (primary.guest || intent.kind === 'tag' || postsLimited.value)

        let timeline: mastodon.v1.Status[] | null = null
        let timelineTag: string | null = null
        if (wantsTimeline && tagForTimeline) {
          timeline = await tagTimelineOf(primary.client, tagForTimeline, isAll ? 6 : PAGE_SIZE)
          timelineTag = tagForTimeline
        }
        if (!ticket.isCurrent()) return
        tagTimeline.value = withOrigin(timeline || [], primary.url, primary.id)
        tagTimelineTag.value = tagTimeline.value.length ? timelineTag : null

        topHit.value = isAll
          ? await pickTopHit(
              trimmed,
              { accounts: nextAccounts, statuses: nextStatuses, hashtags: nextTags },
              primary.client,
              primary.url,
            )
          : null
        if (!ticket.isCurrent()) return
        resultsFor.value = trimmed
      }

      cacheSet(key, {
        at: Date.now(),
        accounts: accounts.value,
        statuses: statuses.value,
        hashtags: hashtags.value,
        tagTimeline: tagTimeline.value,
        tagTimelineTag: tagTimelineTag.value,
        topHit: topHit.value,
        hasMore: searchHasMore.value,
        offset,
        postsLimited: postsLimited.value,
      })

      const peopleToEnrich =
        topHit.value?.kind === 'account' ? [topHit.value.account, ...nextAccounts] : nextAccounts
      if (peopleToEnrich.length) void enrichPeople(peopleToEnrich, enrichTicket)
      if (nextTags.length) void enrichTags(nextTags, enrichTicket)
    } catch (e: unknown) {
      if (!ticket.isCurrent()) return
      if ((e as { name?: string })?.name === 'AbortError') return
      if (!append) {
        const friendly = mapErrorToMessage(e)
        searchError.value = friendly.detail || friendly.title || 'Search failed'
        accounts.value = []
        statuses.value = []
        hashtags.value = []
        tagTimeline.value = []
        topHit.value = null
        resultsFor.value = trimmed
      } else {
        loadMoreError.value = true
      }
    } finally {
      if (ticket.isCurrent()) {
        searchBusy.value = false
        loadMoreBusy.value = false
        inflightKey = null
      }
    }
  }

  const loadMore = () => {
    if (!searchHasMore.value || searchBusy.value || loadMoreBusy.value || loadMoreError.value) return
    // Page the query the visible results answer — the box may already hold newer text
    // (debounce pending), which would append that query's page 2 onto these results.
    const answered = resultsFor.value
    if (!answered || opts.query.value.trim() !== answered) return
    void runSearch(answered, { append: true })
  }

  const retryLoadMore = () => {
    loadMoreError.value = false
    loadMore()
  }

  /** Follow toggles in flight — a double tap would otherwise send two */
  const pendingFollows = new Set<string>()

  const toggleFollowAccount = async (account: mastodon.v1.Account) => {
    const pendingKey = `a:${account.id}`
    if (pendingFollows.has(pendingKey)) return
    pendingFollows.add(pendingKey)
    try {
      const next = await cross.toggleFollow(account as SourcedAccount)
      if (next) relationships.value = { ...relationships.value, [account.id]: next }
    } finally {
      pendingFollows.delete(pendingKey)
    }
  }

  const toggleFollowTag = async (tag: mastodon.v1.Tag) => {
    const key = tag.name.toLowerCase()
    const pendingKey = `t:${key}`
    if (pendingFollows.has(pendingKey)) return
    pendingFollows.add(pendingKey)
    try {
      // Server-supplied name, but masto.js joins it into the path unescaped
      const sel = activeClient().v1.tags.$select(encodeURIComponent(tag.name))
      if (followedTags.value.has(key)) {
        await sel.unfollow()
        const next = new Set(followedTags.value)
        next.delete(key)
        followedTags.value = next
      } else {
        await sel.follow()
        followedTags.value = new Set([...followedTags.value, key])
      }
      // Follow state changed — cached tag rows would show the old button
      cache.clear()
    } finally {
      pendingFollows.delete(pendingKey)
    }
  }

  /** Seed relationships for accounts shown outside results (suggestions) */
  const ensureRelationships = (accts: mastodon.v1.Account[]) => {
    if (!accts.length) return
    void enrichPeople(accts, always)
  }

  // Filters / scope change what the server returns — re-run, bypassing the old cache key
  watch(
    () => [
      opts.tab.value,
      opts.isSignedIn.value,
      JSON.stringify(opts.postFilters.value),
      opts.peopleFollowingOnly.value,
      scopeValue(),
    ],
    () => {
      if (opts.query.value.trim().length >= 2 && opts.tab.value !== 'servers') void runSearch(opts.query.value)
      else if (opts.tab.value === 'servers') clearResults()
    },
  )

  // Relationships belong to the account that fetched them
  watch(
    () => instancesStore.activeAccountId,
    () => {
      relationships.value = {}
    },
  )

  // A deleted post vanishes from search results / the tag timeline without a re-search
  const stopDeletedListen = onDeletedStatus((event) => {
    statuses.value = dropDeletedStatus(statuses.value, event)
    tagTimeline.value = dropDeletedStatus(tagTimeline.value, event)
  })

  onUnmounted(() => {
    stopDeletedListen()
    searchRace.abort()
    resultsGen++
  })

  return {
    searchBusy,
    searchError,
    accounts,
    statuses,
    hashtags,
    tagTimeline,
    tagTimelineTag,
    topHit,
    postsLimited,
    relationships,
    followedTags,
    searchHasMore,
    loadMoreBusy,
    loadMoreError,
    resultsFor,
    clearResults,
    runSearch,
    loadMore,
    retryLoadMore,
    toggleFollowAccount,
    toggleFollowTag,
    ensureRelationships,
  }
}
