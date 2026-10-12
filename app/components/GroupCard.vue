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
import { joinGroupFailure } from '~/utils/groupErrors'
import { formatCountLabel } from '~/utils/searchQuery'

interface Props {
  group: Group
  /** Threads-style discovery tile for horizontal rails */
  tile?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  tile: false,
})

const groupsStore = useGroupsStore()
const instancesStore = useInstancesStore()
const toastStore = useToastStore()
const router = useRouter()

const isPending = computed(() => groupsStore.isTagPending(props.group.tag))

/**
 * Membership lives in the store. Search results are plain objects that never enter
 * `groups` until a join, so reading `props.group.isMember` left a joined card on "Join".
 */
const isMember = computed(
  () => groupsStore.getGroup(props.group.tag)?.isMember ?? props.group.isMember,
)

/**
 * Join ↔ Leave swap (and the pending `disabled`) destroys / blurs the focused
 * button — hand focus to whichever button is rendered once things settle.
 */
const actionBtnRef = ref<HTMLButtonElement | null>(null)
let refocusAction = false
const noteActionFocus = () => {
  if (typeof document !== 'undefined' && document.activeElement === actionBtnRef.value) {
    refocusAction = true
  }
}
watch(
  [isMember, isPending],
  () => {
    if (!refocusAction || isPending.value) return
    refocusAction = false
    nextTick(() => actionBtnRef.value?.focus())
  },
  { flush: 'post' },
)

const handleJoin = async () => {
  if (!instancesStore.isAuthenticated) {
    router.push('/login')
    return
  }
  noteActionFocus()

  try {
    await groupsStore.joinGroup(props.group.tag)
  } catch (e) {
    const { message, retryable } = joinGroupFailure(e)
    toastStore.show({
      message,
      ...(retryable ? { actionLabel: 'Retry', onAction: () => { void handleJoin() } } : {}),
      duration: 5000,
    })
  }
}

const handleLeave = async () => {
  const leftTag = props.group.tag
  noteActionFocus()
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

/** Server-supplied tag names go into the path — keep `?`/`#`/`/` literal */
const groupPath = computed(() => `/groups/${encodeURIComponent(props.group.tag)}`)

const catColor = computed(() =>
  categoryColor(props.group.trending ? 'trending' : props.group.category),
)
const catTint = computed(() =>
  categoryTint(props.group.trending ? 'trending' : props.group.category),
)

const tileStatsLine = computed(() => {
  if (props.group.postsCount == null) return ''
  return `${formatCountLabel(props.group.postsCount, 'post')} this week`
})
</script>

<template>
  <article
    class="group-card"
    :class="{
      'group-card--tile': tile,
      'group-card--member': isMember,
    }"
  >
    <div class="group-card__icon" :style="{ backgroundColor: catTint }">
      <span class="group-card__emoji" aria-hidden="true">{{ group.icon }}</span>
      <!-- On the icon, not the corner — the top-right belongs to the Join/Leave button -->
      <span v-if="isMember && !tile" class="group-card__badge" aria-hidden="true">
        <NeoIcon name="check" :size="10" :stroke="2.75" />
      </span>
    </div>

    <div class="group-card__content">
      <h3 class="group-card__name">
        <NuxtLink :to="groupPath" class="group-card__name-link">
          {{ group.name }}
        </NuxtLink>
      </h3>
      <p v-if="!tile && group.description" class="group-card__description">
        {{ group.description }}
      </p>
      <template v-else-if="tile">
        <p class="group-card__tagline">#{{ group.tag }}</p>
        <p v-if="tileStatsLine" class="group-card__tagline group-card__tagline--stats">{{ tileStatsLine }}</p>
        <div class="group-card__meta group-card__meta--tile">
          <span class="group-card__category">
            <span v-if="group.trending" aria-hidden="true">🔥 </span>
            <span class="group-card__category-dot" :style="{ backgroundColor: catColor }" aria-hidden="true" />
            {{ group.category }}
          </span>
        </div>
      </template>
      <div v-if="!tile" class="group-card__meta">
        <span class="group-card__tag">#{{ group.tag }}</span>
        <span v-if="group.postsCount != null" class="group-card__stats">{{ tileStatsLine }}</span>
        <span class="group-card__category">
          <span v-if="group.trending" aria-hidden="true">🔥 </span>
          <span class="group-card__category-dot" :style="{ backgroundColor: catColor }" aria-hidden="true" />
          {{ group.category }}
        </span>
      </div>
    </div>

    <div class="group-card__actions">
      <button
        v-if="isMember"
        ref="actionBtnRef"
        type="button"
        class="group-card__btn group-card__btn--leave"
        :disabled="isPending"
        :aria-label="isPending ? undefined : `Joined — leave ${group.name}`"
        @click="handleLeave"
      >
        <span v-if="isPending" class="group-card__spinner" aria-hidden="true" />
        <span v-if="isPending" class="sr-only">Leaving…</span>
        <span v-else class="group-card__btn-label">
          <span class="group-card__btn-joined">Joined</span>
          <span class="group-card__btn-leave">Leave</span>
        </span>
      </button>
      <button
        v-else
        ref="actionBtnRef"
        type="button"
        class="group-card__btn group-card__btn--join"
        :disabled="isPending"
        :aria-label="isPending ? undefined : `Join ${group.name}`"
        :title="instancesStore.isAuthenticated ? 'Join this group' : 'Log in to join groups'"
        @click="handleJoin"
      >
        <span v-if="isPending" class="group-card__spinner" aria-hidden="true" />
        <span v-if="isPending" class="sr-only">Joining…</span>
        <span v-else>Join</span>
      </button>
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

    &:hover {
      background: color-mix(in srgb, var(--neo-accent) 14%, var(--neo-bg-card));
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
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--neo-radius-md, 4px);
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
    overflow-wrap: anywhere;
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
    overflow-wrap: anywhere;
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
    min-width: 0;
    color: var(--neo-text-muted);
    overflow-wrap: anywhere;
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
    right: -0.3rem;
    bottom: -0.3rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border: 2px solid var(--neo-bg-card);
    border-radius: 50%;
    background: var(--neo-accent);
    color: var(--neo-text-on-accent, var(--neo-text-inverse));
  }
}

@keyframes group-card-spin {
  to { transform: rotate(360deg); }
}
</style>
