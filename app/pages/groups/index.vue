<script setup lang="ts">
/**
 * Groups Page — Threads-style discovery hub.
 * Horizontal “your groups” + “suggested” rails, then browse by category.
 */

import { useGroupsStore, GROUP_CATEGORIES } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'

const groupsStore = useGroupsStore()
const instancesStore = useInstancesStore()
const router = useRouter()

const selectedCategory = ref('all')
const searchQuery = ref('')
const searchResults = ref<any[]>([])
const isSearching = ref(false)

onMounted(async () => {
  await groupsStore.initializeGroups()
})

const filteredGroups = computed(() => groupsStore.getByCategory(selectedCategory.value))
const joinedGroups = computed(() => groupsStore.joinedGroups)
const recommendedGroups = computed(() => groupsStore.suggestedFeaturedGroups)
const trendingGroups = computed(() =>
  groupsStore.trendingGroups.filter((g) => !g.isMember).slice(0, 10),
)

const trendingServerLabel = computed(() => {
  const url =
    instancesStore.activeAccount?.url ||
    instancesStore.instances[0]?.url ||
    ''
  if (!url) return 'your server'
  try {
    return new URL(url).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'your server'
  }
})

const handleSearch = async () => {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }

  isSearching.value = true
  try {
    searchResults.value = await groupsStore.searchGroups(searchQuery.value)
  } finally {
    isSearching.value = false
  }
}

let searchTimeout: ReturnType<typeof setTimeout>
watch(searchQuery, (val) => {
  clearTimeout(searchTimeout)
  if (val.trim()) {
    searchTimeout = setTimeout(handleSearch, 300)
  } else {
    searchResults.value = []
  }
})

const viewGroup = (tag: string) => {
  router.push(`/groups/${tag}`)
}

const categoryColor = (category: string) => {
  const colors: Record<string, string> = {
    tech: '#c45c26',
    creative: '#b8860b',
    gaming: '#2f7d4a',
    social: '#a84c1e',
    news: '#3a6ea5',
    trending: '#c45c26',
    local: '#757575',
    other: '#757575',
  }
  return colors[category] || colors.other
}

useHead({
  title: 'Groups',
  titleTemplate: '%s | NeoSpace',
  meta: [
    { name: 'description', content: 'Join communities and discover groups on NeoSpace.' },
  ],
})
</script>

<template>
  <div class="groups-page">
    <header class="groups-hero">
      <div class="hero-content">
        <h1>Groups</h1>
      </div>
    </header>

    <div v-if="!instancesStore.isAuthenticated" class="login-notice login-notice--top">
      <div class="notice-content">
        <span class="notice-icon"><NeoIcon name="lock" :size="22" :stroke="1.75" /></span>
        <div>
          <h3>Log in to join groups</h3>
          <p>
            Browse freely — sign in to join and see group posts in your home feed.
          </p>
        </div>
        <NuxtLink to="/login" class="notice-btn">Log in</NuxtLink>
      </div>
    </div>

    <div class="groups-main">
      <!-- Search -->
      <div class="groups-search">
        <div class="search-input-wrapper">
          <span class="search-icon" aria-hidden="true">
            <NeoIcon name="search" :size="18" :stroke="1.75" />
          </span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Search any hashtag — baking, horror, vinyl…"
            class="search-input"
            aria-label="Search groups"
          />
          <span v-if="isSearching" class="search-loading" role="status" aria-live="polite">Searching…</span>
        </div>
        <p
          v-if="searchQuery.trim() && isSearching"
          class="sr-only"
          role="status"
          aria-live="polite"
        >
          Searching groups…
        </p>
      </div>

      <!-- Search Results -->
      <section v-if="searchQuery.trim() && isSearching && searchResults.length === 0" class="groups-section">
        <div class="loading-state" aria-busy="true">
          <FunLoader fill label="Searching groups" />
        </div>
      </section>

      <section v-else-if="searchQuery.trim() && !isSearching && searchResults.length === 0" class="groups-section">
        <div class="empty-state">
          <span class="empty-emoji" aria-hidden="true">🔍</span>
          <p>No groups match “{{ searchQuery.trim() }}”.</p>
        </div>
      </section>

      <section v-else-if="searchResults.length > 0" class="groups-section">
        <h2 class="section-title">Search results</h2>
        <div class="groups-grid">
          <GroupCard
            v-for="group in searchResults"
            :key="group.tag"
            :group="group"
            @view="viewGroup"
          />
        </div>
      </section>

      <template v-if="!searchQuery">
        <!-- Your groups — quick jump (Threads hub style) -->
        <section
          v-if="instancesStore.isAuthenticated && joinedGroups.length > 0"
          class="groups-rail-section"
        >
          <div class="section-heading">
            <h2 class="section-title">Your groups</h2>
            <span class="section-count">{{ joinedGroups.length }}</span>
          </div>
          <div class="groups-jump" role="list">
            <button
              v-for="group in joinedGroups"
              :key="group.tag"
              type="button"
              class="jump-chip"
              role="listitem"
              :title="`Open ${group.name}`"
              @click="viewGroup(group.tag)"
            >
              <span
                class="jump-chip__icon"
                :style="{ backgroundColor: categoryColor(group.category) + '28' }"
              >
                {{ group.icon }}
              </span>
              <span class="jump-chip__name">{{ group.name }}</span>
            </button>
          </div>
        </section>

        <!-- Suggested for you -->
        <section
          v-if="recommendedGroups.length > 0"
          class="groups-rail-section"
        >
          <div class="section-heading">
            <h2 class="section-title">Suggested</h2>
          </div>
          <div class="groups-rail" role="list">
            <GroupCard
              v-for="group in recommendedGroups"
              :key="group.tag"
              :group="group"
              tile
              role="listitem"
              @view="viewGroup"
            />
          </div>
        </section>

        <!-- Trending on your server -->
        <section
          v-if="trendingGroups.length > 0"
          class="groups-rail-section"
        >
          <div class="section-heading">
            <h2 class="section-title">Trending on {{ trendingServerLabel }}</h2>
          </div>
          <div class="groups-rail" role="list">
            <GroupCard
              v-for="group in trendingGroups"
              :key="`trend-${group.tag}`"
              :group="group"
              tile
              role="listitem"
              @view="viewGroup"
            />
          </div>
        </section>

        <!-- Browse all -->
        <section class="groups-section">
          <div class="section-heading">
            <h2 class="section-title">Browse</h2>
          </div>

          <nav class="category-nav" aria-label="Group categories">
            <button
              v-for="cat in GROUP_CATEGORIES"
              :key="cat.id"
              type="button"
              :class="['category-btn', { active: selectedCategory === cat.id }]"
              :aria-pressed="selectedCategory === cat.id"
              @click="selectedCategory = cat.id"
            >
              <span class="cat-emoji" aria-hidden="true">{{ cat.emoji }}</span>
              <span class="cat-label">{{ cat.label }}</span>
            </button>
          </nav>

          <div v-if="groupsStore.isLoading" class="loading-state" aria-busy="true">
            <FunLoader fill label="Loading groups" />
          </div>

          <div v-else-if="filteredGroups.length === 0" class="empty-state">
            <span class="empty-emoji">😕</span>
            <p>No groups found in this category.</p>
          </div>

          <TransitionGroup
            v-else
            name="card"
            tag="div"
            class="groups-grid"
          >
            <GroupCard
              v-for="group in filteredGroups"
              :key="group.tag"
              :group="group"
              @view="viewGroup"
            />
          </TransitionGroup>
        </section>
      </template>

    </div>
  </div>
</template>

<style lang="scss" scoped>
.groups-page {
  width: 100%;
  max-width: min(100%, 1100px);
  margin: 0 auto;
  padding: 0 0.75rem 4rem;
  box-sizing: border-box;

  @media (min-width: 480px) {
    padding: 0 1.25rem 5rem;
  }

  @media (min-width: 1024px) {
    padding: 0 1.5rem 4rem;
  }
}

.groups-hero {
  padding: 1rem 0 0.75rem;
  margin-bottom: 0.35rem;
}

.hero-content {
  max-width: 36rem;
}

.groups-hero h1 {
  font-size: 1.5rem;
  font-weight: 650;
  color: var(--neo-text-primary);
  margin: 0;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.groups-main {
  min-width: 0;
  width: 100%;
  padding-top: 1.15rem;
}

.groups-search {
  margin-bottom: 1.35rem;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 36rem;
}

.search-icon {
  position: absolute;
  left: 0.9rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--neo-text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  min-height: 44px;
  padding: 0.75rem 2.5rem 0.75rem 2.5rem;
  font-size: 1rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  color: var(--neo-text-primary);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
    box-shadow: 0 0 0 3px var(--neo-accent-soft);
  }

  &::placeholder {
    color: var(--neo-text-muted);
  }
}

.search-loading {
  position: absolute;
  right: 1rem;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.section-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.65rem;
  margin-bottom: 0.85rem;
}

.section-title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
  color: var(--neo-text-primary);
  letter-spacing: -0.02em;
}

.section-lede {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.section-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-muted);
  background: var(--neo-bg-tertiary);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
}

.groups-rail-section {
  margin-bottom: 1.75rem;
}

.groups-jump,
.groups-rail {
  display: flex;
  gap: 0.75rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  overscroll-behavior-x: contain;
  margin: 0 -0.75rem;
  padding: 0.15rem 0.75rem 0.35rem;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 480px) {
    margin: 0 -1.25rem;
    padding-left: 1.25rem;
    padding-right: 1.25rem;
  }

  @media (min-width: 1024px) {
    margin: 0;
    padding-left: 0;
    padding-right: 0;
  }
}

.groups-rail {
  gap: 0.85rem;
  padding-bottom: 0.5rem;
}

.jump-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  width: 4.75rem;
  flex: 0 0 auto;
  padding: 0.25rem;
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  scroll-snap-align: start;
  -webkit-tap-highlight-color: transparent;

  &:hover .jump-chip__icon,
  &:focus-visible .jump-chip__icon {
    transform: scale(1.05);
    border-color: var(--neo-accent);
  }
}

.jump-chip__icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  border: 2px solid var(--neo-border-color);
  background: var(--neo-bg-secondary);
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.jump-chip__name {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}

.groups-section {
  margin-bottom: 1.5rem;
}

.category-nav {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.5rem;
  margin: 0 -0.75rem 1.15rem;
  padding: 0 0.75rem 0.35rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  overscroll-behavior-x: contain;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 720px) {
    flex-wrap: wrap;
    overflow-x: visible;
    margin: 0 0 1.25rem;
    padding: 0;
  }
}

.category-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 36px;
  padding: 0.375rem 0.875rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
  font-size: 0.8125rem;
  flex: 0 0 auto;
  white-space: nowrap;

  .cat-emoji {
    font-size: 0.875rem;
    line-height: 1;
  }

  .cat-label {
    color: var(--neo-text-primary);
    font-weight: 500;
  }

  &:hover {
    border-color: var(--neo-accent);
  }

  &.active {
    background: var(--neo-accent);
    border-color: var(--neo-accent);

    .cat-label {
      color: var(--neo-text-inverse);
    }
  }
}

.groups-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @media (min-width: 560px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  @media (min-width: 960px) {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
}

.card-enter-active,
.card-leave-active {
  transition: all 0.3s ease;
}

.card-enter-from {
  opacity: 0;
  transform: scale(0.95) translateY(10px);
}

.card-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.card-move {
  transition: transform 0.3s ease;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  text-align: center;
  min-height: min(55dvh, 28rem);
  padding: 1.25rem;
  box-sizing: border-box;
  color: var(--neo-text-muted);
}

.empty-state {
  align-items: center;
  padding: 2.5rem 1.5rem;
}

.empty-emoji {
  font-size: 2.5rem;
  display: block;
  margin-bottom: 0.75rem;
}

.login-notice {
  margin-top: 1.5rem;

  &--top {
    margin-top: 0;
    margin-bottom: 1rem;
  }
  padding: 1rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
}

.notice-content {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  flex-wrap: wrap;

  @media (min-width: 600px) {
    align-items: center;
    flex-wrap: nowrap;
  }
}

.notice-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.notice-content h3 {
  margin: 0 0 0.125rem;
  font-size: 0.9375rem;
  color: var(--neo-text-primary);
}

.notice-content p {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
  line-height: 1.5;
}

.notice-btn {
  flex-shrink: 0;
  width: 100%;
  padding: 0.55rem 1.25rem;
  background: var(--neo-accent);
  color: var(--neo-text-inverse);
  text-decoration: none;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.875rem;
  text-align: center;

  @media (min-width: 600px) {
    width: auto;
  }

  &:hover {
    filter: brightness(1.08);
  }
}
</style>
