<script setup lang="ts">
/**
 * Compose — Threads "Post Options" sheet: visibility / CW / sensitive media /
 * schedule / language. Teleported to <body>; state and handlers live in RealComposeBox.
 */
import { useInstancesStore } from '~/stores/instances'
import type { ComposeVisibility } from '~/stores/composeSheet'
import {
  COMPOSE_VISIBILITY_OPTIONS,
  type ComposeLanguageOption,
} from '~/utils/composeConstants'

const visibility = defineModel<ComposeVisibility>('visibility', { required: true })
const spoilerText = defineModel<string>('spoilerText', { required: true })
const markSensitive = defineModel<boolean>('markSensitive', { required: true })
/** datetime-local value (local wall clock); empty = post now */
const scheduledLocal = defineModel<string>('scheduledLocal', { required: true })
const postLanguage = defineModel<string>('postLanguage', { required: true })

defineProps<{
  open: boolean
  isPosting: boolean
  isLockedDirect: boolean
  isDirectCompose: boolean
  showCw: boolean
  hasMedia: boolean
  hasSchedule: boolean
  scheduleMinLocal: string
  scheduleZone: string
  scheduleProblem: string | null
  /** Scheduling is single-post only — extra thread parts block it */
  extraSegmentCount: number
  languageOptions: ComposeLanguageOption[]
}>()

const emit = defineEmits<{
  close: []
  toggleCw: []
  clearSchedule: []
}>()

const instancesStore = useInstancesStore()
</script>

<template>
  <!-- Threads sheet: Post Options (visibility / CW / schedule / language / sensitive) -->
  <Teleport to="body">
    <Transition appear name="action-sheet">
      <div
        v-if="open"
        class="compose-options"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-options-title"
        @click.self="emit('close')"
      >
        <button
          type="button"
          class="compose-options__backdrop"
          tabindex="-1"
          aria-hidden="true"
          @click="emit('close')"
        />
        <div class="compose-options__panel" @click.stop>
          <p id="compose-options-title" class="compose-options__title">Post Options</p>

          <div v-if="!isLockedDirect" class="compose-options__field">
            <label for="compose-opt-visibility">Visibility</label>
            <select
              id="compose-opt-visibility"
              v-model="visibility"
              class="compose-visibility-select"
              :disabled="isPosting"
            >
              <option v-for="opt in COMPOSE_VISIBILITY_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.icon }} {{ opt.label }}
              </option>
            </select>
          </div>
          <p v-else class="compose-options__hint">
            <NeoIcon name="message" :size="14" :stroke="2" />
            Direct — only mentioned people can see this
          </p>

          <div class="compose-options__row">
            <button
              type="button"
              class="compose-options__toggle"
              :class="{ 'compose-options__toggle--on': showCw }"
              :aria-pressed="showCw"
              :disabled="isPosting"
              @click="emit('toggleCw')"
            >
              Content warning
            </button>
            <button
              type="button"
              class="compose-options__toggle"
              :class="{ 'compose-options__toggle--on': markSensitive }"
              :aria-pressed="markSensitive"
              :disabled="isPosting || !hasMedia"
              @click="markSensitive = !markSensitive"
            >
              Mark media sensitive
            </button>
          </div>

          <div v-if="showCw" class="compose-options__field">
            <label for="compose-opt-cw">Warning text</label>
            <input
              id="compose-opt-cw"
              v-model="spoilerText"
              type="text"
              class="neo-input"
              placeholder="Content warning"
              :readonly="isPosting"
            />
          </div>

          <div v-if="instancesStore.canSchedulePosts" class="compose-options__field">
            <label for="compose-opt-schedule">Schedule</label>
            <div class="compose-schedule">
              <input
                id="compose-opt-schedule"
                v-model="scheduledLocal"
                type="datetime-local"
                class="compose-schedule-input"
                :min="scheduleMinLocal"
                :disabled="isPosting || extraSegmentCount > 0"
                :aria-label="hasSchedule ? 'Scheduled post time' : 'Schedule post for later'"
              />
              <button
                v-if="hasSchedule"
                type="button"
                class="compose-schedule__clear"
                :disabled="isPosting"
                aria-label="Clear schedule — post now"
                @click="emit('clearSchedule')"
              >
                ×
              </button>
            </div>
            <p v-if="extraSegmentCount" class="compose-options__hint">
              Scheduling is available for a single post — remove extra thread parts first.
            </p>
            <p v-else-if="hasSchedule" class="compose-options__hint">{{ scheduleZone }}</p>
            <p v-if="scheduleProblem" class="compose-options__hint" role="alert">{{ scheduleProblem }}</p>
          </div>

          <div v-if="!isDirectCompose" class="compose-options__field">
            <label for="compose-opt-lang">Language</label>
            <select
              id="compose-opt-lang"
              v-model="postLanguage"
              class="compose-language-select"
              :disabled="isPosting"
            >
              <option v-for="opt in languageOptions" :key="opt.code" :value="opt.code">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <button type="button" class="compose-options__done neo-btn neo-btn--primary" @click="emit('close')">
            Done
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
@use '~/assets/css/compose' as compose;

@include compose.compose-visibility-select;
@include compose.compose-language-select;
@include compose.compose-schedule;

.compose-options {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.compose-options__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--neo-bg-overlay);
  cursor: pointer;
}

.compose-options__panel {
  position: relative;
  z-index: 1;
  margin: 0 0.5rem calc(0.5rem + env(safe-area-inset-bottom, 0px));
  padding: 0.75rem 0.85rem 0.85rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 16px;
  max-height: calc(100dvh - 1rem - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  @media (min-width: 640px) {
    align-self: center;
    width: 100%;
    max-width: 22rem;
    margin-bottom: 1.5rem;
  }
}

.compose-options__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.compose-options__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;

  label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-secondary);
  }

  select,
  input {
    min-height: 40px;
    width: 100%;
  }
}

.compose-options__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.compose-options__toggle {
  min-height: 36px;
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;

  &--on {
    border-color: color-mix(in srgb, var(--neo-accent) 45%, transparent);
    background: color-mix(in srgb, var(--neo-accent) 14%, transparent);
    color: var(--neo-accent);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.compose-options__hint {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.compose-options__done {
  margin-top: 0.25rem;
  min-height: 40px;
}

.action-sheet-enter-active,
.action-sheet-leave-active {
  transition: opacity 0.18s ease;

  .compose-options__panel {
    transition: transform 0.22s ease;
  }
}

.action-sheet-enter-from,
.action-sheet-leave-to {
  opacity: 0;

  .compose-options__panel {
    transform: translateY(12px);
  }
}
</style>
