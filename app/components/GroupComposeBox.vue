<script setup lang="ts">
/**
 * GroupComposeBox Component
 * 
 * A compact compose box specifically for groups.
 * Automatically appends the group hashtag to posts.
 */

import { ref, computed } from 'vue'
import { useTimelineStore } from '~/stores/timeline'
import { useGroupsStore } from '~/stores/groups'
import { useAuthStore } from '~/stores/auth'

const props = defineProps<{
  /** The group's hashtag (without #) */
  tag: string
  /** Optional group name for display */
  groupName?: string
  /** Optional group icon */
  groupIcon?: string
}>()

const emit = defineEmits<{
  (e: 'posted', status: any): void
}>()

const timelineStore = useTimelineStore()
const groupsStore = useGroupsStore()
const authStore = useAuthStore()

const content = ref('')
const visibility = ref<'public' | 'unlisted' | 'private' | 'direct'>('public')
const isPosting = ref(false)
const error = ref<string | null>(null)
const showSuccess = ref(false)

const maxLength = 500 // Standard Mastodon limit
// Account for the hashtag that will be appended
const hashtagLength = computed(() => ` #${props.tag}`.length)
const effectiveMaxLength = computed(() => maxLength - hashtagLength.value)

const characterCount = computed(() => content.value.length)
const isOverLimit = computed(() => characterCount.value > effectiveMaxLength.value)
const canPost = computed(() => 
  content.value.trim().length > 0 && 
  !isOverLimit.value && 
  !isPosting.value &&
  authStore.isAuthenticated
)

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
    // Append the hashtag to the content
    const postContent = `${content.value.trim()} #${props.tag}`
    
    const status = await timelineStore.postStatus(postContent, {
      visibility: visibility.value,
    })
    
    // Add to the group timeline so user sees it immediately
    if (groupsStore.currentGroupTag?.toLowerCase() === props.tag.toLowerCase()) {
      groupsStore.groupTimeline = [status, ...groupsStore.groupTimeline]
    }
    
    // Clear the form
    content.value = ''
    showSuccess.value = true
    
    // Hide success message after a bit
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
</script>

<template>
  <div class="group-compose">
    <div class="group-compose__header">
      <span class="group-compose__icon">{{ groupIcon || '✍️' }}</span>
      <span class="group-compose__title">Post to {{ groupName || `#${tag}` }}</span>
    </div>

    <!-- User avatar and input -->
    <div class="group-compose__body">
      <img 
        v-if="authStore.userAvatar"
        :src="authStore.userAvatar" 
        :alt="authStore.userDisplayName || 'Your avatar'"
        class="group-compose__avatar"
      />
      <div class="group-compose__input-wrapper">
        <textarea
          v-model="content"
          class="group-compose__input"
          :placeholder="`Share something with ${groupName || '#' + tag}...`"
          rows="3"
          :disabled="isPosting"
          @keydown.meta.enter="handlePost"
          @keydown.ctrl.enter="handlePost"
        />
        <span class="group-compose__hashtag-preview">
          #{{ tag }}
        </span>
      </div>
    </div>

    <!-- Error Message -->
    <div v-if="error" class="group-compose__error">
      <span>⚠️</span> {{ error }}
    </div>

    <!-- Success Message -->
    <Transition name="fade">
      <div v-if="showSuccess" class="group-compose__success">
        <span>✅</span> Posted to #{{ tag }}!
      </div>
    </Transition>

    <!-- Footer -->
    <div class="group-compose__footer">
      <div class="group-compose__options">
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
            'group-compose__counter--error': isOverLimit 
          }"
        >
          {{ characterCount }}/{{ effectiveMaxLength }}
        </span>
        
        <button 
          class="group-compose__submit"
          :disabled="!canPost"
          @click="handlePost"
        >
          <span v-if="isPosting" class="group-compose__spinner">⏳</span>
          <span v-else>Post</span>
        </button>
      </div>
    </div>

    <p class="group-compose__hint">
      Your post will include <code>#{{ tag }}</code> automatically
    </p>
  </div>
</template>

<style lang="scss" scoped>
.group-compose {
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  padding: 0.875rem;
  margin-bottom: 1rem;

  @media (min-width: 480px) {
    padding: 1rem;
    border-radius: 14px;
    margin-bottom: 1.25rem;
  }

  @media (min-width: 600px) {
    padding: 1.25rem;
    border-radius: 16px;
    margin-bottom: 1.5rem;
  }
}

.group-compose__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--neo-border-color);

  @media (min-width: 480px) {
    gap: 0.625rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
  }
}

.group-compose__icon {
  font-size: 1.125rem;

  @media (min-width: 480px) {
    font-size: 1.25rem;
  }
}

.group-compose__title {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--neo-text-primary);

  @media (min-width: 480px) {
    font-size: 0.9375rem;
  }
}

.group-compose__body {
  display: flex;
  gap: 0.625rem;
  margin-bottom: 0.75rem;

  @media (min-width: 480px) {
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
}

.group-compose__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;

  @media (min-width: 480px) {
    width: 40px;
    height: 40px;
  }
}

.group-compose__input-wrapper {
  flex: 1;
  position: relative;
  min-width: 0;
}

.group-compose__input {
  width: 100%;
  padding: 0.625rem 0.75rem;
  padding-bottom: 1.75rem; // Space for hashtag preview
  font-size: 0.9375rem;
  line-height: 1.5;
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  color: var(--neo-text-primary);
  resize: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  @media (min-width: 480px) {
    padding: 0.75rem 1rem;
    padding-bottom: 2rem;
    font-size: 1rem;
    border-radius: 12px;
  }

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
    box-shadow: 0 0 0 3px var(--neo-accent-soft);
  }

  &::placeholder {
    color: var(--neo-text-muted);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.group-compose__hashtag-preview {
  position: absolute;
  bottom: 0.5rem;
  left: 0.75rem;
  font-size: 0.75rem;
  color: var(--neo-accent);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  background: var(--neo-accent-soft);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  pointer-events: none;

  @media (min-width: 480px) {
    left: 1rem;
    font-size: 0.8125rem;
  }
}

.group-compose__error {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.625rem 0.75rem;
  background: rgba(220, 53, 69, 0.1);
  border: 1px solid #dc3545;
  border-radius: 8px;
  color: #dc3545;
  font-size: 0.8125rem;
  margin-bottom: 0.75rem;

  @media (min-width: 480px) {
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }
}

.group-compose__success {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.625rem 0.75rem;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid #10b981;
  border-radius: 8px;
  color: #10b981;
  font-size: 0.8125rem;
  margin-bottom: 0.75rem;

  @media (min-width: 480px) {
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    margin-bottom: 1rem;
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

.group-compose__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.group-compose__options {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.group-compose__visibility {
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: 6px;
  cursor: pointer;

  @media (min-width: 480px) {
    padding: 0.4375rem 0.625rem;
    font-size: 0.875rem;
  }

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
  }
}

.group-compose__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;

  @media (min-width: 480px) {
    gap: 1rem;
  }
}

.group-compose__counter {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  font-variant-numeric: tabular-nums;

  @media (min-width: 480px) {
    font-size: 0.8125rem;
  }

  &--warning {
    color: #f59e0b;
  }

  &--error {
    color: #dc3545;
    font-weight: 600;
  }
}

.group-compose__submit {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  background: var(--neo-accent);
  color: white;
  border: none;
  border-radius: 100px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  gap: 0.375rem;

  @media (min-width: 480px) {
    padding: 0.625rem 1.25rem;
    font-size: 0.9375rem;
  }

  &:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
}

.group-compose__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.group-compose__hint {
  margin: 0.75rem 0 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  text-align: center;

  @media (min-width: 480px) {
    margin-top: 1rem;
    font-size: 0.8125rem;
  }

  code {
    background: var(--neo-accent-soft);
    color: var(--neo-accent);
    padding: 0.125rem 0.25rem;
    border-radius: 3px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.6875rem;

    @media (min-width: 480px) {
      font-size: 0.75rem;
    }
  }
}
</style>

