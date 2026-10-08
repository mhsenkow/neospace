<script setup lang="ts">
/**
 * GroupCard Component
 *
 * Displays a group as a friendly card.
 */

import type { Group } from '~/stores/groups'
import { useGroupsStore } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import { categoryColor, categoryTint } from '~/composables/useShellAppearance'

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
const toastStore = useToastStore()
const router = useRouter()

const isPending = computed(() => groupsStore.isTagPending(props.group.tag))

const handleJoin = async () => {
  if (!instancesStore.isAuthenticated) {
    router.push('/login')
    return
  }

  try {
    await groupsStore.joinGroup(props.group.tag)
  } catch {
    toastStore.show({
      message: 'Couldn’t join group',
      actionLabel: 'Retry',
      duration: 5000,
      onAction: () => { void handleJoin() },
    })
  }
}

const handleLeave = async () => {
  const leftTag = props.group.tag
  try {
    await groupsStore.leaveGroup(leftTag)
    toastStore.show({
      message: `Left #${leftTag}`,
      actionLabel: 'Undo',
      duration: 5000,
      onAction: () => { void groupsStore.joinGroup(leftTag) },
    })
  } catch {
    toastStore.show({
      message: 'Couldn’t leave group',
      actionLabel: 'Retry',
      duration: 5000,
      onAction: () => { void handleLeave() },
    })
  }
}

const handleView = () => {
  emit('view', props.group.tag)
}

const catColor = computed(() =>
  categoryColor(props.group.trending ? 'trending' : props.group.category),
)
const catTint = computed(() =>
  categoryTint(props.group.trending ? 'trending' : props.group.category),
)
</script>

<template>
  <article
    class="group-card"
    :class="{
      'group-card--compact': compact,
      'group-card--tile': tile,
      'group-card--member': group.isMember,
    }"
  >
    <div class="group-card__icon" :style="{ backgroundColor: catTint }">
      <span class="group-card__emoji" aria-hidden="true">{{ group.icon }}</span>
    </div>

    <div class="group-card__content">
      <h3 class="group-card__name">
        <NuxtLink
          :to="`/groups/${group.tag}`"
          class="group-card__name-link"
          @click="handleView"
        >
          {{ group.name }}
        </NuxtLink>
      </h3>
      <p v-if="!compact && !tile && group.description" class="group-card__description">
        {{ group.description }}
      </p>
      <p v-else-if="tile" class="group-card__tagline">
        {{ group.trending ? 'Trending' : `#${group.tag}` }}
      </p>
      <div v-if="!tile" class="group-card__meta">
        <span class="group-card__tag">#{{ group.tag }}</span>
        <span class="group-card__category">
          <span class="group-card__category-dot" :style="{ backgroundColor: catColor }" aria-hidden="true" />
          {{ group.trending ? 'trending' : group.category }}
        </span>
      </div>
    </div>

    <div class="group-card__actions" @click.stop>
      <button
        v-if="group.isMember"
        type="button"
        class="group-card__btn group-card__btn--leave"
        :disabled="isPending"
        :aria-pressed="true"
        @click="handleLeave"
      >
        <span v-if="isPending" class="group-card__spinner" aria-hidden="true" />
        <span v-if="isPending" class="sr-only">Leaving…</span>
        <span v-else class="group-card__btn-label">
          <span class="group-card__btn-joined">{{ tile ? 'Joined' : 'Joined' }}</span>
          <span class="group-card__btn-leave">Leave</span>
        </span>
      </button>
      <button
        v-else
        type="button"
        class="group-card__btn group-card__btn--join"
        :disabled="isPending"
        :aria-pressed="false"
        :title="instancesStore.isAuthenticated ? 'Join this group' : 'Log in to join groups'"
        @click="handleJoin"
      >
        <span v-if="isPending" class="group-card__spinner" aria-hidden="true" />
        <span v-if="isPending" class="sr-only">Joining…</span>
        <span v-else>Join</span>
      </button>
    </div>

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
  border-radius: var(--neo-radius-md, 4px);
  cursor: default;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;

  &:has(.group-card__name-link:hover),
  &:has(.group-card__name-link:focus-visible) {
    border-color: var(--neo-accent);
    background: var(--neo-bg-hover);
  }

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
  }

  &--tile {
    flex: 0 0 11.5rem;
    scroll-snap-align: start;
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
    min-height: 9.5rem;
    padding: 0.875rem;

    .group-card__icon {
      width: 44px;
      height: 44px;
    }

    .group-card__actions {
      margin-top: auto;
    }
  }

  &__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--neo-radius-md, 8px);
    flex-shrink: 0;
  }

  &__emoji {
    font-size: 1.375rem;
    line-height: 1;
  }

  &__name {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 700;
    line-height: 1.25;
  }

  &__name-link {
    color: var(--neo-text-primary);
    text-decoration: none;

    &::after {
      content: '';
      position: absolute;
      inset: 0;
    }

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
    }
  }

  &__description,
  &__tagline {
    margin: 0.25rem 0 0;
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
    line-height: 1.35;
  }

  &__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.35rem;
    font-size: 0.75rem;
  }

  &__tag {
    color: var(--neo-text-muted);
  }

  &__category {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--neo-text-secondary);
    text-transform: capitalize;
  }

  &__category-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  &__actions {
    position: relative;
    z-index: 2;
  }

  &__btn {
    min-width: 44px;
    min-height: 44px;
    padding: 0.35rem 0.75rem;
    border-radius: var(--neo-radius-pill, 999px);
    font-size: 0.8125rem;
    font-weight: 650;
    cursor: pointer;
    border: 1px solid transparent;

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
    }

    &:disabled {
      opacity: 0.7;
      cursor: wait;
    }

    &--join {
      color: var(--neo-text-on-accent, var(--neo-text-inverse));
      background: var(--neo-accent);
      border-color: var(--neo-accent);
    }

    &--leave {
      color: var(--neo-text-secondary);
      background: var(--neo-bg-secondary);
      border-color: var(--neo-border-color);

      .group-card__btn-leave {
        display: none;
      }

      &:hover,
      &:focus-visible {
        .group-card__btn-joined {
          display: none;
        }
        .group-card__btn-leave {
          display: inline;
          color: var(--neo-danger);
        }
      }

      /* Touch: no hover reveal — show Leave up front */
      @media (hover: none) {
        .group-card__btn-leave {
          display: inline;
          color: var(--neo-danger);

          &::before {
            content: '· ';
          }
        }
      }
    }
  }

  &__spinner {
    display: inline-block;
    width: 0.875rem;
    height: 0.875rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: group-card-spin 0.7s linear infinite;
  }

  &__badge {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background: var(--neo-accent);
    color: var(--neo-text-on-accent, var(--neo-text-inverse));
  }
}

@keyframes group-card-spin {
  to { transform: rotate(360deg); }
}
</style>
