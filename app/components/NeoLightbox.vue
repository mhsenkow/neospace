<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOverlayStore } from '~/stores/overlay'

const overlay = useOverlayStore()
const rootRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => overlay.lightbox.open)
const hasGallery = computed(() => overlay.lightbox.items.length > 1)
const positionLabel = computed(() => {
  if (!hasGallery.value) return ''
  return `${overlay.lightbox.index + 1} of ${overlay.lightbox.items.length}`
})

const onKeydown = (e: KeyboardEvent) => {
  if (!overlay.lightbox.open) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    overlay.lightboxStep(-1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    overlay.lightboxStep(1)
  }
}

useFocusTrap(rootRef, isOpen, {
  onEscape: () => overlay.closeLightbox(),
  initialFocus: '.neo-lightbox__close',
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="overlay.lightbox.open"
      ref="rootRef"
      class="neo-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="overlay.lightbox.alt || 'Image viewer'"
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
      <button
        v-if="hasGallery"
        type="button"
        class="neo-btn neo-btn--ghost neo-lightbox__nav neo-lightbox__nav--prev"
        aria-label="Previous image"
        @click="overlay.lightboxStep(-1)"
      >
        ‹
      </button>
      <img
        class="neo-lightbox__img"
        :src="overlay.lightbox.src"
        :alt="overlay.lightbox.alt"
      />
      <button
        v-if="hasGallery"
        type="button"
        class="neo-btn neo-btn--ghost neo-lightbox__nav neo-lightbox__nav--next"
        aria-label="Next image"
        @click="overlay.lightboxStep(1)"
      >
        ›
      </button>
      <p v-if="positionLabel" class="neo-lightbox__counter">{{ positionLabel }}</p>
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

.neo-lightbox__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  min-width: 44px;
  min-height: 44px;
  color: #fff;
  border-color: rgba(255, 255, 255, 0.35);
  font-size: 1.75rem;
  line-height: 1;

  &--prev {
    left: max(var(--neo-spacing-3, 0.75rem), env(safe-area-inset-left));
  }

  &--next {
    right: max(var(--neo-spacing-3, 0.75rem), env(safe-area-inset-right));
  }
}

.neo-lightbox__img {
  max-width: min(96vw, 1200px);
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--neo-radius-sm);
}

.neo-lightbox__counter {
  position: absolute;
  bottom: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.875rem;
}
</style>
