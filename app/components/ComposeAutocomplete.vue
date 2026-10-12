<script setup lang="ts">
/**
 * Shared composer listbox for @mentions, #hashtags and :emoji: (APG combobox companion).
 */
import { accountHandle } from '~/composables/useAccountSearch'
import type { ComposeSuggestion, ComposeTokenKind } from '~/utils/composeTokens'

const props = defineProps<{
  id: string
  items: ComposeSuggestion[]
  kind: ComposeTokenKind
  searching?: boolean
  /** How the last lookup ended — empty and failed are announced differently */
  outcome?: 'pending' | 'results' | 'empty' | 'failed'
  activeIndex: number
  /** Open upward when there isn't room below (keyboard / bottom sheet) */
  flipUp?: boolean
}>()

const emit = defineEmits<{
  select: [item: ComposeSuggestion]
}>()

const KIND_LABEL: Record<ComposeTokenKind, string> = {
  mention: 'Mention',
  hashtag: 'Hashtag',
  emoji: 'Emoji',
}
const label = computed(() => `${KIND_LABEL[props.kind]} suggestions`)

/** Polite announcement — focus stays in the textarea, so say what appeared */
const KIND_PLURAL: Record<ComposeTokenKind, string> = {
  mention: 'people',
  hashtag: 'hashtags',
  emoji: 'emoji',
}
const statusText = computed(() => {
  if (props.searching && !props.items.length) return `Looking up ${KIND_PLURAL[props.kind]}…`
  const n = props.items.length
  if (!n) {
    if (props.outcome === 'failed') return `Couldn’t look up ${KIND_PLURAL[props.kind]}. Keep typing to try again.`
    if (props.outcome === 'empty') return `No matching ${KIND_PLURAL[props.kind]}`
    return ''
  }
  const active = props.items[props.activeIndex]
  const lead = `${n} ${n === 1 ? 'suggestion' : 'suggestions'}`
  if (!active) return lead
  const name =
    active.kind === 'mention'
      ? accountHandle(active.account)
      : active.kind === 'hashtag'
        ? `#${active.name}`
        : `:${active.shortcode}:`
  return `${lead}. ${name}, ${props.activeIndex + 1} of ${n}`
})

const usesLabel = (uses: number | null) =>
  uses == null ? '' : `${uses} ${uses === 1 ? 'post' : 'posts'} today`
</script>

<template>
  <div
    v-if="searching || items.length || outcome === 'failed'"
    :id="id"
    class="compose-autocomplete"
    :class="{ 'compose-autocomplete--up': flipUp }"
    role="listbox"
    :aria-label="label"
  >
    <p
      v-if="searching && !items.length"
      class="compose-autocomplete__status"
      aria-hidden="true"
    >
      Looking up…
    </p>
    <p v-else-if="!items.length && outcome === 'failed'" class="compose-autocomplete__status">
      Couldn’t load suggestions — keep typing to retry.
    </p>
    <button
      v-for="(item, idx) in items"
      :id="`${id}-${item.key}`"
      :key="`${item.kind}:${item.key}`"
      type="button"
      tabindex="-1"
      class="compose-autocomplete__item"
      :class="{ 'compose-autocomplete__item--active': idx === activeIndex }"
      role="option"
      :aria-selected="idx === activeIndex"
      @mousedown.prevent="emit('select', item)"
    >
      <template v-if="item.kind === 'mention'">
        <img :src="item.account.avatar" alt="" class="compose-autocomplete__avatar" />
        <span class="compose-autocomplete__meta">
          <span class="compose-autocomplete__name">{{ item.account.displayName || item.account.username }}</span>
          <span class="compose-autocomplete__acct">{{ accountHandle(item.account) }}</span>
        </span>
      </template>
      <template v-else-if="item.kind === 'hashtag'">
        <span class="compose-autocomplete__glyph" aria-hidden="true">#</span>
        <span class="compose-autocomplete__meta">
          <span class="compose-autocomplete__name">#{{ item.name }}</span>
          <span v-if="item.uses != null" class="compose-autocomplete__acct">{{ usesLabel(item.uses) }}</span>
        </span>
      </template>
      <template v-else>
        <img :src="item.url" alt="" class="compose-autocomplete__emoji" loading="lazy" />
        <span class="compose-autocomplete__meta">
          <span class="compose-autocomplete__name">:{{ item.shortcode }}:</span>
        </span>
      </template>
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

.compose-autocomplete__emoji {
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex-shrink: 0;
}

.compose-autocomplete__glyph {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-secondary);
  font-weight: 700;
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
