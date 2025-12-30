<script setup lang="ts">
/**
 * Home Page - The Feed
 * 
 * Shows real Fediverse content! Falls back to public timeline
 * if not authenticated.
 */

import { useTimelineStore } from '~/stores/timeline'
import { useAuthStore } from '~/stores/auth'
import { useThemeStore } from '~/stores/theme'

const timelineStore = useTimelineStore()
const authStore = useAuthStore()
const themeStore = useThemeStore()

type TabType = 'home' | 'local' | 'federated'
const activeTab = ref<TabType>('home')

// Initialize stores
onMounted(async () => {
  await authStore.initialize()
  
  // Load user's custom CSS if available
  if (authStore.userCustomCSS) {
    themeStore.setUserCustomCSS(authStore.userCustomCSS)
  }
  
  // Fetch initial timeline
  if (authStore.isAuthenticated) {
    await timelineStore.fetchHomeTimeline(true)
  } else {
    // Show public timeline for unauthenticated users
    activeTab.value = 'local'
    // Fetch from mastodon.social as default public instance
    await timelineStore.fetchLocalTimeline('https://mastodon.social', true)
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
      // Use a default instance for demo if not logged in
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
  <div class="feed-page">
    <!-- Left Sidebar -->
    <aside class="feed-sidebar feed-sidebar--left">
      <!-- Profile Card (authenticated) -->
      <NuxtLink v-if="authStore.isAuthenticated && authStore.currentUser" to="/profile" class="profile-card-link">
        <div class="profile-card neo-card">
          <div class="profile-card__header">
            <img 
              :src="authStore.currentUser.avatar" 
              :alt="authStore.currentUser.displayName"
              class="profile-card__avatar neo-avatar neo-avatar--xl"
            />
          </div>
          <div class="profile-card__body">
            <h2 class="profile-card__name" v-html="authStore.currentUser.displayName || authStore.currentUser.username" />
            <p class="profile-card__username">@{{ authStore.currentUser.acct }}</p>
            <p 
              v-if="authStore.currentUser.note" 
              class="profile-card__bio" 
              v-html="authStore.currentUser.note" 
            />
          </div>
          <div class="profile-card__stats">
            <div class="profile-card__stat">
              <span class="profile-card__stat-value">{{ authStore.currentUser.statusesCount?.toLocaleString() }}</span>
              <span class="profile-card__stat-label">Posts</span>
            </div>
            <div class="profile-card__stat">
              <span class="profile-card__stat-value">{{ authStore.currentUser.followingCount?.toLocaleString() }}</span>
              <span class="profile-card__stat-label">Following</span>
            </div>
            <div class="profile-card__stat">
              <span class="profile-card__stat-value">{{ authStore.currentUser.followersCount?.toLocaleString() }}</span>
              <span class="profile-card__stat-label">Followers</span>
            </div>
          </div>
          <span class="profile-card__view-link">View Profile →</span>
        </div>
      </NuxtLink>

      <!-- Login prompt for unauthenticated -->
      <div v-else class="login-prompt neo-card">
        <span class="login-prompt__icon">🌌</span>
        <h2 class="login-prompt__title">Welcome to NeoSpace</h2>
        <p class="login-prompt__text">Connect to your Fediverse instance to see your home timeline.</p>
        <NuxtLink to="/login" class="neo-btn neo-btn--primary login-prompt__btn">
          Log In
        </NuxtLink>
      </div>

      <!-- Quick Links -->
      <nav v-if="authStore.isAuthenticated" class="quick-links neo-card">
        <h3 class="quick-links__title">Quick Links</h3>
        <ul class="quick-links__list">
          <li><a href="#" class="quick-links__link">📌 Bookmarks</a></li>
          <li><a href="#" class="quick-links__link">📋 Lists</a></li>
          <li><a href="#" class="quick-links__link">⚙️ Settings</a></li>
          <li><a href="#" class="quick-links__link">❓ Help</a></li>
        </ul>
      </nav>
    </aside>

    <!-- Main Feed -->
    <section class="feed-main">
      <div class="feed-header">
        <div class="feed-header__top">
          <h1 class="feed-header__title">
            {{ activeTab === 'home' ? 'Home' : activeTab === 'local' ? 'Local' : 'Federated' }}
          </h1>
          <button 
            class="feed-header__refresh neo-btn neo-btn--ghost"
            :disabled="timelineStore.isLoading"
            @click="handleRefresh"
          >
            🔄 Refresh
          </button>
        </div>
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

      <!-- Compose Box (authenticated only) -->
      <RealComposeBox v-if="authStore.isAuthenticated" />

      <!-- Loading State -->
      <div v-if="timelineStore.isLoading" class="feed-loading">
        <span class="feed-loading__spinner">🌀</span>
        <p>Loading timeline...</p>
      </div>

      <!-- Error State -->
      <div v-else-if="timelineStore.error" class="feed-error neo-card">
        <span>⚠️</span>
        <p>{{ timelineStore.error }}</p>
        <button class="neo-btn neo-btn--secondary" @click="handleRefresh">Try Again</button>
      </div>

      <!-- Empty State -->
      <div v-else-if="timelineStore.isEmpty" class="feed-empty neo-card">
        <span>📭</span>
        <p>No posts yet. Follow some people or check back later!</p>
      </div>

      <!-- Posts Feed -->
      <div v-else class="feed-posts">
        <TransitionGroup name="post-list">
          <RealPostCard 
            v-for="status in timelineStore.statuses" 
            :key="status.id" 
            :status="status" 
          />
        </TransitionGroup>

        <!-- Load More -->
        <button 
          v-if="timelineStore.hasMore"
          class="feed-load-more neo-btn neo-btn--secondary"
          :disabled="timelineStore.isLoadingMore"
          @click="handleLoadMore"
        >
          {{ timelineStore.isLoadingMore ? 'Loading...' : 'Load More' }}
        </button>
      </div>
    </section>

    <!-- Right Sidebar -->
    <aside class="feed-sidebar feed-sidebar--right">
      <!-- Instance Info -->
      <div v-if="authStore.instanceUrl" class="instance-info neo-card">
        <h3 class="instance-info__title">📡 Connected to</h3>
        <p class="instance-info__url">{{ authStore.instanceUrl.replace('https://', '') }}</p>
      </div>

      <!-- Mode Info -->
      <div class="mode-info neo-card">
        <h3 class="mode-info__title">
          {{ themeStore.isChaosMode ? '🌀 Chaos Mode Active' : '👩 Mom Mode Active' }}
        </h3>
        <p class="mode-info__description">
          {{ themeStore.isChaosMode 
            ? 'Custom CSS is being applied. Your eyes may never be the same.' 
            : 'Clean, accessible design. Your mom would approve.' 
          }}
        </p>
        <p v-if="authStore.userCustomCSS" class="mode-info__hint">
          💡 Custom CSS detected in your profile!
        </p>
      </div>

      <!-- Instructions -->
      <div class="instructions neo-card">
        <h3 class="instructions__title">🎨 Custom CSS Guide</h3>
        <p class="instructions__text">
          Add a profile field named <code>css</code> or <code>custom_css</code> with your CSS variables to customize Chaos Mode!
        </p>
        <details class="instructions__example">
          <summary>See example</summary>
          <pre>:root {
  --neo-bg-primary: #000;
  --neo-text-primary: #0f0;
  --neo-accent: #f0f;
}</pre>
        </details>
      </div>
    </aside>
  </div>
</template>

<style lang="scss" scoped>
.feed-page {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
  
  @media (min-width: 768px) {
    grid-template-columns: 280px 1fr;
  }
  
  @media (min-width: 1200px) {
    grid-template-columns: 280px 1fr 320px;
  }
}

// Sidebar
.feed-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  &--left {
    @media (max-width: 767px) {
      display: none;
    }
  }

  &--right {
    @media (max-width: 1199px) {
      display: none;
    }
  }
}

// Profile Card Link
.profile-card-link {
  text-decoration: none;
  display: block;

  .profile-card {
    transition: transform var(--neo-transition), box-shadow var(--neo-transition);
  }

  &:hover .profile-card {
    transform: translateY(-2px);
    box-shadow: var(--neo-shadow-lg);
  }
}

// Profile Card
.profile-card {
  text-align: center;

  &__header {
    margin-bottom: 1rem;
  }

  &__avatar {
    margin: 0 auto;
  }

  &__name {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    margin-bottom: 0.25rem;

    :deep(img.emoji) {
      height: 1em;
      vertical-align: middle;
    }
  }

  &__username {
    font-size: 0.875rem;
    color: var(--neo-text-muted);
    margin-bottom: 0.75rem;
  }

  &__bio {
    font-size: 0.875rem;
    color: var(--neo-text-secondary);
    line-height: 1.5;
    margin-bottom: 1rem;

    :deep(a) {
      color: var(--neo-accent);
    }
  }

  &__stats {
    display: flex;
    justify-content: center;
    gap: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--neo-border-color);
  }

  &__stat {
    display: flex;
    flex-direction: column;
    align-items: center;

    &-value {
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--neo-text-primary);
    }

    &-label {
      font-size: 0.75rem;
      color: var(--neo-text-muted);
    }
  }

  &__view-link {
    display: block;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--neo-border-color);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--neo-accent);
    transition: color var(--neo-transition);

    .profile-card-link:hover & {
      color: var(--neo-accent-hover);
    }
  }
}

// Login Prompt
.login-prompt {
  text-align: center;

  &__icon {
    font-size: 2.5rem;
    display: block;
    margin-bottom: 1rem;
  }

  &__title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    margin-bottom: 0.5rem;
  }

  &__text {
    font-size: 0.875rem;
    color: var(--neo-text-muted);
    margin-bottom: 1rem;
    line-height: 1.5;
  }

  &__btn {
    width: 100%;
  }
}

// Quick Links
.quick-links {
  &__title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  &__link {
    display: block;
    padding: 0.5rem 0.75rem;
    font-size: 0.9375rem;
    color: var(--neo-text-secondary);
    border-radius: var(--neo-radius-md);
    transition: all var(--neo-transition);

    &:hover {
      background-color: var(--neo-accent-soft);
      color: var(--neo-accent);
    }
  }
}

// Main Feed
.feed-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 680px;
  width: 100%;

  @media (min-width: 768px) {
    margin: 0 auto;
  }
}

.feed-header {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--neo-text-primary);
  }

  &__refresh {
    font-size: 0.875rem;
  }

  &__tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--neo-border-color);
  }

  &__tab {
    padding: 0.75rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--neo-text-muted);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
    transition: all var(--neo-transition);

    &:hover:not(:disabled) {
      color: var(--neo-text-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &--active {
      color: var(--neo-accent);
      border-bottom-color: var(--neo-accent);
    }
  }
}

.feed-loading,
.feed-empty,
.feed-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3rem;
  text-align: center;

  span {
    font-size: 2.5rem;
  }

  p {
    color: var(--neo-text-muted);
  }
}

.feed-loading__spinner {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.feed-posts {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.feed-load-more {
  width: 100%;
}

// Post list animations
.post-list-enter-active,
.post-list-leave-active {
  transition: all 0.3s ease;
}

.post-list-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

.post-list-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

// Right Sidebar
.instance-info {
  &__title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    margin-bottom: 0.5rem;
  }

  &__url {
    font-family: var(--neo-font-mono);
    font-size: 0.9375rem;
    color: var(--neo-accent);
  }
}

.mode-info {
  background: linear-gradient(135deg, var(--neo-accent-soft), var(--neo-bg-secondary));

  &__title {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--neo-accent);
    margin-bottom: 0.5rem;
  }

  &__description {
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
    line-height: 1.5;
  }

  &__hint {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: var(--neo-success);
  }
}

.instructions {
  &__title {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    margin-bottom: 0.5rem;
  }

  &__text {
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
    line-height: 1.5;

    code {
      font-family: var(--neo-font-mono);
      background-color: var(--neo-bg-tertiary);
      padding: 0.125rem 0.375rem;
      border-radius: var(--neo-radius-sm);
    }
  }

  &__example {
    margin-top: 0.75rem;

    summary {
      font-size: 0.8125rem;
      color: var(--neo-accent);
      cursor: pointer;
    }

    pre {
      margin-top: 0.5rem;
      padding: 0.75rem;
      background-color: var(--neo-bg-tertiary);
      border-radius: var(--neo-radius-md);
      font-size: 0.75rem;
      font-family: var(--neo-font-mono);
      overflow-x: auto;
    }
  }
}
</style>
