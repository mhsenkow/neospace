<script setup lang="ts">
/**
 * Leave-a-note FAB → GitHub issue (same pattern as loom.ibm.io FeedbackNotes)
 * Mobile: centered modal that tracks visualViewport so the keyboard doesn't bury inputs.
 */

import {
  createGitHubIssue,
  FeedbackError,
  FEEDBACK_BODY_MAX,
  FEEDBACK_TITLE_MAX,
  getGitHubNewIssueUrl,
  prepareScreenshot,
  type FeedbackKind,
} from '~/utils/feedback'
import { useFeedbackNotes } from '~/composables/useFeedbackNotes'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (id?: string) => void
      remove: (id: string) => void
    }
  }
}

const KINDS: { id: FeedbackKind; label: string }[] = [
  { id: 'ux', label: 'UX' },
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
  { id: 'other', label: 'Other' },
]

const config = useRuntimeConfig()
const turnstileSiteKey = computed(
  () => (config.public.turnstileSiteKey as string) || '',
)

const { open, close } = useFeedbackNotes()
const kind = ref<FeedbackKind>('ux')
const title = ref('')
const body = ref('')
const shot = ref<string | null>(null)
const busy = ref(false)
const toast = ref<string | null>(null)
const fallbackUrl = ref<string | null>(null)
const turnstileToken = ref<string | null>(null)
const turnstileWidgetId = ref<string | null>(null)
const bodyRef = ref<HTMLTextAreaElement | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)
const titleRef = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const overlayRef = ref<HTMLElement | null>(null)
const turnstileRef = ref<HTMLDivElement | null>(null)

const submitDisabledReason = computed(() => {
  if (busy.value) return 'Filing your note…'
  if (!title.value.trim()) return 'Add a title first'
  if (turnstileSiteKey.value && !turnstileToken.value) return 'Complete verification first'
  return ''
})

const canSubmit = computed(() => !submitDisabledReason.value)

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

const reduceMotion = usePrefersReducedMotion()

const onFocusField = (e: FocusEvent) => {
  const el = e.target as HTMLElement | null
  if (!el || !panelRef.value) return
  // After keyboard animates, scroll the focused field into the panel's visible area
  window.setTimeout(() => {
    syncViewport()
    el.scrollIntoView({ block: 'center', behavior: reduceMotion.value ? 'auto' : 'smooth' })
  }, 300)
}

const tryClose = () => {
  if (busy.value) return
  close()
}

let turnstileScriptPromise: Promise<void> | null = null
const loadTurnstileScript = () => {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile failed to load'))
    document.head.appendChild(script)
  })
  return turnstileScriptPromise
}

const mountTurnstile = async () => {
  if (!turnstileSiteKey.value || !turnstileRef.value) return
  try {
    await loadTurnstileScript()
    if (turnstileWidgetId.value) {
      window.turnstile?.remove(turnstileWidgetId.value)
      turnstileWidgetId.value = null
    }
    turnstileToken.value = null
    turnstileWidgetId.value =
      window.turnstile?.render(turnstileRef.value, {
        sitekey: turnstileSiteKey.value,
        callback: (token: string) => {
          turnstileToken.value = token
        },
        'expired-callback': () => {
          turnstileToken.value = null
        },
        'error-callback': () => {
          turnstileToken.value = null
        },
      }) ?? null
  } catch {
    showToast('Verification widget failed to load.')
  }
}

const resetTurnstile = () => {
  if (turnstileWidgetId.value) {
    window.turnstile?.reset(turnstileWidgetId.value)
  }
  turnstileToken.value = null
}

const onTitleEnter = (e: KeyboardEvent) => {
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  bodyRef.value?.focus()
}

const onFormKeydown = (e: KeyboardEvent) => {
  if (e.isComposing || e.keyCode === 229) return
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void submit()
  }
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
  if (!canSubmit.value) return
  busy.value = true
  fallbackUrl.value = null

  const fullTitle = `[${kind.value}] ${title.value.trim()}`
  const fullBody = body.value.trim() || '(no description)'

  try {
    const url = await createGitHubIssue(fullTitle, fullBody, {
      kind: kind.value,
      imageBase64: shot.value,
      turnstileToken: turnstileToken.value,
    })
    showToast('Note filed as a GitHub issue')
    fallbackUrl.value = url
    reset()
    resetTurnstile()
  } catch (e) {
    const err = e instanceof FeedbackError ? e : null
    const msg = err?.message ?? (e instanceof Error ? e.message : String(e))
    const status = err?.status
    const fallback = await getGitHubNewIssueUrl(fullTitle, fullBody)
    if (status === 429) {
      showToast('Too many notes — wait a bit and try again.')
    } else if (status === 403 && err?.code?.startsWith('TURNSTILE')) {
      showToast('Verification failed — try again.')
      resetTurnstile()
    } else if (status === 503 || err?.code === 'NOT_CONFIGURED') {
      fallbackUrl.value = fallback
      showToast('API unavailable — use the GitHub link below.')
    } else if (/network|fetch|offline|failed to fetch/i.test(msg)) {
      showToast('Couldn’t reach GitHub — check your connection and retry.')
    } else {
      fallbackUrl.value = fallback
      showToast(msg.slice(0, 120) || 'Couldn’t file the note.')
    }
  } finally {
    busy.value = false
  }
}

useFocusTrap(overlayRef, open, {
  onEscape: () => tryClose(),
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
    await nextTick()
    void mountTurnstile()
  } else {
    unlockScroll()
    window.visualViewport?.removeEventListener('resize', syncViewport)
    window.visualViewport?.removeEventListener('scroll', syncViewport)
    window.removeEventListener('resize', syncViewport)
    viewportStyle.value = {}
    if (turnstileWidgetId.value) {
      window.turnstile?.remove(turnstileWidgetId.value)
      turnstileWidgetId.value = null
    }
    turnstileToken.value = null
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
      v-show="!open"
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
        @click.self="tryClose"
        @keydown="onFormKeydown"
      >
        <div ref="panelRef" class="notes-panel">
          <header class="notes-panel__header">
            <h2 id="neospace-notes-title">Leave a note</h2>
            <button
              type="button"
              class="notes-panel__close"
              aria-label="Close"
              :disabled="busy"
              @click="tryClose"
            >
              <NeoIcon name="x" :size="16" :stroke="2" />
            </button>
          </header>

          <p class="notes-panel__lede">
            Files as a <strong>public</strong> GitHub issue on NeoSpace — bugs, UX, ideas.
            The current page URL and any screenshot are included.
          </p>

          <fieldset class="notes-kinds">
            <legend class="notes-kinds__legend">Note type</legend>
            <label
              v-for="k in KINDS"
              :key="k.id"
              class="notes-kind"
              :class="{ 'notes-kind--active': kind === k.id }"
            >
              <input
                v-model="kind"
                type="radio"
                name="neospace-note-kind"
                :value="k.id"
              />
              <span>{{ k.label }}</span>
            </label>
          </fieldset>

          <label class="notes-label" for="neospace-note-title">Title</label>
          <input
            id="neospace-note-title"
            ref="titleRef"
            v-model="title"
            type="text"
            class="notes-input"
            placeholder="Short title"
            :maxlength="FEEDBACK_TITLE_MAX"
            enterkeyhint="next"
            autocomplete="off"
            autocorrect="on"
            required
            aria-required="true"
            aria-describedby="neospace-note-title-count"
            @focus="onFocusField"
            @keydown.enter="onTitleEnter"
          />
          <p id="neospace-note-title-count" class="notes-counter">
            {{ title.length }}/{{ FEEDBACK_TITLE_MAX }}
          </p>

          <label class="notes-label" for="neospace-note-body">Details</label>
          <textarea
            id="neospace-note-body"
            ref="bodyRef"
            v-model="body"
            class="notes-textarea"
            placeholder="What happened / what would help…"
            rows="4"
            :maxlength="FEEDBACK_BODY_MAX"
            enterkeyhint="done"
            aria-describedby="neospace-note-body-count"
            @focus="onFocusField"
          />
          <p id="neospace-note-body-count" class="notes-counter">
            {{ body.length }}/{{ FEEDBACK_BODY_MAX }}
          </p>

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
            <button
              v-if="shot"
              type="button"
              class="notes-shot-clear"
              aria-label="Remove screenshot"
              @click="shot = null"
            >
              Remove
            </button>
          </div>

          <img v-if="shot" :src="shot" alt="Screenshot preview" class="notes-preview" />

          <div
            v-if="turnstileSiteKey"
            ref="turnstileRef"
            class="notes-turnstile"
            aria-label="Bot verification"
          />

          <p v-if="fallbackUrl" class="notes-fallback" role="status">
            <a :href="fallbackUrl" target="_blank" rel="noopener noreferrer">Open on GitHub</a>
          </p>

          <div class="notes-actions">
            <button type="button" class="notes-cancel" :disabled="busy" @click="tryClose">
              Cancel
            </button>
            <button
              type="button"
              class="notes-submit"
              :disabled="!canSubmit"
              :title="submitDisabledReason || undefined"
              :aria-describedby="submitDisabledReason ? 'neospace-note-submit-hint' : undefined"
              @click="submit"
            >
              {{ busy ? 'Filing…' : 'File note' }}
            </button>
          </div>
          <p
            v-if="submitDisabledReason && !busy"
            id="neospace-note-submit-hint"
            class="notes-submit-hint"
          >
            {{ submitDisabledReason }}
          </p>
        </div>
      </div>
    </Transition>

    <div class="notes-toast" role="status" aria-live="polite">
      <Transition name="toast">
        <span v-if="toast">{{ toast }}</span>
      </Transition>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.notes-fab {
  position: fixed;
  left: max(0.75rem, env(safe-area-inset-left));
  bottom: calc(var(--neo-mobile-nav-h, 56px) + env(safe-area-inset-bottom, 0px) + 0.65rem);
  z-index: var(--neo-z-shell-header, 90);
  display: grid;
  place-items: center;
  // 44px touch target
  width: 2.75rem;
  height: 2.75rem;
  color: var(--neo-text-muted);
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 6px;
  box-shadow: 0 4px 14px color-mix(in srgb, var(--neo-text-primary) 12%, transparent);
  cursor: pointer;
  transition: color var(--neo-transition-fast), border-color var(--neo-transition-fast);

  &:hover {
    color: var(--neo-text-primary);
    border-color: color-mix(in srgb, var(--neo-accent) 50%, var(--neo-border-color));
  }

  /* Desktop: note lives in the sidebar footer */
  @media (min-width: 1024px) {
    display: none;
  }
}

.notes-overlay {
  position: fixed;
  z-index: var(--neo-z-modal-backdrop, 1040);
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

.notes-counter {
  margin: -0.25rem 0 0.5rem;
  font-size: 0.6875rem;
  color: var(--neo-text-secondary);
  text-align: right;
}

.notes-submit-hint {
  margin: 0.35rem 0 0;
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  text-align: right;
}

.notes-turnstile {
  flex-shrink: 0;
  margin-bottom: 0.5rem;
}

.notes-panel__lede {
  margin: 0 0 0.75rem;
  flex-shrink: 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--neo-text-muted);
}

.notes-label {
  display: block;
  margin: 0 0 0.3rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
}

.notes-fallback {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;

  a {
    color: var(--neo-accent);
  }
}

.notes-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  flex-shrink: 0;
  margin: 0 0 0.75rem;
  padding: 0;
  border: none;
}

.notes-kinds__legend {
  width: 100%;
  margin: 0 0 0.35rem;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
}

.notes-kind {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--neo-text-muted);
  background: transparent;
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
  cursor: pointer;

  input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
  }

  &:has(input:focus-visible) {
    outline: 2px solid var(--neo-focus, var(--neo-accent));
    outline-offset: 2px;
    box-shadow: 0 0 0 4px var(--neo-bg-primary);
  }

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
  box-sizing: border-box;

  &::placeholder {
    color: var(--neo-text-secondary);
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
  border-radius: 4px;

  &:focus-within .notes-shot-btn {
    outline: 2px solid var(--neo-focus, var(--neo-accent));
    outline-offset: 2px;
    box-shadow: 0 0 0 4px var(--neo-bg-primary);
    border-color: var(--neo-focus, var(--neo-accent));
  }
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
  z-index: var(--neo-z-toast, 1080);
  transform: translateX(-50%);
  max-width: min(90vw, 22rem);
  pointer-events: none;

  &:empty,
  &:not(:has(span)) {
    display: none;
  }

  span {
    display: block;
    padding: 0.65rem 0.9rem;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--neo-text-primary);
    background: var(--neo-bg-card);
    border: 1px solid var(--neo-border-color);
    border-radius: 6px;
    box-shadow: 0 8px 24px color-mix(in srgb, var(--neo-text-primary) 16%, transparent);
  }

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
