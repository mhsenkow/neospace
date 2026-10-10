<script setup lang="ts">
/**
 * TimelineColumn - Self-contained timeline column for multi-column layout.
 * Each column manages its own feed data, scroll, and infinite loading.
 * Supports home/local/federated, group, liked, saved, and algorithm feeds.
 */

import type { mastodon } from 'masto'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import { useAlgorithmsStore } from '~/stores/algorithms'
import { useColumnsStore, FEED_LABELS, type ColumnConfig, type ColumnFeedType } from '~/stores/columns'
import { publicClient } from '~/composables/useMasto'
import { hostnameOf, isAuthGatedPublicHost, resolvePublicInstanceUrl } from '~/utils/instances'
import {
  collapseDuplicateReblogs,
  dedupeStatusesByIdentity,
  statusIdentity,
  statusListKey,
} from '~/utils/statusIdentity'
import { recipeTip, statusMatchesRecipe, type AlgorithmSource } from '~/utils/algorithms'
import { useRankedFeed } from '~/composables/useRankedFeed'
import { useSettingsStore } from '~/stores/settings'
import { idLess } from '~/utils/compareId'
import { httpStatusFrom, mapErrorToMessage } from '~/utils/friendlyError'
import { useToastStore } from '~/stores/toast'
import { useFeedKeyboard } from '~/composables/useFeedKeyboard'
import { emitComposedStatus, onComposedStatus } from '~/composables/useComposedStatus'
import { useDeskViewport, useMobileViewport } from '~/composables/useBreakpoint'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'
import { useColumnDnd } from '~/composables/useColumnDnd'
import { cursorPage } from '~/utils/linkHeader'

/** Tag statuses with the instance they were loaded from so likes/boosts hit the right API. */
const withBrowseOrigin = (
  list: mastodon.v1.Status[],
): (mastodon.v1.Status | ExtendedStatus)[] => {
  const account =
    instancesStore.activeAccount ||
    instancesStore.instances.find((i) => i.accessToken) ||
    instancesStore.instances[0]
  if (account) {
    return list.map((s) => ({
      ...s,
      _instanceId: account.id,
      _instanceUrl: account.url,
    }))
  }
  const url = resolvePublicInstanceUrl()
  const host = hostnameOf(url) || 'fallback'
  return list.map((s) => ({
    ...s,
    _instanceId: `public:${host}`,
    _instanceUrl: url,
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
const fetchSavedPage = async (kind: 'favourites' | 'bookmarks', maxId?: string | null) => {
  const active = instancesStore.activeAccount
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

const fetchAlgorithmSourcePage = async (source: AlgorithmSource, cursor?: string) => {
  if (source === 'home') {
    if (!instancesStore.hasAuthenticatedInstance) return [] as ExtendedStatus[]
    const active = instancesStore.activeAccount
    if (cursor && active) {
      return await instancesStore.fetchMergedHomeTimeline(20, { [active.id]: cursor })
    }
    return await instancesStore.fetchMergedHomeTimeline(20)
  }
  return await instancesStore.fetchMergedTimeline(source, 20, cursor)
}

/** Walk the source timeline until we have `limit` matches or the source is exhausted. */
const loadAlgorithmPage = async (limit = 20, continueFrom?: string | null) => {
  const recipe = algorithmsStore.getRecipe(props.column.algorithmId)
  if (!recipe) {
    throw new Error('This algorithm was deleted or isn’t on this device. Import the share link again.')
  }
  if (recipe.source === 'home' && !instancesStore.hasAuthenticatedInstance) {
    throw new Error('Sign in to run algorithms that use your home feed')
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

interface Props {
  column: ColumnConfig
  canRemove: boolean
  isFirst: boolean
  isLast?: boolean
  canReorder?: boolean
  /** Highlight when another column is dragged over this one */
  dropTarget?: boolean
  dragging?: boolean
  /**
   * Quieter chrome (quaternary) when this column isn't the focused one.
   * Cleared on hover / focus-within via .neo-chrome.
   */
  recessed?: boolean
  focused?: boolean
  /** Column is mounted but hidden (desktop focus mode) — stop polling until shown */
  paused?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isLast: false,
  canReorder: false,
  dropTarget: false,
  dragging: false,
  recessed: false,
  focused: false,
  paused: false,
})

/** Desktop-only inline compose — mobile uses the + sheet (avoids stealing Loom handoff) */
const isDesktop = useDeskViewport()

/**
 * Flick (flip) = one post per screen, snap to the next. Phones always honour
 * the column's mode; on desktop it applies to the focused column, where
 * there's room for it — the board's skinny columns stay a feed.
 */
const isFlip = computed(
  () => (!isDesktop.value || props.focused) && (props.column.viewMode || 'flow') === 'flip',
)
/** Desktop focused column: choose how to move through it */
const showModeSwitch = computed(() => isDesktop.value && props.focused)
const setViewMode = (mode: 'flow' | 'flip') => columnsStore.setColumnViewMode(props.column.id, mode)

const syncFlipPort = () => {
  const el = scrollContainer.value
  if (!el || !isFlip.value) return
  el.style.setProperty('--flip-port', `${el.clientHeight}px`)
}

watch(isFlip, () => {
  nextTick(() => {
    syncFlipPort()
    scrollContainer.value?.scrollTo({ top: 0 })
  })
})
const emit = defineEmits<{
  remove: []
  /** Second arg is groupTag or algorithmId depending on feedType */
  'update-feed-type': [feedType: ColumnFeedType, feedParam?: string]
  'column-drag-start': [columnId: string]
  'column-drag-end': []
  'column-drag-over': [columnId: string]
  'column-drop': [fromColumnId: string]
  'move-left': []
  'move-right': []
  focus: []
}>()

const { onColumnDragStart, onColumnDragEnd, onColumnDragOver, onColumnDrop } = useColumnDnd(
  () => props.column.id,
  emit,
  () => props.canReorder,
)

const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()
const groupsStore = useGroupsStore()
const columnsStore = useColumnsStore()
const algorithmsStore = useAlgorithmsStore()
algorithmsStore.hydrate()
/** Session state for ranked recipes (pool, served posts, source cursors) */
const rankedFeed = useRankedFeed()

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
 * page) — the sentinel never left view, so the observer won't fire again.
 */
const lastLoadAddedNothing = ref(false)
const newPostsAnnounce = ref('')
let newPostsAnnounceTimer: ReturnType<typeof setTimeout> | null = null

const feedMenuOpen = ref(false)
const algorithmsExpanded = ref(true)
const groupsExpanded = ref(false)
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
let flipRo: ResizeObserver | null = null

/** Newer posts waiting while you read (never auto-jump) */
const pendingNew = shallowRef<(mastodon.v1.Status | ExtendedStatus)[]>([])
const isNearTop = ref(true)
const toastStore = useToastStore()

/** Mobile pull-to-refresh (no preventDefault — that fights iOS compositing) */
const pullDistance = ref(0)
const isRefreshing = ref(false)
const PTR_THRESHOLD = 64

const isMobileRef = useMobileViewport()
const isMobileViewport = () => isMobileRef.value
const reducedMotion = usePrefersReducedMotion()
/** Smooth JS scrolling unless the reader asked for less motion */
const scrollBehavior = (): ScrollBehavior => (reducedMotion.value ? 'auto' : 'smooth')

const pendingLabel = computed(() => {
  const n = pendingNew.value.length
  if (n <= 0) return ''
  return n === 1 ? '1 new post' : `${n} new posts`
})

watch(pendingLabel, (label) => {
  if (newPostsAnnounceTimer) clearTimeout(newPostsAnnounceTimer)
  if (!label) {
    newPostsAnnounce.value = ''
    return
  }
  // Throttle polite announcements while posts keep arriving. Name the feed —
  // several board columns can each announce, and "3 new posts" alone is ambiguous.
  newPostsAnnounceTimer = setTimeout(() => {
    newPostsAnnounce.value = `${label} in ${feedLabel.value}`
  }, 700)
})

const canShowHome = computed(() => instancesStore.hasAuthenticatedInstance)

const joinedGroups = computed(() => groupsStore.joinedGroups)

const browsingHost = computed(() => {
  const filteredId = instancesStore.activeInstanceFilter
  const filtered = filteredId
    ? instancesStore.instances.find((i) => i.id === filteredId)
    : null
  const preferred =
    filtered?.url ||
    instancesStore.activeAccount?.url ||
    instancesStore.instances[0]?.url ||
    resolvePublicInstanceUrl()
  return hostnameOf(preferred) || 'this server'
})

const activeRecipe = computed(() =>
  props.column.feedType === 'algorithm'
    ? algorithmsStore.getRecipe(props.column.algorithmId)
    : null,
)

const feedLabel = computed(() => {
  if (props.column.feedType === 'group' && props.column.groupTag) {
    const group = groupsStore.getGroup(props.column.groupTag)
    return group ? `${group.icon} ${group.name}` : `#${props.column.groupTag}`
  }
  if (props.column.feedType === 'algorithm') {
    return activeRecipe.value?.name || 'Algorithm'
  }
  if (props.column.feedType === 'local') {
    return `Local (${browsingHost.value})`
  }
  return FEED_LABELS[props.column.feedType] ?? props.column.feedType
})

/** Guest browsing only auth-gated hosts (e.g. mastodon.social) with no token */
const isGatedGuestBrowse = computed(() => {
  if (instancesStore.hasAuthenticatedInstance) return false
  const targets = instancesStore.instances.length
    ? instancesStore.instances
    : [{ url: resolvePublicInstanceUrl(), accessToken: null as string | null }]
  return targets.every((i) => !i.accessToken && isAuthGatedPublicHost(i.url))
})

const isLoginRequiredError = computed(() => {
  const msg = (error.value || '').toLowerCase()
  return (
    msg.includes('requires login') ||
    msg.includes('authenticated') ||
    msg.includes('sign in') ||
    isGatedGuestBrowse.value
  )
})

import type { NeoIconName } from '~/utils/neoIcons'

type EmptyAction = { to: string; label: string; primary?: boolean }

const emptyState = computed((): {
  icon: NeoIconName
  title: string
  body: string
  actions: EmptyAction[]
} => {
  const authed = instancesStore.hasAuthenticatedInstance
  const feed = props.column.feedType

  if (!authed && isGatedGuestBrowse.value) {
    return {
      icon: 'lock',
      title: 'Sign in to open this feed',
      body: `${browsingHost.value} only shows its public timeline to signed-in people. Sign in with any Mastodon account, or pick a server that still shares public posts.`,
      actions: [
        { to: '/login', label: 'Sign in', primary: true },
        { to: '/explore', label: 'Find an open server' },
      ],
    }
  }

  if (!authed) {
    return {
      icon: 'globe',
      title: 'Browsing as a guest',
      body: 'You’re looking at public posts — no account needed. Sign in when you want your home feed, notifications, and to join groups.',
      actions: [
        { to: '/login', label: 'Sign in', primary: true },
        { to: '/explore', label: 'Explore servers' },
      ],
    }
  }

  if (feed === 'home') {
    return {
      icon: 'sparkle',
      title: 'Your feed is quiet',
      body: 'Follow people or explore servers to fill this column.',
      actions: [{ to: '/explore', label: 'Explore servers', primary: true }],
    }
  }

  if (feed === 'favourites') {
    return {
      icon: 'heart',
      title: 'No liked posts yet',
      body: 'Posts you like show up here.',
      actions: [],
    }
  }

  if (feed === 'bookmarks') {
    return {
      icon: 'bookmark',
      title: 'Nothing saved yet',
      body: 'Bookmark posts to read them later in this feed.',
      actions: [],
    }
  }

  if (feed === 'algorithm') {
    return {
      icon: 'filter',
      title: activeRecipe.value ? `No matches in ${activeRecipe.value.name}` : 'Algorithm not found',
      body: activeRecipe.value
        ? 'Try loosening filters, or wait for more posts on the source timeline.'
        : 'This recipe isn’t on this device. Open the share link again to import it.',
      actions: [],
    }
  }

  return {
    icon: 'message',
    title: 'No posts yet',
    body: 'Try another timeline, or find a different server to watch.',
    actions: [{ to: '/explore', label: 'Explore', primary: true }],
  }
})

const errorActions = computed((): EmptyAction[] => {
  if (!isLoginRequiredError.value) return []
  return [
    { to: '/login', label: 'Sign in', primary: true },
    { to: '/explore', label: 'Explore servers' },
  ]
})

const router = useRouter()

const switchFeed = (type: ColumnFeedType, feedParam?: string) => {
  feedMenuOpen.value = false
  algorithmsExpanded.value = true
  groupsExpanded.value = false
  pendingNew.value = []
  // Profiles are a full page — don't shrink them into a board column
  if (type === 'profile') {
    router.push(instancesStore.isAuthenticated ? '/profile' : '/login')
    return
  }
  if (type === props.column.feedType) {
    if (type === 'group' && feedParam === props.column.groupTag) return
    if (type === 'algorithm' && feedParam === props.column.algorithmId) return
    if (type !== 'group' && type !== 'algorithm') return
  }
  emit('update-feed-type', type, feedParam)
}

/**
 * Enter motion only for short prepend windows (not full refresh). A plain
 * keyed v-for plus a class on just-prepended cards — TransitionGroup would
 * measure every card (getBoundingClientRect) on every list update.
 */
const enteringKeys = shallowRef<ReadonlySet<string>>(new Set())
let listMotionTimer: ReturnType<typeof setTimeout> | null = null

const withPrependMotion = (fn: () => void) => {
  if (reducedMotion.value) {
    fn()
    return
  }
  const before = new Set(statuses.value.map((s) => statusListKey(s)))
  fn()
  const added = new Set<string>()
  for (const s of statuses.value) {
    const key = statusListKey(s)
    if (!before.has(key)) added.add(key)
  }
  if (!added.size) return
  enteringKeys.value = added
  if (listMotionTimer) clearTimeout(listMotionTimer)
  listMotionTimer = setTimeout(() => {
    enteringKeys.value = new Set()
    listMotionTimer = null
  }, 280)
}

const statusHasTag = (status: mastodon.v1.Status, tag: string) => {
  const needle = tag.toLowerCase()
  if ((status.tags || []).some((t) => t.name.toLowerCase() === needle)) return true
  // Fallback when tags aren't populated yet on the create response
  return new RegExp(`(?:^|\\s)#${needle}\\b`, 'i').test(
    (status.content || '').replace(/<[^>]*>/g, ' '),
  )
}

const acceptsComposedStatus = (status: mastodon.v1.Status) => {
  if (props.column.feedType === 'home') return true
  if (props.column.feedType === 'group' && props.column.groupTag) {
    return statusHasTag(status, props.column.groupTag)
  }
  return false
}

const insertComposedStatus = (status: mastodon.v1.Status) => {
  if (!acceptsComposedStatus(status)) return
  const key = statusIdentity(status)
  if (!key) return
  if (statuses.value.some((s) => statusIdentity(s) === key)) return
  withPrependMotion(() => {
    statuses.value = dedupeStatusesByIdentity([status, ...statuses.value])
  })
  trimTailIfNearTop()
  pendingNew.value = pendingNew.value.filter((s) => statusIdentity(s) !== key)
}

const onComposePosted = (status: mastodon.v1.Status) => {
  emitComposedStatus(status)
}

const onScroll = () => {
  if (!scrollContainer.value) return
  isNearTop.value = scrollContainer.value.scrollTop < 8
}

const onPullStart = (e: TouchEvent) => {
  if (!isMobileViewport() || isRefreshing.value || props.recessed) return
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

/** Tap feed title — scroll to top / jump to new posts (menu is on the chevron). */
const onFeedTitleClick = () => {
  if (!scrollContainer.value || scrollContainer.value.scrollTop <= 0) return
  if (pendingNew.value.length) {
    jumpToNew()
  } else {
    scrollContainer.value.scrollTo({ top: 0, behavior: scrollBehavior() })
  }
}

watch(feedMenuOpen, (open) => {
  if (!open) {
    algorithmsExpanded.value = true
    groupsExpanded.value = false
  }
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
  scrollContainer.value?.scrollTo({ top: 0, behavior: scrollBehavior() })
  nextTick(() => {
    const first = scrollContainer.value?.querySelector(
      'article.status-card, article[tabindex]',
    ) as HTMLElement | null
    first?.focus?.()
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
  if (props.column.feedType === 'algorithm' || isSavedFeed(props.column.feedType)) return
  const kept = statuses.value.slice(0, MAX_FEED_STATUSES)
  statuses.value = kept
  maxId.value = kept.at(-1)?.id ?? null
  if (
    props.column.feedType === 'home' ||
    props.column.feedType === 'local' ||
    props.column.feedType === 'federated'
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
  if (props.column.feedType === 'group' && props.column.groupTag) {
    return await fetchGroupPage(props.column.groupTag)
  }
  if (isSavedFeed(props.column.feedType)) {
    const page = await fetchSavedPage(props.column.feedType)
    if (gen === fetchGen) savedCursor.value = page.nextMaxId
    return page.statuses
  }
  if (props.column.feedType === 'algorithm') {
    const page = await loadAlgorithmPage(20, null)
    if (gen === fetchGen) {
      algoSourceCursor.value = page.nextCursor
      hasMore.value = !page.exhausted && !!page.nextCursor
    }
    return page.statuses
  }
  if (props.column.feedType === 'home') {
    if (!instancesStore.hasAuthenticatedInstance) return []
    return await instancesStore.fetchMergedHomeTimeline(20)
  }
  if (props.column.feedType !== 'local' && props.column.feedType !== 'federated') {
    return []
  }
  if (instancesStore.instances.length > 0) {
    return await instancesStore.fetchMergedTimeline(props.column.feedType, 20)
  }
  const client = publicClient()
  return withBrowseOrigin(
    await client.v1.timelines.public.list({
      local: props.column.feedType === 'local',
      limit: 20,
    }),
  )
}

const displayStatuses = computed(() => {
  const list = statuses.value
  if (props.column.feedType === 'home' && settingsStore.localPreferences.collapseReblogs) {
    return collapseDuplicateReblogs(list)
  }
  return list
})

/** Keys computed once per list change, not on every column re-render (pull-to-refresh, etc.) */
const displayRows = computed(() =>
  displayStatuses.value.map((status) => ({ status, key: statusListKey(status) })),
)

/** role="feed" articles: total is unknown (-1) while more pages can load */
const feedSetSize = computed(() => (hasMore.value ? -1 : displayStatuses.value.length))

/** Fetch only posts newer than the current top (since_id) — avoids re-downloading the full page. */
const fetchNewSince = async (): Promise<(mastodon.v1.Status | ExtendedStatus)[]> => {
  // Newest post we already hold — including ones parked in the "new posts" pill,
  // or every poll while you read re-downloads the same batch.
  const top = pendingNew.value[0] ?? statuses.value[0]
  if (!top?.id) return []

  const sinceId = top.id

  if (props.column.feedType === 'group' && props.column.groupTag) {
    const client = publicClient()
    const list = await client.v1.timelines.tag.$select(props.column.groupTag).list({
      limit: 20,
      sinceId,
    })
    return withBrowseOrigin(list)
  }

  if (props.column.feedType === 'home') {
    if (!instancesStore.hasAuthenticatedInstance) return []
    const active = instancesStore.activeAccount
    if (!active?.accessToken) return []
    return await instancesStore.fetchMergedHomeTimeline(20, { [active.id]: sinceId }, { since: true })
  }

  if (props.column.feedType === 'local' || props.column.feedType === 'federated') {
    const targets = instancesStore.publicTimelineTargets()
    if (targets.length === 1 && targets[0]?.accessToken) {
      const inst = targets[0]
      const client = instancesStore.getClient(inst.id)
      const list = await client.v1.timelines.public.list({
        local: props.column.feedType === 'local',
        limit: 20,
        sinceId,
      })
      return list.map((s) => ({
        ...s,
        _instanceId: inst.id,
        _instanceUrl: inst.url,
      }))
    }
    if (instancesStore.instances.length > 0) {
      return await instancesStore.fetchMergedTimeline(
        props.column.feedType as 'local' | 'federated',
        20,
        { [targets[0]!.id]: sinceId },
        { since: true },
      )
    }
    const client = publicClient()
    return withBrowseOrigin(
      await client.v1.timelines.public.list({
        local: props.column.feedType === 'local',
        limit: 20,
        sinceId,
      }),
    )
  }

  // Liked / Saved / algorithms: no since_id polling (lists aren’t live firehoses)
  return []
}

/** Recessed only pauses polling on mobile (one visible column); desktop multi-col keeps all live */
const pauseForRecess = () => props.recessed && isMobileViewport()

/** Polling only while shown, active, unrecessed and the tab is visible */
const canPoll = () =>
  isActive &&
  !props.paused &&
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
    const fresh = await fetchNewSince()
    // Feed / account switched mid-poll — these posts belong to the old feed
    if (gen !== fetchGen) return
    mergeIncoming(fresh)
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
  () => props.paused,
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
  if (refresh) {
    // Keep existing posts visible until the new page lands — avoids blank Federated
    // when a newer fetch aborts an in-flight one (init + account/filter watches).
    maxId.value = null
    feedCursors.value = {}
    algoSourceCursor.value = null
    savedCursor.value = null
    pendingNew.value = []
    hasMore.value = true
    loadMoreError.value = null
  }

  const showLoader = refresh ? statuses.value.length === 0 : true
  if (showLoader) isLoading.value = true
  error.value = null

  try {
    let result: (mastodon.v1.Status | ExtendedStatus)[] = []

    if (props.column.feedType === 'home' && !instancesStore.hasAuthenticatedInstance) {
      throw new Error('Log in or add an instance to view your home timeline')
    }
    if (isSavedFeed(props.column.feedType) && !instancesStore.hasAuthenticatedInstance) {
      throw new Error(
        props.column.feedType === 'favourites'
          ? 'Sign in to view liked posts'
          : 'Sign in to view saved posts',
      )
    }

    result = await loadTimelinePage(gen)
    if (
      gen === fetchGen &&
      (props.column.feedType === 'home' ||
        props.column.feedType === 'local' ||
        props.column.feedType === 'federated')
    ) {
      seedFeedCursors(result)
    }

    if (gen !== fetchGen) return true
    statuses.value = dedupeStatusesByIdentity(result)
    if (result.length > 0) {
      maxId.value = statuses.value.at(-1)!.id
    }
    // Algorithm sets hasMore inside loadTimelinePage; Liked / Saved follow the
    // Link header; others use page size
    if (isSavedFeed(props.column.feedType)) {
      hasMore.value = result.length > 0 && !!savedCursor.value
    } else if (props.column.feedType !== 'algorithm') {
      hasMore.value = result.length >= 20
    }
    autoRetryAttempt = 0
    return true
  } catch (e: any) {
    if (gen !== fetchGen) return true
    // Only surface the error if we have nothing to show
    if (!statuses.value.length) {
      const friendly = mapErrorToMessage(e)
      error.value = friendly.detail || friendly.title || e.message || 'Failed to fetch timeline'
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
    props.column.feedType === 'home' ||
    props.column.feedType === 'local' ||
    props.column.feedType === 'federated'
  if (usesCursors) {
    if (!Object.keys(feedCursors.value).length && props.column.feedType === 'home') return
    if (
      (props.column.feedType === 'local' || props.column.feedType === 'federated') &&
      !Object.keys(feedCursors.value).length &&
      !maxId.value
    ) {
      return
    }
  } else if (props.column.feedType === 'algorithm') {
    if (!algoSourceCursor.value) return
  } else if (isSavedFeed(props.column.feedType)) {
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

    switch (props.column.feedType) {
      case 'home': {
        if (!instancesStore.hasAuthenticatedInstance) break
        newStatuses = await instancesStore.fetchMergedHomeTimeline(20, { ...feedCursors.value })
        if (gen === fetchGen) advanceFeedCursors(newStatuses)
        break
      }
      case 'local':
      case 'federated': {
        newStatuses = await instancesStore.fetchMergedTimeline(
          props.column.feedType,
          20,
          Object.keys(feedCursors.value).length ? { ...feedCursors.value } : maxId.value!,
        )
        if (gen === fetchGen) advanceFeedCursors(newStatuses)
        break
      }
      case 'group': {
        if (props.column.groupTag) {
          newStatuses = await fetchGroupPage(props.column.groupTag, maxId.value!)
        }
        break
      }
      case 'favourites':
      case 'bookmarks': {
        const page = await fetchSavedPage(props.column.feedType, savedCursor.value)
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
    if (isSavedFeed(props.column.feedType)) {
      hasMore.value = newStatuses.length > 0 && !!savedCursor.value
    } else if (props.column.feedType !== 'algorithm') {
      hasMore.value = newStatuses.length > 0
    }
    lastLoadAddedNothing.value = added === 0 && hasMore.value
  } catch (e: any) {
    if (gen !== fetchGen) return
    console.error('Load more error:', e)
    const friendly = mapErrorToMessage(e)
    loadMoreError.value = friendly.detail || friendly.title || 'Couldn’t load more'
  } finally {
    if (gen === fetchGen) {
      isLoadingMore.value = false
      // A short page can leave the sentinel in view, and IntersectionObserver only
      // fires on change — re-arm it. A page that added nothing stops here (manual
      // "Load more" below) instead of auto-scanning the whole source timeline.
      if (added > 0 && hasMore.value) rearmInfiniteObserver()
    }
  }
}

const ensureInfiniteObserver = () => {
  if (!scrollContainer.value || observer) return
  observer = new IntersectionObserver(
    (entries) => {
      if (
        entries[0]?.isIntersecting &&
        !isLoadingMore.value &&
        hasMore.value &&
        !loadMoreError.value
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
    `${props.column.feedType}:${props.column.groupTag ?? ''}:${props.column.algorithmId ?? ''}`,
  () => {
    if (instancesStore.isInitialized) fetchTimeline(true)
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
      // Every feed here is fetched / tagged as the active account (Liked, Saved,
      // home-sourced algorithms, likes from group posts). Drop the old account's
      // posts now — a soft refresh would leave them up if the new fetch fails.
      statuses.value = []
      void fetchTimeline(true)
      return
    }
    if (
      props.column.feedType === 'local' ||
      props.column.feedType === 'federated' ||
      props.column.feedType === 'home' ||
      props.column.feedType === 'algorithm'
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

onMounted(() => {
  // Register visibility/polling listeners before any await so unmount mid-fetch can't leak
  document.addEventListener('visibilitychange', onVisibilityChange)
  stopComposedListen = onComposedStatus(insertComposedStatus)
  startPolling()

  nextTick(() => {
    setupInfiniteScroll()
    const el = scrollContainer.value
    el?.addEventListener('scroll', onScroll, { passive: true })
    el?.addEventListener('touchstart', onPullStart, { passive: true })
    el?.addEventListener('touchmove', onPullMove, { passive: true })
    el?.addEventListener('touchend', onPullEnd, { passive: true })
    el?.addEventListener('touchcancel', onPullEnd, { passive: true })
    syncFlipPort()
    if (el && typeof ResizeObserver !== 'undefined') {
      flipRo?.disconnect()
      flipRo = new ResizeObserver(() => syncFlipPort())
      flipRo.observe(el)
    }
  })

  void (async () => {
    if (instancesStore.isAuthenticated && groupsStore.groups.length === 0) {
      groupsStore.initializeGroups()
    }
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
  if (listMotionTimer) clearTimeout(listMotionTimer)
  if (newPostsAnnounceTimer) clearTimeout(newPostsAnnounceTimer)
  if (observer) observer.disconnect()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  const el = scrollContainer.value
  el?.removeEventListener('scroll', onScroll)
  el?.removeEventListener('touchstart', onPullStart)
  el?.removeEventListener('touchmove', onPullMove)
  el?.removeEventListener('touchend', onPullEnd)
  el?.removeEventListener('touchcancel', onPullEnd)
  flipRo?.disconnect()
  flipRo = null
  document.documentElement.classList.remove('mobile-chrome-collapsed')
  stopPolling()
  cancelAutoRetry()
})
</script>
<template>
  <div
    class="timeline-column neo-chrome"
    :class="{
      'neo-chrome--recessed': recessed,
      'timeline-column--drop-target': dropTarget,
      'timeline-column--dragging': dragging,
      'timeline-column--menu-open': feedMenuOpen,
      'timeline-column--focus-wide': isDesktop && focused,
    }"
    @dragover="onColumnDragOver"
    @drop="onColumnDrop"
  >
    <h2 class="column-title">{{ feedLabel }}</h2>

    <!-- Column Header -->
    <div class="column-header">
      <button
        v-if="canReorder"
        type="button"
        class="neo-chrome-btn column-drag-handle"
        draggable="true"
        title="Drag to reorder"
        aria-label="Reorder column — drag, or press Left / Right arrow"
        aria-keyshortcuts="ArrowLeft ArrowRight"
        @click.stop
        @keydown.left.prevent="!isFirst && emit('move-left')"
        @keydown.right.prevent="!isLast && emit('move-right')"
        @dragstart="onColumnDragStart"
        @dragend="onColumnDragEnd"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>

      <div class="column-feed-select">
        <button
          type="button"
          class="column-feed-title"
          :aria-label="`${feedLabel}. Scroll to top`"
          @click.stop="onFeedTitleClick"
        >
          <span class="column-feed-label">{{ feedLabel }}</span>
        </button>
        <NeoMenu
          v-model:open="feedMenuOpen"
          class="column-feed-menu"
          align="start"
          :label="`Switch feed (${feedLabel})`"
        >
          <svg
            class="column-feed-chevron"
            :class="{ 'column-feed-chevron--open': feedMenuOpen }"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <template #items>
            <button
              type="button"
              role="menuitemradio"
              :aria-checked="column.feedType === 'home'"
              class="feed-dropdown__item"
              :class="{ 'feed-dropdown__item--active': column.feedType === 'home' }"
              :disabled="!canShowHome"
              @click="switchFeed('home')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
              For You
            </button>
            <div class="feed-dropdown__divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              :aria-expanded="algorithmsExpanded"
              class="feed-dropdown__section-toggle"
              @click.stop="algorithmsExpanded = !algorithmsExpanded"
            >
              <span>Algorithms</span>
              <svg :class="{ rotated: algorithmsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <template v-if="algorithmsExpanded">
              <button
                type="button"
                role="menuitemradio"
                :aria-checked="column.feedType === 'local'"
                class="feed-dropdown__item"
                :class="{ 'feed-dropdown__item--active': column.feedType === 'local' }"
                @click="switchFeed('local')"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                </svg>
                Local
              </button>
              <button
                type="button"
                role="menuitemradio"
                :aria-checked="column.feedType === 'federated'"
                class="feed-dropdown__item"
                :class="{ 'feed-dropdown__item--active': column.feedType === 'federated' }"
                @click="switchFeed('federated')"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                </svg>
                Federated
              </button>
              <button
                v-if="canShowHome"
                type="button"
                role="menuitemradio"
                :aria-checked="column.feedType === 'favourites'"
                class="feed-dropdown__item"
                :class="{ 'feed-dropdown__item--active': column.feedType === 'favourites' }"
                @click="switchFeed('favourites')"
              >
                <NeoIcon name="heart" :size="16" :stroke="1.5" />
                Liked
              </button>
              <button
                v-if="canShowHome"
                type="button"
                role="menuitemradio"
                :aria-checked="column.feedType === 'bookmarks'"
                class="feed-dropdown__item"
                :class="{ 'feed-dropdown__item--active': column.feedType === 'bookmarks' }"
                @click="switchFeed('bookmarks')"
              >
                <NeoIcon name="bookmark" :size="16" :stroke="1.5" />
                Saved
              </button>
              <button
                v-for="recipe in algorithmsStore.allRecipes"
                :key="recipe.id"
                type="button"
                role="menuitemradio"
                :aria-checked="column.feedType === 'algorithm' && column.algorithmId === recipe.id"
                class="feed-dropdown__item"
                :class="{
                  'feed-dropdown__item--active':
                    column.feedType === 'algorithm' && column.algorithmId === recipe.id,
                  'feed-dropdown__item--algo': !!recipeTip(recipe),
                }"
                :title="recipeTip(recipe) || recipe.name"
                @click="switchFeed('algorithm', recipe.id)"
              >
                <NeoIcon name="filter" :size="16" :stroke="1.5" />
                <span class="feed-dropdown__algo">
                  <span class="feed-dropdown__algo-name">{{ recipe.name }}</span>
                  <span v-if="recipeTip(recipe)" class="feed-dropdown__algo-tip">{{ recipeTip(recipe) }}</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                class="feed-dropdown__item"
                @click="feedMenuOpen = false; algorithmsStore.openEditor()"
              >
                <NeoIcon name="plus" :size="16" :stroke="1.5" />
                Create algorithm…
              </button>
              <button
                v-if="column.feedType === 'algorithm' && column.algorithmId"
                type="button"
                role="menuitem"
                class="feed-dropdown__item"
                @click="feedMenuOpen = false; algorithmsStore.openEditor(column.algorithmId)"
              >
                <NeoIcon name="edit" :size="16" :stroke="1.5" />
                Edit / share…
              </button>
            </template>

            <template v-if="joinedGroups.length > 0">
              <div class="feed-dropdown__divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                :aria-expanded="groupsExpanded"
                class="feed-dropdown__section-toggle"
                @click.stop="groupsExpanded = !groupsExpanded"
              >
                <span>Groups</span>
                <svg :class="{ rotated: groupsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <template v-if="groupsExpanded">
                <button
                  v-for="group in joinedGroups"
                  :key="group.tag"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="column.feedType === 'group' && column.groupTag === group.tag"
                  class="feed-dropdown__item feed-dropdown__item--group"
                  :class="{ 'feed-dropdown__item--active': column.feedType === 'group' && column.groupTag === group.tag }"
                  @click="switchFeed('group', group.tag)"
                >
                  <span class="feed-dropdown__group-icon">{{ group.icon }}</span>
                  {{ group.name }}
                </button>
              </template>
            </template>

            <div class="feed-dropdown__divider" role="separator" />
            <button
              type="button"
              role="menuitemradio"
              :aria-checked="column.feedType === 'search'"
              class="feed-dropdown__item"
              :class="{ 'feed-dropdown__item--active': column.feedType === 'search' }"
              @click="switchFeed('search')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              Search
            </button>
            <button
              type="button"
              role="menuitemradio"
              :aria-checked="column.feedType === 'profile'"
              class="feed-dropdown__item"
              :class="{ 'feed-dropdown__item--active': column.feedType === 'profile' }"
              @click="switchFeed('profile')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Profile
            </button>
            <button
              v-if="canShowHome"
              type="button"
              role="menuitemradio"
              :aria-checked="column.feedType === 'notifications'"
              class="feed-dropdown__item"
              :class="{ 'feed-dropdown__item--active': column.feedType === 'notifications' }"
              @click="switchFeed('notifications')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
              Notifications
            </button>
            <button
              v-if="canShowHome"
              type="button"
              role="menuitemradio"
              :aria-checked="column.feedType === 'messages'"
              class="feed-dropdown__item"
              :class="{ 'feed-dropdown__item--active': column.feedType === 'messages' }"
              @click="switchFeed('messages')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              Messages
            </button>
            <div class="feed-dropdown__divider" role="separator" />
            <NuxtLink
              to="/groups"
              role="menuitem"
              class="feed-dropdown__item feed-dropdown__item--link"
              @click="feedMenuOpen = false"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              Browse Groups
            </NuxtLink>
          </template>
        </NeoMenu>
      </div>

      <div v-if="canReorder" class="column-reorder">
        <button
          type="button"
          class="neo-chrome-btn"
          title="Move left"
          aria-label="Move column left"
          :disabled="isFirst"
          @pointerdown.stop
          @click.stop="emit('move-left')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          type="button"
          class="neo-chrome-btn"
          title="Move right"
          aria-label="Move column right"
          :disabled="isLast"
          @pointerdown.stop
          @click.stop="emit('move-right')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div
        v-if="showModeSwitch"
        class="column-mode"
        role="group"
        aria-label="How to move through this feed"
        @pointerdown.stop
      >
        <button
          type="button"
          class="column-mode__opt"
          :class="{ 'is-on': !isFlip }"
          :aria-pressed="!isFlip"
          title="Feed — scroll a list"
          @click.stop="setViewMode('flow')"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
          Feed
        </button>
        <button
          type="button"
          class="column-mode__opt"
          :class="{ 'is-on': isFlip }"
          :aria-pressed="isFlip"
          title="Flick — one post at a time (j / k, wheel, or arrows)"
          @click.stop="setViewMode('flip')"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="6" y="3" width="12" height="18" rx="2" />
            <polyline points="9 10 12 7 15 10" />
          </svg>
          Flick
        </button>
      </div>

      <button
        type="button"
        class="neo-chrome-btn column-focus"
        :class="{ 'column-focus--push': !canReorder && !showModeSwitch, 'neo-chrome-btn--on': focused }"
        :title="focused ? 'Show all views' : 'Focus this view'"
        :aria-label="focused ? 'Show all views' : 'Focus this view'"
        :aria-pressed="focused"
        @pointerdown.stop
        @click.stop="emit('focus')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>

      <button
        v-if="canRemove"
        type="button"
        class="neo-chrome-btn neo-chrome-btn--danger column-close"
        title="Remove column"
        aria-label="Remove column"
        @pointerdown.stop
        @click.stop="emit('remove')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

    </div>

    <!-- Scrollable Content -->
    <div
      class="column-scroll"
      :class="{ 'column-scroll--flip': isFlip }"
      ref="scrollContainer"
    >
      <!-- Mobile pull-to-refresh affordance -->
      <div
        v-if="pullDistance > 0 || isRefreshing"
        class="column-ptr"
        :class="{ 'column-ptr--ready': pullDistance >= PTR_THRESHOLD || isRefreshing }"
        :style="{ height: `${isRefreshing ? 48 : pullDistance}px` }"
        aria-live="polite"
      >
        <span class="column-ptr__label">{{ pullHint }}</span>
      </div>

      <!-- Compose: desktop first column — Threads-size compact pill -->
      <div
        v-if="isFirst && instancesStore.isAuthenticated && isDesktop"
        class="column-compose"
      >
        <LazyRealComposeBox
          compact
          :accept-handoff="true"
          placeholder="What's new?"
          title="What's new?"
          :initial-group-tag="column.feedType === 'group' ? column.groupTag : undefined"
          @posted="onComposePosted"
        />
      </div>

      <!-- New posts pill — never auto-jumps the feed -->
      <span class="sr-only" aria-live="polite" aria-atomic="true">{{ newPostsAnnounce }}</span>
      <Transition name="pill-slide">
        <button
          v-if="pendingNew.length"
          type="button"
          class="column-new-pill"
          @click="jumpToNew"
        >
          {{ pendingLabel }}
        </button>
      </Transition>

      <!-- Loading -->
      <div v-if="isLoading" class="column-state" aria-busy="true">
        <FunLoader fill label="Loading" />
      </div>

      <!-- Error -->
      <div v-else-if="error" class="column-state column-state--error" role="alert">
        <span class="column-error__icon">
          <NeoIcon :name="isLoginRequiredError ? 'lock' : 'alert'" :size="22" :stroke="1.75" />
        </span>
        <p class="column-state__title">
          {{ isLoginRequiredError ? 'Sign in to see this feed' : 'Couldn’t load posts' }}
        </p>
        <p>{{ error }}</p>
        <div v-if="errorActions.length" class="column-state__actions">
          <NuxtLink
            v-for="action in errorActions"
            :key="action.to + action.label"
            :to="action.to"
            class="neo-btn neo-btn--sm"
            :class="action.primary ? 'neo-btn--primary' : 'neo-btn--ghost'"
          >
            {{ action.label }}
          </NuxtLink>
        </div>
        <p v-if="autoRetryIn" class="column-state__hint">Trying again automatically in about {{ autoRetryIn }}s.</p>
        <button v-if="!errorActions.length" type="button" class="column-retry" @click="fetchTimeline(true)">Retry</button>
      </div>

      <!-- Login prompt for home when not authenticated -->
      <div v-else-if="column.feedType === 'home' && !canShowHome" class="column-state">
        <span aria-hidden="true">👋</span>
        <p class="column-state__title">Home needs a sign-in</p>
        <p>
          You’re browsing as a guest. Sign in with a Mastodon account to see people you follow —
          or switch this column to Local / Federated for public posts.
        </p>
        <div class="column-state__actions">
          <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in</NuxtLink>
          <NuxtLink to="/explore" class="neo-btn neo-btn--ghost neo-btn--sm">Explore servers</NuxtLink>
        </div>
      </div>

      <!-- Empty / first-run -->
      <div v-else-if="statuses.length === 0" class="column-state">
        <span class="column-state__icon"><NeoIcon :name="emptyState.icon" :size="28" :stroke="1.5" /></span>
        <p class="column-state__title">{{ emptyState.title }}</p>
        <p>{{ emptyState.body }}</p>
        <div v-if="emptyState.actions.length" class="column-state__actions">
          <NuxtLink
            v-for="action in emptyState.actions"
            :key="action.to + action.label"
            :to="action.to"
            class="neo-btn neo-btn--sm"
            :class="action.primary ? 'neo-btn--primary' : 'neo-btn--ghost'"
          >
            {{ action.label }}
          </NuxtLink>
        </div>
      </div>

      <!-- Posts -->
      <div
        v-else
        ref="feedRoot"
        class="column-posts"
        :class="{
          'column-posts--flip': isFlip,
          'column-posts--focus-wide': isDesktop && focused,
        }"
        role="feed"
        tabindex="0"
        :aria-busy="isLoadingMore || isLoading"
        :aria-label="`${feedLabel} posts`"
        @keydown="onFeedKeydown"
      >
        <template v-if="isFlip">
          <RealPostCard
            v-for="(row, idx) in displayRows"
            :key="row.key"
            :status="row.status"
            variant="flip"
            hide-inline-reply
            :aria-posinset="idx + 1"
            :aria-setsize="feedSetSize"
          />
        </template>
        <template v-else>
          <RealPostCard
            v-for="(row, idx) in displayRows"
            :key="row.key"
            :status="row.status"
            :class="{ 'post-list-enter': enteringKeys.has(row.key) }"
            :aria-posinset="idx + 1"
            :aria-setsize="feedSetSize"
          />
        </template>

        <!-- Infinite scroll trigger -->
        <div ref="loadTrigger" class="column-load-trigger" :class="{ 'column-load-trigger--flip': isFlip }">
          <Transition name="fade">
            <div v-if="isLoadingMore" class="column-loading-more" role="status" aria-busy="true">
              <FunLoader :size="120" label="Loading more" />
            </div>
          </Transition>
          <div v-if="loadMoreError" class="column-load-more-error" role="alert">
            <p>{{ loadMoreError }}</p>
            <button type="button" class="column-retry" @click="loadMoreError = null; loadMore()">
              Retry
            </button>
          </div>
          <div
            v-else-if="lastLoadAddedNothing && hasMore && !isLoadingMore"
            class="column-load-more-error"
          >
            <p>{{ column.feedType === 'algorithm' ? 'No matches in that stretch.' : 'Nothing new on that page.' }}</p>
            <button type="button" class="column-retry" @click="loadMore()">
              Keep looking
            </button>
          </div>
        </div>

        <div v-if="!hasMore && statuses.length > 0 && !isFlip" class="column-end" role="status">
          <span aria-hidden="true">&#x2728;</span> All caught up
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.timeline-column {
  flex: 1 0 280px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 280px;
  border-right: 1px solid var(--neo-border-color);
  position: relative;
  transition: opacity 0.15s ease, background 0.15s ease;

  &:last-of-type {
    border-right: none;
  }

  &--dragging {
    opacity: 0.45;
  }

  &--drop-target {
    background: color-mix(in srgb, var(--neo-accent) 6%, transparent);

    .column-header {
      box-shadow: inset 3px 0 0 var(--neo-accent);
    }
  }

  /* Keep feed menu above neighboring columns so items stay clickable */
  &--menu-open {
    z-index: 40;

    .column-header {
      z-index: 40;
    }
  }

  // Focused desktop: keep the title/chrome readable while the stage goes wide
  &--focus-wide {
    .column-header {
      max-width: 44rem;
      width: 100%;
      margin-inline: auto;
      box-sizing: border-box;
    }
  }
}

.column-title {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.column-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.5rem 0 0.35rem;
  height: 48px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
  position: relative;
  z-index: 10;

  // Mobile tabs already name the feed — drop the duplicate chrome
  @media (max-width: 1023px) {
    display: none;
  }
}

.column-drag-handle {
  cursor: grab;
  touch-action: none;

  &:active {
    cursor: grabbing;
  }
}

.column-reorder {
  display: flex;
  align-items: center;
  margin-left: auto;
  gap: 0.125rem;
}

.column-focus--push {
  margin-left: auto;
}

/* Feed / Flick — segmented, quiet until hovered */
.column-mode {
  display: inline-flex;
  flex-shrink: 0;
  margin-left: auto;
  margin-right: 0.25rem;
  padding: 2px;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-secondary);

  // Reorder arrows (when shown) sit between title and this — they own the push
  .column-reorder + & {
    margin-left: 0.25rem;
  }

  &__opt {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 26px;
    padding: 0 0.6rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--neo-chrome-fg);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;

    &:hover {
      color: var(--neo-text-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--neo-focus, var(--neo-accent));
      outline-offset: 1px;
    }

    &.is-on {
      background: var(--neo-bg-card, var(--neo-bg-primary));
      color: var(--neo-text-primary);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--neo-text-primary) 14%, transparent);
    }
  }
}

/* Desktop flick (board / multi-column): keep a centred readable stage.
   Focused mode uses .column-posts--focus-wide for edge-to-edge media. */
@media (min-width: 1024px) {
  .column-posts--flip:not(.column-posts--focus-wide) {
    width: min(760px, 100%);
    margin-inline: auto;
  }
}

.neo-chrome-btn--on {
  color: var(--neo-accent);
}


.column-new-pill {
  position: sticky;
  top: 0.75rem;
  z-index: 8;
  display: block;
  margin: 0.75rem auto;
  padding: 0.4rem 0.9rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--neo-text-inverse);
  background: var(--neo-accent);
  border: 1px solid var(--neo-accent-dark, var(--neo-accent));
  border-radius: var(--neo-radius-sm);
  cursor: pointer;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--neo-accent) 28%, transparent);
  transition: transform 0.12s ease, background 0.12s ease;

  &:hover {
    background: var(--neo-accent-hover);
  }

  &:active {
    transform: scale(0.97);
  }
}

.pill-slide-enter-active,
.pill-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.pill-slide-enter-from,
.pill-slide-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem);
}

.column-feed-select {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  // Title area owns the free space, so focus / close stay pinned right even
  // when the hover-only reorder arrows (their old margin-left: auto) are hidden
  flex: 1 1 auto;
  min-width: 0;
  border-radius: var(--neo-radius-md);
  user-select: none;
}

.column-feed-title {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0.375rem 0.35rem 0.375rem 0.5rem;
  border: none;
  border-radius: var(--neo-radius-md);
  background: transparent;
  cursor: pointer;
  transition: background-color var(--neo-transition-fast);

  &:hover {
    background: var(--neo-bg-tertiary);
  }
}

.column-feed-menu {
  flex-shrink: 0;

  :deep(.neo-menu__trigger) {
    padding: 0.375rem 0.5rem 0.375rem 0.25rem;
    border-radius: var(--neo-radius-md);
    color: var(--neo-chrome-fg);

    &:hover {
      background: var(--neo-bg-tertiary);
    }
  }

  :deep(.neo-menu__panel) {
    left: 0;
    right: auto;
    width: 220px;
    max-height: min(70vh, 28rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--neo-bg-secondary);
    border-radius: var(--neo-radius-md);
    box-shadow: var(--neo-shadow-md);
    padding: 0.375rem;
    z-index: var(--neo-z-dropdown, 1000);
  }
}

.column-feed-label {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-chrome-label);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: min(280px, 46vw);
  transition: color var(--neo-transition-fast);
}

.column-feed-chevron {
  color: var(--neo-chrome-fg);
  transition: transform 0.2s ease, color var(--neo-transition-fast);
  flex-shrink: 0;

  &--open {
    transform: rotate(180deg);
  }
}

// ========================================
// Feed Dropdown items (inside NeoMenu panel)
// ========================================
.feed-dropdown {
  &__item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--neo-text-secondary);
    border-radius: var(--neo-radius-lg);
    transition: background-color 0.12s ease, color 0.12s ease;
    text-decoration: none;

    &:hover:not(:disabled) {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &--active {
      background: var(--neo-accent-soft);
      color: var(--neo-text-primary);
      font-weight: 600;
    }

    &--group {
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
    }

    &--link {
      color: var(--neo-text-muted);
      font-size: 0.8125rem;
    }

    &--algo {
      align-items: flex-start;
    }

    svg {
      flex-shrink: 0;
    }
  }

  &__algo {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    text-align: left;
  }

  &__algo-name {
    font: inherit;
  }

  &__algo-tip {
    font-size: 0.6875rem;
    font-weight: 450;
    line-height: 1.3;
    color: var(--neo-text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__group-icon {
    font-size: 1rem;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  &__divider {
    height: 1px;
    background: var(--neo-border-color);
    margin: 0.375rem 0.5rem;
  }

  &__section-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: var(--neo-radius-lg);
    transition: background-color 0.12s ease, color 0.12s ease;

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-secondary);
    }

    svg {
      transition: transform 0.2s ease;
      &.rotated {
        transform: rotate(180deg);
      }
    }
  }

  &__groups {
    display: flex;
    flex-direction: column;
  }
}

// ========================================
// Column Scroll + Posts
// ========================================
.column-ptr {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  color: var(--neo-text-tertiary);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  transition: color 0.12s ease;

  &--ready {
    color: var(--neo-accent);
  }

  &__label {
    padding-bottom: 0.5rem;
  }

  @media (min-width: 1024px) {
    display: none;
  }
}

.column-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  // Queryable width so focused-mode media can bleed to the column edges
  container-type: inline-size;
  container-name: timeline-col;
  // Mobile: vertical latch — horizontal feed switches are driven by index.vue
  // axis-lock (Chrome Android won't chain pan-x through this).
  // Desktop / iPad board: allow horizontal pan so Magic Keyboard trackpad can
  // reach .columns-container (wheel bridge is the other half).
  touch-action: pan-y;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  background: var(--neo-bg-primary);
  scrollbar-width: thin;
  scrollbar-color: var(--neo-text-muted) transparent;

  @media (min-width: 1024px) {
    touch-action: pan-x pan-y;
  }

  @media (max-width: 1023px) {
    // Let the last post's actions scroll clear of the floating note/waffle buttons
    padding-bottom: 3.75rem;
  }

  &--flip {
    scroll-snap-type: y mandatory;
    scroll-padding: 0;
    padding-bottom: 0;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--neo-text-muted);
    border-radius: 3px;
    &:hover {
      background: var(--neo-text-secondary);
    }
  }
}

.column-compose {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--neo-border-color);
}

.column-state {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 0.625rem;
  min-height: 100%;
  width: 100%;
  padding: 1.25rem 1.5rem;
  text-align: center;
  box-sizing: border-box;

  &[aria-busy='true'] {
    min-height: min(55dvh, 28rem);
  }

  &__icon,
  .column-error__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    color: var(--neo-text-tertiary);
  }

  p {
    max-width: 28ch;
    margin-left: auto;
    margin-right: auto;
    color: var(--neo-text-muted);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  &__title {
    margin: 0;
    max-width: none !important;
    font-size: 1rem !important;
    font-weight: 600;
    color: var(--neo-text-primary) !important;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 0.35rem;
  }
}

.column-state__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
}

.column-retry {
  padding: 0.5rem 1rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-tertiary);
  border-radius: var(--neo-radius-lg);
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--neo-bg-hover);
    color: var(--neo-text-primary);
  }
}

.column-load-more-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  text-align: center;
  color: var(--neo-text-muted);
  font-size: 0.875rem;
}

.column-posts {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.5rem;

  // Wide single columns (tablet portrait, desktop tab mode): keep ~70ch lines
  &:not(.column-posts--flip) {
    width: 100%;
    max-width: 44rem;
    margin-inline: auto;
    box-sizing: border-box;
  }

  // Subtle card edges within columns
  // Paint containment clips the post's "More options" dropdown at the card edge
  :deep(.status-card.status-card--menu-open) {
    content-visibility: visible;
  }

  :deep(.status-card) {
    content-visibility: auto;
    contain-intrinsic-size: auto 220px;
    border: 1px solid var(--neo-border-color);
    border-radius: var(--neo-radius-md);
    transition: border-color var(--neo-transition-fast);

    &:hover {
      border-color: var(--neo-border-color-dark);
    }
  }

  &--flip {
    gap: 0;
    padding: 0;

    :deep(.status-card) {
      border: none;
      border-radius: 0;
      flex: 0 0 var(--flip-port, 100%);
      height: var(--flip-port, 100%);
      min-height: var(--flip-port, 100%);
      max-height: var(--flip-port, 100%);

      &:hover {
        border-color: transparent;
      }
    }
  }

  // Focused desktop: media spans the column; reading chrome stays ~44rem
  &--focus-wide:not(.column-posts--flip) {
    // content-visibility paint-containment would clip the media breakout
    :deep(.status-card) {
      content-visibility: visible;
    }

    :deep(.status-media) {
      width: 100cqi;
      max-width: 100cqi;
      margin-left: calc(50% - 50cqi);
      border-radius: 0;
    }

    :deep(.status-media-image) {
      max-height: min(70vh, 720px);
      object-fit: contain;
      background: var(--neo-bg-secondary);
    }

    :deep(.status-media-video) {
      max-height: min(75vh, 800px);
    }
  }

  &--focus-wide.column-posts--flip {
    width: 100%;
    max-width: none;
    margin-inline: 0;
  }
}

.column-load-trigger {
  min-height: 1px;
  padding: 0.5rem 0;

  &--flip {
    flex: 0 0 40%;
    min-height: 40%;
    scroll-snap-align: start;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.column-loading-more {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 9rem;
  padding: 1.25rem 0.75rem;
  box-sizing: border-box;
}

.column-end {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 1.5rem 1rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

// ========================================
// Animations
// ========================================
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
  transform-origin: top left;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}

.groups-expand-enter-active,
.groups-expand-leave-active {
  transition: opacity 0.2s ease, max-height 0.2s ease;
  overflow: hidden;
}
.groups-expand-enter-from,
.groups-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.groups-expand-enter-to,
.groups-expand-leave-from {
  max-height: 300px;
}

// Just-prepended cards (see withPrependMotion) — same feel as the old enter transition
.post-list-enter {
  animation: post-list-enter 0.25s ease backwards;
}
@keyframes post-list-enter {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .post-list-enter {
    animation: none !important;
  }
  .dropdown-enter-active,
  .dropdown-leave-active,
  .groups-expand-enter-active,
  .groups-expand-leave-active,
  .pill-slide-enter-active,
  .pill-slide-leave-active,
  .fade-enter-active,
  .fade-leave-active {
    transition: none !important;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
