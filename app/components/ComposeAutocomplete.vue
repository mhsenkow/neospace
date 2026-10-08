<script setup lang="ts">
/**
 * Shared @mention listbox for composers (APG combobox companion).
 */
import type { mastodon } from 'masto'
import { accountHandle } from '~/composables/useAccountSearch'

const props = defineProps<{
  id: string
  results: mastodon.v1.Account[]
  searching?: boolean
  activeIndex: number
  /** Open upward when there isn't room below (keyboard / bottom sheet) */
  flipUp?: boolean
}>()

const emit = defineEmits<{
  select: [account: mastodon.v1.Account]
}>()

/** Polite announcement — focus stays in the textarea, so say what appeared */
const statusText = computed(() => {
  if (props.searching && !props.results.length) return 'Looking up…'
  const n = props.results.length
  if (!n) return ''
  return `${n} ${n === 1 ? 'suggestion' : 'suggestions'}`
})
</script>

<template>
  <div
    v-if="searching || results.length"
    :id="id"
    class="compose-autocomplete"
    :class="{ 'compose-autocomplete--up': flipUp }"
    role="listbox"
    aria-label="Mention suggestions"
  >
    <p
      v-if="searching && !results.length"
      class="compose-autocomplete__status"
      aria-hidden="true"
    >
      Looking up…
    </p>
    <button
      v-for="(account, idx) in results"
      :id="`${id}-${account.id}`"
      :key="account.id"
      type="button"
      tabindex="-1"
      class="compose-autocomplete__item"
      :class="{ 'compose-autocomplete__item--active': idx === activeIndex }"
      role="option"
      :aria-selected="idx === activeIndex"
      @mousedown.prevent="emit('select', account)"
    >
      <img :src="account.avatar" alt="" class="compose-autocomplete__avatar" />
      <span class="compose-autocomplete__meta">
        <span class="compose-autocomplete__name">{{ account.displayName || account.username }}</span>
        <span class="compose-autocomplete__acct">{{ accountHandle(account) }}</span>
      </span>
    </button>
  </div>
  <p class="sr-only" role="status" aria-live="polite">{{ statusText }}</p>
</template>

<style lang="scss" scoped>
.compose-autocomplete {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 0.25rem);
  z-index: 30;

  &--up {
    top: auto;
    bottom: calc(100% + 0.25rem);
  }
  max-height: 220px;
  overflow-y: auto;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  box-shadow: var(--neo-shadow-lg);
}

.compose-autocomplete__status {
  margin: 0;
  padding: 0.75rem 1rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.compose-autocomplete__item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  min-height: 48px;

  &:hover,
  &--active {
    background: var(--neo-bg-tertiary);
  }
}

.compose-autocomplete__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.compose-autocomplete__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.05rem;
}

.compose-autocomplete__name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.compose-autocomplete__acct {
  font-size: 0.75rem;
  color: var(--neo-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
