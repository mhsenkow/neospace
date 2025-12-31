<script setup lang="ts">
/**
 * GroupCard Component
 * 
 * Displays a group as a friendly card.
 * The user doesn't need to know it's really a hashtag underneath!
 */

import type { Group } from '~/stores/groups'
import { useGroupsStore } from '~/stores/groups'
import { useAuthStore } from '~/stores/auth'

interface Props {
  group: Group
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: false
})

const emit = defineEmits<{
  view: [tag: string]
}>()

const groupsStore = useGroupsStore()
const authStore = useAuthStore()

const isJoining = ref(false)
const isLeaving = ref(false)

const handleJoin = async () => {
  if (!authStore.isAuthenticated) {
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
    tech: '#6366f1',
    creative: '#f59e0b',
    gaming: '#10b981',
    social: '#ec4899',
    news: '#3b82f6',
    local: '#8b5cf6',
    other: '#6b7280'
  }
  return colors[category] || colors.other
}
</script>

<template>
  <article 
    class="group-card" 
    :class="{ 'group-card--compact': compact, 'group-card--member': group.isMember }"
    @click="handleView"
  >
    <div class="group-card__icon" :style="{ backgroundColor: getCategoryColor(group.category) + '20' }">
      <span class="group-card__emoji">{{ group.icon }}</span>
    </div>
    
    <div class="group-card__content">
      <h3 class="group-card__name">{{ group.name }}</h3>
      <p v-if="!compact && group.description" class="group-card__description">
        {{ group.description }}
      </p>
      <div class="group-card__meta">
        <span class="group-card__tag">#{{ group.tag }}</span>
        <span 
          class="group-card__category"
          :style="{ color: getCategoryColor(group.category) }"
        >
          {{ group.category }}
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
        <span v-else>Leave</span>
      </button>
      <button
        v-else
        class="group-card__btn group-card__btn--join"
        :disabled="isJoining || !authStore.isAuthenticated"
        :title="authStore.isAuthenticated ? 'Join this group' : 'Log in to join groups'"
        @click="handleJoin"
      >
        <span v-if="isJoining">...</span>
        <span v-else>Join</span>
      </button>
    </div>

    <!-- Member badge -->
    <div v-if="group.isMember" class="group-card__badge">
      <span>✓</span>
    </div>
  </article>
</template>

<style lang="scss" scoped>
.group-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--neo-spacing-3);
  padding: var(--neo-spacing-4);
  background: var(--neo-bg-card);
  border: var(--neo-border-width) var(--neo-border-style) var(--neo-border-color);
  border-radius: var(--neo-radius-lg);
  cursor: pointer;
  transition: all var(--neo-transition);

  @media (min-width: 480px) {
    gap: 1rem;
    padding: 1.25rem;
    border-radius: 16px;
  }

  &:hover {
    border-color: var(--neo-accent);
    transform: translateY(-2px);
    box-shadow: var(--neo-shadow-md);
  }

  // Disable hover transform on touch devices
  @media (hover: none) {
    &:hover {
      transform: none;
    }
  }

  &--member {
    border-color: var(--neo-accent);
    background: linear-gradient(135deg, var(--neo-bg-card), var(--neo-accent-soft));
  }

  &--compact {
    padding: var(--neo-spacing-3);
    gap: var(--neo-spacing-2);

    @media (min-width: 480px) {
      padding: var(--neo-spacing-4);
      gap: var(--neo-spacing-3);
    }

    .group-card__icon {
      width: 36px;
      height: 36px;

      @media (min-width: 480px) {
        width: 40px;
        height: 40px;
      }
    }

    .group-card__emoji {
      font-size: 1.125rem;

      @media (min-width: 480px) {
        font-size: 1.25rem;
      }
    }

    .group-card__name {
      font-size: 0.9375rem;

      @media (min-width: 480px) {
        font-size: 1rem;
      }
    }

    .group-card__description {
      display: none;
    }
  }

  &__icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--neo-radius-md);
    transition: transform var(--neo-transition);

    @media (min-width: 480px) {
      width: 56px;
      height: 56px;
      border-radius: var(--neo-radius-lg);
    }
  }

  .group-card:hover &__icon {
    @media (hover: hover) {
      transform: scale(1.05) rotate(-3deg);
    }
  }

  &__emoji {
    font-size: 1.375rem;
    line-height: 1;

    @media (min-width: 480px) {
      font-size: 1.75rem;
    }
  }

  &__content {
    flex: 1;
    min-width: 0;
  }

  &__name {
    margin: 0 0 var(--neo-spacing-1);
    font-size: var(--neo-font-size-base);
    font-weight: var(--neo-font-weight-bold);
    color: var(--neo-text-primary);
    line-height: var(--neo-line-height-tight);

    @media (min-width: 480px) {
      margin-bottom: var(--neo-spacing-2);
      font-size: var(--neo-font-size-lg);
    }
  }

  &__description {
    margin: 0 0 var(--neo-spacing-2);
    font-size: var(--neo-font-size-sm);
    color: var(--neo-text-secondary);
    line-height: var(--neo-line-height-relaxed);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;

    @media (min-width: 480px) {
      margin-bottom: var(--neo-spacing-3);
      font-size: var(--neo-font-size-sm);
      line-height: var(--neo-line-height-normal);
    }
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: var(--neo-spacing-2);
    font-size: var(--neo-font-size-xs);

    @media (min-width: 480px) {
      gap: var(--neo-spacing-3);
      font-size: var(--neo-font-size-sm);
    }
  }

  &__tag {
    color: var(--neo-text-muted);
    font-family: var(--neo-font-family-mono);
  }

  &__category {
    font-weight: var(--neo-font-weight-semibold);
    text-transform: uppercase;
    font-size: var(--neo-font-size-xs);
    letter-spacing: var(--neo-letter-spacing-wide);

    @media (min-width: 480px) {
      font-size: var(--neo-font-size-xs);
    }
  }

  &__actions {
    flex-shrink: 0;
    align-self: center;
  }

  &__btn {
    padding: var(--neo-spacing-2) var(--neo-spacing-4);
    font-size: var(--neo-font-size-sm);
    font-weight: var(--neo-font-weight-semibold);
    border: none;
    border-radius: var(--neo-radius-full);
    cursor: pointer;
    transition: all var(--neo-transition-fast);

    @media (min-width: 480px) {
      padding: var(--neo-spacing-2) var(--neo-spacing-4);
      font-size: var(--neo-font-size-sm);
    }

    &--join {
      background: var(--neo-accent);
      color: var(--neo-text-inverse);

      &:hover:not(:disabled) {
        background: var(--neo-accent-hover);
        transform: scale(1.02);
        box-shadow: var(--neo-shadow-sm);
      }

      &:disabled {
        opacity: var(--neo-opacity-50);
        cursor: not-allowed;
      }
    }

    &--leave {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-secondary);
      border: var(--neo-border-width) var(--neo-border-style) var(--neo-border-color);

      &:hover:not(:disabled) {
        background: var(--neo-danger-soft);
        color: var(--neo-danger);
        border-color: var(--neo-danger-light);
      }

      &:disabled {
        opacity: var(--neo-opacity-50);
      }
    }
  }

  &__badge {
    position: absolute;
    top: calc(var(--neo-spacing-1) * -1);
    right: calc(var(--neo-spacing-1) * -1);
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--neo-accent);
    color: var(--neo-text-inverse);
    font-size: var(--neo-font-size-xs);
    font-weight: var(--neo-font-weight-bold);
    border-radius: var(--neo-radius-full);
    box-shadow: var(--neo-shadow-sm);

    @media (min-width: 480px) {
      top: calc(var(--neo-spacing-2) * -1);
      right: calc(var(--neo-spacing-2) * -1);
      width: 22px;
      height: 22px;
      font-size: var(--neo-font-size-sm);
    }
  }
}
</style>

