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

/**
 * Touch: swipe left/right through the gallery, swipe down to dismiss.
 * Pinch-zoom stays native (touch-action: pinch-zoom); gestures pause while zoomed.
 */
const SWIPE_STEP_PX = 50
const SWIPE_CLOSE_PX = 90
const drag = ref<{ id: number; x: number; y: number; dx: number; dy: number } | null>(null)

const isZoomed = () =>
  typeof window !== 'undefined' && (window.visualViewport?.scale ?? 1) > 1.01

const onPointerDown = (e: PointerEvent) => {
  if (e.pointerType === 'mouse' || isZoomed() || drag.value) return
  if ((e.target as HTMLElement | null)?.closest('button')) return
  drag.value = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }
}

const onPointerMove = (e: PointerEvent) => {
  const d = drag.value
  if (!d || d.id !== e.pointerId) return
  d.dx = e.clientX - d.x
  d.dy = e.clientY - d.y
}

/** A swipe that ends on the backdrop must not also count as tap-to-close */
let suppressBackdropClick = false

const onBackdropClick = (e: MouseEvent) => {
  if (e.target !== e.currentTarget) return
  if (suppressBackdropClick) {
    suppressBackdropClick = false
    return
  }
  overlay.closeLightbox()
}

const onPointerEnd = (e: PointerEvent) => {
  const d = drag.value
  if (!d || d.id !== e.pointerId) return
  drag.value = null
  suppressBackdropClick = Math.hypot(d.dx, d.dy) > 10
  const horizontal = Math.abs(d.dx) > Math.abs(d.dy)
  if (horizontal && hasGallery.value && Math.abs(d.dx) >= SWIPE_STEP_PX) {
    overlay.lightboxStep(d.dx < 0 ? 1 : -1)
  } else if (!horizontal && d.dy >= SWIPE_CLOSE_PX) {
    overlay.closeLightbox()
  }
}

/** Follow the finger a little so the gesture feels attached */
const imgStyle = computed(() => {
  const d = drag.value
  if (!d) return undefined
  const horizontal = Math.abs(d.dx) > Math.abs(d.dy)
  const x = horizontal && hasGallery.value ? d.dx * 0.6 : 0
  const y = !horizontal && d.dy > 0 ? d.dy * 0.6 : 0
  return {
    transform: `translate(${x}px, ${y}px)`,
    opacity: String(Math.max(0.4, 1 - y / 400)),
    transition: 'none',
  }
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
      :aria-label="overlay.lightbox.alt || 'Image viewer'"
      @click="onBackdropClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="drag = null"
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
      <figure class="neo-lightbox__figure" :style="imgStyle">
        <img
          class="neo-lightbox__img"
          :src="overlay.lightbox.src"
          :alt="overlay.lightbox.alt"
          draggable="false"
        />
        <!-- Alt text is for everyone, not just screen readers -->
        <figcaption v-if="overlay.lightbox.alt" class="neo-lightbox__alt">
          {{ overlay.lightbox.alt }}
        </figcaption>
      </figure>
      <button
        v-if="hasGallery"
        type="button"
        class="neo-btn neo-btn--ghost neo-lightbox__nav neo-lightbox__nav--next"
        aria-label="Next image"
        @click="overlay.lightboxStep(1)"
      >
        ›
      </button>
      <p v-if="positionLabel" class="neo-lightbox__counter" aria-live="polite">{{ positionLabel }}</p>
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
  // One-finger moves come to our swipe handlers; two-finger pinch stays native
  touch-action: pinch-zoom;
}

.neo-lightbox__figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  margin: 0;
  max-width: 100%;
  transition: transform 0.2s ease, opacity 0.2s ease;
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
  max-height: 90dvh;
  object-fit: contain;
  border-radius: var(--neo-radius-sm);
  user-select: none;
  -webkit-user-drag: none;

  // Leave room for the caption when there is one
  .neo-lightbox__figure:has(.neo-lightbox__alt) & {
    max-height: 70dvh;
  }
}

.neo-lightbox__alt {
  max-width: min(92vw, 40rem);
  max-height: 12dvh;
  overflow-y: auto;
  margin: 0;
  color: rgba(255, 255, 255, 0.88);
  font-size: 0.875rem;
  line-height: 1.45;
  text-align: center;
  white-space: pre-line;
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
