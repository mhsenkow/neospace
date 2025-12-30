<script setup lang="ts">
/**
 * ComposeBox Component
 * 
 * Where the magic posts are born.
 */

import { ref } from 'vue'

const content = ref('')
const maxLength = 500

const characterCount = computed(() => content.value.length)
const isOverLimit = computed(() => characterCount.value > maxLength)
const canPost = computed(() => content.value.trim().length > 0 && !isOverLimit.value)

const handlePost = () => {
  if (!canPost.value) return
  
  console.log('Posting:', content.value)
  // In real app, this would call the Mastodon API
  content.value = ''
}
</script>

<template>
  <div class="compose-box neo-card">
    <div class="compose-box__header">
      <span class="compose-box__title">What's on your mind?</span>
    </div>

    <textarea
      v-model="content"
      class="compose-box__input neo-input"
      placeholder="Share your thoughts with the void..."
      rows="3"
    />

    <div class="compose-box__footer">
      <div class="compose-box__tools">
        <button class="compose-box__tool" aria-label="Add image">📷</button>
        <button class="compose-box__tool" aria-label="Add poll">📊</button>
        <button class="compose-box__tool" aria-label="Add emoji">😊</button>
        <button class="compose-box__tool" aria-label="Content warning">⚠️</button>
      </div>

      <div class="compose-box__actions">
        <span 
          class="compose-box__counter"
          :class="{ 'compose-box__counter--warning': characterCount > maxLength * 0.9, 'compose-box__counter--error': isOverLimit }"
        >
          {{ characterCount }}/{{ maxLength }}
        </span>
        <button 
          class="compose-box__submit neo-btn neo-btn--primary"
          :disabled="!canPost"
          @click="handlePost"
        >
          Post
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.compose-box {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  &__input {
    resize: vertical;
    min-height: 80px;
    max-height: 300px;
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  &__tools {
    display: flex;
    gap: 0.25rem;
  }

  &__tool {
    padding: 0.5rem;
    font-size: 1.125rem;
    background: transparent;
    border: none;
    border-radius: var(--neo-radius-md);
    cursor: pointer;
    transition: all var(--neo-transition);
    opacity: 0.7;

    &:hover {
      opacity: 1;
      background-color: var(--neo-accent-soft);
      transform: scale(1.1);
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  &__counter {
    font-size: 0.875rem;
    color: var(--neo-text-muted);
    font-variant-numeric: tabular-nums;
    transition: color var(--neo-transition);

    &--warning {
      color: var(--neo-warning);
    }

    &--error {
      color: var(--neo-danger);
      font-weight: 600;
    }
  }

  &__submit {
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
    }
  }
}
</style>

