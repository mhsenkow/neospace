<script setup lang="ts">
/**
 * Groups Page
 * 
 * Browse and discover groups - a friendly interface that hides
 * the fact that groups are really just hashtags underneath.
 */

import { useGroupsStore, GROUP_CATEGORIES } from '~/stores/groups'
import { useAuthStore } from '~/stores/auth'

const groupsStore = useGroupsStore()
const authStore = useAuthStore()
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
        <span class="hero-emoji">👥</span>
        <h1>Groups</h1>
        <p class="hero-subtitle">
          Find your people. Join communities around topics you care about.
        </p>
      </div>
      <div class="hero-shapes">
        <div class="shape shape-1"></div>
        <div class="shape shape-2"></div>
        <div class="shape shape-3"></div>
      </div>
    </header>

    <div class="groups-layout">
      <!-- Sidebar: Your Groups -->
      <aside v-if="authStore.isAuthenticated && joinedGroups.length > 0" class="groups-sidebar">
        <h2 class="sidebar-title">
          <span>⭐</span> Your Groups
        </h2>
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
              placeholder="Search for groups or hashtags..."
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

          <div v-else class="groups-grid">
            <TransitionGroup name="card">
              <GroupCard
                v-for="group in filteredGroups"
                :key="group.tag"
                :group="group"
                @view="viewGroup"
              />
            </TransitionGroup>
          </div>
        </section>

        <!-- Not Logged In Notice -->
        <div v-if="!authStore.isAuthenticated" class="login-notice">
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
  max-width: var(--neo-container-xl);
  margin: 0 auto;
  padding: 0 var(--neo-spacing-2) var(--neo-spacing-6);

  @media (min-width: 480px) {
    padding: 0 var(--neo-spacing-4) var(--neo-spacing-8);
  }
}

// Hero Section
.groups-hero {
  position: relative;
  text-align: center;
  padding: var(--neo-spacing-7) var(--neo-spacing-4);
  margin-bottom: var(--neo-spacing-5);
  background: linear-gradient(135deg, var(--neo-success-dark) 0%, var(--neo-success) 50%, var(--neo-success-light) 100%);
  border-radius: var(--neo-radius-xl);
  overflow: hidden;
  box-shadow: var(--neo-shadow-lg);

  @media (min-width: 480px) {
    padding: var(--neo-spacing-10) var(--neo-spacing-6);
    margin-bottom: var(--neo-spacing-6);
    border-radius: var(--neo-radius-2xl);
  }

  @media (min-width: 768px) {
    padding: var(--neo-spacing-12) var(--neo-spacing-8);
    margin-bottom: var(--neo-spacing-8);
    border-radius: var(--neo-radius-3xl);
    box-shadow: var(--neo-shadow-xl);
  }
}

.hero-content {
  position: relative;
  z-index: 2;
}

.hero-emoji {
  font-size: 2.5rem;
  display: block;
  margin-bottom: 0.5rem;
  animation: bounce 2s ease-in-out infinite;

  @media (min-width: 480px) {
    font-size: 3rem;
    margin-bottom: 0.75rem;
  }

  @media (min-width: 768px) {
    font-size: 3.5rem;
  }
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.groups-hero h1 {
  font-size: var(--neo-font-size-3xl);
  font-weight: var(--neo-font-weight-extrabold);
  color: var(--neo-text-inverse);
  margin: 0 0 var(--neo-spacing-2);
  letter-spacing: var(--neo-letter-spacing-tight);
  text-shadow: var(--neo-shadow-md);

  @media (min-width: 480px) {
    font-size: var(--neo-font-size-4xl);
    margin-bottom: var(--neo-spacing-3);
  }

  @media (min-width: 768px) {
    font-size: var(--neo-font-size-5xl);
  }
}

.hero-subtitle {
  color: rgba(255, 255, 255, 0.95);
  font-size: var(--neo-font-size-sm);
  line-height: var(--neo-line-height-normal);
  max-width: 400px;
  margin: 0 auto;

  @media (min-width: 480px) {
    font-size: var(--neo-font-size-base);
    max-width: 450px;
  }

  @media (min-width: 768px) {
    font-size: var(--neo-font-size-lg);
    max-width: 500px;
  }
}

.hero-shapes {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.shape {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);

  &.shape-1 {
    width: 120px;
    height: 120px;
    top: -40px;
    right: -30px;

    @media (min-width: 768px) {
      width: 200px;
      height: 200px;
      top: -60px;
      right: -40px;
    }
  }

  &.shape-2 {
    width: 80px;
    height: 80px;
    bottom: -20px;
    left: 5%;

    @media (min-width: 768px) {
      width: 120px;
      height: 120px;
      bottom: -30px;
      left: 10%;
    }
  }

  &.shape-3 {
    width: 50px;
    height: 50px;
    top: 40%;
    left: -15px;

    @media (min-width: 768px) {
      width: 80px;
      height: 80px;
      left: -20px;
    }
  }
}

// Layout
.groups-layout {
  display: grid;
  gap: var(--neo-spacing-5);

  @media (min-width: 768px) {
    gap: var(--neo-spacing-6);
  }

  @media (min-width: 900px) {
    grid-template-columns: 260px 1fr;
    gap: var(--neo-spacing-8);
  }
}

// Sidebar
.groups-sidebar {
  @media (max-width: 899px) {
    display: none;
  }
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: var(--neo-spacing-2);
  font-size: var(--neo-font-size-sm);
  font-weight: var(--neo-font-weight-bold);
  color: var(--neo-text-secondary);
  margin: 0 0 var(--neo-spacing-3);
  text-transform: uppercase;
  letter-spacing: var(--neo-letter-spacing-wide);

  @media (min-width: 768px) {
    font-size: var(--neo-font-size-base);
    margin-bottom: var(--neo-spacing-4);
  }

  span {
    font-size: var(--neo-font-size-lg);
  }
}

.joined-groups {
  display: flex;
  flex-direction: column;
  gap: var(--neo-spacing-3);
}

// Main Content
.groups-main {
  min-width: 0;
}

// Search
.groups-search {
  margin-bottom: var(--neo-spacing-4);

  @media (min-width: 480px) {
    margin-bottom: var(--neo-spacing-5);
  }

  @media (min-width: 768px) {
    margin-bottom: var(--neo-spacing-6);
  }
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.875rem;
  font-size: 1rem;
  opacity: 0.6;

  @media (min-width: 480px) {
    left: 1rem;
    font-size: 1.125rem;
  }
}

.search-input {
  width: 100%;
  padding: var(--neo-spacing-3) var(--neo-spacing-3) var(--neo-spacing-3) calc(var(--neo-spacing-10) + var(--neo-spacing-2));
  font-size: var(--neo-font-size-sm);
  background: var(--neo-bg-secondary);
  border: var(--neo-border-width-thick) var(--neo-border-style) var(--neo-border-color);
  border-radius: var(--neo-radius-full);
  color: var(--neo-text-primary);
  transition: all var(--neo-transition);

  @media (min-width: 480px) {
    padding: var(--neo-spacing-4) var(--neo-spacing-4) var(--neo-spacing-4) var(--neo-spacing-12);
    font-size: var(--neo-font-size-base);
  }

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
    box-shadow: 0 0 0 3px var(--neo-accent-soft);

    @media (min-width: 480px) {
      box-shadow: 0 0 0 4px var(--neo-accent-soft);
    }
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
  margin-bottom: 2rem;
}

.section-title {
  font-size: var(--neo-font-size-lg);
  font-weight: var(--neo-font-weight-bold);
  color: var(--neo-text-primary);
  margin: 0 0 var(--neo-spacing-4);
}

// Category Navigation
.category-nav {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.375rem;
  margin-bottom: 1rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding-bottom: 0.25rem;
  margin-left: -0.5rem;
  margin-right: -0.5rem;
  padding-left: 0.5rem;
  padding-right: 0.5rem;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 600px) {
    flex-wrap: wrap;
    overflow-x: visible;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    margin-left: 0;
    margin-right: 0;
    padding-left: 0;
    padding-right: 0;
  }
}

.category-btn {
  display: flex;
  align-items: center;
  gap: var(--neo-spacing-1);
  padding: var(--neo-spacing-2) var(--neo-spacing-3);
  background: var(--neo-bg-secondary);
  border: var(--neo-border-width-thick) var(--neo-border-style) var(--neo-border-color);
  border-radius: var(--neo-radius-full);
  cursor: pointer;
  transition: all var(--neo-transition-fast);
  font-size: var(--neo-font-size-xs);
  flex-shrink: 0;
  white-space: nowrap;

  @media (min-width: 480px) {
    gap: var(--neo-spacing-2);
    padding: var(--neo-spacing-2) var(--neo-spacing-4);
    font-size: var(--neo-font-size-sm);
  }

  .cat-emoji {
    font-size: 0.875rem;

    @media (min-width: 480px) {
      font-size: 1rem;
    }
  }

  .cat-label {
    color: var(--neo-text-primary);
    font-weight: var(--neo-font-weight-medium);
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

// Groups Grid
.groups-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--neo-spacing-3);

  @media (min-width: 480px) {
    gap: var(--neo-spacing-4);
  }

  @media (min-width: 600px) {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }

  @media (min-width: 900px) {
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

