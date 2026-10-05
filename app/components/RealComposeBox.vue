<script setup lang="ts">
/**
 * Compose — Threads-easy posting: drag/drop, paste, previews, Cmd+Enter
 */

import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import { useSettingsStore } from '~/stores/settings'
import { useComposeHandoffStore } from '~/stores/composeHandoff'
import { useComposeMedia } from '~/composables/useComposeMedia'
import type { mastodon } from 'masto'

const props = withDefaults(
  defineProps<{
    /** When set, posts as a reply to this status */
    inReplyToId?: string
    placeholder?: string
    title?: string
    /** Slimmer chrome for sticky thread reply bars */
    compact?: boolean
    /** Prefill (e.g. @acct) — applied once on mount */
    initialText?: string
  }>(),
  {
    placeholder: 'Share something — or drop a photo here',
    title: "What's new?",
    compact: false,
  },
)

const emit = defineEmits<{
  posted: [status: mastodon.v1.Status]
}>()

const statusStore = useStatusStore()
const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()
const handoffStore = useComposeHandoffStore()

const content = ref(props.initialText || '')
const spoilerText = ref('')
const visibility = ref<'public' | 'unlisted' | 'private' | 'direct'>(
  settingsStore.defaultVisibility,
)
const showCW = ref(settingsStore.defaultSensitive)
const isPosting = ref(false)
const error = ref<string | null>(null)
const handoffNotice = ref<string | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const {
  attachments,
  isDragging,
  isUploading,
  hasMedia,
  mediaIds,
  allReady,
  canAddMore,
  maxAttachments,
  addFiles,
  removeAttachment,
  clearAttachments,
  retryUpload,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onPaste,
} = useComposeMedia()

const maxLength = computed(() => instancesStore.statusMaxCharacters)

const characterCount = computed(() => content.value.length)
const isOverLimit = computed(() => characterCount.value > maxLength.value)
const canPost = computed(() => {
  const hasText = content.value.trim().length > 0
  return (
    (hasText || hasMedia.value) &&
    !isOverLimit.value &&
    !isPosting.value &&
    !isUploading.value &&
    allReady.value &&
    instancesStore.isAuthenticated
  )
})

const postingAs = computed(() => {
  const account = instancesStore.activeAccount
  if (!account?.user) return null
  const acct = account.user.acct || account.user.username
  const host = account.url.replace(/^https?:\/\//, '')
  return acct.includes('@') ? `@${acct}` : `@${acct}@${host}`
})

const visibilityOptions = [
  { value: 'public', label: 'Public', icon: '🌍' },
  { value: 'unlisted', label: 'Unlisted', icon: '🔓' },
  { value: 'private', label: 'Followers', icon: '🔒' },
  { value: 'direct', label: 'Mentioned', icon: '✉️' },
] as const

const resetForm = () => {
  content.value = props.inReplyToId && props.initialText ? props.initialText : ''
  spoilerText.value = ''
  showCW.value = settingsStore.defaultSensitive
  visibility.value = settingsStore.defaultVisibility
  clearAttachments()
  error.value = null
}

watch(
  () => [settingsStore.defaultVisibility, settingsStore.defaultSensitive] as const,
  ([vis, sensitive]) => {
    // Only apply defaults when compose is empty (don't yank mid-draft)
    if (!content.value.trim() && !hasMedia.value && !isPosting.value) {
      visibility.value = vis
      showCW.value = sensitive
    }
  },
)

const handlePost = async () => {
  if (!canPost.value) return

  isPosting.value = true
  error.value = null

  try {
    const status = await statusStore.postStatus(content.value, {
      visibility: visibility.value,
      spoilerText: showCW.value ? spoilerText.value : undefined,
      mediaIds: mediaIds.value,
      sensitive: showCW.value || undefined,
      inReplyToId: props.inReplyToId,
    })
    resetForm()
    emit('posted', status)
    nextTick(() => {
      textareaRef.value?.focus()
      if (props.initialText && content.value === props.initialText) {
        const len = content.value.length
        textareaRef.value?.setSelectionRange(len, len)
      }
    })
  } catch (e: any) {
    error.value = e.message || 'Failed to post'
  } finally {
    isPosting.value = false
  }
}

const toggleCW = () => {
  showCW.value = !showCW.value
  if (!showCW.value) spoilerText.value = ''
}

const openFilePicker = () => {
  if (!canAddMore.value || isPosting.value) return
  fileInputRef.value?.click()
}

const onFilePicked = async (e: Event) => {
  const input = e.target as HTMLInputElement
  await addFiles(input.files)
  input.value = ''
}

const onKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    handlePost()
  }
}

const focusComposer = () => {
  textareaRef.value?.focus()
}

const applyHandoff = async () => {
  // Only the main home compose absorbs Loom shares — not reply bars
  if (props.inReplyToId || props.compact || !handoffStore.hasPending) return
  const draft = handoffStore.take()
  if (!draft) return
  if (draft.text) content.value = draft.text
  // Replace any prior handoff media so retries don't stack duplicates
  if (draft.files.length) {
    clearAttachments()
    await addFiles(draft.files)
  }
  handoffNotice.value = draft.notice
  if (handoffNotice.value) {
    window.setTimeout(() => {
      handoffNotice.value = null
    }, 5000)
  }
  await nextTick()
  textareaRef.value?.focus()
  textareaRef.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

watch(
  () => handoffStore.hasPending,
  (ready) => {
    if (ready) void applyHandoff()
  },
)

onMounted(() => {
  if (props.inReplyToId && props.initialText) {
    nextTick(() => {
      textareaRef.value?.focus()
      const len = content.value.length
      textareaRef.value?.setSelectionRange(len, len)
    })
  }
  void applyHandoff()
})
</script>

<template>
  <div
    class="compose neo-card"
    :class="{ 'compose--dragging': isDragging, 'compose--compact': compact }"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
    @click="focusComposer"
  >
    <div
      v-if="isDragging"
      class="compose-drop"
      aria-hidden="true"
    >
      <span class="compose-drop__icon">📷</span>
      <span class="compose-drop__label">Drop photos to add</span>
    </div>

    <div class="compose-header" @click.stop>
      <img
        v-if="instancesStore.userAvatar"
        :src="instancesStore.userAvatar"
        :alt="instancesStore.userDisplayName"
        class="compose-avatar neo-avatar"
      />
      <div class="compose-heading">
        <span class="compose-title">{{ title }}</span>
        <span v-if="postingAs && !compact" class="compose-as">Posting as {{ postingAs }}</span>
      </div>
    </div>

    <div v-if="showCW" class="compose-cw" @click.stop>
      <input
        v-model="spoilerText"
        type="text"
        class="compose-cw-input neo-input"
        placeholder="Content warning"
        :disabled="isPosting"
      />
    </div>

    <textarea
      ref="textareaRef"
      v-model="content"
      class="compose-input neo-input"
      :placeholder="placeholder"
      :rows="compact ? 2 : 3"
      :disabled="isPosting"
      @paste="onPaste"
      @keydown="onKeydown"
      @click.stop
    />

    <!-- Media previews -->
    <div v-if="attachments.length" class="compose-media" @click.stop>
      <div
        v-for="item in attachments"
        :key="item.localId"
        class="compose-media__item"
        :class="{
          'compose-media__item--busy': item.uploading,
          'compose-media__item--error': !!item.error,
        }"
      >
        <img
          v-if="item.file.type.startsWith('image/')"
          :src="item.previewUrl"
          alt=""
          class="compose-media__thumb"
        />
        <div v-else class="compose-media__video">
          <span>🎬</span>
          <span class="compose-media__video-name">{{ item.file.name }}</span>
        </div>
        <div v-if="item.uploading" class="compose-media__overlay">Uploading…</div>
        <div
          v-else-if="item.error"
          class="compose-media__overlay compose-media__overlay--error"
          role="button"
          tabindex="0"
          title="Tap to retry upload"
          @click="retryUpload(item.localId)"
          @keydown.enter="retryUpload(item.localId)"
        >
          {{ item.error }} · retry
        </div>
        <button
          type="button"
          class="compose-media__remove"
          aria-label="Remove"
          :disabled="isPosting"
          @click="removeAttachment(item.localId)"
        >
          ×
        </button>
      </div>
    </div>

    <div v-if="handoffNotice" class="compose-handoff" role="status">{{ handoffNotice }}</div>

    <div v-if="error" class="compose-error" @click.stop>{{ error }}</div>

    <div class="compose-footer" @click.stop>
      <div class="compose-tools">
        <input
          ref="fileInputRef"
          type="file"
          class="compose-file"
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
          multiple
          @change="onFilePicked"
        />
        <button
          type="button"
          class="compose-tool"
          aria-label="Add photo"
          title="Add photo"
          :disabled="!canAddMore || isPosting"
          @click="openFilePicker"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
        <button
          type="button"
          class="compose-tool"
          :class="{ 'compose-tool--active': showCW }"
          aria-label="Content warning"
          title="Content warning"
          :disabled="isPosting"
          @click="toggleCW"
        >
          CW
        </button>

        <div class="compose-visibility">
          <select v-model="visibility" class="compose-visibility-select" :disabled="isPosting">
            <option v-for="opt in visibilityOptions" :key="opt.value" :value="opt.value">
              {{ opt.icon }} {{ opt.label }}
            </option>
          </select>
        </div>

        <span v-if="hasMedia" class="compose-media-count">
          {{ attachments.length }}/{{ maxAttachments }}
        </span>
      </div>

      <div class="compose-actions">
        <span
          class="compose-counter"
          :class="{
            'compose-counter--warning': characterCount > maxLength * 0.9,
            'compose-counter--error': isOverLimit,
          }"
        >
          {{ characterCount }}/{{ maxLength }}
        </span>

        <button
          type="button"
          class="compose-submit neo-btn neo-btn--primary"
          :disabled="!canPost"
          :title="isUploading ? 'Waiting for uploads…' : 'Post (⌘↵)'"
          @click="handlePost"
        >
          <span v-if="isPosting">Posting…</span>
          <span v-else-if="isUploading">Uploading…</span>
          <span v-else>Post</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.compose {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
  cursor: text;

  &--dragging {
    border-color: var(--neo-accent);
    background: color-mix(in srgb, var(--neo-accent) 6%, var(--neo-bg-card));
  }

  &--compact {
    gap: 0.5rem;
    padding: 0.75rem;

    .compose-title {
      font-size: 0.875rem;
    }

    .compose-input {
      min-height: 2.5rem;
      font-size: 0.9375rem;
    }
  }
}

.compose-drop {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  background: color-mix(in srgb, var(--neo-bg-card) 88%, var(--neo-accent));
  border: 2px dashed var(--neo-accent);
  border-radius: inherit;
  pointer-events: none;

  &__icon {
    font-size: 1.75rem;
  }

  &__label {
    font-family: var(--neo-font-family-ui);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--neo-accent);
  }
}

.compose-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: default;
}

.compose-heading {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.compose-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.compose-title {
  font-family: var(--neo-font-family-ui);
  font-weight: 600;
  color: var(--neo-text-primary);
}

.compose-as {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compose-cw-input {
  background-color: var(--neo-bg-tertiary);
  border-color: var(--neo-warning);
}

.compose-input {
  resize: none;
  min-height: 5.5rem;
  max-height: 16rem;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  border: none;
  background: transparent;
  padding: 0.25rem 0;
  font-size: 1.0625rem;
  line-height: 1.45;
  field-sizing: content;

  &:focus {
    outline: none;
    box-shadow: none;
    border: none;
  }

  &::placeholder {
    color: var(--neo-text-disabled);
  }
}

.compose-media {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 0.5rem;
}

.compose-media__item {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--neo-radius-md);
  overflow: hidden;
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
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.compose-media__video {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  width: 100%;
  height: 100%;
  padding: 0.5rem;
  font-size: 1.25rem;
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
  inset: 0;
  display: grid;
  place-items: center;
  padding: 0.35rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-align: center;
  color: var(--neo-text-primary);
  background: color-mix(in srgb, var(--neo-bg-card) 55%, transparent);
  backdrop-filter: blur(2px);

  &--error {
    color: var(--neo-danger);
  }
}

.compose-media__remove {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  width: 1.5rem;
  height: 1.5rem;
  display: grid;
  place-items: center;
  font-size: 1rem;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  border: none;
  border-radius: 50%;
  cursor: pointer;

  &:hover {
    background: rgba(0, 0, 0, 0.85);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.compose-error {
  padding: 0.65rem 0.75rem;
  background-color: var(--neo-danger-soft);
  border: 1px solid color-mix(in srgb, var(--neo-danger) 35%, transparent);
  border-radius: var(--neo-radius-md);
  color: var(--neo-danger);
  font-size: 0.8125rem;
  cursor: default;
}

.compose-handoff {
  padding: 0.65rem 0.75rem;
  background: var(--neo-accent-soft);
  border: 1px solid color-mix(in srgb, var(--neo-accent) 35%, transparent);
  border-radius: var(--neo-radius-md);
  color: var(--neo-accent);
  font-size: 0.8125rem;
}

.compose-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding-top: 0.35rem;
  border-top: 1px solid var(--neo-border-color);
  cursor: default;
}

.compose-tools {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-wrap: wrap;
}

.compose-file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

.compose-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.25rem;
  height: 2.25rem;
  padding: 0 0.5rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--neo-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--neo-radius-chrome, var(--neo-radius-md));
  cursor: pointer;
  transition: background-color var(--neo-transition-fast), color var(--neo-transition-fast);

  &:hover:not(:disabled) {
    color: var(--neo-accent);
    background-color: var(--neo-accent-soft);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  &--active {
    color: var(--neo-text-primary);
    background-color: color-mix(in srgb, var(--neo-warning) 35%, transparent);
  }
}

.compose-visibility {
  margin-left: 0.25rem;
}

.compose-visibility-select {
  padding: 0.35rem 0.45rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.75rem;
  background-color: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-chrome, var(--neo-radius-md));
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
  }
}

.compose-media-count {
  margin-left: 0.35rem;
  font-size: 0.6875rem;
  color: var(--neo-text-muted);
  font-variant-numeric: tabular-nums;
}

.compose-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.compose-counter {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  font-variant-numeric: tabular-nums;

  &--warning {
    color: var(--neo-warning);
  }

  &--error {
    color: var(--neo-danger);
    font-weight: 600;
  }
}

.compose-submit {
  min-width: 5.5rem;
}

.compose-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
