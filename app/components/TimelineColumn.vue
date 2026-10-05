<script setup lang="ts">
/**
 * TimelineColumn - Self-contained timeline column for multi-column layout.
 * Each column manages its own feed data, scroll, and infinite loading.
 * Supports home/local/federated timelines and group (hashtag) timelines.
 */

import type { mastodon } from 'masto'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import type { ColumnConfig, ColumnFeedType } from '~/stores/columns'
import { publicClient } from '~/composables/useMasto'

interface Props {
  column: ColumnConfig
  canRemove: boolean
  isFirst: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  remove: []
  'update-feed-type': [feedType: ColumnFeedType, groupTag?: string]
}>()

const instancesStore = useInstancesStore()
const groupsStore = useGroupsStore()

const statuses = ref<(mastodon.v1.Status | ExtendedStatus)[]>([])
const isLoading = ref(false)
const isLoadingMore = ref(false)
const error = ref<string | null>(null)
const hasMore = ref(true)
const maxId = ref<string | null>(null)
/** Per-instance max_id cursors for merged home timeline */
const homeCursors = ref<Record<string, string>>({})

const feedMenuOpen = ref(false)
const groupsExpanded = ref(false)
const scrollContainer = ref<HTMLElement | null>(null)
const loadTrigger = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

/** Newer posts waiting while you read (never auto-jump) */
const pendingNew = ref<(mastodon.v1.Status | ExtendedStatus)[]>([])
const isNearTop = ref(true)

const pendingLabel = computed(() => {
  const n = pendingNew.value.length
  if (n <= 0) return ''
  return n === 1 ? '1 new post' : `${n} new posts`
})

const feedLabels: Record<string, string> = {
  home: 'For You',
  local: 'Local',
  federated: 'Federated',
}

const feedLabel = computed(() => {
  if (props.column.feedType === 'group' && props.column.groupTag) {
    const group = groupsStore.getGroup(props.column.groupTag)
    return group ? `${group.icon} ${group.name}` : `#${props.column.groupTag}`
  }
  return feedLabels[props.column.feedType] ?? props.column.feedType
})

const canShowHome = computed(() => instancesStore.hasAuthenticatedInstance)

const joinedGroups = computed(() => groupsStore.joinedGroups)

const closeFeedMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (!target.closest('.column-feed-select') && !target.closest('.feed-dropdown')) {
    feedMenuOpen.value = false
    groupsExpanded.value = false
  }
}

const switchFeed = (type: ColumnFeedType, groupTag?: string) => {
  feedMenuOpen.value = false
  groupsExpanded.value = false
  pendingNew.value = []
  if (type === props.column.feedType && groupTag === props.column.groupTag) return
  emit('update-feed-type', type, groupTag)
}

const onComposePosted = (status: mastodon.v1.Status) => {
  if (statuses.value.some((s) => s.id === status.id)) return
  statuses.value = [status, ...statuses.value]
  pendingNew.value = pendingNew.value.filter((s) => s.id !== status.id)
}

const onScroll = () => {
  if (!scrollContainer.value) return
  isNearTop.value = scrollContainer.value.scrollTop < 96
}

/** Tap feed title: if scrolled, jump to top (and merge new posts); else open menu */
const onFeedHeaderClick = () => {
  if (scrollContainer.value && scrollContainer.value.scrollTop > 96) {
    if (pendingNew.value.length) {
      jumpToNew()
    } else {
      scrollContainer.value.scrollTo({ top: 0, behavior: 'smooth' })
    }
    return
  }
  feedMenuOpen.value = !feedMenuOpen.value
}

const jumpToNew = () => {
  const seen = new Set(statuses.value.map((s) => s.id))
  const unique = pendingNew.value.filter((s) => !seen.has(s.id))
  if (unique.length) {
    statuses.value = [...unique, ...statuses.value]
  }
  pendingNew.value = []
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

const mergeIncoming = (fresh: (mastodon.v1.Status | ExtendedStatus)[]) => {
  if (!fresh.length || !statuses.value.length) return
  const existing = new Set(statuses.value.map((s) => s.id))
  const pendingIds = new Set(pendingNew.value.map((s) => s.id))
  const cutoff = new Date(statuses.value[0]!.createdAt).getTime()
  const newer = fresh.filter((s) => {
    if (existing.has(s.id) || pendingIds.has(s.id)) return false
    return new Date(s.createdAt).getTime() > cutoff
  })
  if (!newer.length) return

  if (isNearTop.value) {
    statuses.value = [...newer, ...statuses.value]
  } else {
    pendingNew.value = [...newer, ...pendingNew.value].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }
}

const fetchFreshPage = async (): Promise<(mastodon.v1.Status | ExtendedStatus)[]> => {
  if (props.column.feedType === 'group' && props.column.groupTag) {
    const client = publicClient()
    return await client.v1.timelines.tag.$select(props.column.groupTag).list({ limit: 20 })
  }
  if (props.column.feedType === 'home') {
    if (!instancesStore.hasAuthenticatedInstance) return []
    return await instancesStore.fetchMergedHomeTimeline(20)
  }
  if (instancesStore.instances.length > 0) {
    return await instancesStore.fetchMergedTimeline(
      props.column.feedType as 'local' | 'federated',
      20,
    )
  }
  const client = publicClient()
  return await client.v1.timelines.public.list({
    local: props.column.feedType === 'local',
    limit: 20,
  })
}

const pollForNew = async () => {
  if (isLoading.value || document.hidden || !statuses.value.length) return
  try {
    const fresh = await fetchFreshPage()
    mergeIncoming(fresh)
  } catch {
    // quiet — polling failures shouldn't interrupt reading
  }
}

const fetchTimeline = async (refresh = false) => {
  if (refresh) {
    statuses.value = []
    maxId.value = null
    homeCursors.value = {}
    pendingNew.value = []
    hasMore.value = true
  }

  isLoading.value = true
  error.value = null

  try {
    let result: (mastodon.v1.Status | ExtendedStatus)[] = []

    if (props.column.feedType === 'group' && props.column.groupTag) {
      const client = publicClient()
      result = await client.v1.timelines.tag.$select(props.column.groupTag).list({ limit: 20 })
    } else if (props.column.feedType === 'home') {
      if (!instancesStore.hasAuthenticatedInstance) {
        throw new Error('Log in or add an instance to view your home timeline')
      }
      result = await instancesStore.fetchMergedHomeTimeline(20)
      // Seed per-instance cursors from the oldest post we got from each instance
      const next: Record<string, string> = {}
      for (const s of result) {
        const ext = s as ExtendedStatus
        if (!ext._instanceId) continue
        const prev = next[ext._instanceId]
        if (!prev || s.id < prev) next[ext._instanceId] = s.id
      }
      homeCursors.value = next
    } else if (instancesStore.instances.length > 0) {
      result = await instancesStore.fetchMergedTimeline(
        props.column.feedType as 'local' | 'federated',
        20,
      )
    } else {
      const client = publicClient()
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
  if (isLoadingMore.value || !hasMore.value) return
  if (props.column.feedType === 'home') {
    if (!Object.keys(homeCursors.value).length) return
  } else if (!maxId.value) {
    return
  }

  isLoadingMore.value = true

  try {
    let newStatuses: (mastodon.v1.Status | ExtendedStatus)[] = []

    switch (props.column.feedType) {
      case 'home': {
        if (!instancesStore.hasAuthenticatedInstance) break
        newStatuses = await instancesStore.fetchMergedHomeTimeline(20, { ...homeCursors.value })
        // Advance cursors with oldest id per instance from this page
        const next = { ...homeCursors.value }
        for (const s of newStatuses) {
          const ext = s as ExtendedStatus
          if (!ext._instanceId) continue
          const prev = next[ext._instanceId]
          if (!prev || s.id < prev) next[ext._instanceId] = s.id
        }
        homeCursors.value = next
        break
      }
      case 'local': {
        const client = publicClient()
        newStatuses = await client.v1.timelines.public.list({
          local: true,
          maxId: maxId.value!,
          limit: 20,
        })
        break
      }
      case 'federated': {
        const client = publicClient()
        newStatuses = await client.v1.timelines.public.list({
          local: false,
          maxId: maxId.value!,
          limit: 20,
        })
        break
      }
      case 'group': {
        if (props.column.groupTag) {
          const client = publicClient()
          newStatuses = await client.v1.timelines.tag
            .$select(props.column.groupTag)
            .list({ maxId: maxId.value!, limit: 20 })
        }
        break
      }
    }

    if (newStatuses.length > 0) {
      // Dedupe by id when merging across accounts
      const seen = new Set(statuses.value.map((s) => s.id))
      const unique = newStatuses.filter((s) => !seen.has(s.id))
      statuses.value = [...statuses.value, ...unique]
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
    },
  )
  observer.observe(loadTrigger.value)
}

watch(
  () => `${props.column.feedType}:${props.column.groupTag ?? ''}`,
  () => {
    if (instancesStore.isInitialized) fetchTimeline(true)
  },
)

watch(
  () => instancesStore.isInitialized,
  (ready) => {
    if (ready) fetchTimeline(true)
  },
)

watch(
  () => statuses.value.length,
  () => {
    nextTick(() => setupInfiniteScroll())
  },
)

onMounted(async () => {
  if (instancesStore.isAuthenticated && groupsStore.groups.length === 0) {
    groupsStore.initializeGroups()
  }
  if (instancesStore.isInitialized) {
    await fetchTimeline()
  }
  nextTick(() => {
    setupInfiniteScroll()
    scrollContainer.value?.addEventListener('scroll', onScroll, { passive: true })
  })
  document.addEventListener('click', closeFeedMenu)
  pollTimer = setInterval(pollForNew, 45000)
})

onUnmounted(() => {
  if (observer) observer.disconnect()
  document.removeEventListener('click', closeFeedMenu)
  scrollContainer.value?.removeEventListener('scroll', onScroll)
  if (pollTimer) clearInterval(pollTimer)
})
</script>
<template>
  <div class="timeline-column">
    <!-- Column Header -->
    <div class="column-header">
      <div class="column-feed-select" @click.stop="onFeedHeaderClick">
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
          <!-- Standard feeds -->
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

          <!-- Groups Section -->
          <template v-if="joinedGroups.length > 0">
            <div class="feed-dropdown__divider"></div>
            <button class="feed-dropdown__section-toggle" @click.stop="groupsExpanded = !groupsExpanded">
              <span>Groups</span>
              <svg :class="{ 'rotated': groupsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <Transition name="groups-expand">
              <div v-if="groupsExpanded" class="feed-dropdown__groups">
                <button
                  v-for="group in joinedGroups"
                  :key="group.tag"
                  class="feed-dropdown__item feed-dropdown__item--group"
                  :class="{ 'feed-dropdown__item--active': column.feedType === 'group' && column.groupTag === group.tag }"
                  @click="switchFeed('group', group.tag)"
                >
                  <span class="feed-dropdown__group-icon">{{ group.icon }}</span>
                  {{ group.name }}
                </button>
              </div>
            </Transition>
          </template>

          <!-- Browse groups link -->
          <div class="feed-dropdown__divider"></div>
          <NuxtLink to="/groups" class="feed-dropdown__item feed-dropdown__item--link" @click="feedMenuOpen = false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
            Browse Groups
          </NuxtLink>
        </div>
      </Transition>
    </div>

    <!-- Scrollable Content -->
    <div class="column-scroll" ref="scrollContainer">
      <!-- Compose (first column only, when authenticated) -->
      <div v-if="isFirst && instancesStore.isAuthenticated" class="column-compose">
        <RealComposeBox @posted="onComposePosted" />
      </div>

      <!-- New posts pill — never auto-jumps the feed -->
      <Transition name="pill-slide">
        <button
          v-if="pendingNew.length"
          type="button"
          class="column-new-pill"
          @click="jumpToNew"
        >
          {{ pendingLabel }}
        </button>
      </Transition>

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

.column-new-pill {
  position: sticky;
  top: 0.75rem;
  z-index: 8;
  display: block;
  margin: 0.75rem auto;
  padding: 0.4rem 0.9rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--neo-text-inverse);
  background: var(--neo-accent);
  border: 1px solid var(--neo-accent-dark, var(--neo-accent));
  border-radius: 2px;
  cursor: pointer;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--neo-accent) 28%, transparent);
  transition: transform 0.12s ease, background 0.12s ease;

  &:hover {
    background: var(--neo-accent-hover);
  }

  &:active {
    transform: scale(0.97);
  }
}

.pill-slide-enter-active,
.pill-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.pill-slide-enter-from,
.pill-slide-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem);
}

.column-feed-select {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color var(--neo-transition-fast);
  user-select: none;

  &:hover {
    background: var(--neo-bg-tertiary);
  }
}

.column-feed-label {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.column-feed-chevron {
  color: var(--neo-text-muted);
  transition: transform 0.2s ease;
  flex-shrink: 0;

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
  border-radius: 4px;
  color: var(--neo-text-muted);
  transition: background-color var(--neo-transition-fast), color var(--neo-transition-fast);

  &:hover {
    background: var(--neo-danger-soft);
    color: var(--neo-danger);
  }
}

// ========================================
// Feed Dropdown
// ========================================
.feed-dropdown {
  position: absolute;
  top: 44px;
  left: 0.5rem;
  width: 200px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
  box-shadow: var(--neo-shadow-md);
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
    text-decoration: none;

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

    &--group {
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
    }

    &--link {
      color: var(--neo-text-muted);
      font-size: 0.8125rem;
    }

    svg {
      flex-shrink: 0;
    }
  }

  &__group-icon {
    font-size: 1rem;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  &__divider {
    height: 1px;
    background: var(--neo-border-color);
    margin: 0.375rem 0.5rem;
  }

  &__section-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: 6px;
    transition: all 0.12s ease;

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-secondary);
    }

    svg {
      transition: transform 0.2s ease;
      &.rotated {
        transform: rotate(180deg);
      }
    }
  }

  &__groups {
    display: flex;
    flex-direction: column;
  }
}

// ========================================
// Column Scroll + Posts
// ========================================
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
  gap: 0.375rem;
  padding: 0.5rem;

  // Subtle card edges within columns
  :deep(.status-card) {
    border: 1px solid var(--neo-border-color);
    border-radius: 4px;
    transition: border-color var(--neo-transition-fast);

    &:hover {
      border-color: var(--neo-border-color-dark);
    }
  }
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

// ========================================
// Animations
// ========================================
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

.groups-expand-enter-active,
.groups-expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.groups-expand-enter-from,
.groups-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.groups-expand-enter-to,
.groups-expand-leave-from {
  max-height: 300px;
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
