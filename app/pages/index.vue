<script setup lang="ts">
/**
 * Home Page - Threads-inspired minimal feed
 * 
 * Clean, focused design with seamless infinite scroll
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

// Infinite scroll refs
const loadTrigger = ref<HTMLElement | null>(null)
const isNearBottom = ref(false)

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

// Seamless infinite scroll with IntersectionObserver
let observer: IntersectionObserver | null = null

const setupInfiniteScroll = () => {
  if (typeof window === 'undefined' || !loadTrigger.value) return
  
  // Disconnect existing observer
  if (observer) {
    observer.disconnect()
  }
  
  // Create new observer with large rootMargin for eager loading
  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (entry.isIntersecting && !timelineStore.isLoadingMore && timelineStore.hasMore) {
        // Start loading before user reaches the trigger
        loadMorePosts()
      }
    },
    {
      // Trigger 800px before the element comes into view
      rootMargin: '0px 0px 800px 0px',
      threshold: 0
    }
  )
  
  observer.observe(loadTrigger.value)
}

const loadMorePosts = async () => {
  if (timelineStore.isLoadingMore || !timelineStore.hasMore) return
  await timelineStore.loadMore()
}

// Initialize stores and setup infinite scroll
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
  
  // Setup infinite scroll after initial load
  nextTick(() => {
    setupInfiniteScroll()
  })
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('scroll', handleScroll)
  }
  if (observer) {
    observer.disconnect()
  }
})

// Re-setup observer when statuses change
watch(() => timelineStore.statuses.length, () => {
  nextTick(() => {
    setupInfiniteScroll()
  })
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

      <!-- Posts Feed - Seamless infinite scroll -->
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

        <!-- Invisible trigger for infinite scroll - loads before visible -->
        <div ref="loadTrigger" class="infinite-trigger" aria-hidden="true">
          <!-- Subtle loading indicator only visible when actively loading -->
          <Transition name="fade">
            <div v-if="timelineStore.isLoadingMore" class="loading-more">
              <div class="loading-more__dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </Transition>
        </div>

        <!-- End of feed indicator -->
        <Transition name="fade">
          <div v-if="!timelineStore.hasMore && timelineStore.statuses.length > 0" class="feed-end">
            <span>✨</span>
            <p>You're all caught up!</p>
          </div>
        </Transition>
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
  gap: 0.625rem;
  
  // Very subtle background for light mode
  background: transparent;
  border-radius: 16px;
  padding: 0.5rem;
  
  @media (min-width: 1024px) {
    gap: 0.75rem;
    padding: 0.75rem;
    // Subtle tint that works in both modes
    background: var(--neo-bg-secondary);
    opacity: 1;
    border: 1px solid var(--neo-border-color);
    border-radius: 16px;
  }
}

// Infinite scroll trigger - invisible but positioned to trigger early
.infinite-trigger {
  min-height: 1px;
  margin-top: 1rem;
}

// Subtle loading indicator
.loading-more {
  display: flex;
  justify-content: center;
  padding: 1.5rem 0;
  
  &__dots {
    display: flex;
    gap: 0.375rem;
    
    span {
      width: 8px;
      height: 8px;
      background: var(--neo-text-muted);
      border-radius: 50%;
      animation: bounce 1.4s ease-in-out infinite both;
      
      &:nth-child(1) { animation-delay: -0.32s; }
      &:nth-child(2) { animation-delay: -0.16s; }
      &:nth-child(3) { animation-delay: 0s; }
    }
  }
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

// End of feed
.feed-end {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 1rem;
  text-align: center;
  
  span {
    font-size: 1.5rem;
  }
  
  p {
    color: var(--neo-text-muted);
    font-size: 0.875rem;
  }
}

// Fade transition
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
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
