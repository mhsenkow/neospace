<script setup lang="ts">
/**
 * RealPostCard Component
 * 
 * Displays a real Mastodon status with reply preview for conversation intrigue.
 */

import type { mastodon } from 'masto'
import { useTimelineStore } from '~/stores/timeline'
import { useAuthStore } from '~/stores/auth'

interface Props {
  status: mastodon.v1.Status
}

const props = defineProps<Props>()
const timelineStore = useTimelineStore()
const authStore = useAuthStore()

// Get the actual status (might be a reblog)
const displayStatus = computed(() => props.status.reblog || props.status)
const isReblog = computed(() => !!props.status.reblog)
const reblogger = computed(() => isReblog.value ? props.status.account : null)

const isFavouriting = ref(false)
const isBoosting = ref(false)
const isMenuOpen = ref(false)
const isBookmarking = ref(false)
const isMuting = ref(false)
const isBlocking = ref(false)
const showCopiedToast = ref(false)
const menuRef = ref<HTMLElement | null>(null)

// Check if this post has replies (for conversation preview)
const hasReplies = computed(() => (displayStatus.value.repliesCount || 0) > 0)

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  const minutes = Math.floor(diff / (1000 * 60))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const formatNumber = (num: number) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

const handleFavourite = async () => {
  if (!authStore.isAuthenticated || isFavouriting.value) return
  
  isFavouriting.value = true
  try {
    // Pass the status URL for cross-instance resolution
    const statusUrl = displayStatus.value.url || displayStatus.value.uri
    if (displayStatus.value.favourited) {
      await timelineStore.unfavouriteStatus(displayStatus.value.id, statusUrl)
    } else {
      await timelineStore.favouriteStatus(displayStatus.value.id, statusUrl)
    }
    // Optimistically update the UI
    displayStatus.value.favourited = !displayStatus.value.favourited
    displayStatus.value.favouritesCount += displayStatus.value.favourited ? 1 : -1
  } catch (e) {
    console.error('Favourite error:', e)
  } finally {
    isFavouriting.value = false
  }
}

const handleBoost = async () => {
  if (!authStore.isAuthenticated || isBoosting.value) return
  
  isBoosting.value = true
  try {
    const statusUrl = displayStatus.value.url || displayStatus.value.uri
    if (displayStatus.value.reblogged) {
      await timelineStore.unboostStatus(displayStatus.value.id, statusUrl)
    } else {
      await timelineStore.boostStatus(displayStatus.value.id, statusUrl)
    }
    // Optimistically update the UI
    displayStatus.value.reblogged = !displayStatus.value.reblogged
    displayStatus.value.reblogsCount += displayStatus.value.reblogged ? 1 : -1
  } catch (e) {
    console.error('Boost error:', e)
  } finally {
    isBoosting.value = false
  }
}

const getVisibilityIcon = (visibility: string) => {
  switch (visibility) {
    case 'public': return '🌍'
    case 'unlisted': return '🔓'
    case 'private': return '🔒'
    case 'direct': return '✉️'
    default: return '🌍'
  }
}

// Toggle menu
const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value
}

// Close menu when clicking outside
const closeMenu = (event: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    isMenuOpen.value = false
  }
}

// Handle bookmark/save
const handleBookmark = async () => {
  if (!authStore.isAuthenticated || isBookmarking.value) return
  
  isBookmarking.value = true
  try {
    if (displayStatus.value.bookmarked) {
      await timelineStore.unbookmarkStatus(displayStatus.value.id)
    } else {
      await timelineStore.bookmarkStatus(displayStatus.value.id)
    }
  } catch (e) {
    console.error('Bookmark error:', e)
  } finally {
    isBookmarking.value = false
    isMenuOpen.value = false
  }
}

// Handle mute
const handleMute = async () => {
  if (!authStore.isAuthenticated || isMuting.value) return
  
  const confirmed = confirm(`Mute @${displayStatus.value.account.acct}? You won't see their posts in your timelines.`)
  if (!confirmed) return
  
  isMuting.value = true
  try {
    await timelineStore.muteAccount(displayStatus.value.account.id)
  } catch (e) {
    console.error('Mute error:', e)
  } finally {
    isMuting.value = false
    isMenuOpen.value = false
  }
}

// Handle block
const handleBlock = async () => {
  if (!authStore.isAuthenticated || isBlocking.value) return
  
  const confirmed = confirm(`Block @${displayStatus.value.account.acct}? They won't be able to see your posts or interact with you.`)
  if (!confirmed) return
  
  isBlocking.value = true
  try {
    await timelineStore.blockAccount(displayStatus.value.account.id)
  } catch (e) {
    console.error('Block error:', e)
  } finally {
    isBlocking.value = false
    isMenuOpen.value = false
  }
}

// Handle report
const handleReport = async () => {
  if (!authStore.isAuthenticated) return
  
  const reason = prompt(`Report this post by @${displayStatus.value.account.acct}?\n\nOptionally, provide a reason:`)
  if (reason === null) return // User cancelled
  
  try {
    await timelineStore.reportStatus(
      displayStatus.value.id, 
      displayStatus.value.account.id,
      reason || undefined
    )
    alert('Report submitted. Thank you for helping keep the community safe.')
  } catch (e) {
    console.error('Report error:', e)
    alert('Failed to submit report. Please try again.')
  } finally {
    isMenuOpen.value = false
  }
}

// Handle copy link
const handleCopyLink = async () => {
  const url = displayStatus.value.url || displayStatus.value.uri
  if (!url) return
  
  try {
    await navigator.clipboard.writeText(url)
    showCopiedToast.value = true
    setTimeout(() => {
      showCopiedToast.value = false
    }, 2000)
  } catch (e) {
    console.error('Copy error:', e)
  } finally {
    isMenuOpen.value = false
  }
}

// Open in original instance (also serves as "view thread")
const handleOpenOriginal = () => {
  const url = displayStatus.value.url || displayStatus.value.uri
  if (url) {
    window.open(url, '_blank')
  }
  isMenuOpen.value = false
}

// View thread - opens the post in its original location
const viewThread = () => {
  const url = displayStatus.value.url || displayStatus.value.uri
  if (url) {
    window.open(url, '_blank')
  }
}

// Add click outside listener
onMounted(() => {
  document.addEventListener('click', closeMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', closeMenu)
})
</script>

<template>
  <article class="status-card">
    <!-- Reblog indicator -->
    <div v-if="isReblog" class="status-reblog">
      <svg class="status-reblog-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
        <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
      </svg>
      <span class="status-reblog-text">
        {{ reblogger!.displayName || reblogger!.username }} reposted
      </span>
    </div>

    <div class="status-main">
      <!-- Avatar Column -->
      <div class="status-avatar-col">
        <a :href="displayStatus.account.url" target="_blank" class="status-avatar-link">
        <img 
          :src="displayStatus.account.avatar" 
          :alt="displayStatus.account.displayName || displayStatus.account.username"
            class="status-avatar"
          />
          <button class="status-follow-btn" aria-label="Follow">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </a>
        <!-- Thread line connecting to replies -->
        <div v-if="hasReplies" class="status-thread-line"></div>
      </div>

      <!-- Content Column -->
      <div class="status-content-col">
        <!-- Header: username + time -->
        <header class="status-header">
          <a :href="displayStatus.account.url" target="_blank" class="status-author">
            <span class="status-display-name" v-html="displayStatus.account.displayName || displayStatus.account.username" />
          </a>
          <a :href="displayStatus.url || '#'" target="_blank" class="status-time">
            <time :datetime="displayStatus.createdAt">{{ formatDate(displayStatus.createdAt) }}</time>
          </a>
          <div class="status-menu-container" ref="menuRef">
            <button class="status-more" aria-label="More options" @click.stop="toggleMenu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            
            <!-- Dropdown Menu -->
            <Transition name="menu-fade">
              <div v-if="isMenuOpen" class="status-dropdown">
                <!-- Save/Bookmark -->
                <button 
                  v-if="authStore.isAuthenticated"
                  class="status-dropdown-item"
                  :disabled="isBookmarking"
                  @click="handleBookmark"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" :fill="displayStatus.bookmarked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                  </svg>
                  <span>{{ displayStatus.bookmarked ? 'Unsave' : 'Save' }}</span>
                </button>

                <!-- Open Original -->
                <button class="status-dropdown-item" @click="handleOpenOriginal">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <span>Open original</span>
                </button>

                <!-- Divider -->
                <div v-if="authStore.isAuthenticated" class="status-dropdown-divider" />

                <!-- Mute -->
                <button 
                  v-if="authStore.isAuthenticated"
                  class="status-dropdown-item"
                  :disabled="isMuting"
                  @click="handleMute"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                  <span>Mute @{{ displayStatus.account.username }}</span>
                </button>

                <!-- Block -->
                <button 
                  v-if="authStore.isAuthenticated"
                  class="status-dropdown-item status-dropdown-item--danger"
                  :disabled="isBlocking"
                  @click="handleBlock"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  <span>Block @{{ displayStatus.account.username }}</span>
                </button>

                <!-- Report -->
                <button 
                  v-if="authStore.isAuthenticated"
                  class="status-dropdown-item status-dropdown-item--danger"
                  @click="handleReport"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Report</span>
                </button>

                <!-- Divider -->
                <div class="status-dropdown-divider" />

                <!-- Copy Link -->
                <button class="status-dropdown-item" @click="handleCopyLink">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                  </svg>
                  <span>Copy link</span>
                </button>
              </div>
            </Transition>
      </div>
    </header>

        <!-- Content Warning / Spoiler -->
    <details v-if="displayStatus.spoilerText" class="status-cw">
          <summary class="status-cw-summary">⚠️ {{ displayStatus.spoilerText }}</summary>
      <div class="status-content" v-html="displayStatus.content" />
    </details>

    <!-- Regular Content -->
    <div v-else class="status-content" v-html="displayStatus.content" />

    <!-- Media Attachments -->
    <div v-if="displayStatus.mediaAttachments?.length" class="status-media">
      <template v-for="media in displayStatus.mediaAttachments" :key="media.id">
        <img 
          v-if="media.type === 'image'"
          :src="media.previewUrl || media.url"
          :alt="media.description || 'Image attachment'"
          class="status-media-image"
          loading="lazy"
        />
        <video 
          v-else-if="media.type === 'video' || media.type === 'gifv'"
          :src="media.url"
          :poster="media.previewUrl"
          controls
          :autoplay="media.type === 'gifv'"
          :loop="media.type === 'gifv'"
          :muted="media.type === 'gifv'"
          class="status-media-video"
        />
        <audio 
          v-else-if="media.type === 'audio'"
          :src="media.url"
          controls
          class="status-media-audio"
        />
      </template>
    </div>

    <!-- Poll -->
    <div v-if="displayStatus.poll" class="status-poll">
      <div 
        v-for="option in displayStatus.poll.options" 
        :key="option.title"
        class="status-poll-option"
      >
        <span class="status-poll-title">{{ option.title }}</span>
        <span class="status-poll-votes">{{ option.votesCount }} votes</span>
        <div 
          class="status-poll-bar" 
          :style="{ width: `${(option.votesCount || 0) / (displayStatus.poll!.votesCount || 1) * 100}%` }"
        />
      </div>
          <p class="status-poll-info">{{ displayStatus.poll.votesCount }} votes · {{ displayStatus.poll.expired ? 'Closed' : 'Open' }}</p>
    </div>

        <!-- Actions - Threads Style -->
    <footer class="status-actions">
          <button class="status-action" :class="{ 'status-action--active': displayStatus.favourited }" :disabled="isFavouriting" aria-label="Like" @click="handleFavourite">
            <svg width="20" height="20" viewBox="0 0 24 24" :fill="displayStatus.favourited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
            <span v-if="displayStatus.favouritesCount" class="status-action-count">{{ formatNumber(displayStatus.favouritesCount) }}</span>
      </button>
      
          <button class="status-action" aria-label="Reply">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
            </svg>
            <span v-if="displayStatus.repliesCount" class="status-action-count">{{ formatNumber(displayStatus.repliesCount) }}</span>
      </button>
      
          <button class="status-action" :class="{ 'status-action--active': displayStatus.reblogged }" :disabled="isBoosting" aria-label="Repost" @click="handleBoost">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
              <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
            <span v-if="displayStatus.reblogsCount" class="status-action-count">{{ formatNumber(displayStatus.reblogsCount) }}</span>
      </button>
      
      <button class="status-action" aria-label="Share">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
            </svg>
      </button>
    </footer>

        <!-- Reply Preview / Thread Teaser -->
        <button 
          v-if="hasReplies" 
          class="status-thread-preview"
          @click="viewThread"
        >
          <span class="thread-preview-text">
            View {{ displayStatus.repliesCount === 1 ? 'reply' : `${formatNumber(displayStatus.repliesCount)} replies` }}
          </span>
          <svg class="thread-preview-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Copied Toast -->
    <Teleport to="body">
      <Transition name="toast-fade">
        <div v-if="showCopiedToast" class="status-toast">
          ✓ Link copied
        </div>
      </Transition>
    </Teleport>
  </article>
</template>

<style lang="scss" scoped>
// ============================================
// THREADS-STYLE POST CARD
// ============================================

.status-card {
  padding: 0.875rem;
  background: var(--neo-bg-card);
  border-radius: 12px;
  
  // Subtle card feel on mobile too
  @media (max-width: 1023px) {
    background: var(--neo-bg-secondary);
    border-radius: 8px;
  }
}

// Reblog indicator
.status-reblog {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  margin-bottom: 0.5rem;
  padding-left: 52px;

  &-icon {
    width: 14px;
    height: 14px;
    opacity: 0.7;
  }

  &-text {
    font-weight: 500;
  }
}

// Main layout - two columns like Threads
.status-main {
  display: flex;
  gap: 0.75rem;
}

// Avatar Column
.status-avatar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 40px;
  flex-shrink: 0;
}

.status-avatar-link {
  position: relative;
  display: block;
  text-decoration: none;
}

.status-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.status-follow-btn {
  position: absolute;
  bottom: -4px;
  right: -4px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--neo-text-primary);
  color: var(--neo-bg-primary);
  border: 2px solid var(--neo-bg-primary);
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.15s ease;

  svg {
    width: 10px;
    height: 10px;
  }

  &:hover {
    transform: scale(1.1);
  }
}

// Thread line connecting to replies
.status-thread-line {
  flex: 1;
  width: 2px;
  background: var(--neo-border-color);
  margin-top: 0.5rem;
  min-height: 12px;
  border-radius: 1px;
}

// Content Column
.status-content-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

// Header
.status-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.status-author {
  display: flex;
  align-items: center;
  text-decoration: none;
  min-width: 0;

  &:hover .status-display-name {
    text-decoration: underline;
  }
}

.status-display-name {
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  :deep(img.emoji) {
    height: 1em;
    vertical-align: middle;
  }
}

.status-time {
  font-size: 0.875rem;
  color: var(--neo-text-muted);
  white-space: nowrap;
  text-decoration: none;
  margin-left: auto;
  padding-right: 0.25rem;

  &:hover {
    text-decoration: underline;
  }
}

.status-menu-container {
  position: relative;
}

.status-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--neo-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--neo-accent-soft);
    color: var(--neo-text-primary);
  }
}

// Dropdown Menu - Threads Style
.status-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 220px;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  z-index: 100;
  overflow: hidden;
  padding: 0.5rem 0;

  @media (min-width: 480px) {
    min-width: 250px;
  }
}

.status-dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 1rem;
  font-size: 0.9375rem;
  color: var(--neo-text-primary);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;

  svg {
    flex-shrink: 0;
    color: var(--neo-text-secondary);
  }

  span {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &:hover:not(:disabled) {
    background: var(--neo-bg-tertiary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--danger {
    color: #dc3545;

    svg {
      color: #dc3545;
    }

    &:hover:not(:disabled) {
      background: rgba(220, 53, 69, 0.1);
    }
  }
}

.status-dropdown-divider {
  height: 1px;
  background: var(--neo-border-color);
  margin: 0.5rem 0;
}

// Menu animations
.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.95);
}


// Content Warning
.status-cw {
  &-summary {
    cursor: pointer;
    padding: 0.5rem 0.75rem;
    background-color: var(--neo-bg-tertiary);
    border-radius: 8px;
    font-size: 0.875rem;
    color: var(--neo-text-secondary);

    &:hover {
      background-color: var(--neo-border-color);
    }
  }

  &[open] .status-cw-summary {
    margin-bottom: 0.5rem;
  }
}

// Content
.status-content {
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--neo-text-primary);
  word-wrap: break-word;
  overflow-wrap: break-word;

  :deep(p) {
    margin-bottom: 0.5rem;

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(a) {
    color: var(--neo-accent);

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(.mention) {
    color: var(--neo-accent);
  }

  :deep(.hashtag) {
    color: var(--neo-accent);
  }

  :deep(img.emoji) {
    height: 1.2em;
    vertical-align: middle;
  }
}

// Media
.status-media {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.375rem;
  margin-top: 0.5rem;
  border-radius: 12px;
  overflow: hidden;

  // Multi-image grid
  &:has(> *:nth-child(2)) {
    grid-template-columns: repeat(2, 1fr);
  }
}

.status-media-image {
  width: 100%;
  height: auto;
  max-height: 350px;
  object-fit: cover;
  border-radius: 12px;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 0.95;
  }
}

.status-media-video,
.status-media-audio {
  width: 100%;
  border-radius: 12px;
}

// Poll
.status-poll {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.status-poll-option {
  position: relative;
  padding: 0.5rem 0.75rem;
  background-color: var(--neo-bg-tertiary);
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  overflow: hidden;
  font-size: 0.875rem;
}

.status-poll-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background-color: var(--neo-accent-soft);
  z-index: 0;
}

.status-poll-title,
.status-poll-votes {
  position: relative;
  z-index: 1;
}

.status-poll-votes {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.status-poll-info {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

// Actions - Threads Style
.status-actions {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  margin-top: 0.5rem;
  margin-left: -0.5rem;
}

.status-action {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem;
  font-size: 0.875rem;
  color: var(--neo-text-muted);
  background: transparent;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.15s ease;

  svg {
    width: 20px;
    height: 20px;
  }

  &:hover:not(:disabled) {
    background: var(--neo-accent-soft);
    color: var(--neo-text-primary);
  }

  &:active:not(:disabled) {
    transform: scale(0.9);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--active {
    color: #f91880; // Pink like for hearts

    svg {
      stroke: #f91880;
      fill: #f91880;
    }
  }

  &-count {
    font-size: 0.8125rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: inherit;
    padding-right: 0.375rem;
  }
}

// Thread Preview / View Replies Button
.status-thread-preview {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.625rem;
  padding: 0.5rem 0;
  background: transparent;
  border: none;
  color: var(--neo-text-muted);
  font-size: 0.875rem;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--neo-text-secondary);
    
    .thread-preview-arrow {
      transform: translateX(2px);
    }
  }

  .thread-preview-text {
    font-weight: 500;
  }

  .thread-preview-arrow {
    width: 14px;
    height: 14px;
    transition: transform 0.15s ease;
    opacity: 0.7;
  }
}

// Chaos mode
:global(.chaos-active) {
  .status-display-name {
    text-shadow: 0 0 5px currentColor;
  }

  .status-action--active {
    text-shadow: 0 0 10px currentColor;
  }
}

// Desktop card style
@media (min-width: 1024px) {
  .status-card {
    background: var(--neo-bg-card);
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    padding: 1rem;

    &:hover {
      background: var(--neo-bg-secondary);
    }
  }

  .status-reblog {
    padding-left: 52px;
  }

  .status-avatar {
    width: 44px;
    height: 44px;
  }

  .status-avatar-col {
    width: 44px;
  }

  .status-content {
    font-size: 1rem;
  }

  .status-media-image {
    max-height: 400px;
  }
}
</style>

<!-- Unscoped styles for teleported toast -->
<style lang="scss">
.status-toast {
  position: fixed;
  bottom: 7.5rem; // Above mobile bottom nav
  left: 50%;
  transform: translateX(-50%);
  padding: 0.75rem 1.25rem;
  background: #1a1a1a;
  color: #ffffff;
  border-radius: 100px;
  font-size: 0.875rem;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 9999;

  @media (min-width: 1024px) {
    bottom: 2rem;
  }
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>
