<script setup lang="ts">
/**
 * Compose — footer bar: attach / voice / CW / poll tools, visibility, schedule,
 * language, media count, character counter and the Post button.
 * Presentational: state and handlers live in RealComposeBox.
 */
import { useInstancesStore } from '~/stores/instances'
import type { ComposeVisibility } from '~/stores/composeSheet'
import {
  COMPOSE_MEDIA_ACCEPT,
  COMPOSE_VISIBILITY_OPTIONS,
  type ComposeLanguageOption,
} from '~/utils/composeConstants'

const visibility = defineModel<ComposeVisibility>('visibility', { required: true })
/** datetime-local value (local wall clock); empty = post now */
const scheduledLocal = defineModel<string>('scheduledLocal', { required: true })
const postLanguage = defineModel<string>('postLanguage', { required: true })

defineProps<{
  compact: boolean
  submitInHeader: boolean
  isPosting: boolean
  canAddMore: boolean
  showPoll: boolean
  showCw: boolean
  hasMedia: boolean
  voiceSupported: boolean
  voiceBusy: boolean
  voiceElapsedLabel: string
  isLockedDirect: boolean
  isDirectCompose: boolean
  scheduleMinLocal: string
  hasSchedule: boolean
  scheduleZone: string
  scheduleProblem: string | null
  languageOptions: ComposeLanguageOption[]
  attachmentCount: number
  maxAttachments: number
  missingAltCount: number
  counterAnnounce: string
  characterCount: number
  effectiveMaxLength: number
  isNearLimit: boolean
  isOverLimit: boolean
  canPost: boolean
  submitLabel: string
  submitAriaLabel: string
  submitShortcutTitle: string
  submitKeyshortcuts: string
}>()

const emit = defineEmits<{
  pickFiles: [e: Event]
  openFilePicker: []
  toggleVoice: []
  toggleCw: []
  togglePoll: []
  clearSchedule: []
  submit: []
}>()

const instancesStore = useInstancesStore()

const fileInputEl = ref<HTMLInputElement | null>(null)

defineExpose({ fileInput: fileInputEl })
</script>

<template>
  <div class="compose-footer" @click.stop>
    <div class="compose-tools">
      <input
        ref="fileInputEl"
        type="file"
        class="compose-file"
        tabindex="-1"
        aria-hidden="true"
        :accept="COMPOSE_MEDIA_ACCEPT"
        multiple
        @change="emit('pickFiles', $event)"
      />
      <button
        type="button"
        class="compose-tool"
        aria-label="Add photo"
        title="Add photo"
        :disabled="!canAddMore || isPosting || showPoll"
        @click="emit('openFilePicker')"
      >
        <NeoIcon name="image" :size="18" :stroke="1.75" />
      </button>
      <button
        v-if="voiceSupported"
        type="button"
        class="compose-tool"
        :class="{ 'compose-tool--active': voiceBusy, 'compose-tool--recording': voiceBusy }"
        :aria-label="voiceBusy ? `Stop recording ${voiceElapsedLabel}` : 'Record voice note'"
        :title="voiceBusy ? `Stop · ${voiceElapsedLabel}` : 'Record voice note'"
        :aria-pressed="voiceBusy"
        :disabled="isPosting || showPoll || (!canAddMore && !voiceBusy)"
        @click="emit('toggleVoice')"
      >
        <NeoIcon name="mic" :size="18" :stroke="1.75" />
      </button>
      <button
        type="button"
        class="compose-tool"
        :class="{ 'compose-tool--active': showCw }"
        aria-label="Content warning"
        title="Content warning"
        :aria-pressed="showCw"
        :disabled="isPosting"
        @click="emit('toggleCw')"
      >
        <span aria-hidden="true">CW</span>
      </button>
      <button
        v-if="!compact && (instancesStore.canCreatePolls || showPoll)"
        type="button"
        class="compose-tool"
        :class="{ 'compose-tool--active': showPoll }"
        :aria-label="showPoll ? 'Remove poll' : 'Add poll'"
        :title="hasMedia && !showPoll ? 'Polls can’t include media' : showPoll ? 'Remove poll' : 'Add poll'"
        :aria-pressed="showPoll"
        :disabled="isPosting || (hasMedia && !showPoll)"
        @click="emit('togglePoll')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h10M4 12h16M4 18h7" />
        </svg>
      </button>

      <!-- Compact replies inherit parent visibility — don't crowd the dock -->
      <div v-if="!isLockedDirect && !compact" class="compose-visibility">
        <select
          v-model="visibility"
          class="compose-visibility-select"
          :disabled="isPosting"
          aria-label="Post visibility"
        >
          <option v-for="opt in COMPOSE_VISIBILITY_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.icon }} {{ opt.label }}
          </option>
        </select>
      </div>
      <span
        v-else-if="isLockedDirect && !compact"
        class="compose-visibility-lock"
        title="Only mentioned people can see this"
      >
        <NeoIcon name="message" :size="14" :stroke="2" />
        Direct
      </span>

      <!-- Place this cell in time — Mastodon scheduled_at (≥5 min) -->
      <div v-if="!compact && instancesStore.canSchedulePosts" class="compose-schedule">
        <label class="compose-schedule__field">
          <span class="sr-only">Schedule for</span>
          <input
            v-model="scheduledLocal"
            type="datetime-local"
            class="compose-schedule-input"
            :min="scheduleMinLocal"
            :disabled="isPosting"
            :aria-label="hasSchedule ? 'Scheduled post time' : 'Schedule post for later'"
            title="Schedule — place this cell in time"
          />
        </label>
        <button
          v-if="hasSchedule"
          type="button"
          class="compose-schedule__clear"
          :disabled="isPosting"
          aria-label="Clear schedule — post now"
          title="Post now"
          @click="emit('clearSchedule')"
        >
          ×
        </button>
        <span v-if="hasSchedule" class="compose-schedule__zone">{{ scheduleZone }}</span>
        <span v-if="scheduleProblem" class="compose-schedule__zone" role="alert">{{ scheduleProblem }}</span>
      </div>

      <label v-if="!isDirectCompose && !compact" class="compose-language">
        <span class="sr-only">Post language</span>
        <select
          v-model="postLanguage"
          class="compose-language-select"
          :disabled="isPosting"
          aria-label="Post language"
        >
          <option
            v-for="opt in languageOptions"
            :key="opt.code"
            :value="opt.code"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>

      <span v-if="hasMedia" class="compose-media-count">
        {{ attachmentCount }}/{{ maxAttachments }}
        <span v-if="missingAltCount" class="compose-media-count__alt" title="Images need descriptions">
          · {{ missingAltCount }} missing ALT
        </span>
      </span>
    </div>

    <div class="compose-actions">
      <span
        class="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >{{ counterAnnounce }}</span>
      <span
        class="compose-counter"
        :class="{
          'compose-counter--warning': isNearLimit,
          'compose-counter--error': isOverLimit,
          'compose-counter--quiet': !isNearLimit && !isOverLimit && (compact || submitInHeader),
        }"
        aria-hidden="true"
      >
        {{ characterCount }}/{{ effectiveMaxLength }}
      </span>

      <button
        v-if="!compact && !submitInHeader"
        type="button"
        class="compose-submit neo-btn neo-btn--primary"
        :disabled="!canPost"
        :aria-label="submitAriaLabel"
        :title="submitShortcutTitle"
        :aria-keyshortcuts="submitKeyshortcuts"
        @click="emit('submit')"
      >
        {{ submitLabel }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '~/assets/css/compose' as compose;

.compose-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: nowrap;
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 0.35rem;
  border-top: 1px solid var(--neo-border-color);
  cursor: default;

  /* Threads sheet: tools left, counter right — Post lives in the header */
  .compose--header-submit & {
    flex-wrap: wrap;
    row-gap: 0.35rem;
  }
}

.compose-tools {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }
}

@include compose.compose-file;
@include compose.compose-tool;
@include compose.compose-visibility-select;
@include compose.compose-language-select;
@include compose.compose-schedule;
@include compose.compose-counter;

.compose-visibility {
  margin-left: 0.25rem;
}

.compose-visibility-lock {
  margin-left: 0.25rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-muted);
  white-space: nowrap;
  padding: 0 0.35rem;
}

.compose-media-count {
  margin-left: 0.35rem;
  font-size: 0.6875rem;
  color: var(--neo-text-muted);
  font-variant-numeric: tabular-nums;
}

.compose-media-count__alt {
  color: var(--neo-danger);
  font-weight: 600;
}

.compose-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.55rem;
  flex-shrink: 0;
}

.compose-submit {
  min-width: 4.5rem;
  flex-shrink: 0;
}

.compose-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

// Threads pill (compact reply dock) — counter sits right of the tools
.compose--compact {
  .compose-counter {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }
}

.compose--compact.compose--expanded {
  .compose-visibility-select {
    border-radius: 10px;
  }
}
</style>
