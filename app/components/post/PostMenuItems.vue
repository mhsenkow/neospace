<script setup lang="ts">
/**
 * Items for a post card's "More options" NeoMenu (rendered in its #items slot).
 * Pure presentation: every action is emitted back to the card.
 */
import type { mastodon } from 'masto'

defineProps<{
  status: mastodon.v1.Status
  canInteract: boolean
  isOwnPost: boolean
  canManageOwn: boolean
  canPin: boolean
  isBookmarking: boolean
  isMuting: boolean
  isBlocking: boolean
  isDeleting: boolean
  isPinning: boolean
  inspectOpen: boolean
  /** Server reports translation, and the post language isn't the reader's */
  canTranslate?: boolean
  isTranslating?: boolean
}>()

const emit = defineEmits<{
  bookmark: []
  copyLink: []
  mute: []
  block: []
  report: []
  openOriginal: []
  toggleInspect: []
  translate: []
  togglePin: []
  edit: []
  redraft: []
  delete: []
}>()
</script>

<template>
  <button
    v-if="canInteract"
    type="button"
    role="menuitem"
    class="status-dropdown-item"
    :disabled="isBookmarking"
    @click="emit('bookmark')"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" :fill="status.bookmarked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>
    <span>{{ status.bookmarked ? 'Unsave' : 'Save' }}</span>
  </button>
  <button
    v-if="canTranslate"
    type="button"
    role="menuitem"
    class="status-dropdown-item"
    :disabled="isTranslating"
    @click="emit('translate')"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <path d="M5 8h6" />
      <path d="M8 5v3c0 3-2 5-5 6" />
      <path d="M4 14c2.5-1 4-2.5 4.5-5" />
      <path d="M14 19l4-9 4 9" />
      <path d="M15.2 16h5.6" />
    </svg>
    <span>{{ isTranslating ? 'Translating…' : 'Translate' }}</span>
  </button>
  <button type="button" role="menuitem" class="status-dropdown-item" @click="emit('copyLink')">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
    <span>Copy link</span>
  </button>
  <template v-if="canInteract && !isOwnPost">
    <div class="status-dropdown-divider" role="separator" />
    <button
      type="button"
      role="menuitem"
      class="status-dropdown-item"
      :disabled="isMuting"
      @click="emit('mute')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
      <span>Mute @{{ status.account.username }}</span>
    </button>
    <button
      type="button"
      role="menuitem"
      class="status-dropdown-item status-dropdown-item--danger"
      :disabled="isBlocking"
      @click="emit('block')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
      <span>Block @{{ status.account.username }}</span>
    </button>
    <button
      type="button"
      role="menuitem"
      class="status-dropdown-item status-dropdown-item--danger"
      @click="emit('report')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>Report</span>
    </button>
  </template>
  <button type="button" role="menuitem" class="status-dropdown-item" @click="emit('openOriginal')">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
    <span>Open original</span>
  </button>
  <button type="button" role="menuitem" class="status-dropdown-item" @click="emit('toggleInspect')">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
    <span>{{ inspectOpen ? 'Hide signals' : 'Inspect signals' }}</span>
  </button>
  <template v-if="canManageOwn">
    <div class="status-dropdown-divider" role="separator" />
    <button
      v-if="canPin"
      type="button"
      role="menuitem"
      class="status-dropdown-item"
      :disabled="isPinning"
      @click="emit('togglePin')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M12 17v5" />
        <path d="M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7z" />
      </svg>
      <span>{{ status.pinned ? 'Unpin from profile' : 'Pin to profile' }}</span>
    </button>
    <button
      type="button"
      role="menuitem"
      class="status-dropdown-item"
      :disabled="isDeleting"
      @click="emit('edit')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
      <span>Edit</span>
    </button>
    <button
      type="button"
      role="menuitem"
      class="status-dropdown-item"
      :disabled="isDeleting"
      @click="emit('redraft')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
      <span>Delete &amp; redraft</span>
    </button>
    <button
      type="button"
      role="menuitem"
      class="status-dropdown-item status-dropdown-item--danger"
      :disabled="isDeleting"
      @click="emit('delete')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
      </svg>
      <span>Delete</span>
    </button>
  </template>
</template>

<style lang="scss" scoped>
.status-dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  color: var(--neo-text-primary);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.12s ease;

  svg {
    flex-shrink: 0;
    color: var(--neo-text-secondary);
  }

  span {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (hover: hover) {
    &:hover:not(:disabled) {
      background: var(--neo-bg-tertiary);
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--danger {
    color: var(--neo-danger);

    svg {
      color: var(--neo-danger);
    }

    @media (hover: hover) {
      &:hover:not(:disabled) {
        background: var(--neo-danger-soft);
      }
    }
  }
}

.status-dropdown-divider {
  height: 1px;
  background: var(--neo-border-color);
  margin: 0.25rem 0.5rem;
}

:global(.status-card--reduce-motion) .status-dropdown-item {
  transition: none !important;
  animation: none !important;
}
</style>
