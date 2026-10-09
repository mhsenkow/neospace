<script setup lang="ts">
/**
 * Explore / Search — each tab answers its own kind of question:
 *
 * - All:     top hit (exact handle, pasted URL, exact #tag) + a preview of each type
 * - People:  suggestions → live account search, "people I follow" filter
 * - Posts:   trending → full-text search with Mastodon operators as chips,
 *            #tag timeline fallback (guests, servers without full-text search)
 * - Tags:    trending + followed → tag search with 7-day trend lines
 * - Servers: curated catalog (ranked) + live lookup of any hostname
 */

import type { mastodon } from 'masto'
import { useCuratedInstances } from '~/composables/useCuratedInstances'
import { useInstancesStore, type InstanceApiInfo } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import { useFediverseSearch, ALL_PREVIEW, type ExploreSearchTab } from '~/composables/useFediverseSearch'
import { useSearchDiscovery } from '~/composables/useSearchDiscovery'
import { useRecentSearches } from '~/composables/useRecentSearches'
import { normalizeServer, friendlyServerError } from '~/utils/instances'
import { stripHtml } from '~/utils/stripHtml'
import {
  activePostFilterCount,
  detectIntent,
  emptyPostFilters,
  formatCount,
  highlightTerms,
  POST_OPERATOR_TIPS,
  rankServers,
  type PostSince,
} from '~/utils/searchQuery'
import { useToastStore } from '~/stores/toast'
import { useMobileViewport } from '~/composables/useBreakpoint'
import { getMainScroller } from '~/utils/pageScroll'
import SearchPersonRow from '~/components/search/SearchPersonRow.vue'
import SearchTagRow from '~/components/search/SearchTagRow.vue'

type ExploreTab = ExploreSearchTab

const TABS: { id: ExploreTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'people', label: 'People' },
  { id: 'posts', label: 'Posts' },
  { id: 'tags', label: 'Tags' },
  { id: 'servers', label: 'Servers' },
]

const STARTER_TOPICS = ['photography', 'art', 'linux', 'books', 'gaming', 'climate', 'music', 'introduction']

/** How much of each type the All tab previews before "See all" */
const PREVIEW = { people: 4, tags: 5, posts: 4, servers: 3 } as const

const SINCE_OPTIONS: { id: PostSince; label: string }[] = [
  { id: '', label: 'Any time' },
  { id: 'day', label: 'Past day' },
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
  { id: 'year', label: 'Past year' },
]

const { categories, getByCategory, instances: curatedInstances, featured } = useCuratedInstances()
const instancesStore = useInstancesStore()
const groupsStore = useGroupsStore()
const toastStore = useToastStore()
const router = useRouter()
const route = useRoute()

const selectedCategory = ref('all')
const query = ref('')
const tab = ref<ExploreTab>('all')
const customError = ref<string | null>(null)
const customBusy = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
const postFilters = ref(emptyPostFilters())
const peopleFollowingOnly = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | null = null
const loadMoreSentinel = ref<HTMLElement | null>(null)
const isSignedIn = computed(() => instancesStore.hasAuthenticatedInstance)

const {
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
  resultsFor,
  clearResults: clearFediverseResults,
  runSearch: runFediverseSearch,
  loadMore: loadMoreSearch,
  toggleFollowAccount,
  toggleFollowTag,
  ensureRelationships,
} = useFediverseSearch({ query, tab, isSignedIn, postFilters, peopleFollowingOnly })

const discovery = useSearchDiscovery({ isSignedIn })
const recents = useRecentSearches()

const trimmedQuery = computed(() => query.value.trim())
const hasQuery = computed(() => trimmedQuery.value.length >= 2)
const intent = computed(() => detectIntent(query.value))
const terms = computed(() => highlightTerms(resultsFor.value || query.value))
/** Results on screen answer what's in the box (not a keystroke behind) */
const resultsCurrent = computed(() => resultsFor.value === trimmedQuery.value)

// ── Servers ────────────────────────────────────────────────────────────────

const filteredInstances = computed(() =>
  hasQuery.value ? rankServers(curatedInstances, trimmedQuery.value) : getByCategory(selectedCategory.value),
)
const featuredServers = computed(() => featured.value.slice(0, 6))

/** Live card for any hostname typed — no need to press "Look up" */
const liveServer = ref<{ host: string; info: InstanceApiInfo | null; busy: boolean } | null>(null)
let liveTimer: ReturnType<typeof setTimeout> | null = null

const liveHostCandidate = computed(() => {
  if (tab.value !== 'all' && tab.value !== 'servers') return null
  const i = intent.value
  if (i.kind === 'host') return i.host
  if (tab.value === 'servers' && i.kind === 'url') return normalizeServer(i.url)?.replace(/^https:\/\//, '') ?? null
  return null
})

watch(liveHostCandidate, (host) => {
  if (liveTimer) clearTimeout(liveTimer)
  if (!host) {
    liveServer.value = null
    return
  }
  liveServer.value = { host, info: null, busy: true }
  liveTimer = setTimeout(async () => {
    const info = await instancesStore.fetchInstanceInfo(host).catch(() => null)
    if (liveHostCandidate.value !== host) return
    liveServer.value = { host, info, busy: false }
  }, 450)
})

const liveServerJoinUrl = computed(() => {
  const s = liveServer.value
  if (!s?.info?.registrations) return null
  return s.info.registrationsUrl || `https://${s.host}/auth/sign_up`
})

// ── Topics / discovery ─────────────────────────────────────────────────────

const topicChips = computed(() => {
  const merged = [
    ...discovery.trendingTags.value.map((t) => t.name),
    ...groupsStore.trendingGroups.map((g) => g.tag),
    ...STARTER_TOPICS,
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of merged) {
    const key = t.toLowerCase().replace(/^#/, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= 14) break
  }
  return out
})

const recentForTab = computed(() =>
  tab.value === 'all' ? recents.items.value : recents.items.value.filter((r) => r.tab === tab.value),
)

const isTagFollowed = (name: string) => followedTags.value.has(name.toLowerCase())

// Seed follow state from what discovery already knows (trends carry `following`)
watch(
  () => [discovery.followedTagList.value, discovery.trendingTags.value] as const,
  ([followed, trending]) => {
    const next = new Set(followedTags.value)
    for (const t of followed) next.add(t.name.toLowerCase())
    for (const t of trending) {
      const f = (t as { following?: boolean }).following
      if (f === true) next.add(t.name.toLowerCase())
    }
    followedTags.value = next
  },
)

watch(discovery.suggestedPeople, (people) => {
  if (isSignedIn.value) ensureRelationships(people)
})

// ── Section visibility ─────────────────────────────────────────────────────

const isAll = computed(() => tab.value === 'all')

const peopleShown = computed(() => {
  if (!isAll.value) return accounts.value
  const skip = topHit.value?.kind === 'account' ? topHit.value.account.id : null
  return accounts.value.filter((a) => a.id !== skip).slice(0, PREVIEW.people)
})
const tagsShown = computed(() => {
  if (!isAll.value) return hashtags.value
  const skip = topHit.value?.kind === 'tag' ? topHit.value.tag.name.toLowerCase() : null
  return hashtags.value.filter((t) => t.name.toLowerCase() !== skip).slice(0, PREVIEW.tags)
})
const postsShown = computed(() => {
  if (!isAll.value) return statuses.value
  const skip = topHit.value?.kind === 'status' ? topHit.value.status.id : null
  return statuses.value.filter((s) => s.id !== skip).slice(0, PREVIEW.posts)
})
const tagTimelineShown = computed(() =>
  isAll.value ? tagTimeline.value.slice(0, 3) : tagTimeline.value,
)
const serversShown = computed(() =>
  isAll.value ? filteredInstances.value.slice(0, PREVIEW.servers) : filteredInstances.value,
)

const morePeople = computed(() => isAll.value && accounts.value.length > PREVIEW.people)
const moreTags = computed(() => isAll.value && hashtags.value.length > PREVIEW.tags)
const morePosts = computed(
  () => isAll.value && (statuses.value.length > PREVIEW.posts || statuses.value.length >= ALL_PREVIEW || tagTimeline.value.length > 3),
)
const moreServers = computed(() => isAll.value && filteredInstances.value.length > PREVIEW.servers)

const showPeople = computed(() => (isAll.value || tab.value === 'people') && peopleShown.value.length > 0)
const showTags = computed(() => (isAll.value || tab.value === 'tags') && tagsShown.value.length > 0)
const showPosts = computed(() => (isAll.value || tab.value === 'posts') && postsShown.value.length > 0)
const showTagTimeline = computed(
  () => (isAll.value || tab.value === 'posts') && tagTimelineShown.value.length > 0 && !!tagTimelineTag.value,
)
const showServersResults = computed(
  () => (isAll.value || tab.value === 'servers') && hasQuery.value && serversShown.value.length > 0,
)
const showLiveServer = computed(() => !!liveServer.value && (isAll.value || tab.value === 'servers'))

/** Exact #tag the person typed but no server has seen yet — still browsable */
const browseTagSuggestion = computed(() => {
  if (tab.value !== 'tags' && !isAll.value) return null
  const i = intent.value
  const want = i.kind === 'tag' ? i.tag : tab.value === 'tags' && /^[\p{L}][\p{L}\p{N}_]*$/u.test(trimmedQuery.value) ? trimmedQuery.value : null
  if (!want || !resultsCurrent.value) return null
  if (hashtags.value.some((t) => t.name.toLowerCase() === want.toLowerCase())) return null
  return want
})

const nothingFound = computed(() => {
  if (!hasQuery.value || searchBusy.value || searchError.value || !resultsCurrent.value) return false
  if (tab.value === 'servers') return !filteredInstances.value.length && !showLiveServer.value
  if (tab.value === 'people') return !accounts.value.length
  if (tab.value === 'posts') return !statuses.value.length && !tagTimeline.value.length
  if (tab.value === 'tags') return !hashtags.value.length && !browseTagSuggestion.value
  return (
    !topHit.value &&
    !accounts.value.length &&
    !statuses.value.length &&
    !hashtags.value.length &&
    !tagTimeline.value.length &&
    !showServersResults.value &&
    !showLiveServer.value
  )
})

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const searchStatusText = computed(() => {
  if (!hasQuery.value) return ''
  if (searchBusy.value && tab.value !== 'servers') return 'Searching…'
  if (searchError.value) return ''
  const q = trimmedQuery.value
  if (nothingFound.value) return `No results for “${q}”`
  const more = searchHasMore.value ? '+' : ''
  if (tab.value === 'people' && accounts.value.length) return `${plural(accounts.value.length, 'person', 'people')}${more} for “${q}”`
  if (tab.value === 'tags' && hashtags.value.length) return `${plural(hashtags.value.length, 'tag', 'tags')}${more} for “${q}”`
  if (tab.value === 'posts' && statuses.value.length) return `${plural(statuses.value.length, 'post', 'posts')}${more} for “${q}”`
  if (tab.value === 'servers' && filteredInstances.value.length) return `${plural(filteredInstances.value.length, 'server', 'servers')} for “${q}”`
  return ''
})

const showStatusHint = computed(() => !!searchStatusText.value && !customError.value && !searchError.value)

const searchPlaceholder = computed(() => {
  if (tab.value === 'servers') return 'Server, topic, or hostname'
  if (tab.value === 'people') return 'Name or @user@server'
  if (tab.value === 'posts') return isSignedIn.value ? 'Words, or from:me has:media…' : '#tag to see recent posts'
  if (tab.value === 'tags') return '#hashtag'
  return 'People, #tags, posts, servers'
})

const postFilterCount = computed(() => activePostFilterCount(postFilters.value))

// ── Routing ────────────────────────────────────────────────────────────────

const syncFromRoute = () => {
  // Leaving the page also changes the route — don't reset state on the way out
  if (route.path !== '/explore') return
  const q = typeof route.query.q === 'string' ? route.query.q : ''
  // persistRoute stores the trimmed query; echoing that back would eat the
  // space someone just typed ("hello " → "hello" mid-word)
  if (q !== query.value.trim()) query.value = q
  const t = route.query.tab
  tab.value = typeof t === 'string' && TABS.some((x) => x.id === t) ? (t as ExploreTab) : 'all'
}

const routeKey = (q: unknown, t: unknown) =>
  `${typeof q === 'string' ? q : ''}|${typeof t === 'string' && t ? t : 'all'}`

/** URL states this page wrote itself — their echo must not overwrite newer typing */
const ownRouteKeys = new Set<string>()

const persistRoute = () => {
  const nextQuery: Record<string, string> = {}
  if (trimmedQuery.value) nextQuery.q = trimmedQuery.value
  if (tab.value !== 'all') nextQuery.tab = tab.value
  const key = routeKey(nextQuery.q, nextQuery.tab)
  if (routeKey(route.query.q, route.query.tab) === key) return
  ownRouteKeys.add(key)
  router.replace({ path: '/explore', query: nextQuery })
}

/**
 * Keep keyboard users in the field — but on touch, focusing pops the soft
 * keyboard over the results someone just asked for (tab/topic taps).
 */
const refocusSearch = () => {
  if (typeof window !== 'undefined' && !window.matchMedia('(pointer: fine)').matches) return
  nextTick(() => searchInputRef.value?.focus())
}

const setTab = (next: ExploreTab) => {
  if (tab.value === next) return
  tab.value = next
  customError.value = null
  searchError.value = null
  persistRoute()
  refocusSearch()
  // Search re-runs from the composable's tab watcher (cached when possible)
}

/** "See all people →" from the All preview — land at the top of the full list */
const seeAll = (next: ExploreTab) => {
  setTab(next)
  nextTick(() => getMainScroller()?.scrollTo({ top: 0 }) ?? window.scrollTo({ top: 0 }))
}

// ── Actions ────────────────────────────────────────────────────────────────

const handleVisit = (domain: string) => instancesStore.openPreview(domain)

const showToast = (msg: string) => toastStore.show({ message: msg, duration: 3200 })

const onWatched = (domain: string) => showToast(`Watching ${domain} — browse public posts anytime`)

const lookUpCustom = async () => {
  customError.value = null
  const url = normalizeServer(query.value)
  if (!url) {
    customError.value = 'Enter a server name like mastodon.social'
    return
  }
  const host = url.replace(/^https?:\/\//, '')
  customBusy.value = true
  try {
    const info = await instancesStore.fetchInstanceInfo(host)
    if (!info) {
      customError.value = "We couldn't reach that server. Check the spelling and try again."
      return
    }
    instancesStore.openPreview(host)
  } catch (e) {
    customError.value = friendlyServerError(e)
  } finally {
    customBusy.value = false
  }
}

const openAccount = (account: mastodon.v1.Account) =>
  router.push({ path: '/profile', query: { user: account.acct } })

const openStatus = (status: mastodon.v1.Status) => {
  const url = status.url || status.uri
  router.push({ path: `/status/${status.id}`, query: url ? { url } : undefined })
}

const onSearchEnter = async () => {
  if (searchTimer) clearTimeout(searchTimer)
  const q = trimmedQuery.value
  if (!q) return
  // Touch: drop the keyboard so the results aren't hidden behind it
  if (!window.matchMedia('(pointer: fine)').matches) searchInputRef.value?.blur()
  recents.record(q, tab.value)
  persistRoute()
  const i = intent.value
  if (tab.value === 'servers' || (isAll.value && i.kind === 'host')) {
    void lookUpCustom()
    return
  }
  await runFediverseSearch(q, { resolve: true })
  if (trimmedQuery.value !== q) return
  // Pasted a post/profile link or an exact handle → go straight there
  if (i.kind === 'url' || (i.kind === 'handle' && i.remote)) {
    const hit = topHit.value
    if (hit?.kind === 'account') return openAccount(hit.account)
    if (hit?.kind === 'status') return openStatus(hit.status)
    if (tab.value === 'people' && accounts.value.length === 1) return openAccount(accounts.value[0]!)
  }
}

const applyQuery = (q: string, nextTab?: ExploreTab) => {
  if (searchTimer) clearTimeout(searchTimer)
  query.value = q
  const target = nextTab ?? (tab.value === 'servers' ? 'all' : tab.value)
  const tabChanged = target !== tab.value
  tab.value = target
  persistRoute()
  // A tab change re-runs from the composable's watcher; identical requests dedupe
  if (!tabChanged) void runFediverseSearch(q)
  refocusSearch()
}

const applyTopic = (tag: string) => {
  recents.record(`#${tag}`, tab.value === 'servers' ? 'all' : tab.value)
  applyQuery(`#${tag}`)
}

/** Posts tab: tap an operator tip to add it to the query */
const insertOperator = (op: string) => {
  const base = trimmedQuery.value
  if (base.split(/\s+/).includes(op)) return
  applyQuery(base ? `${base} ${op}` : op, 'posts')
}

const togglePostFilter = (key: 'fromMe' | 'media' | 'poll' | 'links' | 'noReplies') => {
  postFilters.value = { ...postFilters.value, [key]: !postFilters.value[key] }
}

const setPostSince = (since: PostSince) => {
  postFilters.value = { ...postFilters.value, since }
}

const clearPostFilters = () => {
  postFilters.value = emptyPostFilters()
}

const clearQuery = () => {
  if (searchTimer) clearTimeout(searchTimer)
  query.value = ''
  clearFediverseResults()
  persistRoute()
  nextTick(() => searchInputRef.value?.focus())
}

const onSearchKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (query.value) {
    e.preventDefault()
    clearQuery()
  } else {
    searchInputRef.value?.blur()
  }
}

/** Opening a result counts as a search worth remembering */
const onResultsClick = (e: MouseEvent) => {
  if (!hasQuery.value) return
  const el = e.target as HTMLElement | null
  if (el?.closest('a[href], .status-card') && !el.closest('button')) recents.record(trimmedQuery.value, tab.value)
}

const goSignIn = () => router.push('/login')
const goAddAccount = () => router.push('/login?add=1')

const handleFollowPerson = async (account: mastodon.v1.Account, e: Event) => {
  e.preventDefault()
  e.stopPropagation()
  try {
    await toggleFollowAccount(account)
  } catch {
    toastStore.show({ message: 'Couldn’t update follow' })
  }
}

const handleFollowTag = async (tag: mastodon.v1.Tag, e: Event) => {
  e.preventDefault()
  e.stopPropagation()
  try {
    await toggleFollowTag(tag)
    discovery.forgetFollowedTags()
  } catch {
    toastStore.show({ message: 'Couldn’t update tag follow' })
  }
}

const linkHost = (link: mastodon.v1.TrendLink) => {
  if (link.providerName) return link.providerName
  try {
    return new URL(link.url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const linkPeople = (link: mastodon.v1.TrendLink) => {
  const n = (link.history || []).reduce((sum, d) => sum + Number(d.accounts || 0), 0)
  return n ? `${formatCount(n)} sharing this week` : ''
}

// ── Typing → search ────────────────────────────────────────────────────────

watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  customError.value = null
  const i = detectIntent(q)
  // WebFinger/URL resolution is slow — wait for a pause before asking
  const delay = i.kind === 'url' || i.kind === 'handle' ? 600 : 260
  searchTimer = setTimeout(() => {
    if (tab.value !== 'servers') void runFediverseSearch(q)
    else clearFediverseResults()
    persistRoute()
  }, delay)
})

// Empty states load lazily for the tab in view
watch(
  [tab, isSignedIn],
  ([t], prev) => {
    if (prev && prev[1] !== isSignedIn.value) discovery.reset()
    void discovery.loadFor(t)
  },
)

let loadMoreObserver: IntersectionObserver | null = null
const isMobileShell = useMobileViewport()
// Mobile scrolls `main`, not the window — observe against it so the prefetch
// margin works; rebind when the shell flips (iPad rotation across 1024px).
watch(
  [loadMoreSentinel, isMobileShell],
  ([el]) => {
    loadMoreObserver?.disconnect()
    loadMoreObserver = null
    if (!el) return
    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) loadMoreSearch()
      },
      { root: getMainScroller(), rootMargin: '0px 0px 600px 0px' },
    )
    loadMoreObserver.observe(el)
  },
  { flush: 'post' },
)

/** `/` jumps to the search field from anywhere on the page */
const onGlobalKeydown = (e: KeyboardEvent) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
  const t = e.target as HTMLElement | null
  if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (document.querySelector('[aria-modal="true"]')) return
  e.preventDefault()
  searchInputRef.value?.focus()
  searchInputRef.value?.select()
}

onMounted(() => {
  syncFromRoute()
  if (isSignedIn.value) void groupsStore.initializeGroups()
  void discovery.loadFor(tab.value)
  window.addEventListener('keydown', onGlobalKeydown)
  nextTick(() => {
    // Fresh visit → ready to type. Arriving with a query (Back, shared link) →
    // show results; on touch that would put the keyboard over them.
    if (!hasQuery.value || window.matchMedia('(pointer: fine)').matches) {
      searchInputRef.value?.focus()
    }
    // The query watcher fired from syncFromRoute — run now instead of debouncing
    if (searchTimer) clearTimeout(searchTimer)
    if (hasQuery.value && tab.value !== 'servers') void runFediverseSearch(query.value)
  })
})

// Back/forward between searches (or a link to /explore?q=…) while mounted
watch(
  () => [route.query.q, route.query.tab],
  ([q, t]) => {
    const key = routeKey(q, t)
    if (ownRouteKeys.delete(key)) return
    if (key === routeKey(trimmedQuery.value, tab.value)) return
    syncFromRoute()
  },
)

useHead({
  title: 'Search | NeoSpace',
  meta: [{ name: 'description', content: 'Search people, posts, hashtags, and servers across the fediverse.' }],
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (liveTimer) clearTimeout(liveTimer)
  loadMoreObserver?.disconnect()
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <div class="explore-page">
    <header class="explore-hero">
      <h1>Search</h1>
    </header>

    <div class="explore-search-block neo-sticky-bar">
      <div class="explore-search-row">
        <!-- Button sits outside the <label> (a label may only label its one control) -->
        <div class="explore-search" :class="{ 'explore-search--busy': searchBusy }">
          <label class="explore-search__field">
            <NeoIcon name="search" :size="20" :stroke="1.75" class="explore-search__icon" />
            <span class="sr-only">Search</span>
            <input
              ref="searchInputRef"
              v-model="query"
              type="search"
              :placeholder="searchPlaceholder"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              autocomplete="off"
              enterkeyhint="search"
              aria-keyshortcuts="/"
              aria-controls="explore-results"
              @keydown.enter.prevent="onSearchEnter"
              @keydown="onSearchKeydown"
            />
          </label>
          <button
            v-if="query"
            type="button"
            class="explore-search__clear"
            aria-label="Clear search"
            @click="clearQuery"
          >
            <NeoIcon name="x" :size="16" />
          </button>
          <button
            v-if="tab === 'servers' && hasQuery && !liveServer"
            type="button"
            class="explore-search__go"
            :disabled="customBusy || !query.trim()"
            @click="lookUpCustom"
          >
            {{ customBusy ? '…' : 'Look up' }}
          </button>
        </div>

        <NeoTabs
          :model-value="tab"
          class="explore-modes"
          :tabs="TABS"
          :panels="false"
          controls-id="explore-results"
          id-prefix="explore-tabs"
          aria-label="Search in"
          @update:model-value="setTab($event as ExploreTab)"
        />
      </div>

      <!-- Per-tab refinements ride in the sticky bar so they stay reachable -->
      <div
        v-if="tab === 'posts' && isSignedIn"
        class="explore-filters"
        role="group"
        aria-label="Post filters"
      >
        <button type="button" class="explore-filter" :aria-pressed="postFilters.fromMe" @click="togglePostFilter('fromMe')">Mine</button>
        <button type="button" class="explore-filter" :aria-pressed="postFilters.media" @click="togglePostFilter('media')">
          <NeoIcon name="image" :size="14" /> Media
        </button>
        <button type="button" class="explore-filter" :aria-pressed="postFilters.poll" @click="togglePostFilter('poll')">
          <NeoIcon name="poll" :size="14" /> Polls
        </button>
        <button type="button" class="explore-filter" :aria-pressed="postFilters.links" @click="togglePostFilter('links')">Links</button>
        <button type="button" class="explore-filter" :aria-pressed="postFilters.noReplies" @click="togglePostFilter('noReplies')">No replies</button>
        <label class="explore-filter explore-filter--select" :class="{ 'is-on': !!postFilters.since }">
          <span class="sr-only">Posted</span>
          <select :value="postFilters.since" @change="setPostSince(($event.target as HTMLSelectElement).value as PostSince)">
            <option v-for="o in SINCE_OPTIONS" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
        </label>
        <button v-if="postFilterCount" type="button" class="explore-filter explore-filter--reset" @click="clearPostFilters">
          Clear {{ postFilterCount }}
        </button>
      </div>
      <div
        v-else-if="tab === 'people' && isSignedIn"
        class="explore-filters"
        role="group"
        aria-label="People filters"
      >
        <button type="button" class="explore-filter" :aria-pressed="peopleFollowingOnly" @click="peopleFollowingOnly = !peopleFollowingOnly">
          <NeoIcon name="users" :size="14" /> People I follow
        </button>
      </div>

      <p v-if="customError" class="explore-error" role="alert">{{ customError }}</p>
      <p v-else-if="searchError" class="explore-error" role="alert">{{ searchError }}</p>
    </div>

    <div
      id="explore-results"
      role="tabpanel"
      :aria-labelledby="`explore-tabs-tab-${tab}`"
      :aria-busy="searchBusy"
      :class="{
        'explore-results--stale': searchBusy && !resultsCurrent,
        'explore-results--tag-first': isAll && hasQuery && intent.kind === 'tag',
      }"
      @click.capture="onResultsClick"
    >
      <!-- Result count reads at the top; it doesn't need to ride in the sticky bar.
           Always mounted: a live region inserted along with its text is often not announced -->
      <p
        class="explore-hint explore-hint--status"
        :class="{ 'sr-only': !showStatusHint }"
        role="status"
        aria-live="polite"
      >
        {{ showStatusHint ? searchStatusText : '' }}
      </p>

      <!-- ═══ Nothing typed: what each tab is for ═══ -->
      <template v-if="!hasQuery">
        <div v-if="!isSignedIn" class="explore-cta-row">
          <a href="https://joinmastodon.org/servers" target="_blank" rel="noopener" class="neo-btn neo-btn--primary">
            Create a free account
          </a>
          <NuxtLink to="/login" class="neo-btn neo-btn--ghost">I already have an account</NuxtLink>
          <p class="explore-cta-row__hint">
            You can search people and #tags on {{ discovery.sourceHost.value || 'this server' }} as a guest. Sign in to
            search post text and follow.
          </p>
        </div>

        <section v-if="recentForTab.length && tab !== 'servers'" class="explore-recent" aria-labelledby="explore-recent-h">
          <div class="explore-section-head">
            <h2 id="explore-recent-h" class="explore-section-title">Recent</h2>
            <button type="button" class="explore-text-link explore-text-link--inline" @click="recents.clear()">Clear</button>
          </div>
          <ul class="explore-recent__list">
            <li v-for="r in recentForTab.slice(0, 6)" :key="r.q" class="explore-recent__item">
              <button type="button" class="explore-recent__q" @click="applyQuery(r.q, r.tab === 'servers' ? 'all' : (tab === 'all' ? r.tab : tab))">
                <NeoIcon name="search" :size="14" />
                <span>{{ r.q }}</span>
                <em v-if="tab === 'all' && r.tab !== 'all'">in {{ r.tab }}</em>
              </button>
              <button type="button" class="explore-recent__x" :aria-label="`Remove ${r.q} from recent searches`" @click="recents.remove(r.q)">
                <NeoIcon name="x" :size="14" />
              </button>
            </li>
          </ul>
        </section>

        <!-- All -->
        <template v-if="tab === 'all'">
          <section class="explore-topics">
            <h2 class="explore-section-title">Trending topics</h2>
            <div class="explore-topic-row">
              <button v-for="topic in topicChips" :key="topic" type="button" class="explore-tag" @click="applyTopic(topic)">
                #{{ topic }}
              </button>
            </div>
          </section>

          <section v-if="discovery.trendingLinks.value.length" class="explore-news">
            <h2 class="explore-section-title">In the news</h2>
            <ul class="explore-news__list">
              <li v-for="link in discovery.trendingLinks.value" :key="link.url">
                <a :href="link.url" target="_blank" rel="noopener" class="explore-news__item">
                  <img v-if="link.image" :src="link.image" alt="" class="explore-news__img" loading="lazy" decoding="async" />
                  <span class="explore-news__text">
                    <span class="explore-news__source">{{ linkHost(link) }}</span>
                    <strong>{{ link.title }}</strong>
                    <span v-if="linkPeople(link)" class="explore-news__meta">{{ linkPeople(link) }}</span>
                  </span>
                </a>
              </li>
            </ul>
          </section>

          <section class="explore-featured">
            <h2 class="explore-section-title">Servers</h2>
            <div class="explore-grid explore-grid--compact">
              <InstanceCard
                v-for="instance in featuredServers"
                :key="instance.domain"
                :instance="instance"
                @visit="handleVisit"
                @watched="onWatched"
              />
            </div>
            <button type="button" class="explore-text-link" @click="setTab('servers')">See all servers →</button>
          </section>
        </template>

        <!-- People -->
        <section v-else-if="tab === 'people'" class="explore-people">
          <h2 class="explore-section-title">
            {{ discovery.peopleSource.value === 'suggestions' ? 'Suggested for you' : `Active on ${discovery.sourceHost.value}` }}
          </h2>
          <p v-if="discovery.loading.value.has('people') && !discovery.suggestedPeople.value.length" class="explore-hint">Loading…</p>
          <SearchPersonRow
            v-for="acct in discovery.suggestedPeople.value"
            :key="acct.id"
            :account="acct"
            :relationship="relationships[acct.id]"
            :can-follow="isSignedIn"
            @follow="handleFollowPerson"
          />
          <p class="explore-tip">
            Tip: paste a full handle like <code>@user@server.social</code> to find someone on any server.
          </p>
        </section>

        <!-- Posts -->
        <template v-else-if="tab === 'posts'">
          <section class="explore-tips" aria-labelledby="explore-tips-h">
            <h2 id="explore-tips-h" class="explore-section-title">{{ isSignedIn ? 'Search smarter' : 'Browse by tag' }}</h2>
            <div v-if="isSignedIn" class="explore-topic-row">
              <button v-for="tip in POST_OPERATOR_TIPS" :key="tip.insert" type="button" class="explore-op" @click="insertOperator(tip.insert)">
                <code>{{ tip.insert }}</code>
                <span>{{ tip.label }}</span>
              </button>
            </div>
            <div v-else class="explore-topic-row">
              <button v-for="topic in topicChips.slice(0, 8)" :key="topic" type="button" class="explore-tag" @click="applyQuery(`#${topic}`, 'posts')">
                #{{ topic }}
              </button>
            </div>
          </section>
          <section v-if="discovery.trendingPosts.value.length" class="explore-posts">
            <h2 class="explore-section-title">Trending posts</h2>
            <div class="explore-posts__list">
              <RealPostCard v-for="status in discovery.trendingPosts.value" :key="status.id" :status="status" />
            </div>
          </section>
          <p v-else-if="discovery.loading.value.has('posts')" class="explore-hint">Loading…</p>
        </template>

        <!-- Tags -->
        <template v-else-if="tab === 'tags'">
          <section v-if="discovery.followedTagList.value.length" class="explore-topics">
            <h2 class="explore-section-title">Tags you follow</h2>
            <div class="explore-topic-row">
              <NuxtLink
                v-for="t in discovery.followedTagList.value"
                :key="t.name"
                :to="`/groups/${encodeURIComponent(t.name)}`"
                class="explore-tag"
              >
                #{{ t.name }}
              </NuxtLink>
            </div>
          </section>
          <section class="explore-tags">
            <h2 class="explore-section-title">Trending on {{ discovery.sourceHost.value || 'your server' }}</h2>
            <p v-if="discovery.loading.value.has('tags') && !discovery.trendingTags.value.length" class="explore-hint">Loading…</p>
            <SearchTagRow
              v-for="t in discovery.trendingTags.value"
              :key="t.name"
              :tag="t"
              :following="isTagFollowed(t.name)"
              :can-follow="isSignedIn"
              @follow="handleFollowTag"
            />
          </section>
        </template>

        <!-- Servers -->
        <template v-else>
          <nav class="explore-cats" aria-label="Categories">
            <button
              v-for="cat in categories"
              :key="cat.id"
              type="button"
              :class="['explore-cat', { active: selectedCategory === cat.id }]"
              :aria-pressed="selectedCategory === cat.id"
              @click="selectedCategory = cat.id"
            >
              {{ cat.label }}
            </button>
          </nav>

          <section class="explore-grid" aria-labelledby="explore-servers-heading">
            <h2 id="explore-servers-heading" class="sr-only">Servers</h2>
            <TransitionGroup name="card">
              <InstanceCard
                v-for="instance in filteredInstances"
                :key="instance.domain"
                :instance="instance"
                @visit="handleVisit"
                @watched="onWatched"
              />
            </TransitionGroup>
          </section>
        </template>
      </template>

      <!-- ═══ Results ═══ -->
      <template v-else>
        <!-- Top hit: the exact thing someone typed or pasted -->
        <section v-if="isAll && topHit" class="explore-top-hit" aria-label="Top result">
          <h2 class="explore-section-title">Top result</h2>
          <SearchPersonRow
            v-if="topHit.kind === 'account'"
            :account="topHit.account"
            :relationship="relationships[topHit.account.id]"
            :terms="terms"
            :can-follow="isSignedIn"
            featured
            @follow="handleFollowPerson"
          />
          <SearchTagRow
            v-else-if="topHit.kind === 'tag'"
            :tag="topHit.tag"
            :following="isTagFollowed(topHit.tag.name)"
            :can-follow="isSignedIn"
            :terms="terms"
            featured
            @follow="handleFollowTag"
          />
          <div v-else class="explore-posts__list">
            <RealPostCard :status="topHit.status" />
          </div>
        </section>

        <!-- Live server card for a typed hostname -->
        <section v-if="showLiveServer && liveServer" class="explore-live-server" aria-live="polite">
          <h2 class="explore-section-title">Server</h2>
          <div class="explore-live-server__card">
            <template v-if="liveServer.busy">
              <p class="explore-hint">Checking {{ liveServer.host }}…</p>
            </template>
            <template v-else-if="liveServer.info">
              <div class="explore-live-server__head">
                <strong>{{ liveServer.info.title || liveServer.host }}</strong>
                <span class="explore-live-server__host">{{ liveServer.host }}</span>
              </div>
              <p v-if="liveServer.info.description" class="explore-live-server__desc">{{ stripHtml(liveServer.info.description) }}</p>
              <p class="explore-live-server__stats">
                <span v-if="liveServer.info.stats?.userCount">{{ formatCount(liveServer.info.stats.userCount) }} people</span>
                <span>{{ liveServer.info.registrations ? 'Open to sign-ups' : 'Invite or approval only' }}</span>
              </p>
              <div class="explore-live-server__actions">
                <button type="button" class="neo-btn neo-btn--primary neo-btn--sm" @click="handleVisit(liveServer.host)">Preview</button>
                <a v-if="liveServerJoinUrl" :href="liveServerJoinUrl" target="_blank" rel="noopener" class="neo-btn neo-btn--ghost neo-btn--sm">Join</a>
              </div>
            </template>
            <template v-else>
              <p class="explore-hint">Couldn’t reach {{ liveServer.host }} — check the spelling, or it may not be a Mastodon-compatible server.</p>
            </template>
          </div>
        </section>

        <section v-if="showPeople" class="explore-people">
          <div class="explore-section-head">
            <h2 class="explore-section-title">People</h2>
            <button v-if="morePeople" type="button" class="explore-text-link explore-text-link--inline" @click="seeAll('people')">See all →</button>
          </div>
          <SearchPersonRow
            v-for="acct in peopleShown"
            :key="acct.id"
            :account="acct"
            :relationship="relationships[acct.id]"
            :terms="terms"
            :can-follow="isSignedIn"
            @follow="handleFollowPerson"
          />
        </section>

        <section v-if="showTags || browseTagSuggestion" class="explore-tags">
          <div class="explore-section-head">
            <h2 class="explore-section-title">Tags</h2>
            <button v-if="moreTags" type="button" class="explore-text-link explore-text-link--inline" @click="seeAll('tags')">See all →</button>
          </div>
          <NuxtLink
            v-if="browseTagSuggestion"
            :to="`/groups/${encodeURIComponent(browseTagSuggestion)}`"
            class="explore-browse-tag"
          >
            <strong>#{{ browseTagSuggestion }}</strong>
            <span>New tag — browse or be the first to post</span>
          </NuxtLink>
          <SearchTagRow
            v-for="t in tagsShown"
            :key="t.name"
            :tag="t"
            :following="isTagFollowed(t.name)"
            :can-follow="isSignedIn"
            :terms="terms"
            @follow="handleFollowTag"
          />
        </section>

        <section v-if="showPosts" class="explore-posts">
          <div class="explore-section-head">
            <h2 class="explore-section-title">Posts</h2>
            <button v-if="morePosts" type="button" class="explore-text-link explore-text-link--inline" @click="seeAll('posts')">See all →</button>
          </div>
          <div class="explore-posts__list">
            <RealPostCard v-for="status in postsShown" :key="status.id" :status="status" />
          </div>
        </section>

        <section v-if="showTagTimeline" class="explore-posts">
          <div class="explore-section-head">
            <h2 class="explore-section-title">Recent in #{{ tagTimelineTag }}</h2>
            <NuxtLink :to="`/groups/${encodeURIComponent(tagTimelineTag!)}`" class="explore-text-link explore-text-link--inline">Open →</NuxtLink>
          </div>
          <div class="explore-posts__list">
            <RealPostCard v-for="status in tagTimelineShown" :key="status.id" :status="status" />
          </div>
        </section>

        <!-- Why post search can come back thin — Mastodon's index is opt-in -->
        <aside
          v-if="(tab === 'posts' || (isAll && intent.kind === 'text' && !statuses.length && !tagTimeline.length)) && resultsCurrent && (postsLimited || !isSignedIn)"
          class="explore-note"
        >
          <template v-if="!isSignedIn">
            Guests can browse posts by <strong>#tag</strong>. <button type="button" class="explore-text-link explore-text-link--inline" @click="goSignIn">Sign in</button> to search post text.
          </template>
          <template v-else>
            Post text search only covers posts whose authors opted into search, plus ones you wrote, liked, boosted, or
            bookmarked. Try a <strong>#tag</strong>, or narrow with <code>from:</code> <code>has:media</code>.
          </template>
        </aside>

        <section v-if="showServersResults" class="explore-server-hits">
          <div class="explore-section-head">
            <h2 class="explore-section-title">{{ isAll ? 'Servers' : 'Curated servers' }}</h2>
            <button v-if="moreServers" type="button" class="explore-text-link explore-text-link--inline" @click="seeAll('servers')">See all →</button>
          </div>
          <div class="explore-grid">
            <InstanceCard
              v-for="instance in serversShown"
              :key="instance.domain"
              :instance="instance"
              @visit="handleVisit"
              @watched="onWatched"
            />
          </div>
        </section>

        <div v-if="nothingFound" class="explore-empty">
          <p>Nothing matched “{{ trimmedQuery }}”{{ tab === 'all' ? '' : ` in ${tab}` }}.</p>
          <div class="explore-empty__actions">
            <button v-if="tab !== 'all'" type="button" class="neo-btn neo-btn--ghost" @click="setTab('all')">Search everything</button>
            <button v-if="tab === 'people' && peopleFollowingOnly" type="button" class="neo-btn neo-btn--ghost" @click="peopleFollowingOnly = false">
              Search everyone
            </button>
            <button v-if="tab === 'posts' && postFilterCount" type="button" class="neo-btn neo-btn--ghost" @click="clearPostFilters">
              Clear filters
            </button>
            <button v-if="tab === 'servers'" type="button" class="neo-btn neo-btn--ghost" @click="lookUpCustom">
              Look up “{{ trimmedQuery }}” as a server
            </button>
          </div>
        </div>

        <div
          v-if="searchHasMore && tab !== 'all' && tab !== 'servers'"
          ref="loadMoreSentinel"
          class="explore-loadmore"
          role="status"
          aria-live="polite"
          :aria-busy="loadMoreBusy"
        >
          {{ loadMoreBusy ? 'Loading more…' : 'Scroll for more' }}
        </div>
      </template>

      <section class="explore-help">
        <h2 class="explore-section-title explore-help__heading">Get started</h2>
        <div v-if="!isSignedIn" class="explore-help__card">
          <h3>Sign in</h3>
          <button type="button" class="explore-text-link" @click="goSignIn">Continue →</button>
        </div>
        <div v-if="isSignedIn" class="explore-help__card">
          <h3>Link more</h3>
          <button type="button" class="explore-text-link" @click="goAddAccount">Add server →</button>
        </div>
        <div class="explore-help__card">
          <h3>Watch</h3>
          <p>Public timelines, no account.</p>
        </div>
        <div class="explore-help__card explore-help__card--wide">
          <h3>Host</h3>
          <div class="explore-help__links">
            <a href="https://joinmastodon.org/hosting" target="_blank" rel="noopener" class="explore-text-link">Official →</a>
            <a href="https://masto.host/" target="_blank" rel="noopener" class="explore-text-link">Masto.host →</a>
            <a href="https://docs.joinmastodon.org/user/run-your-own/" target="_blank" rel="noopener" class="explore-text-link">Self-host →</a>
          </div>
        </div>
      </section>
    </div>

    <InstancePreview @watched="onWatched" />
  </div>
</template>

<style scoped lang="scss">
.explore-page {
  max-width: 64rem;
  margin: 0 auto;
  padding: 1rem 0.75rem 5.5rem;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}

.explore-hero {
  margin-bottom: 0.65rem;
}

.explore-hero h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 650;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: var(--neo-text-primary);
}

.explore-search-block {
  margin-bottom: 0.85rem;
  padding-bottom: 0.35rem;
  /* Solid fill so results don’t show through while sticky */
  background: var(--neo-bg-primary);
}

.explore-search-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.explore-modes {
  flex-shrink: 0;
  max-width: 100%;

  :deep(.neo-tabs__list) {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.15rem;
    padding: 0.2rem;
    border-radius: 10px;
    background: var(--neo-bg-secondary, var(--neo-bg-tertiary));
    border: 1px solid var(--neo-border-color);
    border-bottom: 1px solid var(--neo-border-color);
  }

  :deep(.neo-tabs__tab) {
    min-height: 2.35rem;
    padding: 0.3rem 0.65rem;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--neo-text-secondary);
    font-family: var(--neo-font-family-ui);
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: none;

    &:hover {
      color: var(--neo-text-primary);
      background: transparent;
    }

    &[aria-selected='true'] {
      background: var(--neo-bg-card, var(--neo-bg-primary));
      color: var(--neo-text-primary);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--neo-text-primary) 12%, transparent);
    }
  }
}

.explore-search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  min-height: 2.75rem;
  padding: 0.35rem 0.5rem 0.35rem 1rem;
  border: 1px solid var(--neo-border-color-dark);
  border-radius: 12px;
  background: var(--neo-bg-card);
  box-sizing: border-box;

  &:focus-within {
    border-color: var(--neo-accent);
  }

  // Layout-neutral: icon + input stay flex children of .explore-search
  &__field {
    display: contents;
  }

  &__icon {
    flex-shrink: 0;
    color: var(--neo-text-muted);
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--neo-text-primary);
    font-size: 1rem;
    outline: none;

    &::placeholder {
      color: var(--neo-text-muted);
    }
  }
}

@media (max-width: 720px) {
  .explore-search-row {
    flex-wrap: wrap;
  }

  .explore-search {
    flex: 1 1 100%;
  }

  .explore-modes {
    flex: 1 1 auto;
    width: 100%;

    :deep(.neo-tabs__list) {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }
    }

    :deep(.neo-tabs__tab) {
      flex: 1 0 auto;
      text-align: center;
    }
  }
}

.explore-search__go {
  flex-shrink: 0;
  min-height: 2.4rem;
  padding: 0 1rem;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--neo-text-on-accent, #fafaf8);
  background: var(--neo-accent);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.explore-error {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: var(--neo-danger);
}

.explore-cta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem 0.75rem;
  margin-bottom: 1.25rem;
  padding-bottom: 1.15rem;
  border-bottom: 1px solid var(--neo-border-color);

  &__hint {
    flex: 1 1 100%;
    margin: 0;
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
    line-height: 1.45;
  }
}

.explore-loadmore {
  padding: 1rem 0;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.explore-discover {
  margin-bottom: 1.5rem;
}

.explore-topics,
.explore-recent,
.explore-news,
.explore-tips,
.explore-featured {
  margin-bottom: 1.75rem;
}

.explore-topic-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
}

.explore-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 1.25rem;
}

.explore-cat {
  padding: 0.4rem 0.7rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--neo-text-secondary);
  background: transparent;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  cursor: pointer;

  &:hover {
    border-color: var(--neo-accent);
    color: var(--neo-accent);
  }

  &.active {
    color: var(--neo-text-on-accent, #fafaf8);
    background: var(--neo-accent);
    border-color: var(--neo-accent);
  }
}

.explore-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
  gap: 0.875rem;
  margin-bottom: 1.25rem;

  &--compact {
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }
}

.card-enter-active,
.card-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.card-enter-from,
.card-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.explore-hint {
  margin: 0 0 1rem;
  overflow-wrap: anywhere;
  font-size: 0.875rem;
  color: var(--neo-text-muted);

  // Result count opens the results (the sticky block above supplies the gap)
  &--status {
    margin-top: 0;
  }
}

.explore-section-title {
  margin: 0 0 0.55rem;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--neo-text-tertiary);
}

.explore-help__heading {
  margin-bottom: 0.75rem;
}

.explore-people,
.explore-posts,
.explore-tags,
.explore-top-hit,
.explore-live-server,
.explore-server-hits {
  margin-bottom: 1.5rem;
}

.explore-tag {
  display: inline-flex;
  margin: 0 0.35rem 0.35rem 0;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--neo-border-color);
  background: var(--neo-bg-secondary, var(--neo-bg-tertiary));
  color: var(--neo-accent);
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;

  &:hover {
    border-color: var(--neo-accent);
  }
}

.explore-posts__list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;

  :deep(.status-card) {
    border: 1px solid var(--neo-border-color);
    border-radius: 4px;
  }
}

.explore-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--neo-text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  // Echoes the raw query — an unbroken paste must not widen the page
  overflow-wrap: anywhere;

  > *,
  &__actions > * {
    max-width: 100%;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
  }
}

.explore-help {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
  margin-top: 0.25rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--neo-border-color);
}

.explore-help__card {
  padding: 1rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;

  h3 {
    margin: 0 0 0.35rem;
    font-size: 0.9375rem;
    color: var(--neo-text-primary);
  }

  p {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--neo-text-muted);
  }

  &--wide {
    grid-column: 1 / -1;

    @media (min-width: 720px) {
      grid-column: span 2;
    }
  }
}

.explore-help__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin-top: 0.35rem;
}

.explore-text-link {
  display: inline-block;
  margin-top: 0.65rem;
  padding: 0;
  border: none;
  background: none;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-accent);
  cursor: pointer;
  text-decoration: none;

  .explore-help__links & {
    margin-top: 0.5rem;
  }

  &:hover {
    text-decoration: underline;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

// ── Search field extras ──

.explore-search {
  position: relative;
  overflow: hidden;

  // Thin progress sweep instead of a spinner — results stay readable
  &--busy::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    width: 40%;
    background: var(--neo-accent);
    animation: explore-sweep 1s ease-in-out infinite;
  }
}

@keyframes explore-sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .explore-search--busy::after {
    animation: none;
    width: 100%;
    opacity: 0.5;
  }
}

.explore-search__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;

  @media (hover: hover) {
    &:hover {
      color: var(--neo-text-primary);
      background: var(--neo-bg-tertiary);
    }
  }
}

// Native clear "x" duplicates ours
.explore-search input::-webkit-search-cancel-button {
  display: none;
}

// ── Filters ──

.explore-filters {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.5rem;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }
}

.explore-filter {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
  min-height: 2rem;
  padding: 0.25rem 0.7rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
  color: var(--neo-text-secondary);
  background: transparent;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  cursor: pointer;
  touch-action: manipulation;

  @media (hover: hover) {
    &:hover {
      border-color: var(--neo-accent);
      color: var(--neo-text-primary);
    }
  }

  &[aria-pressed='true'],
  &.is-on {
    color: var(--neo-text-on-accent, #fafaf8);
    background: var(--neo-accent);
    border-color: var(--neo-accent);
  }

  &--select {
    padding: 0;

    select {
      min-height: 2rem;
      padding: 0 0.7rem;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      appearance: none;
    }

    &:focus-within {
      outline: 2px solid var(--neo-focus, var(--neo-accent));
      outline-offset: 1px;
    }
  }

  &--reset {
    border-style: dashed;
  }
}

// Previous results dim while a new query is on the wire
#explore-results {
  display: flex;
  flex-direction: column;
  transition: opacity 0.15s ease;

  > * {
    min-width: 0;
  }
}

// Typed a #tag on All: the tag and its posts matter more than bios that mention it
.explore-results--tag-first {
  > .explore-people {
    order: 1;
  }

  > .explore-help,
  > .explore-empty {
    order: 2;
  }
}

.explore-results--stale {
  opacity: 0.55;
}

// ── Section chrome ──

.explore-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;

  .explore-section-title {
    margin-bottom: 0.55rem;
  }
}

.explore-text-link--inline {
  margin-top: 0;
}

.explore-hint + .explore-section-title,
.explore-section-head + .explore-hint {
  margin-top: 0.5rem;
}

// ── Recent ──

.explore-recent__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.explore-recent__item {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--neo-border-color);
}

.explore-recent__q {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex: 1;
  min-width: 0;
  min-height: 2.75rem;
  padding: 0 0.15rem;
  border: none;
  background: transparent;
  color: var(--neo-text-primary);
  font: inherit;
  font-size: 0.9375rem;
  text-align: left;
  cursor: pointer;

  > :first-child {
    flex-shrink: 0;
    color: var(--neo-text-muted);
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    flex-shrink: 0;
    font-style: normal;
    font-size: 0.75rem;
    color: var(--neo-text-tertiary);
  }
}

.explore-recent__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;

  @media (hover: hover) {
    &:hover {
      color: var(--neo-text-primary);
    }
  }
}

// ── News ──

.explore-news__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  gap: 0.65rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.explore-news__item {
  display: flex;
  gap: 0.75rem;
  height: 100%;
  padding: 0.65rem;
  box-sizing: border-box;
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  background: var(--neo-bg-card);
  color: inherit;
  text-decoration: none;

  @media (hover: hover) {
    &:hover {
      border-color: var(--neo-accent);
    }
  }
}

.explore-news__img {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  border-radius: 8px;
  object-fit: cover;
  background: var(--neo-bg-tertiary);
}

.explore-news__text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;

  strong {
    font-size: 0.9rem;
    line-height: 1.3;
    color: var(--neo-text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}

.explore-news__source,
.explore-news__meta {
  font-size: 0.75rem;
  color: var(--neo-text-tertiary);
}

// ── Posts tips ──

.explore-op {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-secondary, var(--neo-bg-tertiary));
  color: var(--neo-text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;

  code {
    font-size: 0.8125rem;
    color: var(--neo-accent);
  }

  @media (hover: hover) {
    &:hover {
      border-color: var(--neo-accent);
    }
  }
}

.explore-tip,
.explore-note {
  margin: 0.85rem 0 1.25rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--neo-text-muted);

  code {
    font-size: 0.8em;
    padding: 0.05rem 0.3rem;
    border-radius: 4px;
    background: var(--neo-bg-tertiary);
  }
}

.explore-note {
  padding: 0.7rem 0.85rem;
  border: 1px dashed var(--neo-border-color-dark, var(--neo-border-color));
  border-radius: 10px;
}

// ── Tags ──

.explore-browse-tag {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--neo-border-color);
  color: inherit;
  text-decoration: none;

  strong {
    color: var(--neo-accent);
  }

  span {
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }
}

// ── Live server ──

.explore-live-server__card {
  padding: 0.85rem 1rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  background: var(--neo-bg-card);

  .explore-hint {
    margin: 0;
  }
}

.explore-live-server__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.6rem;

  strong {
    font-size: 1rem;
    color: var(--neo-text-primary);
  }
}

.explore-live-server__host {
  font-size: 0.8125rem;
  color: var(--neo-text-tertiary);
}

.explore-live-server__desc {
  margin: 0.4rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.explore-live-server__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.85rem;
  margin: 0.45rem 0 0;
  font-size: 0.75rem;
  color: var(--neo-text-tertiary);
}

.explore-live-server__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.7rem;
}

@media (min-width: 1024px) {
  .explore-page {
    padding: 2rem 1.5rem 3rem;
  }
}
</style>
