<script setup lang="ts">
/**
 * GroupCard Component
 * 
 * Displays a group as a friendly card.
 * The user doesn't need to know it's really a hashtag underneath!
 */

import type { Group } from '~/stores/groups'
import { useGroupsStore } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'

interface Props {
  group: Group
  compact?: boolean
  /** Threads-style discovery tile for horizontal rails */
  tile?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
  tile: false,
})

const emit = defineEmits<{
  view: [tag: string]
}>()

const groupsStore = useGroupsStore()
const instancesStore = useInstancesStore()

const isJoining = ref(false)
const isLeaving = ref(false)

const handleJoin = async () => {
  if (!instancesStore.isAuthenticated) {
    // Could redirect to login or show a message
    return
  }
  
  isJoining.value = true
  try {
    await groupsStore.joinGroup(props.group.tag)
  } catch (e) {
    console.error('Failed to join group:', e)
  } finally {
    isJoining.value = false
  }
}

const handleLeave = async () => {
  isLeaving.value = true
  try {
    await groupsStore.leaveGroup(props.group.tag)
  } catch (e) {
    console.error('Failed to leave group:', e)
  } finally {
    isLeaving.value = false
  }
}

const handleView = () => {
  emit('view', props.group.tag)
}

const getCategoryColor = (category: string) => {
  const colors: Record<string, string> = {
    tech: '#c45c26',
    creative: '#b8860b',
    gaming: '#2f7d4a',
    social: '#a84c1e',
    news: '#3a6ea5',
    trending: '#c45c26',
    local: '#757575',
    other: '#757575',
  }
  return colors[category] || colors.other
}
</script>

<template>
  <article 
    class="group-card" 
    :class="{
      'group-card--compact': compact,
      'group-card--tile': tile,
      'group-card--member': group.isMember,
    }"
    @click="handleView"
  >
    <div class="group-card__icon" :style="{ backgroundColor: getCategoryColor(group.category) + '20' }">
      <span class="group-card__emoji">{{ group.icon }}</span>
    </div>
    
    <div class="group-card__content">
      <h3 class="group-card__name">{{ group.name }}</h3>
      <p v-if="!compact && !tile && group.description" class="group-card__description">
        {{ group.description }}
      </p>
      <p v-else-if="tile" class="group-card__tagline">
        {{ group.trending ? 'Trending' : `#${group.tag}` }}
      </p>
      <div v-if="!tile" class="group-card__meta">
        <span class="group-card__tag">#{{ group.tag }}</span>
        <span
          class="group-card__category"
          :style="{ color: getCategoryColor(group.trending ? 'trending' : group.category) }"
        >
          {{ group.trending ? 'trending' : group.category }}
        </span>
      </div>
    </div>
    
    <div class="group-card__actions" @click.stop>
      <button
        v-if="group.isMember"
        class="group-card__btn group-card__btn--leave"
        :disabled="isLeaving"
        @click="handleLeave"
      >
        <span v-if="isLeaving">...</span>
        <span v-else>{{ tile ? 'Joined' : 'Leave' }}</span>
      </button>
      <button
        v-else
        class="group-card__btn group-card__btn--join"
        :disabled="isJoining || !instancesStore.isAuthenticated"
        :title="instancesStore.isAuthenticated ? 'Join this group' : 'Log in to join groups'"
        @click="handleJoin"
      >
        <span v-if="isJoining">...</span>
        <span v-else>Join</span>
      </button>
    </div>

    <!-- Member badge -->
    <div v-if="group.isMember && !tile" class="group-card__badge">
      <NeoIcon name="check" :size="12" :stroke="2.5" />
    </div>
  </article>
</template>

<style lang="scss" scoped>
.group-card {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.75rem;
  padding: 0.875rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;

  @media (min-width: 480px) {
    gap: 0.875rem;
    padding: 1rem;
  }

  &:hover {
    border-color: var(--neo-border-color-dark);
    background: var(--neo-bg-secondary);
  }

  &--member {
    border-color: color-mix(in srgb, var(--neo-accent) 40%, transparent);
    background: var(--neo-accent-soft);
  }

  &--compact {
    padding: 0.625rem 0.75rem;
    gap: 0.625rem;
    align-items: center;

    .group-card__icon {
      width: 36px;
      height: 36px;
    }

    .group-card__emoji {
      font-size: 1.125rem;
    }

    .group-card__name {
      font-size: 0.875rem;
      margin-bottom: 0.125rem;
    }

    .group-card__description {
      display: none;
    }

    .group-card__actions {
      display: none;
    }
  }

  &--tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    width: 9.5rem;
    flex: 0 0 auto;
    padding: 1rem 0.75rem 0.85rem;
    gap: 0.65rem;
    height: auto;
    scroll-snap-align: start;

    .group-card__icon {
      width: 64px;
      height: 64px;
      border-radius: 18px;
    }

    .group-card__emoji {
      font-size: 1.75rem;
    }

    .group-card__content {
      width: 100%;
    }

    .group-card__name {
      font-size: 0.8125rem;
      margin: 0 0 0.2rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .group-card__tagline {
      margin: 0;
      font-size: 0.6875rem;
      color: var(--neo-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .group-card__meta {
      display: none;
    }

    .group-card__actions {
      width: 100%;
      align-self: stretch;
    }

    .group-card__btn {
      width: 100%;
      min-height: 32px;
      padding: 0.3rem 0.5rem;
      font-size: 0.75rem;
      border-radius: 999px;
    }

    .group-card__btn--leave {
      background: transparent;
      color: var(--neo-text-muted);
      border-color: var(--neo-border-color);
    }
  }

  &__icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 4px;
    transition: transform 0.15s ease;
  }

  &:hover &__icon {
    @media (hover: hover) {
      transform: scale(1.04);
    }
  }

  &__emoji {
    font-size: 1.375rem;
    line-height: 1;
  }

  &__content {
    min-width: 0;
  }

  &__name {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    line-height: 1.25;
    overflow-wrap: anywhere;

    @media (min-width: 480px) {
      font-size: 1rem;
    }
  }

  &__description {
    margin: 0 0 0.5rem;
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem 0.625rem;
    font-size: 0.75rem;
  }

  &__tag {
    color: var(--neo-text-muted);
    font-family: var(--neo-font-family-mono);
  }

  &__category {
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
  }

  &__actions {
    align-self: center;
  }

  &__btn {
    min-height: 36px;
    padding: 0.375rem 0.875rem;
    font-size: 0.8125rem;
    font-weight: 600;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    white-space: nowrap;

    &--join {
      background: var(--neo-accent);
      color: var(--neo-text-inverse);

      &:hover:not(:disabled) {
        background: var(--neo-accent-hover);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    &--leave {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-secondary);
      border: 1px solid var(--neo-border-color);

      &:hover:not(:disabled) {
        background: var(--neo-danger-soft);
        color: var(--neo-danger);
        border-color: var(--neo-danger-light);
      }

      &:disabled {
        opacity: 0.5;
      }
    }
  }

  &__badge {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--neo-accent);
    color: var(--neo-text-inverse);
    font-size: 0.6875rem;
    font-weight: 700;
    border-radius: 50%;
  }
}

// Narrow phones: stack action under content so Join isn't crushed
@media (max-width: 379px) {
  .group-card:not(.group-card--compact) {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'icon content'
      'actions actions';

    .group-card__icon { grid-area: icon; }
    .group-card__content { grid-area: content; }
    .group-card__actions {
      grid-area: actions;
      justify-self: stretch;

      .group-card__btn {
        width: 100%;
      }
    }
  }
}
</style>

