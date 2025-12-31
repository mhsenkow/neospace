<script setup lang="ts">
/**
 * Home Page - Threads-inspired minimal feed
 * 
 * Multi-instance support with merged timelines
 * Clean, focused design with seamless infinite scroll
 */

import { useTimelineStore } from '~/stores/timeline'
import { useAuthStore } from '~/stores/auth'
import { useThemeStore } from '~/stores/theme'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'

const timelineStore = useTimelineStore()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const instancesStore = useInstancesStore()

// Instance manager modal ref
const instanceManagerRef = ref<{ open: () => void } | null>(null)

type TabType = 'home' | 'local' | 'federated'
const activeTab = ref<TabType>('local')

// Multi-instance merged statuses
const mergedStatuses = ref<ExtendedStatus[]>([])
const isLoadingMerged = ref(false)
const mergedError = ref<string | null>(null)

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

// Fetch merged timeline from all connected instances
const fetchMergedTimeline = async (type: 'local' | 'federated' = 'local') => {
  isLoadingMerged.value = true
  mergedError.value = null
  
  try {
    const statuses = await instancesStore.fetchMergedTimeline(type, 20)
    
    // Filter by active instance if set
    if (instancesStore.activeInstanceFilter) {
      mergedStatuses.value = statuses.filter(s => 
        s._instanceId === instancesStore.activeInstanceFilter
      )
    } else {
      mergedStatuses.value = statuses
    }
  } catch (e: any) {
    mergedError.value = e.message || 'Failed to fetch timeline'
  } finally {
    isLoadingMerged.value = false
  }
}

// Fetch merged home timeline (from authenticated instances + legacy auth)
const fetchMergedHomeTimeline = async () => {
  isLoadingMerged.value = true
  mergedError.value = null
  
  try {
    // Start with multi-instance home timeline
    let statuses = await instancesStore.fetchMergedHomeTimeline(20)
    
    // Also include legacy authStore timeline if authenticated
    if (authStore.isAuthenticated && authStore.accessToken && authStore.instanceUrl) {
      try {
        // Fetch from legacy auth as well
        await timelineStore.fetchHomeTimeline(true)
        
        // Merge legacy statuses with multi-instance statuses
        const legacyStatuses = timelineStore.statuses.map(s => ({
          ...s,
          _instanceId: 'legacy',
          _instanceUrl: authStore.instanceUrl,
        }))
        
        // Combine and sort by date
        statuses = [...statuses, ...legacyStatuses].sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        
        // Remove duplicates by ID
        const seen = new Set()
        statuses = statuses.filter(s => {
          if (seen.has(s.id)) return false
          seen.add(s.id)
          return true
        })
      } catch (e) {
        console.warn('Failed to fetch legacy home timeline:', e)
      }
    }
    
    // Filter by active instance if set
    if (instancesStore.activeInstanceFilter) {
      mergedStatuses.value = statuses.filter(s => 
        s._instanceId === instancesStore.activeInstanceFilter
      )
    } else {
      mergedStatuses.value = statuses
    }
  } catch (e: any) {
    mergedError.value = e.message || 'Failed to fetch home timeline'
  } finally {
    isLoadingMerged.value = false
  }
}

// Computed for displayed statuses (merged or single)
const displayedStatuses = computed(() => {
  // If we have multi-instance, use merged statuses
  if (instancesStore.instances.length > 0) {
    return mergedStatuses.value
  }
  // Fallback to legacy single-instance
  return timelineStore.statuses
})

const isTimelineLoading = computed(() => {
  return isLoadingMerged.value || timelineStore.isLoading
})

const timelineError = computed(() => {
  return mergedError.value || timelineStore.error
})

// Initialize stores and setup infinite scroll
onMounted(async () => {
  // Initialize both stores
  await Promise.all([
    authStore.initialize(),
    instancesStore.initialize()
  ])
  
  if (authStore.userCustomCSS) {
    themeStore.setUserCustomCSS(authStore.userCustomCSS)
  }
  
  // Use multi-instance if available
  if (instancesStore.instances.length > 0) {
    // Check if we have any authenticated instances for home timeline
    if (instancesStore.hasAuthenticatedInstance) {
      activeTab.value = 'home'
      await fetchMergedHomeTimeline()
    } else {
      activeTab.value = 'local'
      await fetchMergedTimeline('local')
    }
  } else if (authStore.isAuthenticated) {
    // Legacy single-instance fallback
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
  mergedStatuses.value = []
  
  // Use multi-instance if available
  if (instancesStore.instances.length > 0) {
    switch (tab) {
      case 'home':
        await fetchMergedHomeTimeline()
        break
      case 'local':
        await fetchMergedTimeline('local')
        break
      case 'federated':
        await fetchMergedTimeline('federated')
        break
    }
  } else {
    // Legacy single-instance fallback
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
}

const handleRefresh = async () => {
  if (instancesStore.instances.length > 0) {
    switch (activeTab.value) {
      case 'home':
        await fetchMergedHomeTimeline()
        break
      case 'local':
        await fetchMergedTimeline('local')
        break
      case 'federated':
        await fetchMergedTimeline('federated')
        break
    }
  } else {
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
}

// Set instance filter
const setInstanceFilter = (instanceId: string | null) => {
  instancesStore.setFilter(instanceId)
  // Re-apply filter to current statuses
  handleRefresh()
}

// Open instance manager
const openInstanceManager = () => {
  instanceManagerRef.value?.open()
}

useHead({
  title: 'Home | NeoSpace'
})
</script>

<template>
  <div class="feed-page" ref="feedContainer">
    <!-- Instance Manager Modal -->
    <InstanceManager ref="instanceManagerRef" />
    
    <!-- Main Feed - Single column, centered -->
    <section class="feed-main">
      <!-- Minimal Header with Tabs -->
      <div class="feed-header">
        <div class="feed-header__tabs">
          <button 
            class="feed-header__tab"
            :class="{ 'feed-header__tab--active': activeTab === 'home' }"
            :disabled="!instancesStore.hasAuthenticatedInstance && !authStore.isAuthenticated"
            :title="(!instancesStore.hasAuthenticatedInstance && !authStore.isAuthenticated) ? 'Log in to see your personal feed' : 'Posts from people you follow'"
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

      <!-- Instance Filter Pills (when multiple instances) -->
      <div v-if="instancesStore.instances.length > 1" class="instance-filters">
        <button 
          class="instance-pill"
          :class="{ 'instance-pill--active': !instancesStore.activeInstanceFilter }"
          @click="setInstanceFilter(null)"
        >
          All Servers
        </button>
        <button 
          v-for="instance in instancesStore.instances" 
          :key="instance.id"
          class="instance-pill"
          :class="{ 
            'instance-pill--active': instancesStore.activeInstanceFilter === instance.id,
            'instance-pill--authenticated': !!instance.user 
          }"
          @click="setInstanceFilter(instance.id)"
        >
          <img 
            v-if="instance.instanceInfo?.thumbnail" 
            :src="instance.instanceInfo.thumbnail" 
            :alt="instance.name"
            class="instance-pill__icon"
          />
          <span>{{ instance.name.length > 20 ? instance.name.substring(0, 17) + '...' : instance.name }}</span>
        </button>
        <button class="instance-pill instance-pill--add" @click="openInstanceManager">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      
      <!-- Single instance hint -->
      <div v-else-if="instancesStore.instances.length === 1" class="single-instance-hint">
        <span>📡 {{ instancesStore.instances[0].name }}</span>
        <button class="add-server-link" @click="openInstanceManager">+ Add more servers</button>
      </div>

      <!-- Compose Box (authenticated only) - Collapsible -->
      <Transition name="compose-collapse">
        <div v-if="authStore.isAuthenticated && !isComposeCollapsed" class="compose-wrapper">
          <RealComposeBox />
        </div>
      </Transition>

      <!-- Loading State -->
      <div v-if="isTimelineLoading" class="feed-loading">
        <span class="feed-loading__spinner">🌀</span>
        <p>Loading timeline...</p>
      </div>

      <!-- Error State -->
      <div v-else-if="timelineError" class="feed-error">
        <span>⚠️</span>
        <p>{{ timelineError }}</p>
        <button class="neo-btn neo-btn--secondary" @click="handleRefresh">Try Again</button>
      </div>

      <!-- Empty State -->
      <div v-else-if="displayedStatuses.length === 0" class="feed-empty">
        <template v-if="activeTab === 'home' && !instancesStore.hasAuthenticatedInstance && !authStore.isAuthenticated">
          <span>🔑</span>
          <p><strong>Log in to see your For You feed</strong></p>
          <p class="feed-empty__sub">This shows posts from people you follow on your connected servers.</p>
          <NuxtLink to="/login" class="neo-btn neo-btn--primary">Log In</NuxtLink>
        </template>
        <template v-else>
        <span>📭</span>
        <p>No posts yet. Follow some people or check back later!</p>
        </template>
      </div>

      <!-- Posts Feed - Seamless infinite scroll -->
      <div v-else class="feed-posts">
        <!-- Login Prompt for For You (when not logged in via either method) -->
        <div v-if="!instancesStore.hasAuthenticatedInstance && !authStore.isAuthenticated" class="login-prompt">
          <div class="login-prompt__content">
            <span>💡</span>
            <div>
              <strong>Want your personalized feed?</strong>
              <p>Log in to see posts from people you follow.</p>
            </div>
            <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Log In</NuxtLink>
          </div>
        </div>
        <div class="posts-container">
        <TransitionGroup name="post-list">
          <RealPostCard 
              v-for="status in displayedStatuses" 
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

    <!-- Right Sidebar - Connected Instances -->
    <aside class="feed-sidebar">
      <div class="sidebar-section">
        <div class="sidebar-section__header">
          <span>🌐 Connected Servers</span>
          <button class="sidebar-section__action" @click="openInstanceManager">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
      </div>

        <div class="connected-instances">
          <div 
            v-for="instance in instancesStore.instances" 
            :key="instance.id"
            class="connected-instance"
            :class="{ 'connected-instance--authenticated': !!instance.user }"
          >
            <img 
              v-if="instance.instanceInfo?.thumbnail" 
              :src="instance.instanceInfo.thumbnail" 
              :alt="instance.name"
              class="connected-instance__icon"
            />
            <span v-else class="connected-instance__icon connected-instance__icon--emoji">🌐</span>
            
            <div class="connected-instance__info">
              <span class="connected-instance__name">{{ instance.name }}</span>
              <span v-if="instance.user" class="connected-instance__user">@{{ instance.user.acct }}</span>
              <span v-else class="connected-instance__watching">watching</span>
            </div>
      </div>

          <div v-if="instancesStore.instances.length === 0" class="no-instances">
            <span>No servers connected</span>
          </div>
        </div>
      </div>

      <div class="sidebar-info">
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
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
  
  // Tablet and up - add some breathing room
  @media (min-width: 768px) {
    padding: 0 1rem;
    max-width: 720px;
  }
  
  // Desktop with sidebar
  @media (min-width: 1100px) {
    max-width: 960px;
    padding: 0 1.5rem;
  }
}

// Main Feed - Responsive width
.feed-main {
  flex: 1;
  min-width: 0;
  width: 100%;
  overflow: hidden;
  
  // On mobile, take full width
  @media (max-width: 767px) {
    max-width: 100%;
  }
  
  // Tablet - grow but cap for readability
  @media (min-width: 768px) {
    max-width: 100%;
  }
  
  // Desktop - cap at comfortable reading width
  @media (min-width: 1100px) {
    max-width: 620px;
  }
}

// Minimal tabs header
.feed-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--neo-bg-primary);
  border-bottom: 1px solid var(--neo-border-color);
  margin: 0;
  padding: 0 0.75rem;
  width: 100%;
  
  @media (min-width: 768px) {
    padding: 0;
  }
  
  @media (min-width: 1024px) {
    position: static;
    border-bottom: none;
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

// Instance filter pills
.instance-filters {
      display: flex;
  gap: 0.5rem;
  padding: 0.75rem 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  
  &::-webkit-scrollbar {
    display: none;
  }
  
  @media (max-width: 1023px) {
    margin: 0 -0.5rem;
    padding: 0.75rem 0.5rem;
  }
}

.instance-pill {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);
  border-radius: 20px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--neo-text-secondary);
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
  
  &:hover {
    background: var(--neo-bg-secondary);
    border-color: var(--neo-text-muted);
  }
  
  &--active {
    background: var(--neo-text-primary);
    color: var(--neo-bg-primary);
    border-color: var(--neo-text-primary);
    
    &:hover {
      background: var(--neo-text-secondary);
      border-color: var(--neo-text-secondary);
    }
  }
  
  &--authenticated {
    border-color: var(--neo-accent);
    
    &.instance-pill--active {
      background: var(--neo-accent);
      border-color: var(--neo-accent);
    }
  }
  
  &--add {
    padding: 0.375rem 0.5rem;
    
    svg {
      opacity: 0.7;
    }
    
    &:hover svg {
      opacity: 1;
    }
  }

  &__icon {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    object-fit: cover;
  }
}

.single-instance-hint {
    display: flex;
    align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  
  @media (max-width: 1023px) {
    padding: 0.5rem;
  }
  }

.add-server-link {
  background: none;
  border: none;
  color: var(--neo-accent);
    font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  
  &:hover {
    text-decoration: underline;
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
    margin: 0;
  }
  
  &__sub {
    font-size: 0.875rem !important;
    max-width: 280px;
  }
  
  .neo-btn {
    margin-top: 0.5rem;
  }
}

.login-prompt {
  margin: 0.75rem 0;
  padding: 0.875rem 1rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-lg);
  
  &__content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    
    > span {
      font-size: 1.25rem;
    }
    
    > div {
      flex: 1;
      
      strong {
        display: block;
        font-size: 0.9375rem;
    color: var(--neo-text-primary);
  }

      p {
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
        margin: 0.125rem 0 0;
      }
    }
  }
  
  .neo-btn--sm {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
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
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

// Subtle container wrapping posts
.posts-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  
  // Mobile - edge to edge
  background: transparent;
  border-radius: 0;
  padding: 0;
  
  // Tablet - slight padding
  @media (min-width: 768px) {
    gap: 0.625rem;
    padding: 0.5rem;
    border-radius: 12px;
  }
  
  // Desktop - full styling
  @media (min-width: 1024px) {
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--neo-bg-secondary);
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

// Right sidebar - Connected instances
.feed-sidebar {
  display: none;
  width: 280px;
  flex-shrink: 0;
  padding-top: 1rem;
  
  @media (min-width: 1100px) {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
}

.sidebar-section {
  position: sticky;
  top: 1rem;
  background: var(--neo-bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--neo-border-color);
  overflow: hidden;
  
  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-secondary);
    border-bottom: 1px solid var(--neo-border-color);
  }
  
  &__action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: transparent;
    color: var(--neo-text-muted);
    transition: all 0.15s ease;
    
    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }
  }
}

.connected-instances {
  display: flex;
  flex-direction: column;
}

.connected-instance {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 1rem;
  transition: background 0.15s ease;
  
  &:hover {
    background: var(--neo-bg-tertiary);
  }
  
  &--authenticated {
    .connected-instance__name {
      color: var(--neo-text-primary);
    }
  }
  
  &__icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
    
    &--emoji {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--neo-bg-tertiary);
      font-size: 0.875rem;
    }
  }
  
  &__info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  
  &__name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--neo-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  &__user {
    font-size: 0.75rem;
    color: var(--neo-accent);
  }
  
  &__watching {
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    font-style: italic;
  }
}

.no-instances {
  padding: 1rem;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.sidebar-info {
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
