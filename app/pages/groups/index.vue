<script setup lang="ts">
/**
 * Groups Page
 * 
 * Browse and discover groups - a friendly interface that hides
 * the fact that groups are really just hashtags underneath.
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

// Initialize groups on mount
onMounted(async () => {
  await groupsStore.initializeGroups()
})

// Filtered groups by category
const filteredGroups = computed(() => {
  return groupsStore.getByCategory(selectedCategory.value)
})

// Joined groups (for sidebar)
const joinedGroups = computed(() => groupsStore.joinedGroups)

// Handle search
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

// Debounced search
let searchTimeout: ReturnType<typeof setTimeout>
watch(searchQuery, (val) => {
  clearTimeout(searchTimeout)
  if (val.trim()) {
    searchTimeout = setTimeout(handleSearch, 300)
  } else {
    searchResults.value = []
  }
})

// Navigate to group detail
const viewGroup = (tag: string) => {
  router.push(`/groups/${tag}`)
}

// Page meta
useHead({
  title: 'Groups - NeoSpace',
  meta: [
    { name: 'description', content: 'Join communities and discover groups on NeoSpace.' }
  ]
})
</script>

<template>
  <div class="groups-page">
    <!-- Hero Section -->
    <header class="groups-hero">
      <div class="hero-content">
        <p class="hero-kicker">Communities</p>
        <h1>Groups</h1>
        <p class="hero-subtitle">
          Groups are hashtags with a friendlier face. Browse curated picks, what’s
          trending on your server, or search any tag — the range is as wide as the network.
        </p>
      </div>
    </header>

    <div class="groups-layout">
      <!-- Sidebar: Your Groups -->
      <aside v-if="instancesStore.isAuthenticated && joinedGroups.length > 0" class="groups-sidebar">
        <h2 class="sidebar-title">Your Groups</h2>
        <div class="joined-groups">
          <GroupCard
            v-for="group in joinedGroups"
            :key="group.tag"
            :group="group"
            compact
            @view="viewGroup"
          />
        </div>
      </aside>

      <!-- Main Content -->
      <main class="groups-main">
        <!-- Search -->
        <div class="groups-search">
          <div class="search-input-wrapper">
            <span class="search-icon">🔍</span>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Any hashtag — try #baking, #horror, #vinyl…"
              class="search-input"
            />
            <span v-if="isSearching" class="search-loading">...</span>
          </div>
        </div>

        <!-- Search Results -->
        <section v-if="searchResults.length > 0" class="search-results">
          <h2 class="section-title">Search Results</h2>
          <div class="groups-grid">
            <GroupCard
              v-for="group in searchResults"
              :key="group.tag"
              :group="group"
              @view="viewGroup"
            />
          </div>
        </section>

        <!-- Category Filter -->
        <nav v-if="!searchQuery" class="category-nav">
          <button
            v-for="cat in GROUP_CATEGORIES"
            :key="cat.id"
            :class="['category-btn', { active: selectedCategory === cat.id }]"
            @click="selectedCategory = cat.id"
          >
            <span class="cat-emoji">{{ cat.emoji }}</span>
            <span class="cat-label">{{ cat.label }}</span>
          </button>
        </nav>

        <!-- Groups Grid -->
        <section v-if="!searchQuery" class="groups-section">
          <div v-if="groupsStore.isLoading" class="loading-state">
            <span class="loading-spinner">🌀</span>
            <p>Loading groups...</p>
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

        <!-- Not Logged In Notice -->
        <div v-if="!instancesStore.isAuthenticated" class="login-notice">
          <div class="notice-content">
            <span class="notice-icon">🔐</span>
            <div>
              <h3>Log in to join groups</h3>
              <p>You can browse groups without an account, but you'll need to log in to join them and see group content in your home feed.</p>
            </div>
            <NuxtLink to="/login" class="notice-btn">Log In</NuxtLink>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.groups-page {
  width: 100%;
  max-width: min(100%, 1400px);
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

// Hero Section
.groups-hero {
  position: relative;
  text-align: left;
  padding: 1.5rem 0 1.25rem;
  margin-bottom: 1.25rem;
  background: transparent;
  border-bottom: 1px solid var(--neo-border-color);

  @media (min-width: 768px) {
    padding: 2rem 0 1.5rem;
    margin-bottom: 1.75rem;
  }
}

.hero-content {
  position: relative;
  z-index: 2;
  max-width: 42rem;
}

.hero-kicker {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--neo-accent);
  margin: 0 0 0.5rem;
}

.groups-hero h1 {
  font-size: clamp(1.75rem, 4vw, 2.75rem);
  font-weight: 700;
  color: var(--neo-text-primary);
  margin: 0 0 0.5rem;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.hero-subtitle {
  color: var(--neo-text-muted);
  font-size: clamp(0.875rem, 2vw, 1.0625rem);
  line-height: 1.5;
  max-width: 40ch;
  margin: 0;
}

// Layout
.groups-layout {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: 1fr;
  align-items: start;

  @media (min-width: 1100px) {
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
    gap: 2rem;
  }
}

// Sidebar
.groups-sidebar {
  position: sticky;
  top: 1rem;

  @media (max-width: 1099px) {
    display: none;
  }
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--neo-text-secondary);
  margin: 0 0 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.joined-groups {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

// Main Content
.groups-main {
  min-width: 0;
  width: 100%;
}

// Search
.groups-search {
  margin-bottom: 1rem;

  @media (min-width: 768px) {
    margin-bottom: 1.25rem;
  }
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 40rem;
}

.search-icon {
  position: absolute;
  left: 0.875rem;
  font-size: 1rem;
  opacity: 0.55;
  pointer-events: none;
}

.search-input {
  width: 100%;
  min-height: 44px;
  padding: 0.75rem 2.5rem 0.75rem 2.5rem;
  font-size: 1rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
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

// Search Results
.search-results {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--neo-text-primary);
  margin: 0 0 1rem;
}

// Category Navigation — swipe on phones, wrap on wider
.category-nav {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.5rem;
  margin: 0 -0.75rem 1.25rem;
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
    margin: 0 0 1.5rem;
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
  border-radius: 4px;
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

// Groups Grid — real multi-column once TransitionGroup is the grid root
.groups-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @media (min-width: 560px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  @media (min-width: 960px) {
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  }

  @media (min-width: 1280px) {
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  }
}

// Card transitions
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

// States
.loading-state,
.empty-state {
  text-align: center;
  padding: 2.5rem 1.5rem;
  color: var(--neo-text-muted);

  @media (min-width: 480px) {
    padding: 3rem 2rem;
  }

  @media (min-width: 768px) {
    padding: 4rem 2rem;
  }
}

.loading-spinner,
.empty-emoji {
  font-size: 2.5rem;
  display: block;
  margin-bottom: 0.75rem;

  @media (min-width: 480px) {
    font-size: 3rem;
    margin-bottom: 1rem;
  }
}

.loading-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Login Notice
.login-notice {
  margin-top: var(--neo-spacing-6);
  padding: var(--neo-spacing-4);
  background: var(--neo-bg-secondary);
  border: var(--neo-border-width) var(--neo-border-style) var(--neo-border-color);
  border-radius: var(--neo-radius-lg);

  @media (min-width: 480px) {
    margin-top: var(--neo-spacing-8);
    padding: var(--neo-spacing-5);
    border-radius: var(--neo-radius-xl);
  }

  @media (min-width: 768px) {
    padding: var(--neo-spacing-6);
    border-radius: var(--neo-radius-xl);
  }
}

.notice-content {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  flex-wrap: wrap;

  @media (min-width: 480px) {
    align-items: center;
    gap: 1rem;
  }

  @media (min-width: 600px) {
    flex-wrap: nowrap;
  }
}

.notice-icon {
  font-size: 1.5rem;
  flex-shrink: 0;

  @media (min-width: 480px) {
    font-size: 2rem;
  }
}

.notice-text {
  flex: 1;
  min-width: 0;
}

.notice-content h3 {
  margin: 0 0 0.125rem;
  font-size: 0.9375rem;
  color: var(--neo-text-primary);

  @media (min-width: 480px) {
    margin-bottom: 0.25rem;
    font-size: 1rem;
  }
}

.notice-content p {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
  line-height: 1.5;

  @media (min-width: 480px) {
    font-size: 0.875rem;
  }
}

.notice-btn {
  flex-shrink: 0;
  width: 100%;
  padding: var(--neo-spacing-2) var(--neo-spacing-5);
  background: var(--neo-accent);
  color: var(--neo-text-inverse);
  text-decoration: none;
  border-radius: var(--neo-radius-full);
  font-weight: var(--neo-font-weight-semibold);
  font-size: var(--neo-font-size-sm);
  transition: all var(--neo-transition-fast);
  text-align: center;

  @media (min-width: 480px) {
    width: auto;
    padding: var(--neo-spacing-3) var(--neo-spacing-6);
  }

  &:hover {
    filter: brightness(1.1);
    transform: scale(1.02);
  }
}
</style>

