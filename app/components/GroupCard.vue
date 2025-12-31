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
  gap: 0.75rem;
  padding: 1rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;

  @media (min-width: 480px) {
    gap: 1rem;
    padding: 1.25rem;
    border-radius: 16px;
  }

  &:hover {
    border-color: var(--neo-accent);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }

  // Disable hover transform on touch devices
  @media (hover: none) {
    &:hover {
      transform: none;
    }
  }

  &--member {
    border-color: var(--neo-accent);
    background: linear-gradient(135deg, var(--neo-bg-secondary), var(--neo-accent-soft));
  }

  &--compact {
    padding: 0.75rem;
    gap: 0.625rem;

    @media (min-width: 480px) {
      padding: 1rem;
      gap: 0.75rem;
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
    border-radius: 12px;
    transition: transform 0.2s ease;

    @media (min-width: 480px) {
      width: 56px;
      height: 56px;
      border-radius: 14px;
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
    margin: 0 0 0.125rem;
    font-size: 1rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    line-height: 1.3;

    @media (min-width: 480px) {
      margin-bottom: 0.25rem;
      font-size: 1.125rem;
    }
  }

  &__description {
    margin: 0 0 0.375rem;
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;

    @media (min-width: 480px) {
      margin-bottom: 0.5rem;
      font-size: 0.875rem;
      line-height: 1.5;
    }
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;

    @media (min-width: 480px) {
      gap: 0.75rem;
      font-size: 0.8125rem;
    }
  }

  &__tag {
    color: var(--neo-text-muted);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }

  &__category {
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.625rem;
    letter-spacing: 0.05em;

    @media (min-width: 480px) {
      font-size: 0.6875rem;
    }
  }

  &__actions {
    flex-shrink: 0;
    align-self: center;
  }

  &__btn {
    padding: 0.4375rem 0.875rem;
    font-size: 0.8125rem;
    font-weight: 600;
    border: none;
    border-radius: 100px;
    cursor: pointer;
    transition: all 0.15s ease;

    @media (min-width: 480px) {
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
    }

    &--join {
      background: var(--neo-accent);
      color: white;

      &:hover:not(:disabled) {
        filter: brightness(1.1);
        transform: scale(1.02);
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
        background: #fee2e2;
        color: #dc2626;
        border-color: #fca5a5;
      }

      &:disabled {
        opacity: 0.5;
      }
    }
  }

  &__badge {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--neo-accent);
    color: white;
    font-size: 0.625rem;
    font-weight: bold;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

    @media (min-width: 480px) {
      top: -6px;
      right: -6px;
      width: 22px;
      height: 22px;
      font-size: 0.75rem;
    }
  }
}

// Dark mode adjustments
:root[data-theme="dark"] {
  .group-card {
    &__btn--leave:hover:not(:disabled) {
      background: rgba(220, 38, 38, 0.2);
      color: #f87171;
      border-color: rgba(248, 113, 113, 0.3);
    }
  }
}
</style>

