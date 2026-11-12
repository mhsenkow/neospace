<script setup lang="ts">
/**
 * Compose — attachment strip: thumbnails, upload progress, retry / cancel / remove, alt text.
 */
import type { ComposeAttachment } from '~/composables/useComposeMedia'
import { COMPOSE_PREVIEWABLE_IMAGE, composeAttachmentIcon } from '~/utils/composeConstants'

defineProps<{
  attachments: ComposeAttachment[]
  mediaStorageHost?: string | null
  mediaOptimizeSummary?: string | null
  altMax: number
  /** Disables remove / alt editing while a post is in flight */
  isPosting: boolean
}>()

const emit = defineEmits<{
  cancel: [localId: string]
  retry: [localId: string]
  remove: [localId: string]
  describe: [localId: string, text: string]
}>()

const rootRef = ref<HTMLElement | null>(null)

/** Honest status text: a % only when the browser reported real bytes sent */
const uploadPhaseLabel = (item: ComposeAttachment) => {
  if (item.phase === 'processing') return 'Processing…'
  if (item.progress != null) return `Uploading ${Math.round(item.progress * 100)}%`
  return 'Uploading…'
}

defineExpose({ el: rootRef })
</script>

<template>
  <div ref="rootRef" class="compose-media" @click.stop>
    <p v-if="mediaStorageHost || mediaOptimizeSummary" class="compose-media__commons">
      <span v-if="mediaOptimizeSummary">{{ mediaOptimizeSummary }}</span>
      <span
        v-if="mediaOptimizeSummary && mediaStorageHost"
        class="compose-media__commons-sep"
        aria-hidden="true"
      >·</span>
      <span v-if="mediaStorageHost">Stored on {{ mediaStorageHost }}</span>
    </p>
    <div
      v-for="(item, mediaIndex) in attachments"
      :key="item.localId"
      class="compose-media__item"
      :class="{
        'compose-media__item--busy': item.uploading,
        'compose-media__item--error': !!item.error,
      }"
    >
      <img
        v-if="COMPOSE_PREVIEWABLE_IMAGE.test(item.file.type)"
        :src="item.previewUrl"
        alt=""
        class="compose-media__thumb"
      />
      <div v-else class="compose-media__video">
        <span aria-hidden="true">{{ composeAttachmentIcon(item.file.type) }}</span>
        <span class="compose-media__video-name">{{ item.file.name }}</span>
      </div>
      <div
        v-if="item.uploading"
        class="compose-media__overlay compose-media__overlay--busy"
        role="group"
        :aria-label="`${uploadPhaseLabel(item)} ${item.file.name || 'attachment'}`"
      >
        <span class="compose-media__phase">{{ uploadPhaseLabel(item) }}</span>
        <!-- Real bytes-sent bar only; indeterminate when the browser can't report progress -->
        <span
          class="compose-media__bar"
          :class="{ 'compose-media__bar--indeterminate': item.phase !== 'uploading' || item.progress == null }"
          aria-hidden="true"
        >
          <span
            v-if="item.phase === 'uploading' && item.progress != null"
            :style="{ width: `${Math.round(item.progress * 100)}%` }"
          />
          <span v-else />
        </span>
        <button
          type="button"
          class="compose-media__cancel"
          :aria-label="`Cancel upload of ${item.file.name || 'attachment'}`"
          @click.stop="emit('cancel', item.localId)"
        >
          Cancel
        </button>
      </div>
      <button
        v-else-if="item.error"
        type="button"
        class="compose-media__overlay compose-media__overlay--error"
        @click="emit('retry', item.localId)"
      >
        {{ item.error }} · retry
      </button>
      <button
        type="button"
        class="compose-media__remove"
        :aria-label="`Remove image ${mediaIndex + 1}`"
        :disabled="isPosting"
        @click="emit('remove', item.localId)"
      >
        <NeoIcon name="x" :size="12" :stroke="2.5" />
      </button>
      <span
        v-if="!item.uploading && !item.error && item.remoteId && !item.description?.trim()"
        class="compose-media__alt-badge"
        title="Missing alt text"
      >
        ALT
      </span>
      <label class="compose-media__alt">
        <span class="compose-media__alt-label">Alt text</span>
        <textarea
          class="compose-media__alt-input"
          rows="2"
          :maxlength="altMax"
          :disabled="isPosting"
          :value="item.description"
          placeholder="Describe this image for screen readers"
          @input="emit('describe', item.localId, ($event.target as HTMLTextAreaElement).value)"
          @click.stop
        />
      </label>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.compose-media {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.compose-media__commons {
  margin: 0;
  font-size: 0.6875rem;
  line-height: 1.35;
  color: var(--neo-text-tertiary);
}

.compose-media__commons-sep {
  margin: 0 0.3em;
}

.compose-media__item {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 0.65rem;
  align-items: start;
  position: relative;
  padding: 0.5rem;
  border-radius: var(--neo-radius-md);
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);

  &--busy,
  &--error {
    .compose-media__thumb {
      opacity: 0.55;
    }
  }
}

.compose-media__thumb {
  width: 96px;
  height: 96px;
  object-fit: cover;
  display: block;
  border-radius: calc(var(--neo-radius-md) - 2px);
}

.compose-media__video {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  width: 96px;
  height: 96px;
  padding: 0.5rem;
  font-size: 1.25rem;
  border-radius: calc(var(--neo-radius-md) - 2px);
  background: var(--neo-bg-secondary);
}

.compose-media__video-name {
  font-size: 0.625rem;
  color: var(--neo-text-muted);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.compose-media__overlay {
  position: absolute;
  left: 0.5rem;
  top: 0.5rem;
  width: 96px;
  height: 96px;
  display: grid;
  place-items: center;
  padding: 0.35rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-align: center;
  color: var(--neo-text-primary);
  background: color-mix(in srgb, var(--neo-bg-card) 55%, transparent);
  backdrop-filter: blur(2px);
  border-radius: calc(var(--neo-radius-md) - 2px);

  &--error {
    color: var(--neo-danger);
  }

  &--busy {
    grid-auto-flow: row;
    grid-template-rows: auto auto auto;
    align-content: center;
    gap: 0.3rem;
  }
}

.compose-media__bar {
  display: block;
  width: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--neo-border-color);

  > span {
    display: block;
    height: 100%;
    background: var(--neo-accent);
    transition: width 0.15s linear;
  }

  &--indeterminate > span {
    width: 40%;
    animation: compose-media-indeterminate 1.1s ease-in-out infinite;
  }
}

@keyframes compose-media-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}

@media (prefers-reduced-motion: reduce) {
  .compose-media__bar--indeterminate > span {
    animation: none;
    width: 100%;
    opacity: 0.5;
  }
}

.compose-media__cancel {
  min-height: 24px;
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  background: var(--neo-bg-primary);
  color: var(--neo-text-primary);
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}

.compose-media__remove {
  position: absolute;
  top: 0.35rem;
  left: calc(0.5rem + 96px - 1.65rem);
  min-width: 24px;
  min-height: 24px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  font-size: 1rem;
  line-height: 1;
  color: var(--neo-text-on-accent, #fff);
  background: color-mix(in srgb, var(--neo-text-primary) 65%, transparent);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  z-index: 1;

  @media (hover: hover) {
    &:hover {
      background: rgba(0, 0, 0, 0.85);
    }
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.compose-media__alt-badge {
  position: absolute;
  top: 0.35rem;
  left: 0.65rem;
  z-index: 1;
  padding: 0.1rem 0.35rem;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--neo-text-on-accent, #fff);
  background: var(--neo-danger, #c62828);
  border-radius: 3px;
  pointer-events: none;
}

.compose-media__alt {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.compose-media__alt-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.compose-media__alt-input {
  width: 100%;
  min-height: 3.25rem;
  padding: 0.45rem 0.55rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  line-height: 1.35;
  color: var(--neo-text-primary);
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md);
  resize: vertical;

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
  }

  &:disabled {
    opacity: 0.6;
  }

  &::placeholder {
    color: var(--neo-text-secondary);
  }
}
</style>
