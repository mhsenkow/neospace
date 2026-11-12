<script setup lang="ts">
/**
 * Public thread composer pinned above the keyboard.
 * The status page still owns reply-target resolution, mentions, and the full-composer sheet.
 */
import type { mastodon } from 'masto'

const props = defineProps<{
  /** Focus post id — composer key and fallback in-reply-to */
  statusId: string
  /** Resolved local id for this reply; null while unknown */
  replyTargetId: string | null
  /** True while resolveReplyId is in flight */
  resolving: boolean
  mentionAccts: string[]
  /** Focus author handle, without @ */
  replyToAcct: string
  visibility: mastodon.v1.Status['visibility']
  keyboardOpen: boolean
  insetStyle: Record<string, string>
}>()

const emit = defineEmits<{
  posted: [status: mastodon.v1.Status]
  expand: []
}>()

const pending = computed(() => props.resolving || !props.replyTargetId)
const replyId = computed(() => props.replyTargetId || props.statusId)
const placeholder = computed(() => `Reply to @${props.replyToAcct}…`)
</script>

<template>
  <div
    class="thread-reply-dock"
    data-keyboard-fixed
    :class="{
      'thread-reply-dock--pending': pending,
      'thread-reply-dock--keyboard': keyboardOpen,
    }"
    :style="insetStyle"
    :aria-busy="pending || undefined"
  >
    <div class="thread-reply-dock__inner">
      <RealComposeBox
        :key="replyId"
        compact
        :accept-handoff="false"
        :disabled="pending"
        :in-reply-to-id="replyId"
        :mention-accts="mentionAccts"
        :initial-visibility="visibility"
        :placeholder="placeholder"
        title="Reply"
        @posted="emit('posted', $event)"
      />
      <button
        type="button"
        class="thread-reply-dock__expand"
        aria-label="Open full composer"
        title="Open full composer"
        :disabled="pending"
        @click="emit('expand')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.thread-reply-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  padding: 0.55rem 0.75rem calc(0.65rem + env(safe-area-inset-bottom, 0px));
  background: color-mix(in srgb, var(--neo-bg-primary) 96%, transparent);
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);

  &--pending {
    opacity: 0.72;
    pointer-events: none;
  }

  &--keyboard {
    padding: 0.3rem 0.5rem 0.3rem;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;

    :deep(.compose-footer) {
      padding-top: 0.2rem;
      gap: 0.3rem;
    }

    :deep(.compose-language),
    :deep(.compose-media-count),
    :deep(.compose-visibility) {
      display: none;
    }

    :deep(.compose-input) {
      min-height: 2.35rem;
      max-height: 5rem;
    }

    /* Reclaim width — send lives in the field */
    :deep(.compose-avatar) {
      display: none;
    }

    :deep(.compose--compact.compose--expanded) {
      padding: 0.35rem 0.45rem 0.3rem;
    }
  }

  @media (min-width: 1024px) {
    left: var(--neo-sidebar-width, 248px);
    padding: 0.7rem 1rem 0.85rem;
  }

  &__inner {
    display: flex;
    align-items: flex-end;
    gap: 0.35rem;
    width: 100%;
    max-width: 40rem;
  }

  &__expand {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin-bottom: 0.15rem;
    padding: 0;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--neo-text-secondary);
    cursor: pointer;

    @include hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }

    &:focus-visible {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }

  :deep(.compose--compact) {
    width: 100%;
  }

  :deep(.compose-input) {
    font-size: max(16px, 1rem);
  }

  :deep(.compose-send) {
    min-height: 44px;
    min-width: 44px;
  }
}
</style>
