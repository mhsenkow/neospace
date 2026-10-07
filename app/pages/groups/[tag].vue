<script setup lang="ts">
/**
 * Group Detail Page
 * 
 * Shows a single group's feed - which is really a hashtag timeline,
 * but presented as a cohesive group experience.
 */

import type { mastodon } from 'masto'
import { useGroupsStore } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'
import { useColumnsStore } from '~/stores/columns'
import { categoryColor } from '~/composables/useShellAppearance'
import { logError } from '~/utils/log'

const route = useRoute()
const router = useRouter()
const groupsStore = useGroupsStore()
const instancesStore = useInstancesStore()
const columnsStore = useColumnsStore()

function normalizeGroupTag(raw: string): string {
  try {
    return decodeURIComponent(String(raw)).replace(/^#/, '').trim()
  } catch {
    return String(raw).replace(/^#/, '').trim()
  }
}

// Get the tag from route
const tag = computed(() => normalizeGroupTag(route.params.tag as string))

// The current group info
const group = computed(() => groupsStore.getGroup(tag.value))

// Create a dynamic group if it doesn't exist in our predefined list
const displayGroup = computed(() => {
  if (group.value) return group.value
  
  // Create an ad-hoc group for this hashtag
  return {
    tag: tag.value,
    name: groupsStore.formatTagAsName(tag.value),
    icon: '🏷️',
    category: 'other' as const,
    isMember: groupsStore.followedTags.some(
      t => t.name.toLowerCase() === tag.value.toLowerCase()
    ),
    featured: false
  }
})

const isJoining = ref(false)
const isLeaving = ref(false)
const loadMoreError = ref<string | null>(null)

const showActionError = async (message: string, retry?: () => void) => {
  const { useToastStore } = await import('~/stores/toast')
  useToastStore().show({
    message,
    actionLabel: retry ? 'Retry' : undefined,
    duration: retry ? 6000 : 4000,
    onAction: retry,
  })
}

const onGroupPosted = (status: mastodon.v1.Status) => {
  groupsStore.prependToTimeline(tag.value, status)
}

const loadTimeline = async (newTag: string) => {
  const restoredScroll = groupsStore.restoreTimeline(newTag)
  if (restoredScroll != null) {
    await nextTick()
    window.scrollTo({ top: restoredScroll, behavior: 'auto' })
    return
  }
  await groupsStore.fetchGroupTimeline(newTag, true)
}

onMounted(async () => {
  if (groupsStore.groups.length === 0) {
    await groupsStore.initializeGroups()
  }
  await loadTimeline(tag.value)
})

watch(tag, async (newTag, oldTag) => {
  if (oldTag && oldTag !== newTag) {
    groupsStore.cacheTimeline(oldTag, window.scrollY)
  }
  if (newTag) await loadTimeline(newTag)
})

onUnmounted(() => {
  groupsStore.clearTimeline(tag.value, window.scrollY)
})

// Handle join
const handleJoin = async () => {
  if (!instancesStore.isAuthenticated) {
    router.push('/login')
    return
  }
  
  isJoining.value = true
  try {
    await groupsStore.joinGroup(tag.value)
  } catch (e) {
    logError('Failed to join:', e)
    void showActionError('Couldn’t join group', () => { void handleJoin() })
  } finally {
    isJoining.value = false
  }
}

// Leave immediately, offer Undo to rejoin
const handleLeave = async () => {
  if (isLeaving.value) return
  const leftTag = tag.value
  isLeaving.value = true
  try {
    await groupsStore.leaveGroup(leftTag)
    const { useToastStore } = await import('~/stores/toast')
    useToastStore().show({
      message: `Left #${leftTag}`,
      actionLabel: 'Undo',
      duration: 5000,
      onAction: () => {
        void groupsStore.joinGroup(leftTag)
      },
    })
  } catch (e) {
    logError('Failed to leave:', e)
    void showActionError('Couldn’t leave group', () => { void handleLeave() })
  } finally {
    isLeaving.value = false
  }
}

// Load more posts
const handleLoadMore = async () => {
  loadMoreError.value = null
  try {
    await groupsStore.loadMoreTimeline()
  } catch (e: any) {
    loadMoreError.value = e?.message || 'Couldn’t load more posts'
    void showActionError(loadMoreError.value, () => { void handleLoadMore() })
  }
}

// Go back
const goBack = () => {
  router.push('/groups')
}

const isOnBoard = computed(() =>
  columnsStore.columns.some(
    (c) => c.feedType === 'group' && c.groupTag?.toLowerCase() === tag.value.toLowerCase(),
  ),
)

/** Pin this hashtag feed as a board column and jump home */
const addToBoard = () => {
  const id = columnsStore.ensureFocusedView('group', tag.value.toLowerCase())
  if (id) router.push('/')
}

// Page meta
useHead({
  title: computed(() => `${displayGroup.value.name} - Groups - NeoSpace`),
  meta: [
    { 
      name: 'description', 
      content: computed(() => displayGroup.value.description || `Posts in the ${displayGroup.value.name} group`) 
    }
  ]
})
</script>

<template>
  <div class="group-detail">
    <!-- Header -->
    <header class="group-header" :style="{ '--category-color': categoryColor(displayGroup.category) }">
      <button class="back-btn" @click="goBack">
        <NeoIcon name="chevron-left" :size="18" :stroke="2" />
        <span>All Groups</span>
      </button>

      <div class="group-info">
        <div class="group-icon">
          <span aria-hidden="true">{{ displayGroup.icon }}</span>
        </div>
        
        <div class="group-meta">
          <h1 class="group-name">{{ displayGroup.name }}</h1>
          <p class="group-tag">#{{ displayGroup.tag }}</p>
          <p v-if="displayGroup.description" class="group-description">
            {{ displayGroup.description }}
          </p>
        </div>

        <div class="group-actions">
          <button
            class="action-btn action-btn--board"
            :class="{ 'action-btn--board-on': isOnBoard }"
            :title="isOnBoard ? 'Open on your board' : 'Add as a column on Home'"
            @click="addToBoard"
          >
            <NeoIcon :name="isOnBoard ? 'check' : 'plus'" :size="14" :stroke="2.5" />
            <span>{{ isOnBoard ? 'On board' : 'Add column' }}</span>
          </button>
          <button
            v-if="displayGroup.isMember"
            class="action-btn action-btn--leave"
            :disabled="isLeaving"
            aria-label="Leave group"
            @click="handleLeave"
          >
            <span v-if="isLeaving">Leaving…</span>
            <span v-else class="action-btn__joined">
              <NeoIcon name="check" :size="14" :stroke="2.5" />
              <span class="action-btn__joined-label">Joined</span>
              <span class="action-btn__leave-label">Leave</span>
            </span>
          </button>
          <button
            v-else
            class="action-btn action-btn--join"
            :disabled="isJoining"
            :title="instancesStore.isAuthenticated ? 'Join this group' : 'Log in to join'"
            @click="handleJoin"
          >
            <span v-if="isJoining">Joining...</span>
            <span v-else>+ Join Group</span>
          </button>
        </div>
      </div>

      <div class="header-decoration">
        <div class="deco-ring deco-ring-1"></div>
        <div class="deco-ring deco-ring-2"></div>
      </div>
    </header>

    <!-- Membership Banner -->
    <div v-if="displayGroup.isMember" class="member-banner">
      <span>✨</span>
      <p>You're a member! Posts from this group will appear in your home timeline.</p>
    </div>

    <!-- Compose Box (for authenticated users) -->
    <RealComposeBox
      v-if="instancesStore.isAuthenticated"
      :initial-group-tag="tag"
      lock-group
      :title="`Post to ${displayGroup.name}`"
      :placeholder="`Share with #${tag}…`"
      :accept-handoff="false"
      @posted="onGroupPosted"
    />

    <!-- Timeline -->
    <section class="group-timeline">
      <!-- Loading State -->
      <div v-if="groupsStore.isLoadingTimeline" class="timeline-loading" aria-busy="true">
        <FunLoader fill label="Loading group posts" />
      </div>

      <!-- Error State -->
      <div v-else-if="groupsStore.error" class="timeline-error">
        <span>😕</span>
        <p>{{ groupsStore.error }}</p>
        <button type="button" class="neo-btn neo-btn--ghost" @click="groupsStore.fetchGroupTimeline(tag, true)">
          Try again
        </button>
      </div>

      <!-- Empty State -->
      <div v-else-if="groupsStore.groupTimeline.length === 0" class="timeline-empty">
        <span class="empty-emoji">📭</span>
        <h3>No posts yet</h3>
        <p>No posts visible from your server yet. Use #{{ tag }} when you post.</p>
      </div>

      <!-- Posts -->
      <div v-else class="timeline-posts">
        <RealPostCard
          v-for="status in groupsStore.groupTimeline"
          :key="status.id"
          :status="status"
        />
        
        <!-- Load More -->
        <div v-if="groupsStore.hasMore" class="load-more">
          <button 
            class="load-more-btn"
            :disabled="groupsStore.isLoadingMore"
            @click="handleLoadMore"
          >
            <span v-if="groupsStore.isLoadingMore">Loading...</span>
            <span v-else>Load More Posts</span>
          </button>
        </div>

        <!-- End of Feed -->
        <div v-else class="timeline-end">
          <span>🎉</span>
          <p>You've seen all the posts!</p>
        </div>
      </div>
    </section>

    <!-- Floating Post Hint (for non-authenticated users) -->
    <div v-if="!instancesStore.isAuthenticated" class="post-hint">
      <p>Log in to post in this group using <code>#{{ tag }}</code></p>
      <NuxtLink to="/login" class="post-hint__login">Log In</NuxtLink>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.group-detail {
  max-width: 700px;
  margin: 0 auto;
  padding: 0 0.5rem 5rem; // Extra bottom padding for mobile nav

  @media (min-width: 480px) {
    padding: 0 1rem 5rem;
  }

  @media (min-width: 1024px) {
    padding: 0 1rem 3rem; // Less padding on desktop (no bottom nav)
  }
}

// Header
.group-header {
  position: relative;
  padding: 1rem;
  // Mix toward black so white chrome stays ≥4.5:1 on light category hues
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--category-color) 78%, #0a0a0a),
    color-mix(in srgb, var(--category-color) 55%, #121212)
  );
  border-radius: 14px;
  margin-bottom: 1rem;
  overflow: hidden;

  @media (min-width: 480px) {
    padding: 1.25rem;
    border-radius: 16px;
    margin-bottom: 1.25rem;
  }

  @media (min-width: 600px) {
    padding: 1.5rem;
    border-radius: 20px;
    margin-bottom: 1.5rem;
  }
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background: rgba(255, 255, 255, 0.2);
  border: none;
  border-radius: 100px;
  color: white;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 0.75rem;

  @media (min-width: 480px) {
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: translateX(-4px);
  }

  span:first-child {
    font-size: 1rem;

    @media (min-width: 480px) {
      font-size: 1.125rem;
    }
  }
}

.group-info {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  @media (min-width: 480px) {
    gap: 1rem;
  }

  @media (min-width: 600px) {
    flex-direction: row;
    align-items: flex-start;
  }
}

.group-icon {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 14px;
  backdrop-filter: blur(10px);

  @media (min-width: 480px) {
    width: 64px;
    height: 64px;
    border-radius: 16px;
  }

  @media (min-width: 600px) {
    width: 72px;
    height: 72px;
    border-radius: 18px;
  }

  span {
    font-size: 1.75rem;
    line-height: 1;

    @media (min-width: 480px) {
      font-size: 2rem;
    }

    @media (min-width: 600px) {
      font-size: 2.5rem;
    }
  }
}

.group-meta {
  flex: 1;
  min-width: 0;
}

.group-name {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 800;
  color: white;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  line-height: 1.2;

  @media (min-width: 480px) {
    font-size: 1.5rem;
  }

  @media (min-width: 600px) {
    font-size: 1.75rem;
  }
}

.group-tag {
  margin: 0.125rem 0 0;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.85);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;

  @media (min-width: 480px) {
    margin-top: 0.25rem;
    font-size: 1rem;
  }
}

.group-description {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.45;

  @media (min-width: 480px) {
    margin-top: 0.75rem;
    font-size: 0.9375rem;
    line-height: 1.5;
  }
}

.group-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-shrink: 0;
  align-self: flex-start;
  width: 100%;
  position: relative;
  z-index: 2;

  @media (min-width: 600px) {
    align-self: center;
    width: auto;
  }
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  border-radius: 100px;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  pointer-events: auto;

  @media (min-width: 480px) {
    padding: 0.75rem 1.5rem;
    font-size: 0.9375rem;
  }

  @media (min-width: 600px) {
    width: auto;
    min-width: 9.5rem;
  }

  &--board {
    background: rgba(255, 255, 255, 0.18);
    color: white;
    border: 2px solid rgba(255, 255, 255, 0.65);

    &:hover {
      background: rgba(255, 255, 255, 0.28);
    }
  }

  &--board-on {
    background: white;
    color: var(--category-color);
    border-color: white;
  }

  &--join {
    background: white;
    color: var(--category-color);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

    &:hover:not(:disabled) {
      transform: scale(1.02);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }

  &--leave {
    background: rgba(255, 255, 255, 0.25);
    color: white;
    border: 2px solid rgba(255, 255, 255, 0.5);

    .action-btn__leave-label {
      display: none;
    }

    &:hover:not(:disabled),
    &:focus-visible:not(:disabled) {
      background: rgba(255, 255, 255, 0.35);

      .action-btn__joined-label {
        display: none;
      }

      .action-btn__leave-label {
        display: inline;
      }
    }

    &:disabled {
      opacity: 0.6;
    }
  }
}

.action-btn__joined {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.header-decoration {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.deco-ring {
  position: absolute;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.15);

  &-1 {
    width: 200px;
    height: 200px;
    top: -80px;
    right: -60px;
  }

  &-2 {
    width: 150px;
    height: 150px;
    bottom: -60px;
    left: -40px;
  }
}

// Member Banner
.member-banner {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  background: var(--neo-accent-soft);
  border: 1px solid var(--neo-accent);
  border-radius: 10px;
  margin-bottom: 1rem;

  @media (min-width: 480px) {
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-radius: 12px;
    margin-bottom: 1.5rem;
  }

  span {
    font-size: 1.125rem;

    @media (min-width: 480px) {
      font-size: 1.25rem;
    }
  }

  p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--neo-text-primary);

    @media (min-width: 480px) {
      font-size: 0.9375rem;
    }
  }
}

// Timeline
.group-timeline {
  min-height: 200px;

  @media (min-width: 480px) {
    min-height: 300px;
  }
}

.timeline-loading,
.timeline-error,
.timeline-empty {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  text-align: center;
  min-height: min(55dvh, 28rem);
  padding: 1.25rem;
  color: var(--neo-text-muted);
  box-sizing: border-box;

  @media (min-width: 480px) {
    padding: 1.5rem;
  }
}

.timeline-error,
.timeline-empty {
  align-items: center;
  gap: 0.75rem;
}

.timeline-error {
  span {
    font-size: 2.5rem;
    display: block;
    margin-bottom: 0.75rem;

    @media (min-width: 480px) {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
  }

  button {
    margin-top: 0.75rem;
    padding: 0.625rem 1.25rem;
    background: var(--neo-accent);
    color: white;
    border: none;
    border-radius: 100px;
    font-weight: 600;
    cursor: pointer;

    @media (min-width: 480px) {
      margin-top: 1rem;
      padding: 0.75rem 1.5rem;
    }

    &:hover {
      filter: brightness(1.1);
    }
  }
}

.timeline-empty {
  .empty-emoji {
    font-size: 3rem;
    display: block;
    margin-bottom: 0.75rem;
    opacity: 0.8;

    @media (min-width: 480px) {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
  }

  h3 {
    margin: 0 0 0.375rem;
    font-size: 1.125rem;
    color: var(--neo-text-primary);

    @media (min-width: 480px) {
      margin-bottom: 0.5rem;
      font-size: 1.25rem;
    }
  }

  p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--neo-text-secondary);

    @media (min-width: 480px) {
      font-size: 0.9375rem;
    }
  }
}

// Posts
.timeline-posts {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  @media (min-width: 480px) {
    gap: 1rem;
  }
}

// Load More
.load-more {
  display: flex;
  justify-content: center;
  padding: 0.75rem 0;

  @media (min-width: 480px) {
    padding: 1rem 0;
  }
}

.load-more-btn {
  width: 100%;
  padding: 0.75rem 1.5rem;
  background: var(--neo-bg-secondary);
  border: 2px solid var(--neo-border-color);
  border-radius: 100px;
  color: var(--neo-text-primary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  @media (min-width: 480px) {
    width: auto;
    padding: 0.875rem 2rem;
    font-size: 0.9375rem;
  }

  &:hover:not(:disabled) {
    border-color: var(--neo-accent);
    color: var(--neo-accent);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.timeline-end {
  text-align: center;
  padding: 1.5rem;
  color: var(--neo-text-muted);

  @media (min-width: 480px) {
    padding: 2rem;
  }

  span {
    font-size: 1.75rem;
    display: block;
    margin-bottom: 0.375rem;

    @media (min-width: 480px) {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }
  }

  p {
    margin: 0;
    font-size: 0.8125rem;

    @media (min-width: 480px) {
      font-size: 0.9375rem;
    }
  }
}

// Post Hint (for non-authenticated users)
.post-hint {
  position: fixed;
  bottom: calc(var(--neo-mobile-nav-h, 64px) + env(safe-area-inset-bottom, 0px) + 0.75rem);
  left: 0.5rem;
  right: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;

  @media (min-width: 480px) {
    bottom: 1rem;
    left: 1rem;
    right: 1rem;
    padding: 0.875rem 1.25rem;
    border-radius: 100px;
    gap: 1rem;
  }

  @media (min-width: 600px) {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    bottom: 1.5rem;
    padding: 0.875rem 1.5rem;
    flex-wrap: nowrap;
  }

  p {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
    text-align: center;

    @media (min-width: 480px) {
      font-size: 0.875rem;
    }
  }

  code {
    background: var(--neo-accent-soft);
    color: var(--neo-accent);
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.75rem;
    font-weight: 600;

    @media (min-width: 480px) {
      font-size: 0.8125rem;
    }
  }

  &__login {
    padding: 0.5rem 1rem;
    background: var(--neo-accent);
    color: white;
    text-decoration: none;
    border-radius: 100px;
    font-size: 0.8125rem;
    font-weight: 600;
    transition: all 0.15s ease;
    flex-shrink: 0;

    @media (min-width: 480px) {
      padding: 0.5rem 1.25rem;
      font-size: 0.875rem;
    }

    &:hover {
      filter: brightness(1.1);
      transform: scale(1.02);
    }
  }
}
</style>

