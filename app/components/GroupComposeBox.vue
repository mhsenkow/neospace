<script setup lang="ts">
/**
 * Group compose — hashtag auto-append + Threads-easy media
 */

import { useStatusStore } from '~/stores/status'
import { useGroupsStore } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'
import { useComposeMedia } from '~/composables/useComposeMedia'

const props = defineProps<{
  tag: string
  groupName?: string
  groupIcon?: string
}>()

const emit = defineEmits<{
  (e: 'posted', status: any): void
}>()

const statusStore = useStatusStore()
const groupsStore = useGroupsStore()
const instancesStore = useInstancesStore()

const content = ref('')
const visibility = ref<'public' | 'unlisted' | 'private' | 'direct'>('public')
const isPosting = ref(false)
const error = ref<string | null>(null)
const showSuccess = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const {
  attachments,
  isDragging,
  isUploading,
  hasMedia,
  mediaIds,
  allReady,
  canAddMore,
  addFiles,
  removeAttachment,
  clearAttachments,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onPaste,
} = useComposeMedia()

const maxLength = computed(() => instancesStore.statusMaxCharacters)
const hashtagLength = computed(() => ` #${props.tag}`.length)
const effectiveMaxLength = computed(() => maxLength.value - hashtagLength.value)

const characterCount = computed(() => content.value.length)
const isOverLimit = computed(() => characterCount.value > effectiveMaxLength.value)
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

const visibilityOptions = [
  { value: 'public', label: 'Public', icon: '🌍' },
  { value: 'unlisted', label: 'Unlisted', icon: '🔓' },
]

const handlePost = async () => {
  if (!canPost.value) return

  isPosting.value = true
  error.value = null
  showSuccess.value = false

  try {
    const body = content.value.trim()
    const postContent = body ? `${body} #${props.tag}` : `#${props.tag}`

    const status = await statusStore.postStatus(postContent, {
      visibility: visibility.value,
      mediaIds: mediaIds.value,
    })

    if (groupsStore.currentGroupTag?.toLowerCase() === props.tag.toLowerCase()) {
      groupsStore.groupTimeline = [status, ...groupsStore.groupTimeline]
    }

    content.value = ''
    clearAttachments()
    showSuccess.value = true
    setTimeout(() => {
      showSuccess.value = false
    }, 3000)

    emit('posted', status)
  } catch (e: any) {
    error.value = e.message || 'Failed to post'
  } finally {
    isPosting.value = false
  }
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
</script>

<template>
  <div
    class="group-compose"
    :class="{ 'group-compose--dragging': isDragging }"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <div v-if="isDragging" class="group-compose__drop" aria-hidden="true">
      Drop photos to add
    </div>

    <div class="group-compose__header">
      <span class="group-compose__icon">{{ groupIcon || '✍️' }}</span>
      <span class="group-compose__title">Post to {{ groupName || `#${tag}` }}</span>
    </div>

    <div class="group-compose__body">
      <img
        v-if="instancesStore.userAvatar"
        :src="instancesStore.userAvatar"
        :alt="instancesStore.userDisplayName || 'Your avatar'"
        class="group-compose__avatar"
      />
      <div class="group-compose__input-wrapper">
        <textarea
          ref="textareaRef"
          v-model="content"
          class="group-compose__input"
          :placeholder="`Share with ${groupName || '#' + tag} — or drop a photo`"
          rows="3"
          :disabled="isPosting"
          @paste="onPaste"
          @keydown.meta.enter="handlePost"
          @keydown.ctrl.enter="handlePost"
        />
        <span class="group-compose__hashtag-preview">#{{ tag }}</span>
      </div>
    </div>

    <div v-if="attachments.length" class="group-compose__media">
      <div
        v-for="item in attachments"
        :key="item.localId"
        class="group-compose__media-item"
        :class="{ busy: item.uploading, error: !!item.error }"
      >
        <img
          v-if="item.file.type.startsWith('image/')"
          :src="item.previewUrl"
          alt=""
        />
        <span v-else class="group-compose__media-video">🎬</span>
        <button
          type="button"
          class="group-compose__media-remove"
          aria-label="Remove"
          @click="removeAttachment(item.localId)"
        >
          ×
        </button>
      </div>
    </div>

    <div v-if="error" class="group-compose__error">
      <span>⚠️</span> {{ error }}
    </div>

    <Transition name="fade">
      <div v-if="showSuccess" class="group-compose__success">
        <span>✅</span> Posted to #{{ tag }}!
      </div>
    </Transition>

    <div class="group-compose__footer">
      <div class="group-compose__options">
        <input
          ref="fileInputRef"
          type="file"
          class="group-compose__file"
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
          multiple
          @change="onFilePicked"
        />
        <button
          type="button"
          class="group-compose__photo"
          title="Add photo"
          :disabled="!canAddMore || isPosting"
          @click="openFilePicker"
        >
          📷
        </button>
        <select v-model="visibility" class="group-compose__visibility">
          <option v-for="opt in visibilityOptions" :key="opt.value" :value="opt.value">
            {{ opt.icon }} {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="group-compose__actions">
        <span
          class="group-compose__counter"
          :class="{
            'group-compose__counter--warning': characterCount > effectiveMaxLength * 0.9,
            'group-compose__counter--error': isOverLimit,
          }"
        >
          {{ characterCount }}/{{ effectiveMaxLength }}
        </span>

        <button
          class="group-compose__submit"
          :disabled="!canPost"
          @click="handlePost"
        >
          <span v-if="isPosting">…</span>
          <span v-else-if="isUploading">Uploading…</span>
          <span v-else>Post</span>
        </button>
      </div>
    </div>

    <p class="group-compose__hint">
      Includes <code>#{{ tag }}</code> automatically · drop or paste photos
    </p>
  </div>
</template>

<style lang="scss" scoped>
.group-compose {
  position: relative;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md, 12px);
  padding: 0.875rem;
  margin-bottom: 1rem;

  &--dragging {
    border-color: var(--neo-accent);
  }

  @media (min-width: 480px) {
    padding: 1rem;
    margin-bottom: 1.25rem;
  }
}

.group-compose__drop {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: grid;
  place-items: center;
  font-family: var(--neo-font-family-ui);
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--neo-accent);
  background: color-mix(in srgb, var(--neo-bg-secondary) 88%, var(--neo-accent));
  border: 2px dashed var(--neo-accent);
  border-radius: inherit;
  pointer-events: none;
}

.group-compose__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--neo-border-color);
}

.group-compose__icon {
  font-size: 1.125rem;
}

.group-compose__title {
  font-family: var(--neo-font-family-ui);
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--neo-text-primary);
}

.group-compose__body {
  display: flex;
  gap: 0.75rem;
}

.group-compose__avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--neo-radius-full, 50%);
  object-fit: cover;
  flex-shrink: 0;
}

.group-compose__input-wrapper {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.group-compose__input {
  width: 100%;
  min-height: 4.5rem;
  padding: 0.5rem 0;
  resize: none;
  border: none;
  background: transparent;
  color: var(--neo-text-primary);
  font-size: 0.9375rem;
  line-height: 1.45;

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: var(--neo-text-disabled);
  }
}

.group-compose__hashtag-preview {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-accent);
}

.group-compose__media {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 0.4rem;
  margin-top: 0.65rem;
}

.group-compose__media-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--neo-radius-sm, 6px);
  overflow: hidden;
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &.busy {
    opacity: 0.6;
  }
}

.group-compose__media-video {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 1.25rem;
}

.group-compose__media-remove {
  position: absolute;
  top: 0.2rem;
  right: 0.2rem;
  width: 1.35rem;
  height: 1.35rem;
  display: grid;
  place-items: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.875rem;
  line-height: 1;
}

.group-compose__error,
.group-compose__success {
  margin-top: 0.65rem;
  padding: 0.5rem 0.65rem;
  border-radius: var(--neo-radius-sm);
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.group-compose__error {
  color: var(--neo-danger);
  background: var(--neo-danger-soft);
}

.group-compose__success {
  color: var(--neo-success, #2f7d4a);
  background: color-mix(in srgb, var(--neo-success, #2f7d4a) 12%, transparent);
}

.group-compose__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--neo-border-color);
}

.group-compose__options {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.group-compose__file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.group-compose__photo {
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  background: transparent;
  border: none;
  border-radius: var(--neo-radius-chrome, 6px);
  cursor: pointer;
  font-size: 1rem;

  &:hover:not(:disabled) {
    background: var(--neo-accent-soft);
  }

  &:disabled {
    opacity: 0.35;
  }
}

.group-compose__visibility {
  padding: 0.3rem 0.4rem;
  font-size: 0.75rem;
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-chrome, 6px);
}

.group-compose__actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.group-compose__counter {
  font-size: 0.75rem;
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

.group-compose__submit {
  min-width: 4.5rem;
  padding: 0.45rem 0.9rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-on-accent, #fff);
  background: var(--neo-accent);
  border: none;
  border-radius: var(--neo-radius-chrome, 6px);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--neo-accent-hover);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.group-compose__hint {
  margin: 0.65rem 0 0;
  font-size: 0.6875rem;
  color: var(--neo-text-muted);

  code {
    font-family: var(--neo-font-family-mono);
    color: var(--neo-accent);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
