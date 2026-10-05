<script setup lang="ts">
/**
 * Leave-a-note FAB → GitHub issue (same pattern as loom.ibm.io FeedbackNotes)
 */

import {
  createGitHubIssue,
  getGitHubNewIssueUrl,
  prepareScreenshot,
  type FeedbackKind,
} from '~/utils/feedback'

const KINDS: { id: FeedbackKind; label: string }[] = [
  { id: 'ux', label: 'UX' },
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
  { id: 'other', label: 'Other' },
]

const open = ref(false)
const kind = ref<FeedbackKind>('ux')
const title = ref('')
const body = ref('')
const shot = ref<string | null>(null)
const busy = ref(false)
const toast = ref<string | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)

let toastTimer: ReturnType<typeof setTimeout> | null = null

const showToast = (msg: string) => {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 4200)
}

const reset = () => {
  title.value = ''
  body.value = ''
  kind.value = 'ux'
  shot.value = null
  if (fileRef.value) fileRef.value.value = ''
}

const onUpload = async (file: File | undefined) => {
  if (!file) return
  try {
    shot.value = await prepareScreenshot(file)
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Could not read that image.')
  }
}

const submit = async () => {
  if (!title.value.trim() || busy.value) return
  busy.value = true

  const fullTitle = `[${kind.value}] ${title.value.trim()}`
  const fullBody = body.value.trim() || '(no description)'

  try {
    const url = await createGitHubIssue(fullTitle, fullBody, {
      kind: kind.value,
      imageBase64: shot.value,
    })
    showToast('Note filed as a GitHub issue')
    window.open(url, '_blank', 'noopener,noreferrer')
    reset()
    open.value = false
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const fallback = getGitHubNewIssueUrl(fullTitle, fullBody)
    window.open(fallback, '_blank', 'noopener,noreferrer')
    showToast(
      msg.includes('GITHUB_TOKEN') || msg.includes('not configured')
        ? 'Opened GitHub — paste your note there (API token not set yet).'
        : `Opened GitHub form (${msg.slice(0, 80)})`,
    )
  } finally {
    busy.value = false
  }
}

onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <Teleport to="body">
    <button
      v-if="!open"
      type="button"
      class="notes-fab"
      aria-label="Leave a note"
      title="Leave a note"
      @click="open = true"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>

    <Transition name="notes">
      <div
        v-if="open"
        class="notes-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Leave a note"
        @click.self="open = false"
      >
        <div class="notes-panel">
          <header class="notes-panel__header">
            <h2>Leave a note</h2>
            <button type="button" class="notes-panel__close" aria-label="Close" @click="open = false">×</button>
          </header>

          <p class="notes-panel__lede">
            Files as a GitHub issue on NeoSpace — bugs, UX, ideas.
          </p>

          <div class="notes-kinds">
            <button
              v-for="k in KINDS"
              :key="k.id"
              type="button"
              class="notes-kind"
              :class="{ 'notes-kind--active': kind === k.id }"
              @click="kind = k.id"
            >
              {{ k.label }}
            </button>
          </div>

          <input
            v-model="title"
            type="text"
            class="notes-input"
            placeholder="Short title"
            autofocus
            @keydown.enter.prevent="submit"
          />

          <textarea
            v-model="body"
            class="notes-textarea"
            placeholder="What happened / what would help…"
            rows="4"
          />

          <div class="notes-shot-row">
            <input
              id="neospace-note-shot"
              ref="fileRef"
              type="file"
              accept="image/*"
              class="notes-file"
              @change="onUpload(($event.target as HTMLInputElement).files?.[0])"
            />
            <label for="neospace-note-shot" class="notes-shot-btn">
              {{ shot ? 'Replace screenshot' : 'Attach screenshot' }}
            </label>
            <button v-if="shot" type="button" class="notes-shot-clear" @click="shot = null">
              Remove
            </button>
          </div>

          <img v-if="shot" :src="shot" alt="Screenshot preview" class="notes-preview" />

          <div class="notes-actions">
            <button type="button" class="notes-cancel" @click="open = false">Cancel</button>
            <button
              type="button"
              class="notes-submit"
              :disabled="!title.trim() || busy"
              @click="submit"
            >
              {{ busy ? 'Filing…' : 'File note' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="toast">
      <div v-if="toast" class="notes-toast" role="status">{{ toast }}</div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.notes-fab {
  position: fixed;
  left: max(0.75rem, env(safe-area-inset-left));
  bottom: max(4.5rem, calc(env(safe-area-inset-bottom) + 3.75rem));
  z-index: 90;
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  color: var(--neo-text-muted);
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 6px;
  box-shadow: 0 4px 14px color-mix(in srgb, var(--neo-text-primary) 12%, transparent);
  cursor: pointer;
  transition: color var(--neo-transition-fast), border-color var(--neo-transition-fast);

  &:hover,
  &:focus-visible {
    color: var(--neo-text-primary);
    border-color: color-mix(in srgb, var(--neo-accent) 50%, var(--neo-border-color));
    outline: none;
  }

  @media (min-width: 1024px) {
    bottom: max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem));
    width: 2.25rem;
    height: 2.25rem;
  }
}

.notes-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(3px);

  @media (min-width: 640px) {
    align-items: center;
    padding: 1rem;
  }
}

.notes-panel {
  width: 100%;
  max-width: 26rem;
  padding: 1.125rem 1.125rem calc(1.125rem + env(safe-area-inset-bottom));
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 12px 40px color-mix(in srgb, var(--neo-text-primary) 18%, transparent);

  @media (min-width: 640px) {
    border-radius: 10px;
    padding: 1.25rem;
  }
}

.notes-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;

  h2 {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }
}

.notes-panel__close {
  width: 1.75rem;
  height: 1.75rem;
  font-size: 1.25rem;
  line-height: 1;
  color: var(--neo-text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    color: var(--neo-text-primary);
    background: var(--neo-bg-hover);
  }
}

.notes-panel__lede {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--neo-text-muted);
}

.notes-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.notes-kind {
  padding: 0.3rem 0.55rem;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--neo-text-muted);
  background: transparent;
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
  cursor: pointer;

  &--active {
    color: var(--neo-text-primary);
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }
}

.notes-input,
.notes-textarea {
  width: 100%;
  margin-bottom: 0.5rem;
  padding: 0.65rem 0.75rem;
  font-size: 0.8125rem;
  color: var(--neo-text-primary);
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color-dark);
  border-radius: 4px;
  outline: none;

  &:focus {
    border-color: var(--neo-accent);
  }

  &::placeholder {
    color: var(--neo-text-disabled);
  }
}

.notes-textarea {
  min-height: 5.5rem;
  resize: vertical;
  line-height: 1.45;
}

.notes-file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}

.notes-shot-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.notes-shot-btn {
  padding: 0.3rem 0.55rem;
  font-size: 0.6875rem;
  color: var(--neo-text-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    color: var(--neo-text-primary);
    border-color: var(--neo-accent);
  }
}

.notes-shot-clear {
  font-size: 0.6875rem;
  color: var(--neo-text-muted);
  background: none;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--neo-text-primary);
  }
}

.notes-preview {
  display: block;
  max-height: 7rem;
  width: auto;
  margin-bottom: 0.75rem;
  border-radius: 4px;
  border: 1px solid var(--neo-border-color);
  object-fit: contain;
  background: var(--neo-bg-tertiary);
}

.notes-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.notes-cancel {
  padding: 0.45rem 0.75rem;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    color: var(--neo-text-primary);
    background: var(--neo-bg-hover);
  }
}

.notes-submit {
  padding: 0.45rem 0.85rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-on-accent, #fafaf8);
  background: var(--neo-accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--neo-accent-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.notes-toast {
  position: fixed;
  left: 50%;
  bottom: max(5.5rem, calc(env(safe-area-inset-bottom) + 4.5rem));
  z-index: 1200;
  transform: translateX(-50%);
  max-width: min(90vw, 22rem);
  padding: 0.65rem 0.9rem;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--neo-text-primary);
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 6px;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--neo-text-primary) 16%, transparent);

  @media (min-width: 1024px) {
    bottom: max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem));
  }
}

.notes-enter-active,
.notes-leave-active {
  transition: opacity 0.18s ease;

  .notes-panel {
    transition: transform 0.18s ease;
  }
}

.notes-enter-from,
.notes-leave-to {
  opacity: 0;

  .notes-panel {
    transform: translateY(12px);
  }
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
</style>
