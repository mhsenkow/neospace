<script setup lang="ts">
/**
 * Compact account card for column peeks and DM context profile pane.
 */

import type { mastodon } from 'masto'
import { sanitizeStatusHtml } from '~/utils/sanitizeHtml'
import { emojify } from '~/utils/emojify'
import { formatCompact } from '~/utils/insights'

const props = withDefaults(
  defineProps<{
    account: mastodon.v1.Account
    /** Button label (column peek uses “Open profile”) */
    openLabel?: string
    /** Hide the navigate-away button (DM in-pane feed) */
    hideOpen?: boolean
    /** Don’t clamp the bio — used when posts scroll below */
    fullBio?: boolean
  }>(),
  { openLabel: 'Open full profile', hideOpen: false, fullBio: false },
)

const emit = defineEmits<{
  open: []
}>()

const handle = computed(() => {
  const acct = props.account.acct || props.account.username || ''
  return acct.startsWith('@') ? acct : `@${acct}`
})

const safeBio = computed(() => {
  const note = props.account.note || ''
  if (!note) return ''
  return emojify(sanitizeStatusHtml(note), props.account.emojis || [], { escape: false })
})

const followers = computed(() => formatCompact(props.account.followersCount ?? 0))
const following = computed(() => formatCompact(props.account.followingCount ?? 0))
const posts = computed(() => formatCompact(props.account.statusesCount ?? 0))
</script>

<template>
  <div class="profile-card">
    <img
      v-if="account.avatar"
      :src="account.avatar"
      :alt="account.displayName || account.username"
      class="profile-card__avatar"
    />
    <div
      v-else
      class="profile-card__avatar profile-card__avatar--placeholder"
      aria-hidden="true"
    >
      {{ (account.displayName || account.username || '?').slice(0, 1).toUpperCase() }}
    </div>
    <div class="profile-card__meta">
      <h3 class="profile-card__name">
        {{ account.displayName || account.username }}
      </h3>
      <p class="profile-card__acct">{{ handle }}</p>
      <div
        v-if="safeBio"
        class="profile-card__bio"
        :class="{ 'profile-card__bio--full': fullBio }"
        v-html="safeBio"
      />
      <p class="profile-card__stats">
        <span><strong>{{ followers }}</strong> followers</span>
        <span aria-hidden="true">·</span>
        <span><strong>{{ following }}</strong> following</span>
        <span aria-hidden="true">·</span>
        <span><strong>{{ posts }}</strong> posts</span>
      </p>
      <button
        v-if="!hideOpen"
        type="button"
        class="neo-btn neo-btn--secondary profile-card__open"
        @click="emit('open')"
      >
        {{ openLabel }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.profile-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
  box-sizing: border-box;
  width: 100%;
  padding: 0.75rem 0.5rem 0.85rem;
  margin: 0;
  border-bottom: 1px solid var(--neo-border-color);

  &__avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--neo-border-color);
    flex-shrink: 0;
    background: var(--neo-bg-tertiary);

    &--placeholder {
      display: grid;
      place-items: center;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--neo-text-muted);
    }
  }

  &__meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    width: 100%;
    min-width: 0;
  }

  &__name {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
  }

  &__acct {
    margin: 0;
    font-size: 0.875rem;
    color: var(--neo-text-tertiary);
  }

  &__bio {
    margin: 0.35rem 0 0;
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 8;
    -webkit-box-orient: vertical;
    overflow: hidden;

    &--full {
      display: block;
      -webkit-line-clamp: unset;
      -webkit-box-orient: unset;
      overflow: visible;
    }

    :deep(p) {
      margin: 0 0 0.35em;
    }

    :deep(a) {
      color: var(--neo-accent);
      text-decoration: none;
    }

    :deep(img.emoji),
    :deep(img.custom-emoji) {
      width: 1.1em;
      height: 1.1em;
      vertical-align: -0.15em;
    }
  }

  &__stats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin: 0.35rem 0 0;
    font-size: 0.875rem;
    color: var(--neo-text-muted);

    strong {
      color: var(--neo-text-primary);
      font-weight: 600;
    }
  }

  &__open {
    margin-top: 0.5rem;
    width: 100%;
    justify-content: center;
  }
}
</style>
