<script setup lang="ts">
/**
 * Full-screen / bottom compose sheet for mobile (+ tab).
 */

import { useComposeSheetStore } from '~/stores/composeSheet'
import type { mastodon } from 'masto'

const sheet = useComposeSheetStore()

const onPosted = (_status: mastodon.v1.Status) => {
  sheet.hide()
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && sheet.open) sheet.hide()
}

watch(
  () => sheet.open,
  (open) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = open ? 'hidden' : ''
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="compose-sheet">
      <div
        v-if="sheet.open"
        class="compose-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="New post"
      >
        <button type="button" class="compose-sheet__backdrop" aria-label="Close" @click="sheet.hide()" />
        <div class="compose-sheet__panel">
          <header class="compose-sheet__header">
            <button type="button" class="compose-sheet__close neo-btn neo-btn--tertiary" @click="sheet.hide()">
              Cancel
            </button>
            <span class="compose-sheet__title">New post</span>
            <span class="compose-sheet__spacer" />
          </header>
          <div class="compose-sheet__body">
            <RealComposeBox
              :key="sheet.instanceKey"
              :initial-text="sheet.initialText || undefined"
              :initial-visibility="sheet.initialVisibility || undefined"
              :placeholder="sheet.placeholder || undefined"
              title="What's new?"
              @posted="onPosted"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.compose-sheet {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;

  @media (min-width: 1024px) {
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
  }
}

.compose-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--neo-bg-overlay);
  cursor: pointer;
}

.compose-sheet__panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: min(92vh, 100%);
  background: var(--neo-bg-primary);
  border-radius: 16px 16px 0 0;
  border: 1px solid var(--neo-border-color);
  border-bottom: none;
  box-shadow: var(--neo-shadow-xl);
  padding-bottom: env(safe-area-inset-bottom, 0);

  @media (min-width: 1024px) {
    max-width: 560px;
    max-height: min(80vh, 720px);
    border-radius: 12px;
    border-bottom: 1px solid var(--neo-border-color);
    padding-bottom: 0;
  }
}

.compose-sheet__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--neo-border-color);
  flex-shrink: 0;
}

.compose-sheet__close {
  min-width: auto;
  min-height: 40px;
  padding: 0.35rem 0.65rem;
  font-size: 0.875rem;
  font-weight: 600;
}

.compose-sheet__title {
  flex: 1;
  text-align: center;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--neo-text-primary);
}

.compose-sheet__spacer {
  width: 4.5rem;
}

.compose-sheet__body {
  overflow-y: auto;
  padding: 0.75rem;
  -webkit-overflow-scrolling: touch;
}

.compose-sheet-enter-active,
.compose-sheet-leave-active {
  transition: opacity 0.2s ease;

  .compose-sheet__panel {
    transition: transform 0.22s ease;
  }
}

.compose-sheet-enter-from,
.compose-sheet-leave-to {
  opacity: 0;

  .compose-sheet__panel {
    transform: translateY(100%);
  }
}
</style>
