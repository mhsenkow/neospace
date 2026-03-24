<script setup lang="ts">
/**
 * TimelineColumn - Self-contained timeline column for multi-column layout.
 * Each column manages its own feed data, scroll, and infinite loading.
 */

import { createRestAPIClient, type mastodon } from 'masto'
import { useAuthStore } from '~/stores/auth'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import type { ColumnConfig, ColumnFeedType } from '~/stores/columns'

interface Props {
  column: ColumnConfig
  canRemove: boolean
  isFirst: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  remove: []
  'update-feed-type': [feedType: ColumnFeedType]
}>()

const authStore = useAuthStore()
const instancesStore = useInstancesStore()

const statuses = ref<(mastodon.v1.Status | ExtendedStatus)[]>([])
const isLoading = ref(false)
const isLoadingMore = ref(false)
const error = ref<string | null>(null)
const hasMore = ref(true)
const maxId = ref<string | null>(null)

const feedMenuOpen = ref(false)
const scrollContainer = ref<HTMLElement | null>(null)
const loadTrigger = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const feedLabels: Record<ColumnFeedType, string> = {
  home: 'For You',
  local: 'Local',
  federated: 'Federated',
}

const feedLabel = computed(() => feedLabels[props.column.feedType])

const canShowHome = computed(() =>
  instancesStore.hasAuthenticatedInstance || authStore.isAuthenticated
)

const closeFeedMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (!target.closest('.column-feed-select') && !target.closest('.feed-dropdown')) {
    feedMenuOpen.value = false
  }
}

const switchFeed = (type: ColumnFeedType) => {
  feedMenuOpen.value = false
  if (type === props.column.feedType) return
  emit('update-feed-type', type)
}

const fetchTimeline = async (refresh = false) => {
  if (refresh) {
    statuses.value = []
    maxId.value = null
    hasMore.value = true
  }

  isLoading.value = true
  error.value = null

  try {
    let result: (mastodon.v1.Status | ExtendedStatus)[] = []

    if (instancesStore.instances.length > 0) {
      if (props.column.feedType === 'home') {
        let merged = await instancesStore.fetchMergedHomeTimeline(20)

        if (authStore.isAuthenticated && authStore.accessToken && authStore.instanceUrl) {
          try {
            const client = createRestAPIClient({
              url: authStore.instanceUrl,
              accessToken: authStore.accessToken,
            })
            const legacy = await client.v1.timelines.home.list({ limit: 20 })
            const legacyExtended = legacy.map(s => ({
              ...s,
              _instanceId: 'legacy',
              _instanceUrl: authStore.instanceUrl!,
            }))
            merged = [...merged, ...legacyExtended].sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )
            const seen = new Set<string>()
            merged = merged.filter(s => {
              if (seen.has(s.id)) return false
              seen.add(s.id)
              return true
            })
          } catch {
            // legacy fetch failed, use what we have
          }
        }
        result = merged
      } else {
        result = await instancesStore.fetchMergedTimeline(props.column.feedType, 20)
      }
    } else if (authStore.isAuthenticated && authStore.instanceUrl) {
      const client = createRestAPIClient({
        url: authStore.instanceUrl,
        accessToken: authStore.accessToken || undefined,
      })
      switch (props.column.feedType) {
        case 'home':
          result = await client.v1.timelines.home.list({ limit: 20 })
          break
        case 'local':
          result = await client.v1.timelines.public.list({ local: true, limit: 20 })
          break
        case 'federated':
          result = await client.v1.timelines.public.list({ local: false, limit: 20 })
          break
      }
    } else if (props.column.feedType !== 'home') {
      const client = createRestAPIClient({ url: 'https://mastodon.social' })
      result = await client.v1.timelines.public.list({
        local: props.column.feedType === 'local',
        limit: 20,
      })
    }

    statuses.value = result
    if (result.length > 0) {
      maxId.value = result.at(-1)!.id
    }
    hasMore.value = result.length >= 20
  } catch (e: any) {
    error.value = e.message || 'Failed to fetch timeline'
  } finally {
    isLoading.value = false
  }
}

const loadMore = async () => {
  if (isLoadingMore.value || !hasMore.value || !maxId.value) return

  isLoadingMore.value = true

  try {
    let newStatuses: mastodon.v1.Status[] = []
    const url = authStore.instanceUrl || 'https://mastodon.social'
    const client = createRestAPIClient({
      url,
      accessToken: authStore.accessToken || undefined,
    })

    switch (props.column.feedType) {
      case 'home':
        if (authStore.isAuthenticated) {
          newStatuses = await client.v1.timelines.home.list({ maxId: maxId.value, limit: 20 })
        }
        break
      case 'local':
        newStatuses = await client.v1.timelines.public.list({ local: true, maxId: maxId.value, limit: 20 })
        break
      case 'federated':
        newStatuses = await client.v1.timelines.public.list({ local: false, maxId: maxId.value, limit: 20 })
        break
    }

    if (newStatuses.length > 0) {
      statuses.value = [...statuses.value, ...newStatuses]
      maxId.value = newStatuses.at(-1)!.id
    }
    hasMore.value = newStatuses.length > 0
  } catch (e: any) {
    console.error('Load more error:', e)
  } finally {
    isLoadingMore.value = false
  }
}

const setupInfiniteScroll = () => {
  if (!loadTrigger.value || !scrollContainer.value) return
  if (observer) observer.disconnect()

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !isLoadingMore.value && hasMore.value) {
        loadMore()
      }
    },
    {
      root: scrollContainer.value,
      rootMargin: '0px 0px 600px 0px',
      threshold: 0,
    }
  )
  observer.observe(loadTrigger.value)
}

watch(() => props.column.feedType, () => {
  fetchTimeline(true)
})

watch(() => statuses.value.length, () => {
  nextTick(() => setupInfiniteScroll())
})

onMounted(async () => {
  await fetchTimeline()
  nextTick(() => setupInfiniteScroll())
  document.addEventListener('click', closeFeedMenu)
})

onUnmounted(() => {
  if (observer) observer.disconnect()
  document.removeEventListener('click', closeFeedMenu)
})
</script>

<template>
  <div class="timeline-column">
    <!-- Column Header -->
    <div class="column-header">
      <div class="column-feed-select" @click.stop="feedMenuOpen = !feedMenuOpen">
        <span class="column-feed-label">{{ feedLabel }}</span>
        <svg class="column-feed-chevron" :class="{ 'column-feed-chevron--open': feedMenuOpen }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      <button v-if="canRemove" class="column-close" @click="emit('remove')" title="Remove column">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Feed Type Dropdown -->
      <Transition name="dropdown">
        <div v-if="feedMenuOpen" class="feed-dropdown" @click.stop>
          <button
            class="feed-dropdown__item"
            :class="{ 'feed-dropdown__item--active': column.feedType === 'home' }"
            :disabled="!canShowHome"
            @click="switchFeed('home')"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            For You
          </button>
          <button
            class="feed-dropdown__item"
            :class="{ 'feed-dropdown__item--active': column.feedType === 'local' }"
            @click="switchFeed('local')"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            Local
          </button>
          <button
            class="feed-dropdown__item"
            :class="{ 'feed-dropdown__item--active': column.feedType === 'federated' }"
            @click="switchFeed('federated')"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            Federated
          </button>
        </div>
      </Transition>
    </div>

    <!-- Scrollable Content -->
    <div class="column-scroll" ref="scrollContainer">
      <!-- Compose (first column only, when authenticated) -->
      <div v-if="isFirst && authStore.isAuthenticated && column.feedType === 'home'" class="column-compose">
        <RealComposeBox />
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="column-state">
        <span class="column-state__spinner">&#x1F300;</span>
        <p>Loading...</p>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="column-state column-state--error">
        <span>&#x26A0;&#xFE0F;</span>
        <p>{{ error }}</p>
        <button class="column-retry" @click="fetchTimeline(true)">Retry</button>
      </div>

      <!-- Login prompt for home when not authenticated -->
      <div v-else-if="column.feedType === 'home' && !canShowHome" class="column-state">
        <span>&#x1F511;</span>
        <p>Log in to see your feed</p>
        <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Log In</NuxtLink>
      </div>

      <!-- Empty -->
      <div v-else-if="statuses.length === 0" class="column-state">
        <span>&#x1F4ED;</span>
        <p>No posts yet</p>
      </div>

      <!-- Posts -->
      <div v-else class="column-posts">
        <TransitionGroup name="post-list">
          <RealPostCard
            v-for="status in statuses"
            :key="status.id"
            :status="status"
          />
        </TransitionGroup>

        <!-- Infinite scroll trigger -->
        <div ref="loadTrigger" class="column-load-trigger">
          <Transition name="fade">
            <div v-if="isLoadingMore" class="column-loading-more">
              <span></span><span></span><span></span>
            </div>
          </Transition>
        </div>

        <div v-if="!hasMore && statuses.length > 0" class="column-end">
          <span>&#x2728;</span> All caught up
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.timeline-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  border-right: 1px solid var(--neo-border-color);
  position: relative;

  &:last-of-type {
    border-right: none;
  }
}

.column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.75rem;
  height: 48px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
  position: relative;
  z-index: 10;
}

.column-feed-select {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;

  &:hover {
    background: var(--neo-bg-tertiary);
  }
}

.column-feed-label {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
}

.column-feed-chevron {
  color: var(--neo-text-muted);
  transition: transform 0.2s ease;

  &--open {
    transform: rotate(180deg);
  }
}

.column-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  color: var(--neo-text-muted);
  transition: all 0.15s ease;

  &:hover {
    background: var(--neo-danger-soft);
    color: var(--neo-danger);
  }
}

.feed-dropdown {
  position: absolute;
  top: 44px;
  left: 0.5rem;
  width: 180px;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  box-shadow: var(--neo-shadow-lg);
  padding: 0.375rem;
  z-index: 20;

  &__item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--neo-text-secondary);
    border-radius: 7px;
    transition: all 0.12s ease;

    &:hover:not(:disabled) {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &--active {
      background: var(--neo-accent-soft);
      color: var(--neo-text-primary);
      font-weight: 600;
    }

    svg {
      flex-shrink: 0;
    }
  }
}

.column-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--neo-text-muted) transparent;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--neo-text-muted);
    border-radius: 3px;
    &:hover {
      background: var(--neo-text-secondary);
    }
  }
}

.column-compose {
  padding: 0.75rem;
  border-bottom: 1px solid var(--neo-border-color);
}

.column-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.625rem;
  padding: 3rem 1.5rem;
  text-align: center;

  > span:first-child {
    font-size: 1.75rem;
  }

  p {
    color: var(--neo-text-muted);
    font-size: 0.875rem;
  }

  &__spinner {
    animation: spin 2s linear infinite;
  }
}

.column-retry {
  padding: 0.5rem 1rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-tertiary);
  border-radius: 8px;
  transition: all 0.15s ease;

  &:hover {
    background: var(--neo-bg-hover);
    color: var(--neo-text-primary);
  }
}

.column-posts {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.column-load-trigger {
  min-height: 1px;
  padding: 0.5rem 0;
}

.column-loading-more {
  display: flex;
  justify-content: center;
  gap: 0.375rem;
  padding: 1rem 0;

  span {
    width: 6px;
    height: 6px;
    background: var(--neo-text-muted);
    border-radius: 50%;
    animation: bounce 1.4s ease-in-out infinite both;

    &:nth-child(1) { animation-delay: -0.32s; }
    &:nth-child(2) { animation-delay: -0.16s; }
    &:nth-child(3) { animation-delay: 0s; }
  }
}

.column-end {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 1.5rem 1rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

// Animations
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease;
  transform-origin: top left;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}

.post-list-enter-active,
.post-list-leave-active {
  transition: all 0.25s ease;
}
.post-list-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.post-list-leave-to {
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
