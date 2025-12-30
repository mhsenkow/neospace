<script setup lang="ts">
/**
 * RealPostCard Component
 * 
 * Displays a real Mastodon status from the API.
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
    if (displayStatus.value.favourited) {
      await timelineStore.unfavouriteStatus(displayStatus.value.id)
    } else {
      await timelineStore.favouriteStatus(displayStatus.value.id)
    }
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
    if (displayStatus.value.reblogged) {
      await timelineStore.unboostStatus(displayStatus.value.id)
    } else {
      await timelineStore.boostStatus(displayStatus.value.id)
    }
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
</script>

<template>
  <article class="status-card neo-card">
    <!-- Reblog indicator -->
    <div v-if="isReblog" class="status-reblog">
      <span class="status-reblog-icon">🔁</span>
      <img 
        :src="reblogger!.avatar" 
        :alt="reblogger!.displayName || reblogger!.username"
        class="status-reblog-avatar"
      />
      <span class="status-reblog-text">
        {{ reblogger!.displayName || reblogger!.username }} boosted
      </span>
    </div>

    <!-- Main status content -->
    <header class="status-header">
      <a :href="displayStatus.account.url" target="_blank" class="status-author">
        <img 
          :src="displayStatus.account.avatar" 
          :alt="displayStatus.account.displayName || displayStatus.account.username"
          class="status-avatar neo-avatar"
        />
        <div class="status-meta">
          <span class="status-display-name" v-html="displayStatus.account.displayName || displayStatus.account.username" />
          <span class="status-username">@{{ displayStatus.account.acct }}</span>
        </div>
      </a>
      <div class="status-info">
        <span class="status-visibility" :title="displayStatus.visibility">
          {{ getVisibilityIcon(displayStatus.visibility) }}
        </span>
        <a :href="displayStatus.url || '#'" target="_blank" class="status-time">
          <time :datetime="displayStatus.createdAt">
            {{ formatDate(displayStatus.createdAt) }}
          </time>
        </a>
      </div>
    </header>

    <!-- Content Warning / Spoiler -->
    <details v-if="displayStatus.spoilerText" class="status-cw">
      <summary class="status-cw-summary">
        ⚠️ {{ displayStatus.spoilerText }}
      </summary>
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
      <p class="status-poll-info">
        {{ displayStatus.poll.votesCount }} votes · 
        {{ displayStatus.poll.expired ? 'Closed' : 'Open' }}
      </p>
    </div>

    <!-- Actions -->
    <footer class="status-actions">
      <button class="status-action" aria-label="Reply">
        <span class="status-action-icon">💬</span>
        <span class="status-action-count">{{ formatNumber(displayStatus.repliesCount) }}</span>
      </button>
      
      <button 
        class="status-action" 
        :class="{ 'status-action--active': displayStatus.reblogged }"
        :disabled="isBoosting"
        aria-label="Boost"
        @click="handleBoost"
      >
        <span class="status-action-icon">🔁</span>
        <span class="status-action-count">{{ formatNumber(displayStatus.reblogsCount) }}</span>
      </button>
      
      <button 
        class="status-action"
        :class="{ 'status-action--active': displayStatus.favourited }"
        :disabled="isFavouriting"
        aria-label="Favourite"
        @click="handleFavourite"
      >
        <span class="status-action-icon">{{ displayStatus.favourited ? '⭐' : '☆' }}</span>
        <span class="status-action-count">{{ formatNumber(displayStatus.favouritesCount) }}</span>
      </button>
      
      <button class="status-action" aria-label="Share">
        <span class="status-action-icon">📤</span>
      </button>
    </footer>
  </article>
</template>

<style lang="scss" scoped>
.status-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

// Reblog indicator
.status-reblog {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  margin-bottom: 0.25rem;

  &-icon {
    opacity: 0.7;
  }

  &-avatar {
    width: 16px;
    height: 16px;
    border-radius: var(--neo-radius-full);
  }
}

// Header
.status-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.status-author {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-decoration: none;
  min-width: 0;
  flex: 1;

  &:hover .status-display-name {
    text-decoration: underline;
  }
}

.status-avatar {
  flex-shrink: 0;
}

.status-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.status-display-name {
  font-weight: 700;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  :deep(img.emoji) {
    height: 1em;
    vertical-align: middle;
  }
}

.status-username {
  font-size: 0.875rem;
  color: var(--neo-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.status-visibility {
  font-size: 0.875rem;
  opacity: 0.7;
}

.status-time {
  font-size: 0.875rem;
  color: var(--neo-text-muted);
  white-space: nowrap;

  &:hover {
    text-decoration: underline;
  }
}

// Content Warning
.status-cw {
  &-summary {
    cursor: pointer;
    padding: 0.75rem 1rem;
    background-color: var(--neo-bg-tertiary);
    border-radius: var(--neo-radius-md);
    font-size: 0.9375rem;
    color: var(--neo-text-secondary);

    &:hover {
      background-color: var(--neo-border-color);
    }
  }

  &[open] .status-cw-summary {
    margin-bottom: 0.75rem;
  }
}

// Content
.status-content {
  font-size: 1rem;
  line-height: 1.6;
  color: var(--neo-text-primary);
  word-wrap: break-word;
  overflow-wrap: break-word;

  :deep(p) {
    margin-bottom: 0.75rem;

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
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.5rem;
  margin-top: 0.5rem;
  border-radius: var(--neo-radius-lg);
  overflow: hidden;
}

.status-media-image {
  width: 100%;
  height: auto;
  max-height: 400px;
  object-fit: cover;
  border-radius: var(--neo-radius-md);
  cursor: pointer;
  transition: opacity var(--neo-transition);

  &:hover {
    opacity: 0.9;
  }
}

.status-media-video,
.status-media-audio {
  width: 100%;
  border-radius: var(--neo-radius-md);
}

// Poll
.status-poll {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.status-poll-option {
  position: relative;
  padding: 0.5rem 0.75rem;
  background-color: var(--neo-bg-tertiary);
  border-radius: var(--neo-radius-md);
  display: flex;
  justify-content: space-between;
  overflow: hidden;
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
  font-size: 0.875rem;
  color: var(--neo-text-muted);
}

.status-poll-info {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

// Actions
.status-actions {
  display: flex;
  gap: 0.25rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--neo-border-color);
  margin-top: 0.5rem;
}

.status-action {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--neo-text-muted);
  background: transparent;
  border: none;
  border-radius: var(--neo-radius-md);
  cursor: pointer;
  transition: all var(--neo-transition);

  &:hover:not(:disabled) {
    background-color: var(--neo-accent-soft);
    color: var(--neo-accent);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--active {
    color: var(--neo-accent);
  }

  &-icon {
    font-size: 1rem;
  }

  &-count {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
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
</style>

