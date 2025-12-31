<script setup lang="ts">
/**
 * Home Page - Threads-inspired minimal feed
 * 
 * Clean, focused design with subtle card container and reply previews
 */

import { useTimelineStore } from '~/stores/timeline'
import { useAuthStore } from '~/stores/auth'
import { useThemeStore } from '~/stores/theme'

const timelineStore = useTimelineStore()
const authStore = useAuthStore()
const themeStore = useThemeStore()

type TabType = 'home' | 'local' | 'federated'
const activeTab = ref<TabType>('home')

// Scroll-based compose collapse
const isComposeCollapsed = ref(false)
const lastScrollY = ref(0)
const feedContainer = ref<HTMLElement | null>(null)

const handleScroll = () => {
  if (typeof window === 'undefined') return
  
  const currentScrollY = window.scrollY
  
  // Collapse after scrolling down 100px
  if (currentScrollY > 100 && currentScrollY > lastScrollY.value) {
    isComposeCollapsed.value = true
  }
  // Expand when scrolling back to top
  if (currentScrollY < 50) {
    isComposeCollapsed.value = false
  }
  
  lastScrollY.value = currentScrollY
}

const expandCompose = () => {
  isComposeCollapsed.value = false
  // Scroll to top smoothly
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// Initialize stores
onMounted(async () => {
  await authStore.initialize()
  
  if (authStore.userCustomCSS) {
    themeStore.setUserCustomCSS(authStore.userCustomCSS)
  }
  
  if (authStore.isAuthenticated) {
    await timelineStore.fetchHomeTimeline(true)
  } else {
    activeTab.value = 'local'
    await timelineStore.fetchLocalTimeline('https://mastodon.social', true)
  }
  
  // Add scroll listener
  window.addEventListener('scroll', handleScroll, { passive: true })
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('scroll', handleScroll)
  }
})

const switchTab = async (tab: TabType) => {
  if (tab === activeTab.value) return
  
  activeTab.value = tab
  
  switch (tab) {
    case 'home':
      if (authStore.isAuthenticated) {
        await timelineStore.fetchHomeTimeline(true)
      }
      break
    case 'local':
      const localUrl = authStore.instanceUrl || 'https://mastodon.social'
      await timelineStore.fetchLocalTimeline(localUrl, true)
      break
    case 'federated':
      const fedUrl = authStore.instanceUrl || 'https://mastodon.social'
      await timelineStore.fetchFederatedTimeline(fedUrl, true)
      break
  }
}

const handleLoadMore = () => {
  timelineStore.loadMore()
}

const handleRefresh = async () => {
  switch (activeTab.value) {
    case 'home':
      await timelineStore.fetchHomeTimeline(true)
      break
    case 'local':
      await timelineStore.fetchLocalTimeline(authStore.instanceUrl || 'https://mastodon.social', true)
      break
    case 'federated':
      await timelineStore.fetchFederatedTimeline(authStore.instanceUrl || 'https://mastodon.social', true)
      break
  }
}

useHead({
  title: 'Home | NeoSpace'
})
</script>

<template>
  <div class="feed-page" ref="feedContainer">
    <!-- Main Feed - Single column, centered -->
    <section class="feed-main">
      <!-- Minimal Header with Tabs -->
      <div class="feed-header">
        <div class="feed-header__tabs">
          <button 
            class="feed-header__tab"
            :class="{ 'feed-header__tab--active': activeTab === 'home' }"
            :disabled="!authStore.isAuthenticated"
            @click="switchTab('home')"
          >
            For You
          </button>
          <button 
            class="feed-header__tab"
            :class="{ 'feed-header__tab--active': activeTab === 'local' }"
            @click="switchTab('local')"
          >
            Local
          </button>
          <button 
            class="feed-header__tab"
            :class="{ 'feed-header__tab--active': activeTab === 'federated' }"
            @click="switchTab('federated')"
          >
            Federated
          </button>
        </div>
      </div>

      <!-- Compose Box (authenticated only) - Collapsible -->
      <Transition name="compose-collapse">
        <div v-if="authStore.isAuthenticated && !isComposeCollapsed" class="compose-wrapper">
          <RealComposeBox />
        </div>
      </Transition>

      <!-- Loading State -->
      <div v-if="timelineStore.isLoading" class="feed-loading">
        <span class="feed-loading__spinner">🌀</span>
        <p>Loading timeline...</p>
      </div>

      <!-- Error State -->
      <div v-else-if="timelineStore.error" class="feed-error">
        <span>⚠️</span>
        <p>{{ timelineStore.error }}</p>
        <button class="neo-btn neo-btn--secondary" @click="handleRefresh">Try Again</button>
      </div>

      <!-- Empty State -->
      <div v-else-if="timelineStore.isEmpty" class="feed-empty">
        <span>📭</span>
        <p>No posts yet. Follow some people or check back later!</p>
      </div>

      <!-- Posts Feed - Subtle background container -->
      <div v-else class="feed-posts">
        <div class="posts-container">
          <TransitionGroup name="post-list">
            <RealPostCard 
              v-for="status in timelineStore.statuses" 
              :key="status.id" 
              :status="status" 
            />
          </TransitionGroup>
        </div>

        <!-- Load More -->
        <button 
          v-if="timelineStore.hasMore"
          class="feed-load-more neo-btn neo-btn--ghost"
          :disabled="timelineStore.isLoadingMore"
          @click="handleLoadMore"
        >
          {{ timelineStore.isLoadingMore ? 'Loading...' : 'Load More' }}
        </button>
      </div>
    </section>

    <!-- Right Sidebar - Ultra minimal info -->
    <aside class="feed-sidebar">
      <div class="sidebar-info">
        <div v-if="authStore.instanceUrl" class="info-item">
          <span class="info-label">📡</span>
          <span class="info-value">{{ authStore.instanceUrl.replace('https://', '') }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">{{ themeStore.isChaosMode ? '🌀' : '👩' }}</span>
          <span class="info-value">{{ themeStore.isChaosMode ? 'Chaos Mode' : 'Mom Mode' }}</span>
        </div>
      </div>
    </aside>

    <!-- Floating Compose Button (when collapsed) -->
    <Transition name="fab-pop">
      <button 
        v-if="authStore.isAuthenticated && isComposeCollapsed" 
        class="floating-compose"
        @click="expandCompose"
        aria-label="New Post"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </Transition>
  </div>
</template>

<style lang="scss" scoped>
.feed-page {
  display: flex;
  gap: 2rem;
  max-width: 680px;
  margin: 0 auto;
  padding: 0 0.5rem;
  
  @media (min-width: 1100px) {
    max-width: 920px;
  }
}

// Main Feed - Full focus
.feed-main {
  flex: 1;
  min-width: 0;
  max-width: 600px;
  
  @media (min-width: 1100px) {
    max-width: 600px;
  }
}

// Minimal tabs header
.feed-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--neo-bg-primary);
  border-bottom: 1px solid var(--neo-border-color);
  margin: 0 -0.5rem;
  padding: 0 0.5rem;
  
  @media (min-width: 1024px) {
    position: static;
    border-bottom: none;
    margin: 0;
    padding: 0;
    margin-bottom: 0.5rem;
  }

  &__tabs {
    display: flex;
    justify-content: center;
  }

  &__tab {
    flex: 1;
    max-width: 140px;
    padding: 0.875rem 1rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover:not(:disabled) {
      color: var(--neo-text-secondary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &--active {
      color: var(--neo-text-primary);
      border-bottom-color: var(--neo-text-primary);
    }
  }
}

// Compose wrapper with collapse animation
.compose-wrapper {
  margin-bottom: 1rem;
  
  @media (max-width: 1023px) {
    margin: 0 -0.5rem 1rem;
    
    :deep(.compose) {
      border-radius: 0;
      border-left: none;
      border-right: none;
    }
  }
}

.compose-collapse-enter-active,
.compose-collapse-leave-active {
  transition: all 0.25s ease;
  transform-origin: top center;
}

.compose-collapse-enter-from,
.compose-collapse-leave-to {
  opacity: 0;
  max-height: 0;
  transform: scaleY(0.8);
  margin-bottom: 0;
}

// Floating compose button
.floating-compose {
  position: fixed;
  bottom: calc(70px + env(safe-area-inset-bottom, 0px));
  right: 1rem;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--neo-text-primary);
  color: var(--neo-bg-primary);
  border: none;
  border-radius: 50%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  z-index: 80;
  transition: all 0.2s ease;
  
  @media (min-width: 1024px) {
    bottom: 2rem;
    right: 2rem;
  }

  &:hover {
    transform: scale(1.08);
    box-shadow: 0 6px 28px rgba(0, 0, 0, 0.3);
  }

  &:active {
    transform: scale(0.95);
  }
}

.fab-pop-enter-active,
.fab-pop-leave-active {
  transition: all 0.2s ease;
}

.fab-pop-enter-from,
.fab-pop-leave-to {
  opacity: 0;
  transform: scale(0.5);
}

// Feed states
.feed-loading,
.feed-empty,
.feed-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  text-align: center;

  span {
    font-size: 2rem;
  }

  p {
    color: var(--neo-text-muted);
    font-size: 0.9375rem;
  }
}

.feed-loading__spinner {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Posts list - Subtle background container
.feed-posts {
  display: flex;
  flex-direction: column;
  
  @media (max-width: 1023px) {
    margin: 0 -0.5rem;
  }
}

// Subtle container wrapping posts
.posts-container {
  display: flex;
  flex-direction: column;
  gap: 0.625rem; // Slight spacing between cards
  
  // Very subtle background - barely noticeable
  background: linear-gradient(
    to bottom,
    transparent 0%,
    var(--neo-bg-secondary) 2%,
    var(--neo-bg-secondary) 98%,
    transparent 100%
  );
  border-radius: 16px;
  padding: 0.5rem;
  
  @media (min-width: 1024px) {
    gap: 0.75rem;
    padding: 0.75rem;
    background: linear-gradient(
      135deg,
      rgba(var(--neo-bg-secondary-rgb, 30, 30, 30), 0.4) 0%,
      rgba(var(--neo-bg-secondary-rgb, 30, 30, 30), 0.2) 100%
    );
    border: 1px solid rgba(var(--neo-border-rgb, 58, 58, 58), 0.3);
  }
}

.feed-load-more {
  margin: 1rem auto;
  padding: 0.625rem 1.5rem;
  font-size: 0.875rem;
}

// Right sidebar - Ultra minimal
.feed-sidebar {
  display: none;
  width: 280px;
  flex-shrink: 0;
  padding-top: 1rem;
  
  @media (min-width: 1100px) {
    display: block;
  }
}

.sidebar-info {
  position: sticky;
  top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--neo-bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--neo-border-color);
}

.info-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  
  .info-label {
    font-size: 0.875rem;
  }
  
  .info-value {
    color: var(--neo-text-secondary);
  }
}

// Post list animations
.post-list-enter-active,
.post-list-leave-active {
  transition: all 0.3s ease;
}

.post-list-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.post-list-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
</style>
