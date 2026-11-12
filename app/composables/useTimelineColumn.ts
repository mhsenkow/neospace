/**
 * Timeline feed state: fetch, poll, infinite scroll, catch-up, pull-to-refresh.
 * Extracted from TimelineColumn — chrome stays in the Vue component.
 */

import type { mastodon } from 'masto'
import type { MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useAlgorithmsStore } from '~/stores/algorithms'
import {
  useColumnsStore,
  ALL_ACCOUNTS_INSTANCE,
  type ColumnConfig,
  type ColumnFeedType,
} from '~/stores/columns'
import { publicClient } from '~/composables/useMasto'
import { hostnameOf, isAuthGatedPublicHost, resolvePublicInstanceUrl } from '~/utils/instances'
import {
  collapseDuplicateReblogs,
  dedupeStatusesByIdentity,
  statusIdentity,
  statusListKey,
} from '~/utils/statusIdentity'
import { statusMatchesRecipe, type AlgorithmSource } from '~/utils/algorithms'
import { RANKERS, homeEngagementBreakdown, homeEngagementScore } from '~/utils/rankers'
import type { RankBreakdown } from '~/utils/rankers'
import { useRankedFeed } from '~/composables/useRankedFeed'
import { useSettingsStore } from '~/stores/settings'
import { compareId, idLess } from '~/utils/compareId'
import { newestIdPerInstance } from '~/stores/edward'
import { httpStatusFrom, mapErrorToMessage } from '~/utils/friendlyError'
import { useToastStore } from '~/stores/toast'
import { onComposedStatus } from '~/composables/useComposedStatus'
import { onDeletedStatus } from '~/composables/useDeletedStatus'
import { dropDeletedStatus, type DeletedStatusEvent } from '~/utils/deletedStatus'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'
import { cursorPage } from '~/utils/linkHeader'
import {
  catchUpForward,
  mergeCursors,
  nextGapSources,
  type CatchUpSource,
} from '~/utils/catchUp'
import { logError } from '~/utils/log'

export type UseTimelineColumnOpts = {
  column: MaybeRefOrGetter<ColumnConfig>
  paused: MaybeRefOrGetter<boolean>
  recessed: MaybeRefOrGetter<boolean>
  isMobileViewport: () => boolean
  withPrependMotion?: (fn: () => void) => void
}

export function useTimelineColumn(opts: UseTimelineColumnOpts) {
  const column = computed(() => toValue(opts.column))
  const paused = computed(() => toValue(opts.paused))
  const recessed = computed(() => toValue(opts.recessed))
  const isMobileViewport = opts.isMobileViewport
  const withPrependMotion = opts.withPrependMotion ?? ((fn: () => void) => fn())

  const instancesStore = useInstancesStore()
  const settingsStore = useSettingsStore()
  const columnsStore = useColumnsStore()
  const algorithmsStore = useAlgorithmsStore()
  const rankedFeed = useRankedFeed()
  const toastStore = useToastStore()
  const reducedMotion = usePrefersReducedMotion()
  const scrollBehavior = (): ScrollBehavior => (reducedMotion.value ? 'auto' : 'smooth')

  const columnPinnedInstanceId = computed(() => column.value.instanceId || null)
  const columnPinnedHost = computed(() =>
    column.value.serverHost?.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase() || null,
  )
  const followsActiveAccount = computed(
    () => !columnPinnedInstanceId.value && !columnPinnedHost.value,
  )
  const homeFeedMode = computed(() => settingsStore.localPreferences.homeFeedMode || 'forYou')

  /** Tag statuses with the instance they were loaded from so likes/boosts hit the right API. */
  const browseOrigin = (): { id: string; url: string } => {
    const account =
      instancesStore.activeAccount ||
      instancesStore.instances.find((i) => i.accessToken) ||
      instancesStore.instances[0]
    if (account) return { id: account.id, url: account.url }
    const url = resolvePublicInstanceUrl()
    return { id: `public:${hostnameOf(url) || 'fallback'}`, url }
  }

  const withBrowseOrigin = (
    list: mastodon.v1.Status[],
  ): (mastodon.v1.Status | ExtendedStatus)[] => {
    const origin = browseOrigin()
    return list.map((s) => ({
      ...s,
      _instanceId: origin.id,
      _instanceUrl: origin.url,
    }))
  }

  const fetchGroupPage = async (tag: string, maxId?: string) => {
    const client = publicClient()
    const list = await client.v1.timelines.tag.$select(tag).list({
      limit: 20,
      ...(maxId ? { maxId } : {}),
    })
    return withBrowseOrigin(list)
  }

  /**
   * Liked / Saved page for the active account. These lists paginate by the
   * favourite/bookmark row id from the Link header — a status id is NOT a valid
   * max_id there (it would just return the first page again).
   */
  const savedAccount = () => {
    const pin = column.value.instanceId
    if (pin && pin !== ALL_ACCOUNTS_INSTANCE) {
      return instancesStore.instances.find((i) => i.id === pin && i.accessToken) || null
    }
    return instancesStore.activeAccount
  }

  const fetchSavedPage = async (kind: 'favourites' | 'bookmarks', maxId?: string | null) => {
    const active = savedAccount()
    if (!active?.accessToken) {
      throw new Error(kind === 'favourites' ? 'Sign in to view liked posts' : 'Sign in to view saved posts')
    }
    const client = instancesStore.getClient(active.id)
    const params = { limit: 20, ...(maxId ? { maxId } : {}) }
    const page = await cursorPage(
      kind === 'favourites'
        ? client.v1.favourites.list.$raw(params)
        : client.v1.bookmarks.list.$raw(params),
    )
    return {
      statuses: page.items.map(
        (s): ExtendedStatus => ({ ...s, _instanceId: active.id, _instanceUrl: active.url }),
      ),
      nextMaxId: page.nextMaxId,
    }
  }

  const isSavedFeed = (type: ColumnFeedType): type is 'favourites' | 'bookmarks' =>
    type === 'favourites' || type === 'bookmarks'

  const homeAccountOpts = (): { accountIds?: string[] | 'all' } => {
    const pin = column.value.instanceId
    if (pin === ALL_ACCOUNTS_INSTANCE) return { accountIds: 'all' }
    if (pin) return { accountIds: [pin] }
    return {}
  }

  const fetchAlgorithmSourcePage = async (source: AlgorithmSource, cursor?: string) => {
    if (source === 'home') {
      if (!instancesStore.hasAuthenticatedInstance) return [] as ExtendedStatus[]
      const opts = homeAccountOpts()
      if (cursor) {
        const id =
          opts.accountIds === 'all'
            ? Object.keys(feedCursors.value)[0]
            : Array.isArray(opts.accountIds)
              ? opts.accountIds[0]
              : instancesStore.activeAccount?.id
        if (id) return await instancesStore.fetchMergedHomeTimeline(20, { [id]: cursor }, opts)
      }
      return await instancesStore.fetchMergedHomeTimeline(20, undefined, opts)
    }
    return await instancesStore.fetchMergedTimeline(source, 20, cursor, {
      instanceId: column.value.instanceId || null,
    })
  }

  /** Walk the source timeline until we have `limit` matches or the source is exhausted. */
  const loadAlgorithmPage = async (limit = 20, continueFrom?: string | null) => {
    const recipe = algorithmsStore.getRecipe(column.value.algorithmId)
    if (!recipe) {
      throw new Error('This algorithm was deleted or isn’t on this device. Import the share link again.')
    }
    if (recipe.source === 'home' && !instancesStore.hasAuthenticatedInstance) {
      throw new Error('Sign in to run algorithms that use your home feed')
    }
    if (recipe.ranker && RANKERS[recipe.ranker]?.needsAuth && !instancesStore.hasAuthenticatedInstance) {
      throw new Error(`Sign in to use the ${RANKERS[recipe.ranker].short}-style ranking`)
    }

    // X / Facebook / TikTok-style: ranked pages from a multi-source pool
    if (recipe.ranker) {
      const out: ExtendedStatus[] = []
      let done = false
      for (let round = 0; out.length < limit && round < 4; round++) {
        const page = await rankedFeed.nextPage(recipe.ranker, !continueFrom && round === 0)
        for (const s of page.statuses) if (statusMatchesRecipe(s, recipe)) out.push(s)
        if (page.exhausted) {
          done = true
          break
        }
      }
      return { statuses: out, nextCursor: done ? null : 'ranked', exhausted: done }
    }

    const collected: ExtendedStatus[] = []
    let cursor: string | undefined = continueFrom || undefined
    let pages = 0
    let exhausted = false

    while (collected.length < limit && pages < 8) {
      const page = await fetchAlgorithmSourcePage(recipe.source, cursor)
      pages += 1
      if (!page.length) {
        exhausted = true
        break
      }
      let scannedAll = true
      for (let i = 0; i < page.length; i++) {
        const s = page[i]!
        // Cursor = last status actually scanned, so a mid-page stop doesn't skip the rest
        cursor = s.id
        if (statusMatchesRecipe(s, recipe)) collected.push(s)
        if (collected.length >= limit) {
          scannedAll = i === page.length - 1
          break
        }
      }
      if (scannedAll && page.length < 20) {
        exhausted = true
        break
      }
    }

    return { statuses: collected, nextCursor: cursor ?? null, exhausted }
  }


  /**
   * Shallow: only whole-array replacements trigger. Cards make their own status
   * reactive (RealPostCard) so optimistic like/boost/bookmark still re-render.
   */
  const statuses = shallowRef<(mastodon.v1.Status | ExtendedStatus)[]>([])
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const isPolling = ref(false)
  const error = ref<string | null>(null)
  const loadMoreError = ref<string | null>(null)
  let fetchGen = 0
  const hasMore = ref(true)
  const maxId = ref<string | null>(null)
  /** Per-instance max_id cursors for merged home / local / federated timelines */
  const feedCursors = ref<Record<string, string>>({})
  /** Source-timeline cursor for algorithm filters (not the last displayed status) */
  const algoSourceCursor = ref<string | null>(null)
  /** Link-header cursor for Liked / Saved (favourite/bookmark row id) */
  const savedCursor = ref<string | null>(null)
  /**
   * Last loadMore added nothing new (sparse algorithm window, all-duplicate
   * page) — after a few quiet auto-skips we pause for a manual "Look further"
   * so we don't scan forever.
   */
  const lastLoadAddedNothing = ref(false)
  /** Consecutive empty-add pages while still hasMore — drives quiet auto-skip. */
  const sparseSkipStreak = ref(0)
  const AUTO_SPARSE_SKIPS = 8
  const newPostsAnnounce = ref('')

  const scrollContainer = ref<HTMLElement | null>(null)
  const loadTrigger = ref<HTMLElement | null>(null)
  let observer: IntersectionObserver | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pollStartTimer: ReturnType<typeof setTimeout> | null = null
  let catchUpTimer: ReturnType<typeof setTimeout> | null = null
  /** False while a keep-alive parent has this column deactivated */
  let isActive = true
  let pullStartY = 0
  let pullListening = false

  /** Newer posts waiting while you read (never auto-jump) */
  const pendingNew = shallowRef<(mastodon.v1.Status | ExtendedStatus)[]>([])
  const isNearTop = ref(true)
  /** Sources whose catch-up hit the page cap — more arrivals are waiting (next poll continues from the cursor) */
  const gapSources = ref<string[]>([])
  const timelineGap = computed(() => gapSources.value.length > 0)
  /** Newest status id per instance for since_id polls (not the oldest-for-max_id feedCursors) */
  const sinceCursors = ref<Record<string, string>>({})

  const SINCE_PAGE_LIMIT = 20
  const CATCH_UP_MAX_PAGES = 5

  /** Mobile pull-to-refresh (no preventDefault — that fights iOS compositing) */
  const pullDistance = ref(0)
  const isRefreshing = ref(false)
  const PTR_THRESHOLD = 64

  const pendingLabel = computed(() => {
    const n = pendingNew.value.length
    if (n <= 0) return ''
    return n === 1 ? '↑ 1 new post' : `↑ ${n} new posts`
  })

  const sparsePauseCopy = computed(() => {
    if (column.value.feedType === 'algorithm') {
      return {
        title: 'No matches in that stretch',
        body: 'This filter skipped a window with nothing that fits. Keep looking further back, or refine the algorithm.',
        action: 'Look further',
      }
    }
    return {
      title: 'Already caught up through here',
      body: 'That page was mostly posts you’ve already seen. Look further back for older ones.',
      action: 'Look further',
    }
  })

  const endOfFeedCopy = computed(() => {
    if (column.value.feedType === 'algorithm') return 'End of matches'
    if (column.value.feedType === 'favourites') return 'End of liked posts'
    if (column.value.feedType === 'bookmarks') return 'End of saved posts'
    return 'You’re all caught up'
  })

  const statusHasTag = (status: mastodon.v1.Status, tag: string) => {
    const needle = tag.toLowerCase()
    if ((status.tags || []).some((t) => t.name.toLowerCase() === needle)) return true
    // Fallback when tags aren't populated yet on the create response
    return new RegExp(`(?:^|\\s)#${needle}\\b`, 'i').test(
      (status.content || '').replace(/<[^>]*>/g, ' '),
    )
  }

  const acceptsComposedStatus = (status: mastodon.v1.Status) => {
    if (column.value.feedType === 'home') return true
    if (column.value.feedType === 'group' && column.value.groupTag) {
      return statusHasTag(status, column.value.groupTag)
    }
    return false
  }

  const insertComposedStatus = (status: mastodon.v1.Status) => {
    if (!acceptsComposedStatus(status)) return
    const key = statusIdentity(status)
    if (!key) return
    const existingIdx = statuses.value.findIndex((s) => statusIdentity(s) === key)
    if (existingIdx >= 0) {
      // Edited posts re-emit with the same identity — patch in place
      const next = [...statuses.value]
      next[existingIdx] = { ...statuses.value[existingIdx], ...status } as (typeof statuses.value)[number]
      statuses.value = next
      return
    }
    withPrependMotion(() => {
      statuses.value = dedupeStatusesByIdentity([status, ...statuses.value])
    })
    trimTailIfNearTop()
    pendingNew.value = pendingNew.value.filter((s) => statusIdentity(s) !== key)
  }

  /**
   * A post was deleted anywhere in the app — drop every copy from this column.
   * Matched by canonical identity / same-origin id (never a bare id: another server's
   * unrelated post can share it).
   */
  const onStatusDeleted = (event: DeletedStatusEvent) => {
    statuses.value = dropDeletedStatus(statuses.value, event)
    pendingNew.value = dropDeletedStatus(pendingNew.value, event)
  }


  const onScroll = () => {
    if (!scrollContainer.value) return
    isNearTop.value = scrollContainer.value.scrollTop < 8
  }

  const onPullStart = (e: TouchEvent) => {
    if (!isMobileViewport() || isRefreshing.value || recessed.value) return
    if (!scrollContainer.value || scrollContainer.value.scrollTop > 0) return
    pullStartY = e.touches[0]?.clientY ?? 0
    pullListening = true
  }

  const onPullMove = (e: TouchEvent) => {
    if (!pullListening || !scrollContainer.value) return
    if (scrollContainer.value.scrollTop > 0) {
      pullListening = false
      pullDistance.value = 0
      return
    }
    const y = e.touches[0]?.clientY ?? pullStartY
    const dy = y - pullStartY
    if (dy <= 0) {
      pullDistance.value = 0
      return
    }
    // Never preventDefault — iOS turns that into black flashes with nested scrollers
    pullDistance.value = Math.min(dy * 0.35, 72)
  }

  const onPullEnd = async () => {
    if (!pullListening) return
    pullListening = false
    const shouldRefresh = pullDistance.value >= PTR_THRESHOLD && !isRefreshing.value
    pullDistance.value = 0
    if (!shouldRefresh) return
    isRefreshing.value = true
    try {
      // Soft refresh — fetchTimeline(true) keeps current posts visible until the
      // new page lands, bumps the generation (so an in-flight loadMore can't append
      // an old-cursor page after the fresh one) and reseeds every feed's cursors.
      const hadPosts = statuses.value.length > 0
      const ok = await fetchTimeline(true)
      // No posts → the column's own error state already says what went wrong
      if (!ok && hadPosts) {
        toastStore.show({ message: 'Couldn’t refresh — try again', duration: 3500 })
      }
    } finally {
      isRefreshing.value = false
    }
  }

  const pullHint = computed(() => {
    if (isRefreshing.value) return 'Refreshing…'
    if (pullDistance.value >= PTR_THRESHOLD) return 'Release to refresh'
    return 'Pull to refresh'
  })

  const seedFeedCursors = (result: (mastodon.v1.Status | ExtendedStatus)[]) => {
    const next: Record<string, string> = {}
    for (const s of result) {
      const ext = s as ExtendedStatus
      if (!ext._instanceId) continue
      const prev = next[ext._instanceId]
      if (!prev || idLess(s.id, prev)) next[ext._instanceId] = s.id
    }
    feedCursors.value = next
  }

  const advanceFeedCursors = (page: (mastodon.v1.Status | ExtendedStatus)[]) => {
    const next = { ...feedCursors.value }
    for (const s of page) {
      const ext = s as ExtendedStatus
      if (!ext._instanceId) continue
      const prev = next[ext._instanceId]
      if (!prev || idLess(s.id, prev)) next[ext._instanceId] = s.id
    }
    feedCursors.value = next
  }

  const jumpToNew = () => {
    const seen = new Set(statuses.value.map((s) => statusIdentity(s)))
    const unique = pendingNew.value.filter((s) => !seen.has(statusIdentity(s)))
    if (unique.length) {
      withPrependMotion(() => {
        statuses.value = dedupeStatusesByIdentity([...unique, ...statuses.value])
      })
      // We're about to scroll to the top — let the cap apply now rather than
      // leaving a long-pending batch over the limit until the next prepend.
      isNearTop.value = true
      trimTailIfNearTop()
    }
    pendingNew.value = []
    newPostsAnnounce.value = ''
    // Pill tap should land immediately — never animate-scroll away from where
    // the reader was (smooth scroll felt like the feed was stealing focus).
    scrollContainer.value?.scrollTo({ top: 0, behavior: 'auto' })
    nextTick(() => {
      const first = scrollContainer.value?.querySelector(
        'article.status-card, article[tabindex]',
      ) as HTMLElement | null
      first?.focus?.({ preventScroll: true })
    })
  }

  /**
   * Cap the column so a long session doesn't grow the DOM forever. Only trims
   * the oldest tail, and only while the reader is at the top (tail is far
   * off-screen); loadMore never trims. Cursors move to the new tail so
   * scrolling down refetches what was dropped.
   */
  const MAX_FEED_STATUSES = 400

  const trimTailIfNearTop = () => {
    if (!isNearTop.value || statuses.value.length <= MAX_FEED_STATUSES) return
    // Algorithm / Liked / Saved cursors aren't the shown tail's status id — leave those alone
    if (column.value.feedType === 'algorithm' || isSavedFeed(column.value.feedType)) return
    const kept = statuses.value.slice(0, MAX_FEED_STATUSES)
    statuses.value = kept
    maxId.value = kept.at(-1)?.id ?? null
    if (
      column.value.feedType === 'home' ||
      column.value.feedType === 'local' ||
      column.value.feedType === 'federated'
    ) {
      seedFeedCursors(kept)
    }
    hasMore.value = true
  }

  const mergeIncoming = (fresh: (mastodon.v1.Status | ExtendedStatus)[]) => {
    if (!fresh.length || !statuses.value.length) return
    const existing = new Set(statuses.value.map((s) => statusIdentity(s)))
    const pendingIds = new Set(pendingNew.value.map((s) => statusIdentity(s)))
    const cutoff = new Date(statuses.value[0]!.createdAt).getTime()
    const newer = fresh.filter((s) => {
      const key = statusIdentity(s)
      if (!key || existing.has(key) || pendingIds.has(key)) return false
      return new Date(s.createdAt).getTime() > cutoff
    })
    if (!newer.length) return

    if (isNearTop.value) {
      withPrependMotion(() => {
        statuses.value = dedupeStatusesByIdentity([...newer, ...statuses.value])
      })
      trimTailIfNearTop()
    } else {
      // Capped: a reader parked mid-feed for hours shouldn't grow this forever
      pendingNew.value = dedupeStatusesByIdentity([...newer, ...pendingNew.value])
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, MAX_FEED_STATUSES)
    }
  }

  /** `gen`: the fetchGen this load belongs to — stale loads don't touch paging state. */
  const loadTimelinePage = async (
    gen = fetchGen,
  ): Promise<(mastodon.v1.Status | ExtendedStatus)[]> => {
    if (column.value.feedType === 'group' && column.value.groupTag) {
      return await fetchGroupPage(column.value.groupTag)
    }
    if (isSavedFeed(column.value.feedType)) {
      const page = await fetchSavedPage(column.value.feedType)
      if (gen === fetchGen) savedCursor.value = page.nextMaxId
      return page.statuses
    }
    if (column.value.feedType === 'algorithm') {
      const page = await loadAlgorithmPage(20, null)
      if (gen === fetchGen) {
        algoSourceCursor.value = page.nextCursor
        hasMore.value = !page.exhausted && !!page.nextCursor
      }
      return page.statuses
    }
    if (column.value.feedType === 'list' && column.value.listId) {
      if (!instancesStore.hasAuthenticatedInstance) return []
      const active = instancesStore.activeAccount
      if (!active) return []
      const client = instancesStore.getClient(active.id)
      return withBrowseOrigin(
        await client.v1.timelines.list.$select(column.value.listId).list({ limit: 20 }),
      )
    }
    if (column.value.feedType === 'rss' && column.value.rssUrl) {
      const { fetchRssFeed, rssFeedToStatuses } = await import('~/utils/rssToStatus')
      const feed = await fetchRssFeed(column.value.rssUrl)
      if (gen === fetchGen && feed.title) {
        columnsStore.setRssTitle(column.value.id, feed.title)
        hasMore.value = false
      }
      return rssFeedToStatuses(feed)
    }
    if (column.value.feedType === 'home') {
      if (!instancesStore.hasAuthenticatedInstance) return []
      return await instancesStore.fetchMergedHomeTimeline(20, undefined, homeAccountOpts())
    }
    if (column.value.feedType !== 'local' && column.value.feedType !== 'federated') {
      return []
    }
    if (columnPinnedHost.value) {
      return await instancesStore.fetchHostPublicTimeline(
        columnPinnedHost.value,
        column.value.feedType,
        20,
      )
    }
    if (instancesStore.instances.length > 0) {
      return await instancesStore.fetchMergedTimeline(column.value.feedType, 20, undefined, {
        instanceId: columnPinnedInstanceId.value,
      })
    }
    const client = publicClient()
    return withBrowseOrigin(
      await client.v1.timelines.public.list({
        local: column.value.feedType === 'local',
        limit: 20,
      }),
    )
  }

  const displayStatuses = computed(() => {
    let list = statuses.value
    if (column.value.feedType === 'home' && settingsStore.localPreferences.collapseReblogs) {
      list = collapseDuplicateReblogs(list)
    }
    if (column.value.feedType === 'home' && homeFeedMode.value === 'forYou' && list.length > 1) {
      const now = Date.now()
      return [...list]
        .map((s) => {
          const { score, breakdown } = homeEngagementBreakdown(s, now)
          return {
            ...s,
            _homeScore: score,
            _rankWhy: (s as { _rankWhy?: string })._rankWhy || 'For You · engagement',
            _rankBreakdown: (s as { _rankBreakdown?: RankBreakdown })._rankBreakdown || breakdown,
          }
        })
        .sort((a, b) => (b._homeScore || 0) - (a._homeScore || 0) || homeEngagementScore(b) - homeEngagementScore(a))
    }
    return list
  })

  /** Keys computed once per list change, not on every column re-render (pull-to-refresh, etc.) */
  const displayRows = computed(() =>
    displayStatuses.value.map((status) => ({ status, key: statusListKey(status) })),
  )

  /** role="feed" articles: total is unknown (-1) while more pages can load */
  const feedSetSize = computed(() => (hasMore.value ? -1 : displayStatuses.value.length))

  /**
   * Newest held id per instance, merged over `current`. Pure — a poll works on
   * this local copy and only commits it once pollForNew accepts the result.
   */
  const seedSinceCursors = (
    current: Record<string, string>,
    list: (mastodon.v1.Status | ExtendedStatus)[],
  ): Record<string, string> => {
    const next = { ...newestIdPerInstance(list as ExtendedStatus[]) }
    // Single-server feeds may lack _instanceId — fall back to global top
    const top = list[0]
    if (top?.id) {
      const key = (top as ExtendedStatus)._instanceId || '_default'
      if (!next[key] || compareId(top.id, next[key]) > 0) next[key] = top.id
    }
    return mergeCursors(current, next)
  }

  /**
   * One forward (`min_id`) source per server for the current feed. Empty when the
   * feed type doesn't support live polling. Each source pages independently so a
   * busy server can hit the cap while a quiet one settles.
   */
  const buildCatchUpSources = (
    cursors: Record<string, string>,
  ): CatchUpSource<mastodon.v1.Status | ExtendedStatus>[] => {
    const cursorFor = (key: string) => cursors[key] || cursors._default || ''
    const tagged = (list: mastodon.v1.Status[], inst: { id: string; url: string }) =>
      list.map((s) => ({ ...s, _instanceId: inst.id, _instanceUrl: inst.url }))

    if (column.value.feedType === 'group' && column.value.groupTag) {
      const tag = column.value.groupTag
      const origin = browseOrigin()
      const cursor = cursorFor(origin.id) || Object.values(cursors)[0] || ''
      if (!cursor) return []
      return [
        {
          key: origin.id,
          cursor,
          fetchPage: async (minId, limit) =>
            tagged(await publicClient().v1.timelines.tag.$select(tag).list({ limit, minId }), origin),
        },
      ]
    }

    if (column.value.feedType === 'home') {
      if (!instancesStore.hasAuthenticatedInstance) return []
      const opts = homeAccountOpts()
      const accounts =
        opts.accountIds === 'all'
          ? instancesStore.authenticatedInstances
          : Array.isArray(opts.accountIds)
            ? instancesStore.authenticatedInstances.filter((i) => opts.accountIds!.includes(i.id))
            : instancesStore.activeAccount?.accessToken
              ? [instancesStore.activeAccount]
              : []
      return accounts.flatMap((active) => {
        if (!active?.accessToken) return []
        const cursor = cursorFor(active.id)
        if (!cursor) return []
        return [
          {
            key: active.id,
            cursor,
            fetchPage: async (minId: string, limit: number) =>
              tagged(
                await instancesStore.getClient(active.id).v1.timelines.home.list({ limit, minId }),
                active,
              ),
          },
        ]
      })
    }

    if (column.value.feedType === 'local' || column.value.feedType === 'federated') {
      const local = column.value.feedType === 'local'
      if (columnPinnedHost.value) {
        const host = columnPinnedHost.value
        const origin = { id: `host:${host}`, url: `https://${host}` }
        const cursor = cursorFor(origin.id) || Object.values(cursors)[0] || ''
        if (!cursor) return []
        return [
          {
            key: origin.id,
            cursor,
            fetchPage: async (minId: string, limit: number) =>
              tagged(
                await publicClient(origin.url).v1.timelines.public.list({ local, limit, minId }),
                origin,
              ),
          },
        ]
      }
      const targets = instancesStore.publicTimelineTargets(columnPinnedInstanceId.value)
      if (instancesStore.instances.length > 0 && targets.length > 0) {
        return targets.flatMap((inst) => {
          const cursor = cursorFor(inst.id)
          if (!cursor) return []
          if (!inst.accessToken && isAuthGatedPublicHost(inst.url)) return []
          return [
            {
              key: inst.id,
              cursor,
              fetchPage: async (minId: string, limit: number) =>
                tagged(await instancesStore.getClient(inst.id).v1.timelines.public.list({ local, limit, minId }), inst),
            },
          ]
        })
      }
      const origin = browseOrigin()
      const cursor = cursorFor(origin.id) || Object.values(cursors)[0] || ''
      if (!cursor) return []
      return [
        {
          key: origin.id,
          cursor,
          fetchPage: async (minId, limit) =>
            tagged(await publicClient().v1.timelines.public.list({ local, limit, minId }), origin),
        },
      ]
    }

    // Liked / Saved / algorithms: no polling (lists aren’t live firehoses)
    return []
  }

  interface CatchUpOutcome {
    items: (mastodon.v1.Status | ExtendedStatus)[]
    cursors: Record<string, string>
    gapSources: string[]
  }

  /**
   * Fetch every post newer than the held tops, walking each server forward with
   * min_id (up to CATCH_UP_MAX_PAGES per server). Mutates nothing: pollForNew
   * commits `cursors` / `gapSources` only after the fetch generation still matches.
   */
  const fetchNewSince = async (): Promise<CatchUpOutcome> => {
    const held = [...pendingNew.value, ...statuses.value]
    const cursors = seedSinceCursors(sinceCursors.value, held)
    if (!held.length) return { items: [], cursors, gapSources: gapSources.value }

    const sources = buildCatchUpSources(cursors)
    const result = await catchUpForward(sources, {
      pageLimit: SINCE_PAGE_LIMIT,
      maxPages: CATCH_UP_MAX_PAGES,
    })
    // Every server failed — surface it (polling swallows quietly) rather than "nothing new"
    if (sources.length && result.failed.length === sources.length) throw result.firstError

    result.items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return {
      items: result.items,
      cursors: mergeCursors(cursors, result.cursors),
      gapSources: nextGapSources(gapSources.value, result),
    }
  }

  /** Full refresh to recover posts that may have been skipped past the catch-up cap */
  const recoverTimelineGap = () => {
    gapSources.value = []
    statuses.value = []
    pendingNew.value = []
    sinceCursors.value = {}
    void fetchTimeline(true)
  }

  /** Recessed only pauses polling on mobile (one visible column); desktop multi-col keeps all live */
  const pauseForRecess = () => recessed.value && isMobileViewport()

  /** Polling only while shown, active, unrecessed and the tab is visible */
  const canPoll = () =>
    isActive &&
    !paused.value &&
    !pauseForRecess() &&
    !(typeof document !== 'undefined' && document.hidden)

  const pollForNew = async () => {
    if (
      !canPoll() ||
      isLoading.value ||
      isLoadingMore.value ||
      isPolling.value ||
      document.hidden ||
      !statuses.value.length
    ) {
      return
    }
    isPolling.value = true
    const gen = fetchGen
    try {
      const outcome = await fetchNewSince()
      // Feed / account switched mid-poll — these posts and cursors belong to the old feed
      if (gen !== fetchGen) return
      sinceCursors.value = outcome.cursors
      gapSources.value = outcome.gapSources
      mergeIncoming(outcome.items)
    } catch {
      // quiet — polling failures shouldn't interrupt reading
    } finally {
      isPolling.value = false
    }
  }

  const POLL_INTERVAL_MS = 45_000
  /** Spread columns' poll phases so a board doesn't hit the API in lockstep */
  const POLL_START_JITTER_MS = 8000
  const CATCH_UP_JITTER_MS = 3000

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (pollStartTimer) {
      clearTimeout(pollStartTimer)
      pollStartTimer = null
    }
    if (catchUpTimer) {
      clearTimeout(catchUpTimer)
      catchUpTimer = null
    }
  }

  const startPolling = () => {
    stopPolling()
    if (!canPoll()) return
    pollStartTimer = setTimeout(() => {
      pollStartTimer = null
      pollTimer = setInterval(pollForNew, POLL_INTERVAL_MS)
    }, Math.round(Math.random() * POLL_START_JITTER_MS))
  }

  /** Restart polling plus one jittered catch-up poll (tab return, column shown again). */
  const resumePolling = () => {
    startPolling()
    if (!canPoll()) return
    catchUpTimer = setTimeout(() => {
      catchUpTimer = null
      void pollForNew()
    }, Math.round(Math.random() * CATCH_UP_JITTER_MS))
  }

  const onVisibilityChange = () => {
    if (document.hidden) {
      stopPolling()
      return
    }
    resumePolling()
  }

  watch(
    () => pauseForRecess(),
    (recess) => {
      if (recess) stopPolling()
      else startPolling()
    },
  )

  watch(
    () => paused.value,
    (paused) => {
      if (paused) stopPolling()
      else resumePolling()
    },
  )

  /**
   * Rate limits (429) and server hiccups (5xx) clear on their own — a board of
   * 6+ columns tends to trip them together, so retry with backoff instead of
   * leaving every column on a manual Retry button.
   */
  const AUTO_RETRY_BASE_S = 20
  const AUTO_RETRY_MAX_S = 120
  let autoRetryTimer: ReturnType<typeof setTimeout> | null = null
  let autoRetryAttempt = 0
  const autoRetryIn = ref<number | null>(null)

  const cancelAutoRetry = () => {
    if (autoRetryTimer) clearTimeout(autoRetryTimer)
    autoRetryTimer = null
    autoRetryIn.value = null
  }

  const scheduleAutoRetry = (err: unknown) => {
    const status = httpStatusFrom(err)
    if (status !== 429 && !(status != null && status >= 500)) return
    const seconds = Math.min(AUTO_RETRY_MAX_S, AUTO_RETRY_BASE_S * 2 ** autoRetryAttempt)
    // Spread retries so columns don't all fire in the same second again
    const jitterMs = Math.round(Math.random() * 4000)
    autoRetryAttempt += 1
    autoRetryIn.value = seconds
    autoRetryTimer = setTimeout(() => {
      autoRetryTimer = null
      autoRetryIn.value = null
      void fetchTimeline(true)
    }, seconds * 1000 + jitterMs)
  }

  /** Resolves false when the load failed (and wasn't superseded by a newer one). */
  const fetchTimeline = async (refresh = false): Promise<boolean> => {
    cancelAutoRetry()
    const gen = ++fetchGen
    // An in-flight loadMore from the previous generation won't clear this itself
    isLoadingMore.value = false
    lastLoadAddedNothing.value = false
    sparseSkipStreak.value = 0
    if (refresh) {
      // Keep existing posts visible until the new page lands — avoids blank Federated
      // when a newer fetch aborts an in-flight one (init + account/filter watches).
      maxId.value = null
      feedCursors.value = {}
      sinceCursors.value = {}
      algoSourceCursor.value = null
      savedCursor.value = null
      pendingNew.value = []
      gapSources.value = []
      hasMore.value = true
      loadMoreError.value = null
    }

    const showLoader = refresh ? statuses.value.length === 0 : true
    if (showLoader) isLoading.value = true
    error.value = null

    try {
      let result: (mastodon.v1.Status | ExtendedStatus)[] = []

      if (column.value.feedType === 'home' && !instancesStore.hasAuthenticatedInstance) {
        throw new Error('Log in or add an instance to view your home timeline')
      }
      if (isSavedFeed(column.value.feedType) && !instancesStore.hasAuthenticatedInstance) {
        throw new Error(
          column.value.feedType === 'favourites'
            ? 'Sign in to view liked posts'
            : 'Sign in to view saved posts',
        )
      }
      if (column.value.feedType === 'list' && !instancesStore.hasAuthenticatedInstance) {
        throw new Error('Sign in to view your lists')
      }

      result = await loadTimelinePage(gen)
      if (
        gen === fetchGen &&
        (column.value.feedType === 'home' ||
          column.value.feedType === 'local' ||
          column.value.feedType === 'federated')
      ) {
        seedFeedCursors(result)
      }

      if (gen !== fetchGen) return true
      statuses.value = dedupeStatusesByIdentity(result)
      if (result.length > 0) {
        maxId.value = statuses.value.at(-1)!.id
      }
      // Algorithm / RSS set hasMore inside loadTimelinePage; Liked / Saved follow the
      // Link header; others use page size
      if (isSavedFeed(column.value.feedType)) {
        hasMore.value = result.length > 0 && !!savedCursor.value
      } else if (column.value.feedType !== 'algorithm' && column.value.feedType !== 'rss') {
        hasMore.value = result.length >= 20
      }
      autoRetryAttempt = 0
      return true
    } catch (e: unknown) {
      if (gen !== fetchGen) return true
      // Only surface the error if we have nothing to show
      if (!statuses.value.length) {
        const friendly = mapErrorToMessage(e)
        error.value = friendly.detail || friendly.title || (e instanceof Error ? e.message : 'Failed to fetch timeline')
        scheduleAutoRetry(e)
      }
      return false
    } finally {
      if (gen === fetchGen) isLoading.value = false
    }
  }

  /** Re-observe the sentinel so a page that didn't push it out of view keeps paging. */
  const rearmInfiniteObserver = () => {
    nextTick(() => {
      const el = loadTrigger.value
      if (!observer || !el) return
      observer.unobserve(el)
      observer.observe(el)
    })
  }

  const loadMore = async () => {
    if (isLoadingMore.value || !hasMore.value) return
    const usesCursors =
      column.value.feedType === 'home' ||
      column.value.feedType === 'local' ||
      column.value.feedType === 'federated'
    if (usesCursors) {
      if (!Object.keys(feedCursors.value).length && column.value.feedType === 'home') return
      if (
        (column.value.feedType === 'local' || column.value.feedType === 'federated') &&
        !Object.keys(feedCursors.value).length &&
        !maxId.value
      ) {
        return
      }
    } else if (column.value.feedType === 'algorithm') {
      if (!algoSourceCursor.value) return
    } else if (isSavedFeed(column.value.feedType)) {
      if (!savedCursor.value) return
    } else if (!maxId.value) {
      return
    }

    const gen = fetchGen
    let added = 0
    isLoadingMore.value = true
    loadMoreError.value = null

    try {
      let newStatuses: (mastodon.v1.Status | ExtendedStatus)[] = []

      switch (column.value.feedType) {
        case 'home': {
          if (!instancesStore.hasAuthenticatedInstance) break
          newStatuses = await instancesStore.fetchMergedHomeTimeline(
            20,
            { ...feedCursors.value },
            homeAccountOpts(),
          )
          if (gen === fetchGen) advanceFeedCursors(newStatuses)
          break
        }
        case 'local':
        case 'federated': {
          if (columnPinnedHost.value) {
            newStatuses = await instancesStore.fetchHostPublicTimeline(
              columnPinnedHost.value,
              column.value.feedType,
              20,
              maxId.value || undefined,
            )
          } else {
            newStatuses = await instancesStore.fetchMergedTimeline(
              column.value.feedType,
              20,
              Object.keys(feedCursors.value).length ? { ...feedCursors.value } : maxId.value!,
              { instanceId: columnPinnedInstanceId.value },
            )
          }
          if (gen === fetchGen) advanceFeedCursors(newStatuses)
          break
        }
        case 'group': {
          if (column.value.groupTag) {
            newStatuses = await fetchGroupPage(column.value.groupTag, maxId.value!)
          }
          break
        }
        case 'favourites':
        case 'bookmarks': {
          const page = await fetchSavedPage(column.value.feedType, savedCursor.value)
          newStatuses = page.statuses
          if (gen === fetchGen) savedCursor.value = page.nextMaxId
          break
        }
        case 'algorithm': {
          const page = await loadAlgorithmPage(20, algoSourceCursor.value)
          newStatuses = page.statuses
          if (gen === fetchGen) {
            algoSourceCursor.value = page.nextCursor
            // Keep paging even when a window had zero matches (sparse filters)
            hasMore.value = !page.exhausted && !!page.nextCursor
          }
          break
        }
        case 'list': {
          if (column.value.listId && maxId.value) {
            const active = instancesStore.activeAccount
            if (active) {
              const client = instancesStore.getClient(active.id)
              newStatuses = withBrowseOrigin(
                await client.v1.timelines.list
                  .$select(column.value.listId)
                  .list({ limit: 20, maxId: maxId.value }),
              )
            }
          }
          break
        }
        case 'rss': {
          // Single-shot feed fetch — no cursor paging
          if (gen === fetchGen) hasMore.value = false
          break
        }
      }

      if (gen !== fetchGen) return
      if (newStatuses.length > 0) {
        const seen = new Set(statuses.value.map((s) => statusIdentity(s)))
        const unique = newStatuses.filter((s) => {
          const key = statusIdentity(s)
          return key && !seen.has(key)
        })
        statuses.value = [...statuses.value, ...unique]
        maxId.value = newStatuses.at(-1)!.id
        added = unique.length
      }
      if (isSavedFeed(column.value.feedType)) {
        hasMore.value = newStatuses.length > 0 && !!savedCursor.value
      } else if (column.value.feedType !== 'algorithm' && column.value.feedType !== 'rss') {
        hasMore.value = newStatuses.length > 0
      }

      if (added > 0) {
        sparseSkipStreak.value = 0
        lastLoadAddedNothing.value = false
      } else if (hasMore.value) {
        sparseSkipStreak.value += 1
        // Quietly skip a few empty/duplicate windows before asking the reader
        lastLoadAddedNothing.value = sparseSkipStreak.value >= AUTO_SPARSE_SKIPS
      } else {
        sparseSkipStreak.value = 0
        lastLoadAddedNothing.value = false
      }
    } catch (e: unknown) {
      if (gen !== fetchGen) return
      logError('Load more error:', e)
      const friendly = mapErrorToMessage(e)
      loadMoreError.value = friendly.detail || friendly.title || 'Couldn’t load more'
    } finally {
      if (gen === fetchGen) {
        isLoadingMore.value = false
        // A short page can leave the sentinel in view, and IntersectionObserver only
        // fires on change — re-arm it. Empty-add pages auto-continue a few times
        // (quiet "Looking further…") then pause for a manual Look further.
        if (hasMore.value) {
          if (added > 0) {
            rearmInfiniteObserver()
          } else if (sparseSkipStreak.value < AUTO_SPARSE_SKIPS && !loadMoreError.value) {
            // Call immediately so isLoadingMore flips true again before paint
            void loadMore()
          }
          // else: paused for a manual Look further — do not re-arm (would loop forever)
        }
      }
    }
  }

  const continueAfterSparsePause = () => {
    sparseSkipStreak.value = 0
    lastLoadAddedNothing.value = false
    void loadMore()
  }

  const ensureInfiniteObserver = () => {
    if (!scrollContainer.value || observer) return
    observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          !isLoadingMore.value &&
          hasMore.value &&
          !loadMoreError.value &&
          !lastLoadAddedNothing.value
        ) {
          loadMore()
        }
      },
      {
        root: scrollContainer.value,
        rootMargin: '0px 0px 600px 0px',
        threshold: 0,
      },
    )
  }

  const setupInfiniteScroll = () => {
    if (!loadTrigger.value || !scrollContainer.value) return
    ensureInfiniteObserver()
    observer?.observe(loadTrigger.value)
  }

  watch(
    () =>
      `${column.value.feedType}:${column.value.groupTag ?? ''}:${column.value.algorithmId ?? ''}:${column.value.instanceId ?? ''}:${column.value.serverHost ?? ''}`,
    () => {
      if (!instancesStore.isInitialized) return
      // Hard clear on feed identity change — soft refresh would leave the old
      // feed under the new label (including when the new fetch fails).
      statuses.value = []
      pendingNew.value = []
      sinceCursors.value = {}
      gapSources.value = []
      error.value = null
      loadMoreError.value = null
      isNearTop.value = true
      if (scrollContainer.value) scrollContainer.value.scrollTop = 0
      void fetchTimeline(true)
    },
  )

  watch(
    () => instancesStore.isInitialized,
    (ready) => {
      if (ready) fetchTimeline(true)
    },
  )

  watch(
    () => [instancesStore.activeAccountId ?? '', instancesStore.activeInstanceFilter ?? ''] as const,
    ([accountId, filter], [prevAccountId, prevFilter]) => {
      if ((accountId === prevAccountId && filter === prevFilter) || !instancesStore.isInitialized) {
        return
      }
      if (accountId !== prevAccountId) {
        // Pinned columns keep their own account/server — only unpinned ones rebind
        if (!followsActiveAccount.value) return
        statuses.value = []
        void fetchTimeline(true)
        return
      }
      // Global server filter only affects unpinned Local/Federated columns
      if (!followsActiveAccount.value) return
      if (
        column.value.feedType === 'local' ||
        column.value.feedType === 'federated' ||
        column.value.feedType === 'home' ||
        column.value.feedType === 'algorithm'
      ) {
        void fetchTimeline(true)
      }
    },
  )

  watch(loadTrigger, (el, prev) => {
    if (prev && observer) observer.unobserve(prev)
    if (el) nextTick(() => setupInfiniteScroll())
  })

  const feedRoot = ref<HTMLElement | null>(null)
  const { onKeydown: onFeedKeydown } = useFeedKeyboard(feedRoot)

  let stopComposedListen: (() => void) | null = null
  let stopDeletedListen: (() => void) | null = null

  onMounted(() => {
    // Register visibility/polling listeners before any await so unmount mid-fetch can't leak
    document.addEventListener('visibilitychange', onVisibilityChange)
    stopComposedListen = onComposedStatus(insertComposedStatus)
    stopDeletedListen = onDeletedStatus(onStatusDeleted)
    startPolling()

    nextTick(() => {
      setupInfiniteScroll()
      const el = scrollContainer.value
      el?.addEventListener('scroll', onScroll, { passive: true })
      el?.addEventListener('touchstart', onPullStart, { passive: true })
      el?.addEventListener('touchmove', onPullMove, { passive: true })
      el?.addEventListener('touchend', onPullEnd, { passive: true })
      el?.addEventListener('touchcancel', onPullEnd, { passive: true })
    })

    void (async () => {
      if (instancesStore.isInitialized) {
        await fetchTimeline()
      }
    })()
  })

  onActivated(() => {
    isActive = true
    // Catch-up poll — startPolling alone waits a full interval after keepalive return
    resumePolling()
  })

  onDeactivated(() => {
    isActive = false
    stopPolling()
  })

  onUnmounted(() => {
    stopComposedListen?.()
    stopComposedListen = null
    stopDeletedListen?.()
    stopDeletedListen = null
    if (observer) observer.disconnect()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    const el = scrollContainer.value
    el?.removeEventListener('scroll', onScroll)
    el?.removeEventListener('touchstart', onPullStart)
    el?.removeEventListener('touchmove', onPullMove)
    el?.removeEventListener('touchend', onPullEnd)
    el?.removeEventListener('touchcancel', onPullEnd)
    stopPolling()
    cancelAutoRetry()
  })
  return {
    scrollContainer,
    loadTrigger,
    statuses,
    displayStatuses,
    displayRows,
    feedSetSize,
    isLoading,
    isLoadingMore,
    isPolling,
    error,
    loadMoreError,
    hasMore,
    pendingNew,
    pendingLabel,
    lastLoadAddedNothing,
    sparsePauseCopy,
    endOfFeedCopy,
    timelineGap,
    recoverTimelineGap,
    jumpToNew,
    loadMore,
    continueAfterSparsePause,
    fetchTimeline,
    pullDistance,
    PTR_THRESHOLD,
    isRefreshing,
    pullHint,
    sparseSkipStreak,
    onScroll,
    onPullStart,
    onPullMove,
    onPullEnd,
    newPostsAnnounce,
    insertComposedStatus,
    onStatusDeleted,
    autoRetryIn,
    scrollBehavior,
    followsActiveAccount,
  }
}
