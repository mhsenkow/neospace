<script setup lang="ts">
/**
 * PostCard Component
 * 
 * Displays a single post in the feed.
 * Adapts to both Mom Mode and Chaos Mode aesthetics.
 */

import type { MockPost } from '~/composables/useMockData'

interface Props {
  post: MockPost
}

defineProps<Props>()

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  const minutes = Math.floor(diff / (1000 * 60))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

const formatNumber = (num: number) => {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toString()
}
</script>

<template>
  <article class="post-card neo-card">
    <header class="post-card__header">
      <img 
        :src="post.author.avatar" 
        :alt="post.author.displayName"
        class="post-card__avatar neo-avatar"
      />
      <div class="post-card__meta">
        <span class="post-card__display-name">{{ post.author.displayName }}</span>
        <span class="post-card__username">@{{ post.author.username }}</span>
        <span class="post-card__separator">·</span>
        <time class="post-card__time" :datetime="post.createdAt">
          {{ formatDate(post.createdAt) }}
        </time>
      </div>
    </header>

    <div class="post-card__content" v-html="post.content" />

    <footer class="post-card__actions">
      <button class="post-card__action" aria-label="Reply">
        <span class="post-card__action-icon">💬</span>
        <span class="post-card__action-count">{{ formatNumber(post.repliesCount) }}</span>
      </button>
      <button class="post-card__action" aria-label="Boost">
        <span class="post-card__action-icon">🔁</span>
        <span class="post-card__action-count">{{ formatNumber(post.reblogsCount) }}</span>
      </button>
      <button class="post-card__action" aria-label="Favorite">
        <span class="post-card__action-icon">⭐</span>
        <span class="post-card__action-count">{{ formatNumber(post.favouritesCount) }}</span>
      </button>
      <button class="post-card__action" aria-label="Share">
        <span class="post-card__action-icon">📤</span>
      </button>
    </footer>
  </article>
</template>

<style lang="scss" scoped>
.post-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  &__header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  &__avatar {
    flex-shrink: 0;
  }

  &__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    font-size: 0.9375rem;
    line-height: 1.3;
  }

  &__display-name {
    font-weight: 700;
    color: var(--neo-text-primary);
  }

  &__username {
    color: var(--neo-text-muted);
    font-size: 0.875rem;
  }

  &__separator {
    color: var(--neo-text-muted);
  }

  &__time {
    color: var(--neo-text-muted);
    font-size: 0.875rem;
  }

  &__content {
    font-size: 1rem;
    line-height: 1.6;
    color: var(--neo-text-primary);

    :deep(p) {
      margin-bottom: 0.75rem;

      &:last-child {
        margin-bottom: 0;
      }
    }

    :deep(a) {
      color: var(--neo-accent);
      text-decoration: underline;
      text-decoration-color: transparent;
      transition: text-decoration-color var(--neo-transition);

      &:hover {
        text-decoration-color: currentColor;
      }
    }

    :deep(code) {
      font-family: var(--neo-font-mono);
      font-size: 0.875em;
      padding: 0.125rem 0.375rem;
      background-color: var(--neo-bg-tertiary);
      border-radius: var(--neo-radius-sm);
    }
  }

  &__actions {
    display: flex;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--neo-border-color);
    margin-top: 0.5rem;
  }

  &__action {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: var(--neo-text-muted);
    background-color: transparent;
    border: none;
    border-radius: var(--neo-radius-md);
    cursor: pointer;
    transition: all var(--neo-transition);

    &:hover {
      background-color: var(--neo-accent-soft);
      color: var(--neo-accent);
    }

    &-icon {
      font-size: 1rem;
      line-height: 1;
    }

    &-count {
      font-weight: 500;
    }
  }
}

// Chaos mode enhancements
:global(.chaos-active) {
  .post-card {
    &__display-name {
      text-shadow: 0 0 5px currentColor;
    }

    &__action:hover {
      transform: scale(1.1);
    }
  }
}
</style>

