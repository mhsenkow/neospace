<script setup lang="ts">
/**
 * Explore / Search — people, posts, tags, and servers.
 */

import type { mastodon } from 'masto'
import { useCuratedInstances } from '~/composables/useCuratedInstances'
import { useInstancesStore } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import { useFediverseSearch } from '~/composables/useFediverseSearch'
import { normalizeServer, friendlyServerError } from '~/utils/instances'
import { stripHtml } from '~/utils/sanitizeHtml'
import { tagHistorySummary } from '~/utils/hashtag'
import { useToastStore } from '~/stores/toast'
import { useMobileViewport } from '~/composables/useBreakpoint'
import { getMainScroller } from '~/utils/pageScroll'

type ExploreTab = 'all' | 'people' | 'posts' | 'tags' | 'servers'

const TABS: { id: ExploreTab; label: string; tip: string; needsAuth?: boolean }[] = [
  { id: 'all', label: 'All', tip: 'People, posts, tags, and servers' },
  { id: 'people', label: 'People', tip: 'Accounts and @handles', needsAuth: true },
  { id: 'posts', label: 'Posts', tip: 'Posts by keyword', needsAuth: true },
  { id: 'tags', label: 'Tags', tip: 'Hashtags and topics', needsAuth: true },
  { id: 'servers', label: 'Servers', tip: 'Join, watch, or look up a host' },
]

const STARTER_TOPICS = [
  'photography',
  'art',
  'linux',
  'books',
  'gaming',
  'climate',
  'music',
  'introduction',
]

const { categories, getByCategory, search: searchServers, featured } = useCuratedInstances()
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

let searchTimer: ReturnType<typeof setTimeout> | null = null
const loadMoreSentinel = ref<HTMLElement | null>(null)
const isSignedIn = computed(() => instancesStore.hasAuthenticatedInstance)

const {
  searchBusy,
  searchError,
  accounts,
  statuses,
  hashtags,
  relationships,
  followedTags,
  searchHasMore,
  loadMoreBusy,
  clearResults: clearFediverseResults,
  runSearch: runFediverseSearch,
  loadMore: loadMoreSearch,
  shouldResolveQuery,
  toggleFollowAccount,
  toggleFollowTag,
} = useFediverseSearch({ query, tab, isSignedIn })

const hasQuery = computed(() => query.value.trim().length >= 2)

const filteredInstances = computed(() => {
  const q = query.value.trim()
  if (q.length >= 2) return searchServers(q)
  return getByCategory(selectedCategory.value)
})

const featuredServers = computed(() => featured.value.slice(0, 6))

const topicChips = computed(() => {
  const fromTrends = groupsStore.trendingGroups.map((g) => g.tag)
  const merged = [...fromTrends, ...STARTER_TOPICS]
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

const searchPlaceholder = computed(() => {
  if (!isSignedIn.value && (tab.value === 'people' || tab.value === 'posts' || tab.value === 'tags')) {
    return 'Sign in to search'
  }
  if (tab.value === 'servers') return 'Server or hostname'
  if (tab.value === 'people') return 'Name or @handle'
  if (tab.value === 'posts') return 'Posts'
  if (tab.value === 'tags') return 'Tags'
  return 'Search'
})

const showPeople = computed(
  () => (tab.value === 'all' || tab.value === 'people') && accounts.value.length > 0,
)
const showPosts = computed(
  () => (tab.value === 'all' || tab.value === 'posts') && statuses.value.length > 0,
)
const showTags = computed(
  () => (tab.value === 'all' || tab.value === 'tags') && hashtags.value.length > 0,
)
const showServersResults = computed(
  () =>
    (tab.value === 'all' || tab.value === 'servers') &&
    hasQuery.value &&
    filteredInstances.value.length > 0,
)

const fediverseSearchEmpty = computed(() => {
  if (!hasQuery.value || searchBusy.value || searchError.value) return false
  if (tab.value === 'servers') return false
  if (tab.value === 'people') return !accounts.value.length
  if (tab.value === 'posts') return !statuses.value.length
  if (tab.value === 'tags') return !hashtags.value.length
  return !accounts.value.length && !statuses.value.length && !hashtags.value.length
})

const searchStatusText = computed(() => {
  if (!hasQuery.value) return ''
  if (searchBusy.value) return 'Searching…'
  if (searchError.value) return searchError.value
  if (!isSignedIn.value && tab.value !== 'servers') return ''
  const q = query.value.trim()
  const parts: string[] = []
  if (showPeople.value) parts.push(`${accounts.value.length} ${accounts.value.length === 1 ? 'person' : 'people'}`)
  if (showTags.value) parts.push(`${hashtags.value.length} ${hashtags.value.length === 1 ? 'tag' : 'tags'}`)
  if (showPosts.value) parts.push(`${statuses.value.length} ${statuses.value.length === 1 ? 'post' : 'posts'}`)
  if (showServersResults.value) {
    parts.push(`${filteredInstances.value.length} ${filteredInstances.value.length === 1 ? 'server' : 'servers'}`)
  }
  if (parts.length) return `${parts.join(', ')} for “${q}”`
  if (fediverseSearchEmpty.value) return `No results for “${q}”`
  return ''
})

const showStatusHint = computed(
  () => !!searchStatusText.value && !customError.value && !searchError.value,
)

const syncFromRoute = () => {
  // Leaving the page also changes the route — don't reset state on the way out
  if (route.path !== '/explore') return
  const q = typeof route.query.q === 'string' ? route.query.q : ''
  // persistRoute stores the trimmed query; echoing that back would eat the
  // space someone just typed ("hello " → "hello" mid-word)
  if (q !== query.value.trim()) query.value = q

  const t = route.query.tab
  const allowed = TABS.map((x) => x.id)
  if (typeof t === 'string' && (allowed as string[]).includes(t)) {
    tab.value = t as ExploreTab
  } else if (t == null) {
    // Bare /explore (nav link while already here) → back to the default tab
    tab.value = 'all'
  }
}

const persistRoute = () => {
  const nextQuery: Record<string, string> = {}
  if (query.value.trim()) nextQuery.q = query.value.trim()
  if (tab.value !== 'all') nextQuery.tab = tab.value
  const curQ = typeof route.query.q === 'string' ? route.query.q : ''
  const curTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (curQ === (nextQuery.q || '') && curTab === (nextQuery.tab || '')) return
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
  const meta = TABS.find((t) => t.id === next)
  if (meta?.needsAuth && !isSignedIn.value) {
    tab.value = next
    persistRoute()
    refocusSearch()
    return
  }
  tab.value = next
  customError.value = null
  searchError.value = null
  persistRoute()
  refocusSearch()
  // Search is driven by watch(tab) — avoid a double request here
}

const handleVisit = (domain: string) => {
  instancesStore.openPreview(domain)
}

/** Shared toast host — one polite live region, sits above the tab bar */
const showToast = (msg: string) => {
  toastStore.show({ message: msg, duration: 3200 })
}

const onWatched = (domain: string) => {
  showToast(`Watching ${domain} — browse public posts anytime`)
}

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

const onSearchEnter = () => {
  // Touch: drop the keyboard so the results aren't hidden behind it
  if (!window.matchMedia('(pointer: fine)').matches) searchInputRef.value?.blur()
  // A pending debounce would fire a plain search after this one and replace it
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
  persistRoute()
  if (tab.value === 'servers' || (tab.value === 'all' && looksLikeHostname(query.value))) {
    void lookUpCustom()
    return
  }
  void runFediverseSearch(query.value, { resolve: true })
}

const looksLikeHostname = (raw: string) => {
  const q = raw.trim().toLowerCase()
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(q) && !q.includes(' ')
}

const applyTopic = (tag: string) => {
  query.value = tag
  if (tab.value === 'servers') tab.value = 'all'
  persistRoute()
  void runFediverseSearch(tag)
  // The query watcher (pre-flush) has queued its debounce by now — drop it so
  // the topic isn't searched twice
  void nextTick(() => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = null
  })
  refocusSearch()
}

const goSignIn = () => router.push('/login')
const goAddAccount = () => router.push('/login?add=1')
const goGroups = () => router.push('/groups')

watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    if (tab.value !== 'servers') {
      void runFediverseSearch(q)
    } else {
      clearFediverseResults()
    }
    persistRoute()
  }, 260)
})

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
  } catch {
    toastStore.show({ message: 'Couldn’t update tag follow' })
  }
}

let loadMoreObserver: IntersectionObserver | null = null
const isMobileShell = useMobileViewport()
// Mobile scrolls `main`, not the window — observe against it so the prefetch
// margin works; rebind when the shell flips (iPad rotation across 1024px).
watch([loadMoreSentinel, isMobileShell], ([el]) => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  if (!el) return
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((x) => x.isIntersecting)) loadMoreSearch()
    },
    { root: getMainScroller(), rootMargin: '0px 0px 400px 0px' },
  )
  loadMoreObserver.observe(el)
}, { flush: 'post' })

// useFediverseSearch re-runs the search on tab / sign-in changes itself —
// doing it here too sent every request twice
watch(tab, () => {
  persistRoute()
})

onMounted(async () => {
  syncFromRoute()
  if (isSignedIn.value) {
    void groupsStore.initializeGroups()
  }
  nextTick(() => {
    // Fresh visit → ready to type. Arriving with a query (Back, shared link) →
    // show results; on touch that would put the keyboard over them.
    if (!hasQuery.value || window.matchMedia('(pointer: fine)').matches) {
      searchInputRef.value?.focus()
    }
    // Route sync already set query/tab. Skip the query debounce and search now —
    // unless a ?tab= change already started one via useFediverseSearch
    if (searchTimer) clearTimeout(searchTimer)
    if (hasQuery.value && tab.value !== 'servers' && !searchBusy.value) {
      void runFediverseSearch(query.value)
    }
  })
})

watch(
  () => [route.query.q, route.query.tab],
  () => syncFromRoute(),
)

useHead({
  title: 'Search | NeoSpace',
  meta: [
    {
      name: 'description',
      content: 'Search on NeoSpace.',
    },
  ],
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  loadMoreObserver?.disconnect()
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
        <div class="explore-search">
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
              @keydown.enter.prevent="onSearchEnter"
            />
          </label>
          <button
            v-if="tab === 'servers' || looksLikeHostname(query)"
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
          :tabs="TABS.map((t) => ({ id: t.id, label: t.label }))"
          :panels="false"
          controls-id="explore-results"
          id-prefix="explore-tabs"
          aria-label="Search in"
          @update:model-value="setTab($event as ExploreTab)"
        />
      </div>

      <p v-if="customError" class="explore-error" role="alert">{{ customError }}</p>
      <p v-else-if="searchError" class="explore-error" role="alert">{{ searchError }}</p>
    </div>

    <div
      id="explore-results"
      role="tabpanel"
      :aria-labelledby="`explore-tabs-tab-${tab}`"
      :aria-busy="searchBusy"
    >
    <!-- Result count reads at the top; it doesn't need to ride in the sticky bar -->
    <!-- Always mounted: a live region inserted along with its text is often not announced -->
    <p
      class="explore-hint explore-hint--status"
      :class="{ 'sr-only': !showStatusHint }"
      role="status"
      aria-live="polite"
    >
      {{ showStatusHint ? searchStatusText : '' }}
    </p>
    <div v-if="!isSignedIn" class="explore-cta-row">
      <a
        href="https://joinmastodon.org/servers"
        target="_blank"
        rel="noopener"
        class="neo-btn neo-btn--primary"
      >
        Create a free account
      </a>
      <NuxtLink to="/login" class="neo-btn neo-btn--ghost">I already have an account</NuxtLink>
      <p class="explore-cta-row__hint">
        Pick a server from the
        <a href="https://joinmastodon.org/servers" target="_blank" rel="noopener">joinmastodon directory</a>,
        then sign in here.
      </p>
    </div>

    <template v-if="!hasQuery">
      <section v-if="tab !== 'servers'" class="explore-discover">
        <div
          v-if="(tab === 'people' || tab === 'posts' || tab === 'tags') && !isSignedIn"
          class="explore-empty"
        >
          <p>Sign in to search {{ tab }}.</p>
          <button type="button" class="neo-btn neo-btn--primary" @click="goSignIn">
            Sign in
          </button>
        </div>

        <template v-else>
          <div class="explore-topics">
            <h2 class="explore-section-title">Topics</h2>
            <div class="explore-topic-row">
              <button
                v-for="topic in topicChips"
                :key="topic"
                type="button"
                class="explore-tag"
                @click="applyTopic(topic)"
              >
                #{{ topic }}
              </button>
            </div>
          </div>

          <div class="explore-do-more">
            <h2 class="explore-section-title">Suggestions</h2>
            <div class="explore-do-grid">
              <button type="button" class="explore-do-card" @click="setTab('people')">
                <strong>People</strong>
              </button>
              <button type="button" class="explore-do-card" @click="setTab('posts')">
                <strong>Posts</strong>
              </button>
              <button type="button" class="explore-do-card" @click="goGroups">
                <strong>Groups</strong>
              </button>
              <button type="button" class="explore-do-card" @click="setTab('servers')">
                <strong>Servers</strong>
              </button>
            </div>
          </div>

          <div v-if="tab === 'all'" class="explore-featured">
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
            <button type="button" class="explore-text-link" @click="setTab('servers')">
              See all →
            </button>
          </div>
        </template>
      </section>

      <template v-if="tab === 'servers'">
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

    <!-- Active search results -->
    <template v-else>
      <div
        v-if="!isSignedIn && tab !== 'servers'"
        class="explore-empty"
      >
        <p>Sign in to search people, posts, and tags.</p>
        <div class="explore-empty__actions">
          <button type="button" class="neo-btn neo-btn--primary" @click="goSignIn">
            Sign in
          </button>
          <button type="button" class="neo-btn neo-btn--ghost" @click="setTab('servers')">
            Servers
          </button>
        </div>
      </div>

      <template v-else>
        <section v-if="showPeople" class="explore-people">
          <h2 class="explore-section-title">People</h2>
          <ul class="explore-results-list">
          <li
            v-for="acct in accounts"
            :key="acct.id"
            class="explore-person-row"
          >
            <NuxtLink
              :to="{ path: '/profile', query: { user: acct.acct } }"
              class="explore-person"
            >
              <img :src="acct.avatar" alt="" class="explore-person__avatar" loading="lazy" />
              <span class="explore-person__meta">
                <strong>{{ acct.displayName || acct.username }}</strong>
                <em>@{{ acct.acct }}</em>
                <span v-if="relationships[acct.id]?.followedBy" class="explore-chip">Follows you</span>
                <span v-if="acct.note" class="explore-person__bio">{{ stripHtml(acct.note) }}</span>
              </span>
            </NuxtLink>
            <button
              v-if="isSignedIn"
              type="button"
              class="neo-btn neo-btn--sm"
              :class="relationships[acct.id]?.following || relationships[acct.id]?.requested ? 'neo-btn--secondary' : 'neo-btn--primary'"
              @click="handleFollowPerson(acct, $event)"
            >
              {{
                relationships[acct.id]?.following
                  ? 'Following'
                  : relationships[acct.id]?.requested
                    ? 'Requested'
                    : 'Follow'
              }}
            </button>
          </li>
          </ul>
        </section>

        <section v-if="showTags" class="explore-tags">
          <h2 class="explore-section-title">Tags</h2>
          <ul class="explore-results-list">
          <li
            v-for="tag in hashtags"
            :key="tag.name"
            class="explore-tag-row"
          >
            <NuxtLink
              :to="`/groups/${encodeURIComponent(tag.name.replace(/^#/, ''))}`"
              class="explore-tag-hit"
            >
              <strong>#{{ tag.name }}</strong>
              <span v-if="tagHistorySummary(tag)" class="explore-tag-hit__meta">{{ tagHistorySummary(tag) }}</span>
            </NuxtLink>
            <button
              v-if="isSignedIn"
              type="button"
              class="neo-btn neo-btn--sm"
              :class="followedTags.has(tag.name.toLowerCase()) ? 'neo-btn--secondary' : 'neo-btn--ghost'"
              @click="handleFollowTag(tag, $event)"
            >
              {{ followedTags.has(tag.name.toLowerCase()) ? 'Following' : 'Follow tag' }}
            </button>
          </li>
          </ul>
        </section>

        <section v-if="showPosts" class="explore-posts">
          <h2 class="explore-section-title">Posts</h2>
          <div class="explore-posts__list">
            <RealPostCard
              v-for="status in statuses"
              :key="status.id"
              :status="status"
            />
          </div>
        </section>

        <section v-if="showServersResults" class="explore-server-hits">
          <h2 class="explore-section-title">Servers</h2>
          <div class="explore-grid">
            <InstanceCard
              v-for="instance in filteredInstances"
              :key="instance.domain"
              :instance="instance"
              @visit="handleVisit"
              @watched="onWatched"
            />
          </div>
          <button
            v-if="tab === 'all'"
            type="button"
            class="neo-btn neo-btn--ghost explore-wrap-btn"
            :disabled="customBusy"
            @click="lookUpCustom"
          >
            Look up “{{ query }}” as a server name
          </button>
        </section>

        <div
          v-if="tab === 'servers' && filteredInstances.length === 0"
          class="explore-empty"
        >
          <p>No curated servers match that search.</p>
          <button type="button" class="neo-btn neo-btn--ghost" @click="lookUpCustom">
            Look up “{{ query }}” as a server name
          </button>
        </div>

        <div v-else-if="fediverseSearchEmpty" class="explore-empty">
          <p>Nothing matched “{{ query }}” here.</p>
          <div class="explore-empty__actions">
            <button
              v-if="tab !== 'servers'"
              type="button"
              class="neo-btn neo-btn--ghost"
              @click="setTab('servers')"
            >
              Try servers
            </button>
            <button type="button" class="neo-btn neo-btn--ghost" @click="lookUpCustom">
              Look up as hostname
            </button>
          </div>
        </div>

        <div
          v-if="searchHasMore && hasQuery && tab !== 'servers' && isSignedIn"
          ref="loadMoreSentinel"
          class="explore-loadmore"
          role="status"
          aria-live="polite"
          :aria-busy="loadMoreBusy"
        >
          {{ loadMoreBusy ? 'Loading more…' : 'Scroll for more' }}
        </div>
      </template>
    </template>

    <section class="explore-help">
      <h2 class="explore-section-title explore-help__heading">Get started</h2>
      <div v-if="!isSignedIn" class="explore-help__card">
        <h3>Sign in</h3>
        <button type="button" class="explore-text-link" @click="goSignIn">Continue →</button>
      </div>
      <div v-if="isSignedIn" class="explore-help__card">
        <h3>Link more</h3>
        <button type="button" class="explore-text-link" @click="goAddAccount">
          Add server →
        </button>
      </div>
      <div class="explore-help__card">
        <h3>Watch</h3>
        <p>Public timelines, no account.</p>
      </div>
      <div class="explore-help__card explore-help__card--wide">
        <h3>Host</h3>
        <div class="explore-help__links">
          <a
            href="https://joinmastodon.org/hosting"
            target="_blank"
            rel="noopener"
            class="explore-text-link"
          >
            Official →
          </a>
          <a
            href="https://masto.host/"
            target="_blank"
            rel="noopener"
            class="explore-text-link"
          >
            Masto.host →
          </a>
          <a
            href="https://docs.joinmastodon.org/user/run-your-own/"
            target="_blank"
            rel="noopener"
            class="explore-text-link"
          >
            Self-host →
          </a>
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

.explore-results-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.explore-wrap-btn {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.explore-person-row,
.explore-tag-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--neo-border-color);
}

.explore-chip {
  display: inline-block;
  margin-top: 0.15rem;
  padding: 0.05rem 0.4rem;
  font-size: 0.6875rem;
  font-weight: 600;
  font-style: normal;
  color: var(--neo-text-secondary);
  background: var(--neo-accent-soft);
  border-radius: 999px;
}

.explore-tag-hit {
  flex: 1;
  min-width: 0;
  padding: 0.35rem 0;
  text-decoration: none;
  color: inherit;

  strong {
    display: block;
    color: var(--neo-accent);
    overflow-wrap: anywhere;
  }

  &__meta {
    display: block;
    margin-top: 0.15rem;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }
}

.explore-loadmore {
  padding: 1rem 0;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.explore-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0.5rem 0.9rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid transparent;

  &--primary {
    color: var(--neo-text-on-accent, #fafaf8);
    background: var(--neo-accent);
    border-color: var(--neo-accent);

    &:hover {
      background: var(--neo-accent-hover);
    }
  }

  &--ghost {
    color: var(--neo-text-secondary);
    background: transparent;
    border-color: var(--neo-border-color-dark);

    &:hover {
      border-color: var(--neo-accent);
      color: var(--neo-accent);
    }
  }
}

.explore-discover {
  margin-bottom: 1.5rem;
}

.explore-topics,
.explore-do-more,
.explore-featured {
  margin-bottom: 1.75rem;
}

.explore-topic-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
}

.explore-do-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.65rem;
}

.explore-do-card {
  display: flex;
  align-items: center;
  padding: 0.7rem 0.95rem;
  text-align: left;
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  background: var(--neo-bg-card);
  color: inherit;
  cursor: pointer;

  strong {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  &:hover {
    border-color: var(--neo-accent);
  }
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
.explore-server-hits {
  margin-bottom: 1.5rem;
}

.explore-person {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  flex: 1;
  min-width: 0;
  padding: 0.35rem 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--neo-text-primary) 4%, transparent);
  }

  &__avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--neo-bg-tertiary);
  }

  &__meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    // Long display names / @user@very.long.host handles at 320px
    overflow-wrap: anywhere;

    strong {
      font-size: 0.9375rem;
      color: var(--neo-text-primary);
    }

    em {
      font-style: normal;
      font-size: 0.8125rem;
      color: var(--neo-text-tertiary);
    }
  }

  &__bio {
    margin-top: 0.2rem;
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
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

.explore-catalog-note {
  margin: 0.5rem 0 1.25rem;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-muted);

  a {
    color: var(--neo-accent);
    font-weight: 600;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
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

@media (min-width: 1024px) {
  .explore-page {
    padding: 2rem 1.5rem 3rem;
  }
}
</style>
