<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOverlayStore } from '~/stores/overlay'

const overlay = useOverlayStore()
const rootRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => overlay.lightbox.open)

useFocusTrap(rootRef, isOpen, {
  onEscape: () => overlay.closeLightbox(),
  initialFocus: '.neo-lightbox__close',
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="overlay.lightbox.open"
      ref="rootRef"
      class="neo-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="overlay.lightbox.alt || 'Image'"
      @click.self="overlay.closeLightbox()"
    >
      <button
        type="button"
        class="neo-btn neo-btn--ghost neo-lightbox__close"
        aria-label="Close"
        @click="overlay.closeLightbox()"
      >
        Close
      </button>
      <img
        class="neo-lightbox__img"
        :src="overlay.lightbox.src"
        :alt="overlay.lightbox.alt"
      />
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.neo-lightbox {
  position: fixed;
  inset: 0;
  z-index: var(--neo-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--neo-spacing-6, 1.25rem);
  background: rgba(0, 0, 0, 0.88);
}

.neo-lightbox__close {
  position: absolute;
  top: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-top));
  right: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-right));
  color: #fff;
  border-color: rgba(255, 255, 255, 0.35);

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.5);
  }
}

.neo-lightbox__img {
  max-width: min(96vw, 1200px);
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--neo-radius-sm);
}
</style>
