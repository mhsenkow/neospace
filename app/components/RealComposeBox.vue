<script setup lang="ts">
/**
 * RealComposeBox Component
 * 
 * Compose and post real statuses to the Fediverse!
 */

import { ref, computed } from 'vue'
import { useTimelineStore } from '~/stores/timeline'
import { useAuthStore } from '~/stores/auth'

const timelineStore = useTimelineStore()
const authStore = useAuthStore()

const content = ref('')
const spoilerText = ref('')
const visibility = ref<'public' | 'unlisted' | 'private' | 'direct'>('public')
const showCW = ref(false)
const isPosting = ref(false)
const error = ref<string | null>(null)

const maxLength = 500 // Standard Mastodon limit, GoToSocial may differ

const characterCount = computed(() => content.value.length)
const isOverLimit = computed(() => characterCount.value > maxLength)
const canPost = computed(() => 
  content.value.trim().length > 0 && 
  !isOverLimit.value && 
  !isPosting.value &&
  authStore.isAuthenticated
)

const visibilityOptions = [
  { value: 'public', label: 'Public', icon: '🌍', desc: 'Visible to everyone' },
  { value: 'unlisted', label: 'Unlisted', icon: '🔓', desc: 'Visible but not on timelines' },
  { value: 'private', label: 'Followers Only', icon: '🔒', desc: 'Only visible to followers' },
  { value: 'direct', label: 'Direct', icon: '✉️', desc: 'Only visible to mentioned users' },
]

const currentVisibility = computed(() => 
  visibilityOptions.find(v => v.value === visibility.value)
)

const handlePost = async () => {
  if (!canPost.value) return
  
  isPosting.value = true
  error.value = null
  
  try {
    await timelineStore.postStatus(content.value, {
      visibility: visibility.value,
      spoilerText: showCW.value ? spoilerText.value : undefined,
    })
    
    // Clear the form
    content.value = ''
    spoilerText.value = ''
    showCW.value = false
  } catch (e: any) {
    error.value = e.message || 'Failed to post'
  } finally {
    isPosting.value = false
  }
}

const toggleCW = () => {
  showCW.value = !showCW.value
  if (!showCW.value) {
    spoilerText.value = ''
  }
}
</script>

<template>
  <div class="compose neo-card">
    <div class="compose-header">
      <img 
        v-if="authStore.userAvatar"
        :src="authStore.userAvatar" 
        :alt="authStore.userDisplayName"
        class="compose-avatar neo-avatar"
      />
      <span class="compose-title">What's on your mind?</span>
    </div>

    <!-- Content Warning Input -->
    <div v-if="showCW" class="compose-cw">
      <input
        v-model="spoilerText"
        type="text"
        class="compose-cw-input neo-input"
        placeholder="Content warning (optional)"
      />
    </div>

    <!-- Main Textarea -->
    <textarea
      v-model="content"
      class="compose-input neo-input"
      placeholder="Share your thoughts with the Fediverse..."
      rows="4"
      :disabled="isPosting"
    />

    <!-- Error Message -->
    <div v-if="error" class="compose-error">
      {{ error }}
    </div>

    <!-- Footer -->
    <div class="compose-footer">
      <div class="compose-tools">
        <button class="compose-tool" aria-label="Add image" title="Add image">
          📷
        </button>
        <button class="compose-tool" aria-label="Add poll" title="Add poll">
          📊
        </button>
        <button 
          class="compose-tool" 
          :class="{ 'compose-tool--active': showCW }"
          aria-label="Toggle content warning" 
          title="Content warning"
          @click="toggleCW"
        >
          ⚠️
        </button>
        
        <!-- Visibility Selector -->
        <div class="compose-visibility">
          <select v-model="visibility" class="compose-visibility-select">
            <option v-for="opt in visibilityOptions" :key="opt.value" :value="opt.value">
              {{ opt.icon }} {{ opt.label }}
            </option>
          </select>
        </div>
      </div>

      <div class="compose-actions">
        <span 
          class="compose-counter"
          :class="{ 
            'compose-counter--warning': characterCount > maxLength * 0.9, 
            'compose-counter--error': isOverLimit 
          }"
        >
          {{ characterCount }}/{{ maxLength }}
        </span>
        
        <button 
          class="compose-submit neo-btn neo-btn--primary"
          :disabled="!canPost"
          @click="handlePost"
        >
          <span v-if="isPosting">Posting...</span>
          <span v-else>Post</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.compose {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.compose-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.compose-avatar {
  width: 40px;
  height: 40px;
}

.compose-title {
  font-weight: 600;
  color: var(--neo-text-primary);
}

.compose-cw {
  margin-bottom: -0.5rem;
}

.compose-cw-input {
  background-color: var(--neo-bg-tertiary);
  border-color: var(--neo-warning);
}

.compose-input {
  resize: vertical;
  min-height: 100px;
  max-height: 400px;
}

.compose-error {
  padding: 0.75rem;
  background-color: rgba(220, 53, 69, 0.1);
  border: 1px solid var(--neo-danger);
  border-radius: var(--neo-radius-md);
  color: var(--neo-danger);
  font-size: 0.875rem;
}

.compose-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.compose-tools {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.compose-tool {
  padding: 0.5rem;
  font-size: 1.125rem;
  background: transparent;
  border: none;
  border-radius: var(--neo-radius-md);
  cursor: pointer;
  opacity: 0.7;
  transition: all var(--neo-transition);

  &:hover {
    opacity: 1;
    background-color: var(--neo-accent-soft);
  }

  &--active {
    opacity: 1;
    background-color: var(--neo-warning);
    color: black;
  }
}

.compose-visibility {
  margin-left: 0.5rem;
}

.compose-visibility-select {
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
  background-color: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md);
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
  }
}

.compose-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.compose-counter {
  font-size: 0.875rem;
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

.compose-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

