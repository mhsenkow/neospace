<script setup lang="ts">
/**
 * Group Detail Page
 * 
 * Shows a single group's feed - which is really a hashtag timeline,
 * but presented as a cohesive group experience.
 */

import type { mastodon } from 'masto'
import { useGroupsStore, isGroupTagName } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'
import { useColumnsStore } from '~/stores/columns'
import { categoryColor } from '~/composables/useShellAppearance'
import { logError } from '~/utils/log'
import { getPageScrollTop, scrollPageTo } from '~/utils/pageScroll'
import { useMobileViewport } from '~/composables/useBreakpoint'
import { plainTextOf } from '~/utils/plainText'
import { useDebouncedValue } from '~/composables/useDebouncedValue'

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
/** Hand-typed / crafted URLs: never send a non-hashtag to the API */
const tagValid = computed(() => isGroupTagName(tag.value))

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

/** Phones/tablets: one-row composer pill so posts start above the fold */
const isMobile = useMobileViewport()

const isJoining = ref(false)
const isLeaving = ref(false)
const loadMoreError = ref<string | null>(null)
const postsQuery = ref('')
/** Debounced find-in-feed query — filtering parses every loaded post */
const postsFindQuery = useDebouncedValue(postsQuery, 150)

const visibleTimeline = computed(() => {
  const list = groupsStore.groupTimeline
  const q = postsFindQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((s) => {
    const src = s.reblog || s
    const hay = [
      plainTextOf(src),
      src.spoilerText || '',
      src.account?.displayName || '',
      src.account?.username || '',
      src.account?.acct || '',
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

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
  if (!isGroupTagName(newTag)) return
  const restoredScroll = groupsStore.restoreTimeline(newTag)
  if (restoredScroll != null) {
    await nextTick()
    scrollPageTo(restoredScroll)
    return
  }
  await groupsStore.fetchGroupTimeline(newTag, true)
}

onMounted(async () => {
  // Seeds the curated list synchronously; trends + memberships load alongside
  // the timeline instead of in front of it
  if (groupsStore.groups.length === 0) {
    void groupsStore.initializeGroups()
  }
  await loadTimeline(tag.value)
})

watch(tag, async (newTag, oldTag) => {
  if (oldTag && oldTag !== newTag) {
    groupsStore.cacheTimeline(oldTag, getPageScrollTop())
  }
  postsQuery.value = ''
  if (newTag) await loadTimeline(newTag)
})

onBeforeUnmount(() => {
  groupsStore.clearTimeline(tag.value, getPageScrollTop())
})

// Handle join
const joinBtnRef = ref<HTMLButtonElement | null>(null)
const leaveBtnRef = ref<HTMLButtonElement | null>(null)

/** Join↔Leave swap via v-if destroys the focused button — move focus to its replacement */
const refocusMembershipButton = async (hadFocus: boolean) => {
  if (!hadFocus) return
  await nextTick()
  ;(leaveBtnRef.value || joinBtnRef.value)?.focus()
}

const handleJoin = async () => {
  if (!tagValid.value) return
  if (!instancesStore.isAuthenticated) {
    router.push('/login')
    return
  }

  const hadFocus = !!joinBtnRef.value && document.activeElement === joinBtnRef.value
  isJoining.value = true
  try {
    await groupsStore.joinGroup(tag.value)
  } catch (e) {
    logError('Failed to join:', e)
    void showActionError('Couldn’t join group', () => { void handleJoin() })
  } finally {
    isJoining.value = false
    void refocusMembershipButton(hadFocus)
  }
}

// Leave immediately, offer Undo to rejoin
const handleLeave = async () => {
  if (isLeaving.value || !tagValid.value) return
  const leftTag = tag.value
  const hadFocus = !!leaveBtnRef.value && document.activeElement === leaveBtnRef.value
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
    void refocusMembershipButton(hadFocus)
  }
}

// Load more posts
const handleLoadMore = async () => {
  loadMoreError.value = null
  try {
    await groupsStore.loadMoreTimeline()
  } catch (e: any) {
    const message: string = e?.message || 'Couldn’t load more posts'
    loadMoreError.value = message
    void showActionError(message, () => { void handleLoadMore() })
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
  if (!tagValid.value) return
  const id = columnsStore.ensureFocusedView('group', tag.value.toLowerCase())
  if (id) router.push('/')
}

// Page meta
useHead({
  title: computed(() => `${displayGroup.value.name} · Groups | NeoSpace`),
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
    <SubviewChrome :title="displayGroup.name" :back-action="goBack">
      <template v-if="tagValid" #actions>
        <button
          type="button"
          class="subview-chrome__btn neo-tip group-chrome-board"
          :aria-label="isOnBoard ? 'Open on your board' : 'Add as a column on Home'"
          @click="addToBoard"
        >
          <NeoIcon :name="isOnBoard ? 'check' : 'plus'" :size="18" :stroke="1.75" />
        </button>
      </template>
    </SubviewChrome>

    <div v-if="!tagValid" class="timeline-empty" role="alert">
      <span class="empty-emoji" aria-hidden="true">🏷️</span>
      <h2>That’s not a hashtag</h2>
      <p>Group names use letters, numbers, and underscores.</p>
      <NuxtLink to="/groups" class="neo-btn neo-btn--ghost">Browse groups</NuxtLink>
    </div>

    <template v-else>
    <!-- Header -->
    <header class="group-header" :style="{ '--category-color': categoryColor(displayGroup.category) }">
      <div class="group-info">
        <div class="group-icon">
          <span aria-hidden="true">{{ displayGroup.icon }}</span>
        </div>
        
        <div class="group-meta">
          <!-- SubviewChrome already renders the page h1 -->
          <h2 class="group-name">{{ displayGroup.name }}</h2>
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
            <span class="action-btn__text">{{ isOnBoard ? 'On board' : 'Add column' }}</span>
          </button>
          <button
            v-if="displayGroup.isMember"
            ref="leaveBtnRef"
            class="action-btn action-btn--leave"
            :disabled="isLeaving"
            :aria-label="isLeaving ? 'Leaving group' : 'Joined — leave group'"
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
            ref="joinBtnRef"
            class="action-btn action-btn--join"
            :disabled="isJoining"
            :title="instancesStore.isAuthenticated ? 'Join this group' : 'Log in to join'"
            @click="handleJoin"
          >
            <span v-if="isJoining">Joining...</span>
            <span v-else>+ Join</span>
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
      <span aria-hidden="true">✨</span>
      <p>You're a member! Posts from this group will appear in your home timeline.</p>
    </div>

    <!-- Compose Box (for authenticated users) -->
    <RealComposeBox
      v-if="instancesStore.isAuthenticated"
      :initial-group-tag="tag"
      lock-group
      :compact="isMobile"
      :title="`Post to ${displayGroup.name}`"
      :placeholder="`Share with #${tag}…`"
      :accept-handoff="false"
      @posted="onGroupPosted"
    />

    <!-- Timeline -->
    <section class="group-timeline">
      <div
        v-if="groupsStore.groupTimeline.length || postsQuery.trim()"
        class="group-posts-search neo-sticky-bar neo-sticky-bar--under-chrome"
      >
        <label class="group-posts-search__field">
          <span class="sr-only">Search group posts</span>
          <NeoIcon name="search" :size="16" :stroke="1.75" class="group-posts-search__icon" aria-hidden="true" />
          <input
            v-model="postsQuery"
            type="search"
            class="group-posts-search__input"
            placeholder="Search posts…"
            autocomplete="off"
            enterkeyhint="search"
          />
        </label>
      </div>

      <!-- Loading State -->
      <div v-if="groupsStore.isLoadingTimeline" class="timeline-loading" aria-busy="true">
        <FunLoader fill label="Loading group posts" />
      </div>

      <!-- Error State -->
      <div v-else-if="groupsStore.error" class="timeline-error" role="alert">
        <span aria-hidden="true">😕</span>
        <p>{{ groupsStore.error }}</p>
        <button type="button" class="neo-btn neo-btn--ghost" @click="groupsStore.fetchGroupTimeline(tag, true)">
          Try again
        </button>
      </div>

      <!-- Empty State -->
      <div v-else-if="groupsStore.groupTimeline.length === 0" class="timeline-empty">
        <span class="empty-emoji" aria-hidden="true">📭</span>
        <h3>No posts yet</h3>
        <p>No posts visible from your server yet. Use #{{ tag }} when you post.</p>
      </div>

      <div v-else-if="postsFindQuery.trim() && !visibleTimeline.length" class="timeline-empty">
        <span class="empty-emoji" aria-hidden="true">🔍</span>
        <h3>No matches</h3>
        <p>No loaded posts match “{{ postsFindQuery.trim() }}”.</p>
      </div>

      <!-- Posts -->
      <div v-else class="timeline-posts">
        <RealPostCard
          v-for="status in visibleTimeline"
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
          <span aria-hidden="true">🎉</span>
          <p>You've seen all the posts!</p>
        </div>
      </div>
    </section>

    <!-- Floating Post Hint (for non-authenticated users) -->
    <div v-if="!instancesStore.isAuthenticated" class="post-hint">
      <p>Log in to post in this group using <code>#{{ tag }}</code></p>
      <NuxtLink to="/login" class="post-hint__login">Log In</NuxtLink>
    </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.group-detail {
  max-width: 700px;
  margin: 0 auto;
  padding: 0 0.5rem calc(1.5rem + env(safe-area-inset-bottom, 0px));
  min-width: 0;
  width: 100%;
  box-sizing: border-box;

  @media (min-width: 480px) {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  @media (min-width: 1024px) {
    padding-bottom: 3rem;
  }
}

/* Sticky chrome: board action on phones; header button on desktop */
.group-chrome-board {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-primary);
  cursor: pointer;

  &:hover {
    background: var(--neo-bg-hover, var(--neo-bg-tertiary));
  }

  @media (min-width: 1024px) {
    display: none;
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

.group-info {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;

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
  overflow-wrap: anywhere;
  word-break: break-word;

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
  overflow-wrap: anywhere;
  word-break: break-word;

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
  overflow-wrap: anywhere;

  @media (min-width: 480px) {
    margin-top: 0.75rem;
    font-size: 0.9375rem;
    line-height: 1.5;
  }
}

.group-actions {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex-shrink: 0;
  align-self: stretch;
  width: 100%;
  position: relative;
  z-index: 2;

  @media (min-width: 600px) {
    align-self: center;
    width: auto;
    flex-wrap: nowrap;
  }
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.625rem 1rem;
  min-height: 44px;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  border-radius: 100px;
  cursor: pointer;
  transition: all 0.15s ease;
  flex: 1 1 auto;
  min-width: 0;
  width: auto;
  pointer-events: auto;

  @media (min-width: 480px) {
    padding: 0.75rem 1.25rem;
    font-size: 0.9375rem;
  }

  @media (min-width: 600px) {
    flex: 0 0 auto;
    min-width: 9.5rem;
  }

  &--board {
    background: rgba(255, 255, 255, 0.18);
    color: white;
    border: 2px solid rgba(255, 255, 255, 0.65);

    @media (max-width: 1023px) {
      display: none;
    }

    &:hover {
      background: rgba(255, 255, 255, 0.28);
    }
  }

  &--board-on {
    background: white;
    color: color-mix(in srgb, var(--category-color) 68%, #000);
    border-color: white;
  }

  &--join {
    background: white;
    // Raw gold/orange category hues are ~3:1 on white — darken the label
    color: color-mix(in srgb, var(--category-color) 68%, #000);
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

    // Touch has no hover reveal — one tap leaves, so say so up front
    @media (hover: none) {
      .action-btn__leave-label {
        display: inline;

        &::before {
          content: '· ';
        }
      }
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
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  background: var(--neo-accent-soft);
  border: 1px solid var(--neo-accent);
  border-radius: 10px;
  margin-bottom: 1rem;
  min-width: 0;

  @media (min-width: 480px) {
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-radius: 12px;
    margin-bottom: 1.5rem;
  }

  > span {
    flex-shrink: 0;
    font-size: 1.125rem;

    @media (min-width: 480px) {
      font-size: 1.25rem;
    }
  }

  p {
    margin: 0;
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
    color: var(--neo-text-primary);
    line-height: 1.4;

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

.group-posts-search {
  margin: 0 0 0.85rem;
  padding: 0.35rem 0 0.55rem;
  background: var(--neo-bg-primary);
  border-bottom: 1px solid var(--neo-border-color);

  &__field {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.35rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--neo-border-color);
    border-radius: var(--neo-radius-md, 12px);
    background: var(--neo-bg-tertiary);
    box-sizing: border-box;

    &:focus-within {
      border-color: color-mix(in srgb, var(--neo-accent) 50%, var(--neo-border-color));
      box-shadow: 0 0 0 3px var(--neo-accent-soft);
    }
  }

  &__icon {
    flex-shrink: 0;
    color: var(--neo-text-muted);
  }

  &__input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--neo-text-primary);
    font: inherit;
    font-size: 0.875rem;
    outline: none;

    &::placeholder {
      color: var(--neo-text-muted);
    }
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
    color: var(--neo-text-on-accent, #fff);
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

  h2,
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

// Post Hint (for non-authenticated users) — detail is a mobile subview (no tab bar)
.post-hint {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 0.75rem);
  left: 0.5rem;
  right: 0.5rem;
  max-width: min(36rem, calc(100vw - 1rem));
  margin: 0 auto;
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
  box-sizing: border-box;

  @media (min-width: 480px) {
    left: 1rem;
    right: 1rem;
    padding: 0.875rem 1.25rem;
    border-radius: 100px;
    gap: 1rem;
  }

  @media (min-width: 1024px) {
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
    color: var(--neo-text-on-accent, #fff);
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

