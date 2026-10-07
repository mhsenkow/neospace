<script setup lang="ts">
/**
 * Leave-a-note FAB → GitHub issue (same pattern as loom.ibm.io FeedbackNotes)
 * Mobile: centered modal that tracks visualViewport so the keyboard doesn't bury inputs.
 */

import {
  createGitHubIssue,
  getGitHubNewIssueUrl,
  prepareScreenshot,
  type FeedbackKind,
} from '~/utils/feedback'
import { useFeedbackNotes } from '~/composables/useFeedbackNotes'

const KINDS: { id: FeedbackKind; label: string }[] = [
  { id: 'ux', label: 'UX' },
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
  { id: 'other', label: 'Other' },
]

const { open } = useFeedbackNotes()
const kind = ref<FeedbackKind>('ux')
const title = ref('')
const body = ref('')
const shot = ref<string | null>(null)
const busy = ref(false)
const toast = ref<string | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)
const titleRef = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const overlayRef = ref<HTMLElement | null>(null)

/** visualViewport offset — keeps the sheet in the visible area above the keyboard */
const viewportStyle = ref<Record<string, string>>({})

let toastTimer: ReturnType<typeof setTimeout> | null = null
let scrollLockY = 0

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

const syncViewport = () => {
  if (typeof window === 'undefined') return
  const vv = window.visualViewport
  if (!vv) {
    viewportStyle.value = {
      top: '0px',
      left: '0px',
      width: '100%',
      height: '100%',
    }
    return
  }
  // Position overlay to the *visible* viewport (above soft keyboard)
  viewportStyle.value = {
    top: `${vv.offsetTop}px`,
    left: `${vv.offsetLeft}px`,
    width: `${vv.width}px`,
    height: `${vv.height}px`,
  }
}

const lockScroll = () => {
  if (typeof document === 'undefined') return
  scrollLockY = window.scrollY || 0
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  document.body.style.position = 'fixed'
  document.body.style.inset = '0'
  document.body.style.width = '100%'
}

const unlockScroll = () => {
  if (typeof document === 'undefined') return
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.inset = ''
  document.body.style.width = ''
  window.scrollTo(0, scrollLockY)
}

const onFocusField = (e: FocusEvent) => {
  const el = e.target as HTMLElement | null
  if (!el || !panelRef.value) return
  // After keyboard animates, scroll the focused field into the panel's visible area
  window.setTimeout(() => {
    syncViewport()
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 300)
}

const close = () => {
  open.value = false
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
    close()
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

useFocusTrap(overlayRef, open, {
  onEscape: () => close(),
  initialFocus: 'input, textarea, .notes-panel__close',
})

watch(open, async (isOpen) => {
  if (typeof window === 'undefined') return
  if (isOpen) {
    syncViewport()
    lockScroll()
    window.visualViewport?.addEventListener('resize', syncViewport)
    window.visualViewport?.addEventListener('scroll', syncViewport)
    window.addEventListener('resize', syncViewport)
  } else {
    unlockScroll()
    window.visualViewport?.removeEventListener('resize', syncViewport)
    window.visualViewport?.removeEventListener('scroll', syncViewport)
    window.removeEventListener('resize', syncViewport)
    viewportStyle.value = {}
  }
})

onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
  window.visualViewport?.removeEventListener('resize', syncViewport)
  window.visualViewport?.removeEventListener('scroll', syncViewport)
  window.removeEventListener('resize', syncViewport)
  if (open.value) unlockScroll()
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
        ref="overlayRef"
        class="notes-overlay"
        :style="viewportStyle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="neospace-notes-title"
        @click.self="close"
      >
        <div ref="panelRef" class="notes-panel">
          <header class="notes-panel__header">
            <h2 id="neospace-notes-title">Leave a note</h2>
            <button type="button" class="notes-panel__close" aria-label="Close" @click="close">
              <NeoIcon name="x" :size="16" :stroke="2" />
            </button>
          </header>

          <p class="notes-panel__lede">
            Files as a GitHub issue on NeoSpace — bugs, UX, ideas.
          </p>

          <div class="notes-kinds" role="radiogroup" aria-label="Note type">
            <button
              v-for="k in KINDS"
              :key="k.id"
              type="button"
              role="radio"
              class="notes-kind"
              :class="{ 'notes-kind--active': kind === k.id }"
              :aria-checked="kind === k.id"
              @click="kind = k.id"
            >
              {{ k.label }}
            </button>
          </div>

          <label class="sr-only" for="neospace-note-title">Title</label>
          <input
            id="neospace-note-title"
            ref="titleRef"
            v-model="title"
            type="text"
            class="notes-input"
            placeholder="Short title"
            enterkeyhint="next"
            autocomplete="off"
            autocorrect="on"
            required
            aria-required="true"
            @focus="onFocusField"
            @keydown.enter.prevent="submit"
          />

          <label class="sr-only" for="neospace-note-body">Details</label>
          <textarea
            id="neospace-note-body"
            v-model="body"
            class="notes-textarea"
            placeholder="What happened / what would help…"
            rows="4"
            enterkeyhint="done"
            @focus="onFocusField"
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
            <button type="button" class="notes-cancel" @click="close">Cancel</button>
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

  /* Desktop: note lives in the sidebar footer */
  @media (min-width: 1024px) {
    display: none;
  }
}

.notes-overlay {
  position: fixed;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: max(0.75rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right))
    max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  /* Fallback when visualViewport style isn't applied yet */
  inset: 0;
  overscroll-behavior: contain;
}

.notes-panel {
  display: flex;
  flex-direction: column;
  width: min(100%, 26rem);
  max-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 1.125rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  box-shadow: 0 16px 48px color-mix(in srgb, var(--neo-text-primary) 22%, transparent);
}

.notes-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-bottom: 0.35rem;

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }
}

.notes-panel__close {
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
  flex-shrink: 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--neo-text-muted);
}

.notes-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  flex-shrink: 0;
  margin-bottom: 0.75rem;
}

.notes-kind {
  padding: 0.4rem 0.65rem;
  font-size: 0.75rem;
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
  padding: 0.7rem 0.75rem;
  /* ≥16px avoids iOS auto-zoom on focus */
  font-size: 1rem;
  color: var(--neo-text-primary);
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color-dark);
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;

  &:focus {
    border-color: var(--neo-accent);
  }

  &::placeholder {
    color: var(--neo-text-disabled);
  }
}

.notes-textarea {
  min-height: 5.5rem;
  max-height: 12rem;
  resize: vertical;
  line-height: 1.45;
  flex: 0 1 auto;
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
  flex-shrink: 0;
  margin-bottom: 0.5rem;
}

.notes-shot-btn {
  padding: 0.4rem 0.65rem;
  font-size: 0.75rem;
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
  font-size: 0.75rem;
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
  max-height: 6rem;
  width: auto;
  max-width: 100%;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
  border-radius: 4px;
  border: 1px solid var(--neo-border-color);
  object-fit: contain;
  background: var(--neo-bg-tertiary);
}

.notes-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
  padding-top: 0.35rem;
  /* Keep actions reachable above home indicator when keyboard is closed */
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.notes-cancel {
  padding: 0.55rem 0.85rem;
  font-size: 0.875rem;
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
  padding: 0.55rem 0.95rem;
  font-size: 0.875rem;
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
    transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease;
  }
}

.notes-enter-from,
.notes-leave-to {
  opacity: 0;

  .notes-panel {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
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
