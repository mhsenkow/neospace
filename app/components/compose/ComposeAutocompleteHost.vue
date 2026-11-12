<script setup lang="ts">
/**
 * Compose — the status field plus its @mention / #hashtag / :emoji: suggestion popup.
 * Presentational: the parent owns the text, the autocomplete state machine and key handling.
 */
import type { ComposeSuggestion, ComposeTokenKind } from '~/utils/composeTokens'

const content = defineModel<string>({ required: true })

defineProps<{
  placeholder?: string
  rows: number
  /** `send` for the compact pill, `enter` otherwise */
  enterkeyhint: 'send' | 'enter'
  /** readonly while posting / disabled */
  locked: boolean
  /** Posting, uploading or disabled — surfaced as aria-busy */
  busy: boolean
  invalid: boolean
  /** Accessible name for the field */
  label: string
  keyshortcuts: string
  /** Compact pill: field + in-field Send (default slot) */
  send?: boolean
  // Autocomplete popup + combobox wiring
  listId: string
  listShown: boolean
  activeDescendantId?: string
  open: boolean
  items: ComposeSuggestion[]
  kind: ComposeTokenKind
  searching?: boolean
  outcome?: 'pending' | 'results' | 'empty' | 'failed'
  activeIndex: number
  flipUp?: boolean
}>()

const emit = defineEmits<{
  focus: [e: FocusEvent]
  blur: [e: FocusEvent]
  paste: [e: ClipboardEvent]
  keydown: [e: KeyboardEvent]
  keyup: [e: KeyboardEvent]
  input: [e: Event]
  /** Native click on the textarea (caret moved) */
  caretClick: [e: MouseEvent]
  select: [item: ComposeSuggestion]
}>()

const textareaEl = ref<HTMLTextAreaElement | null>(null)

defineExpose({ el: textareaEl })
</script>

<template>
  <div class="compose-input-wrap" :class="{ 'compose-input-wrap--send': send }">
    <textarea
      ref="textareaEl"
      v-model="content"
      class="compose-input neo-input"
      :placeholder="placeholder"
      :rows="rows"
      :enterkeyhint="enterkeyhint"
      autocapitalize="sentences"
      :readonly="locked"
      :aria-busy="busy || undefined"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="listShown"
      :aria-controls="listShown ? listId : undefined"
      :aria-activedescendant="listShown ? activeDescendantId : undefined"
      :aria-invalid="invalid"
      :aria-label="label"
      :aria-keyshortcuts="keyshortcuts"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
      @paste="emit('paste', $event)"
      @keydown="emit('keydown', $event)"
      @input="emit('input', $event)"
      @click="emit('caretClick', $event)"
      @keyup="emit('keyup', $event)"
    />
    <ComposeAutocomplete
      v-if="open"
      :id="listId"
      :items="items"
      :kind="kind"
      :searching="searching"
      :outcome="outcome"
      :active-index="activeIndex"
      :flip-up="flipUp"
      @select="emit('select', $event)"
    />
    <slot />
  </div>
</template>

<style lang="scss" scoped>
@use '~/assets/css/compose' as compose;

@include compose.compose-input-wrap;
@include compose.compose-input;

// Threads pill: the field sits beside the avatar with Send tucked inside
.compose--compact {
  .compose-input-wrap {
    flex: 1;
    min-width: 0;
  }

  .compose-input-wrap--send {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 0.25rem;
    min-height: 2.75rem;
  }

  .compose-input {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 0.5rem 0.15rem 0.5rem 0;
    /* Room for the in-field send control (44px touch target) */
    padding-right: 3rem;
    border: none;
    background: transparent;
    box-shadow: none;
    // ≥16px absolute — stops iOS/iPad focus zoom (root rem is 15px)
    font-size: max(16px, 1rem);
    line-height: 1.35;
    resize: none;
    field-sizing: content;
    max-height: 6.5rem;

    &:focus {
      outline: none;
    }
  }
}
</style>
