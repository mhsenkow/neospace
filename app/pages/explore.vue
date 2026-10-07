<script setup lang="ts">
/**
 * Explore / Search — people, posts, tags, and servers.
 */

import type { mastodon } from 'masto'
import { useCuratedInstances } from '~/composables/useCuratedInstances'
import { useInstancesStore } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import { activeClient } from '~/composables/useMasto'
import { normalizeServer, friendlyServerError } from '~/utils/instances'
import { stripHtml } from '~/utils/sanitizeHtml'

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
const router = useRouter()
const route = useRoute()

const selectedCategory = ref('all')
const query = ref('')
const tab = ref<ExploreTab>('all')
const customError = ref<string | null>(null)
const customBusy = ref(false)
const watchToast = ref<string | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

const searchBusy = ref(false)
const searchError = ref<string | null>(null)
const accounts = ref<mastodon.v1.Account[]>([])
const statuses = ref<mastodon.v1.Status[]>([])
const hashtags = ref<mastodon.v1.Tag[]>([])
let searchTimer: ReturnType<typeof setTimeout> | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

const isSignedIn = computed(() => instancesStore.hasAuthenticatedInstance)
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
  if (!hasQuery.value || searchBusy.value) return false
  if (tab.value === 'servers') return false
  if (tab.value === 'people') return !accounts.value.length
  if (tab.value === 'posts') return !statuses.value.length
  if (tab.value === 'tags') return !hashtags.value.length
  return !accounts.value.length && !statuses.value.length && !hashtags.value.length
})

const syncFromRoute = () => {
  const q = route.query.q
  if (typeof q === 'string') query.value = q

  const t = route.query.tab
  const allowed = TABS.map((x) => x.id)
  if (typeof t === 'string' && (allowed as string[]).includes(t)) {
    tab.value = t as ExploreTab
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

const setTab = (next: ExploreTab) => {
  const meta = TABS.find((t) => t.id === next)
  if (meta?.needsAuth && !isSignedIn.value) {
    tab.value = next
    persistRoute()
    nextTick(() => searchInputRef.value?.focus())
    return
  }
  tab.value = next
  customError.value = null
  searchError.value = null
  persistRoute()
  nextTick(() => searchInputRef.value?.focus())
  if (hasQuery.value) void runFediverseSearch(query.value)
}

const handleVisit = (domain: string) => {
  instancesStore.openPreview(domain)
}

const showToast = (msg: string) => {
  watchToast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    watchToast.value = null
  }, 3200)
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

const clearFediverseResults = () => {
  accounts.value = []
  statuses.value = []
  hashtags.value = []
  searchError.value = null
}

const runFediverseSearch = async (q: string) => {
  const trimmed = q.trim()
  if (trimmed.length < 2) {
    clearFediverseResults()
    return
  }
  if (tab.value === 'servers') {
    clearFediverseResults()
    return
  }
  if (!isSignedIn.value) {
    clearFediverseResults()
    return
  }

  searchBusy.value = true
  searchError.value = null
  try {
    const client = activeClient()
    const type =
      tab.value === 'people'
        ? 'accounts'
        : tab.value === 'posts'
          ? 'statuses'
          : tab.value === 'tags'
            ? 'hashtags'
            : undefined

    const res = await client.v2.search.fetch({
      q: trimmed,
      limit: 16,
      resolve: true,
      ...(type ? { type } : {}),
    } as any)

    accounts.value = res.accounts || []
    statuses.value = res.statuses || []
    hashtags.value = res.hashtags || []
  } catch (e: any) {
    searchError.value = e?.message || 'Search failed'
    clearFediverseResults()
  } finally {
    searchBusy.value = false
  }
}

const onSearchEnter = () => {
  if (tab.value === 'servers' || looksLikeHostname(query.value)) {
    void lookUpCustom()
    return
  }
  void runFediverseSearch(query.value)
}

const looksLikeHostname = (raw: string) => {
  const q = raw.trim().toLowerCase()
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(q) && !q.includes(' ')
}

const openAccount = (acct: string) => {
  router.push({ path: '/profile', query: { user: acct } })
}

const openHashtag = (tag: string) => {
  router.push(`/groups/${encodeURIComponent(tag.replace(/^#/, ''))}`)
}

const applyTopic = (tag: string) => {
  query.value = tag
  if (tab.value === 'servers') tab.value = 'all'
  void runFediverseSearch(tag)
  persistRoute()
  nextTick(() => searchInputRef.value?.focus())
}

const goSignIn = () => router.push('/login')
const goAddAccount = () => router.push('/login?add=1')
const goGroups = () => router.push('/groups')

watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (tab.value !== 'servers') {
    searchTimer = setTimeout(() => {
      void runFediverseSearch(q)
    }, 260)
  } else {
    clearFediverseResults()
  }
  persistRoute()
})

watch(tab, () => {
  if (hasQuery.value && tab.value !== 'servers') void runFediverseSearch(query.value)
})

watch(isSignedIn, (ok) => {
  if (!ok && ['people', 'posts', 'tags'].includes(tab.value) && !hasQuery.value) {
    /* keep tab so they see the sign-in empty state */
  }
  if (ok && hasQuery.value) void runFediverseSearch(query.value)
})

onMounted(async () => {
  syncFromRoute()
  if (isSignedIn.value) {
    void groupsStore.initializeGroups()
  }
  nextTick(() => {
    searchInputRef.value?.focus()
    if (hasQuery.value && tab.value !== 'servers') void runFediverseSearch(query.value)
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
  if (toastTimer) clearTimeout(toastTimer)
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div class="explore-page">
    <header class="explore-hero">
      <h1>Search</h1>
    </header>

    <div class="explore-search-block">
      <div class="explore-search-row">
        <label class="explore-search">
          <NeoIcon name="search" :size="20" :stroke="1.75" class="explore-search__icon" />
          <span class="sr-only">Search</span>
          <input
            ref="searchInputRef"
            v-model="query"
            type="search"
            :placeholder="searchPlaceholder"
            autocomplete="off"
            @keydown.enter.prevent="onSearchEnter"
          />
          <button
            v-if="tab === 'servers' || looksLikeHostname(query)"
            type="button"
            class="explore-search__go"
            :disabled="customBusy || !query.trim()"
            @click="lookUpCustom"
          >
            {{ customBusy ? '…' : 'Look up' }}
          </button>
        </label>

        <div class="explore-modes" role="tablist" aria-label="Search type">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            role="tab"
            class="explore-mode"
            :class="{ 'explore-mode--on': tab === t.id }"
            :aria-selected="tab === t.id"
            :title="t.tip"
            :aria-label="`${t.label}: ${t.tip}`"
            @click="setTab(t.id)"
          >
            {{ t.label }}
          </button>
        </div>
      </div>

      <p v-if="customError" class="explore-error" role="alert">{{ customError }}</p>
      <p v-else-if="searchError" class="explore-error" role="alert">{{ searchError }}</p>
    </div>

    <div v-if="!isSignedIn" class="explore-cta-row">
      <a
        href="https://joinmastodon.org/servers"
        target="_blank"
        rel="noopener"
        class="explore-btn explore-btn--primary"
      >
        Create a free account
      </a>
      <NuxtLink to="/login" class="explore-btn explore-btn--ghost">I already have an account</NuxtLink>
    </div>

    <template v-if="!hasQuery">
      <section v-if="tab !== 'servers'" class="explore-discover">
        <div
          v-if="(tab === 'people' || tab === 'posts' || tab === 'tags') && !isSignedIn"
          class="explore-empty"
        >
          <p>Sign in to search {{ tab }}.</p>
          <button type="button" class="explore-btn explore-btn--primary" @click="goSignIn">
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

          <div v-if="tab === 'all' || tab === 'servers'" class="explore-featured">
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
            @click="selectedCategory = cat.id"
          >
            {{ cat.label }}
          </button>
        </nav>

        <section class="explore-grid">
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
      <p v-if="searchBusy" class="explore-hint">Searching…</p>

      <div
        v-if="!isSignedIn && tab !== 'servers'"
        class="explore-empty"
      >
        <p>Sign in to search people, posts, and tags.</p>
        <div class="explore-empty__actions">
          <button type="button" class="explore-btn explore-btn--primary" @click="goSignIn">
            Sign in
          </button>
          <button type="button" class="explore-btn explore-btn--ghost" @click="setTab('servers')">
            Servers
          </button>
        </div>
      </div>

      <template v-else>
        <section v-if="showPeople" class="explore-people">
          <h2 class="explore-section-title">People</h2>
          <button
            v-for="acct in accounts"
            :key="acct.id"
            type="button"
            class="explore-person"
            @click="openAccount(acct.acct)"
          >
            <img :src="acct.avatar" alt="" class="explore-person__avatar" loading="lazy" />
            <span class="explore-person__meta">
              <strong>{{ acct.displayName || acct.username }}</strong>
              <em>@{{ acct.acct }}</em>
              <span v-if="acct.note" class="explore-person__bio">{{ stripHtml(acct.note) }}</span>
            </span>
          </button>
          <button
            v-if="tab === 'all' && accounts.length >= 8"
            type="button"
            class="explore-text-link"
            @click="setTab('people')"
          >
            More people →
          </button>
        </section>

        <section v-if="showTags" class="explore-people">
          <h2 class="explore-section-title">Tags</h2>
          <button
            v-for="tag in hashtags"
            :key="tag.name"
            type="button"
            class="explore-tag"
            @click="openHashtag(tag.name)"
          >
            #{{ tag.name }}
          </button>
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
            class="explore-btn explore-btn--ghost"
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
          <button type="button" class="explore-btn explore-btn--ghost" @click="lookUpCustom">
            Look up “{{ query }}” as a server name
          </button>
        </div>

        <div v-else-if="fediverseSearchEmpty" class="explore-empty">
          <p>Nothing matched “{{ query }}” here.</p>
          <div class="explore-empty__actions">
            <button
              v-if="tab !== 'servers'"
              type="button"
              class="explore-btn explore-btn--ghost"
              @click="setTab('servers')"
            >
              Try servers
            </button>
            <button type="button" class="explore-btn explore-btn--ghost" @click="lookUpCustom">
              Look up as hostname
            </button>
          </div>
        </div>
      </template>
    </template>

    <p class="explore-catalog-note">
      <a href="https://joinmastodon.org/servers" target="_blank" rel="noopener">Directory</a>
      · type a hostname to look it up.
    </p>

    <section class="explore-help">
      <div v-if="!isSignedIn" class="explore-help__card">
        <h3>Create</h3>
        <a
          href="https://joinmastodon.org/servers"
          target="_blank"
          rel="noopener"
          class="explore-text-link"
        >
          Directory →
        </a>
      </div>
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

    <InstancePreview @watched="onWatched" />

    <Teleport to="body">
      <Transition name="toast-fade">
        <div v-if="watchToast" class="explore-toast">{{ watchToast }}</div>
      </Transition>
    </Teleport>
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
}

.explore-search-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.explore-modes {
  display: flex;
  flex-shrink: 0;
  flex-wrap: nowrap;
  gap: 0.15rem;
  padding: 0.2rem;
  border-radius: 10px;
  background: var(--neo-bg-secondary, var(--neo-bg-tertiary));
  border: 1px solid var(--neo-border-color);
  max-width: 100%;
}

.explore-mode {
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
  cursor: pointer;

  &:hover {
    color: var(--neo-text-primary);
  }

  &--on {
    background: var(--neo-bg-card, var(--neo-bg-primary));
    color: var(--neo-text-primary);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--neo-text-primary) 12%, transparent);
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
      color: var(--neo-text-disabled);
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
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .explore-mode {
    flex: 1 0 auto;
    text-align: center;
  }
}

.explore-search__go {
  flex-shrink: 0;
  min-height: 2.4rem;
  padding: 0 1rem;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--neo-text-inverse, #fafaf8);
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
    color: var(--neo-text-inverse, #fafaf8);
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
    color: var(--neo-text-inverse, #fafaf8);
    background: var(--neo-accent);
    border-color: var(--neo-accent);
  }
}

.explore-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
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
  font-size: 0.875rem;
  color: var(--neo-text-muted);
}

.explore-section-title {
  margin: 0 0 0.55rem;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--neo-text-quaternary);
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
  width: 100%;
  padding: 0.65rem 0.15rem;
  border: none;
  border-bottom: 1px solid var(--neo-border-color);
  background: transparent;
  color: inherit;
  text-align: left;
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

.explore-toast {
  position: fixed;
  bottom: 5.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  padding: 0.65rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--neo-text-primary);
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);

  @media (min-width: 1024px) {
    bottom: 2rem;
  }
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (min-width: 1024px) {
  .explore-page {
    padding: 2rem 1.5rem 3rem;
  }
}
</style>
