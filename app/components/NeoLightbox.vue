<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOverlayStore } from '~/stores/overlay'
import {
  blurhashPalette,
  focusToCssPercent,
  formatMegapixels,
  simplifyAspectRatio,
} from '~/utils/mediaLoupe'

const overlay = useOverlayStore()
const rootRef = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => overlay.lightbox.open)
const hasGallery = computed(() => overlay.lightbox.items.length > 1)
/** Author-written alt text only — generated fallbacks stay screen-reader-only */
const caption = computed(
  () => overlay.lightbox.items[overlay.lightbox.index]?.caption?.trim() || '',
)
const preview = computed(() => overlay.lightbox.items[overlay.lightbox.index]?.preview || '')
const meta = computed(() => overlay.lightbox.items[overlay.lightbox.index]?.meta)
/** Full-size load state — never leave a bare black screen on slow or failed loads */
const loadState = ref<'loading' | 'loaded' | 'error'>('loading')

const MIN_SCALE = 1
const MAX_SCALE = 8
const DOUBLE_TAP_SCALE = 2.5
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const showHud = ref(false)
const copiedNote = ref('')

const resetTransform = () => {
  scale.value = 1
  panX.value = 0
  panY.value = 0
}

watch(
  () => [overlay.lightbox.open, overlay.lightbox.src] as const,
  () => {
    loadState.value = 'loading'
    resetTransform()
  },
  { immediate: true },
)

const positionLabel = computed(() => {
  if (!hasGallery.value) return ''
  return `${overlay.lightbox.index + 1} of ${overlay.lightbox.items.length}`
})

const galleryLiveLabel = computed(() => {
  const pos = positionLabel.value
  const alt = overlay.lightbox.alt?.trim() || caption.value
  if (!pos) return alt
  return alt ? `${pos}: ${alt}` : pos
})

const isZoomed = computed(() => scale.value > 1.01)

const clampPan = () => {
  // Soft clamp so the image can't leave the stage entirely
  const el = stageRef.value
  if (!el || scale.value <= 1) {
    panX.value = 0
    panY.value = 0
    return
  }
  const maxX = (el.clientWidth * (scale.value - 1)) / 2
  const maxY = (el.clientHeight * (scale.value - 1)) / 2
  panX.value = Math.max(-maxX, Math.min(maxX, panX.value))
  panY.value = Math.max(-maxY, Math.min(maxY, panY.value))
}

const zoomAt = (next: number, clientX?: number, clientY?: number) => {
  const el = stageRef.value
  const prev = scale.value
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next))
  if (clamped === prev) return
  if (clamped <= 1) {
    resetTransform()
    return
  }
  if (el && clientX != null && clientY != null) {
    const rect = el.getBoundingClientRect()
    const cx = clientX - rect.left - rect.width / 2
    const cy = clientY - rect.top - rect.height / 2
    const ratio = clamped / prev
    panX.value = cx - (cx - panX.value) * ratio
    panY.value = cy - (cy - panY.value) * ratio
  }
  scale.value = clamped
  clampPan()
}

const zoomBy = (delta: number, clientX?: number, clientY?: number) => {
  zoomAt(scale.value * delta, clientX, clientY)
}

const onWheel = (e: WheelEvent) => {
  if (!overlay.lightbox.open) return
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
  zoomBy(factor, e.clientX, e.clientY)
}

let lastTapAt = 0
let lastTapX = 0
let lastTapY = 0

const onDoubleActivate = (clientX: number, clientY: number) => {
  if (scale.value > 1.05) resetTransform()
  else zoomAt(DOUBLE_TAP_SCALE, clientX, clientY)
}

const onKeydown = (e: KeyboardEvent) => {
  if (!overlay.lightbox.open) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    overlay.lightboxStep(-1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    overlay.lightboxStep(1)
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault()
    zoomBy(1.25)
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    zoomBy(1 / 1.25)
  } else if (e.key === '0') {
    e.preventDefault()
    resetTransform()
  } else if (e.key === 'i' || e.key === 'I') {
    e.preventDefault()
    showHud.value = !showHud.value
  }
}

useFocusTrap(rootRef, isOpen, {
  onEscape: () => overlay.closeLightbox(),
  initialFocus: '.neo-lightbox__close',
})

watch(
  isOpen,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown)
      showHud.value = false
      copiedNote.value = ''
    } else {
      window.removeEventListener('keydown', onKeydown)
      resetTransform()
    }
  },
  { immediate: true },
)
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

/**
 * Touch: swipe left/right through the gallery, swipe down to dismiss.
 * Custom pinch + drag-pan when zoomed; native pinch paused so we own the scale.
 */
const SWIPE_STEP_PX = 50
const SWIPE_CLOSE_PX = 90
const drag = ref<{
  id: number
  x: number
  y: number
  dx: number
  dy: number
  mode: 'swipe' | 'pan'
  originPanX: number
  originPanY: number
} | null>(null)

type PinchState = {
  dist: number
  scale: number
  midX: number
  midY: number
  panX: number
  panY: number
}
const pinch = ref<PinchState | null>(null)
const activePointers = new Map<number, { x: number; y: number }>()

const pointerDist = () => {
  const pts = [...activePointers.values()]
  if (pts.length < 2) return 0
  const [a, b] = pts
  return Math.hypot(a!.x - b!.x, a!.y - b!.y)
}

const pointerMid = () => {
  const pts = [...activePointers.values()]
  if (pts.length < 2) return { x: 0, y: 0 }
  return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 }
}

const onPointerDown = (e: PointerEvent) => {
  if ((e.target as HTMLElement | null)?.closest('button, .neo-lightbox__alt, .neo-lightbox__hud, a')) {
    return
  }
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)

  if (activePointers.size === 2) {
    drag.value = null
    const mid = pointerMid()
    pinch.value = {
      dist: pointerDist(),
      scale: scale.value,
      midX: mid.x,
      midY: mid.y,
      panX: panX.value,
      panY: panY.value,
    }
    return
  }

  if (e.pointerType === 'mouse' && e.button !== 0) return
  const mode = isZoomed.value ? 'pan' : 'swipe'
  drag.value = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    dx: 0,
    dy: 0,
    mode,
    originPanX: panX.value,
    originPanY: panY.value,
  }
}

const onPointerMove = (e: PointerEvent) => {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  if (pinch.value && activePointers.size >= 2) {
    const d = pointerDist()
    if (pinch.value.dist > 0) {
      const next = pinch.value.scale * (d / pinch.value.dist)
      zoomAt(next, pinch.value.midX, pinch.value.midY)
    }
    return
  }
  const d = drag.value
  if (!d || d.id !== e.pointerId) return
  d.dx = e.clientX - d.x
  d.dy = e.clientY - d.y
  if (d.mode === 'pan') {
    panX.value = d.originPanX + d.dx
    panY.value = d.originPanY + d.dy
    clampPan()
  }
}

/** A swipe that ends on the backdrop must not also count as tap-to-close */
let suppressBackdropClick = false

const onBackdropClick = (e: MouseEvent) => {
  if (e.target !== e.currentTarget && !(e.target as HTMLElement)?.classList.contains('neo-lightbox__stage')) {
    return
  }
  if (suppressBackdropClick) {
    suppressBackdropClick = false
    return
  }
  if (isZoomed.value) {
    resetTransform()
    return
  }
  overlay.closeLightbox()
}

const onPointerEnd = (e: PointerEvent) => {
  activePointers.delete(e.pointerId)
  if (activePointers.size < 2) pinch.value = null

  const d = drag.value
  if (!d || d.id !== e.pointerId) return
  drag.value = null

  if (d.mode === 'pan') {
    suppressBackdropClick = Math.hypot(d.dx, d.dy) > 6
    return
  }

  const moved = Math.hypot(d.dx, d.dy)
  suppressBackdropClick = moved > 10

  // Double-tap zoom (touch)
  if (e.pointerType !== 'mouse' && moved < 12) {
    const now = Date.now()
    if (now - lastTapAt < 320 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40) {
      onDoubleActivate(e.clientX, e.clientY)
      lastTapAt = 0
      suppressBackdropClick = true
      return
    }
    lastTapAt = now
    lastTapX = e.clientX
    lastTapY = e.clientY
  }

  if (isZoomed.value) return
  const horizontal = Math.abs(d.dx) > Math.abs(d.dy)
  if (horizontal && hasGallery.value && Math.abs(d.dx) >= SWIPE_STEP_PX) {
    overlay.lightboxStep(d.dx < 0 ? 1 : -1)
  } else if (!horizontal && d.dy >= SWIPE_CLOSE_PX) {
    overlay.closeLightbox()
  }
}

const onDblClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement | null)?.closest('button, .neo-lightbox__alt, .neo-lightbox__hud, a')) {
    return
  }
  e.preventDefault()
  onDoubleActivate(e.clientX, e.clientY)
}

/** Follow the finger a little so the gesture feels attached (swipe mode only) */
const imgStyle = computed(() => {
  const transform = `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`
  const d = drag.value
  if (!d || d.mode !== 'swipe' || isZoomed.value) {
    return {
      transform,
      transition: pinch.value || (d && d.mode === 'pan') ? 'none' : undefined,
    }
  }
  const horizontal = Math.abs(d.dx) > Math.abs(d.dy)
  const x = horizontal && hasGallery.value ? d.dx * 0.6 : 0
  const y = !horizontal && d.dy > 0 ? d.dy * 0.6 : 0
  return {
    transform: `translate(${x + panX.value}px, ${y + panY.value}px) scale(${scale.value})`,
    opacity: String(Math.max(0.4, 1 - y / 400)),
    transition: 'none',
  }
})

const focusCss = computed(() => focusToCssPercent(meta.value?.focus))
const palette = computed(() => blurhashPalette(meta.value?.blurhash, 5))
const dimLabel = computed(() => {
  const w = meta.value?.width
  const h = meta.value?.height
  if (!w || !h) return null
  return {
    pixels: `${w} × ${h}`,
    mp: formatMegapixels(w, h),
    aspect: simplifyAspectRatio(w, h),
  }
})
const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`)

const copyAlt = async () => {
  const text = caption.value || overlay.lightbox.alt
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedNote.value = 'Alt text copied'
  } catch {
    copiedNote.value = 'Couldn’t copy'
  }
  window.setTimeout(() => {
    copiedNote.value = ''
  }, 1800)
}

const onImgLoad = (e: Event) => {
  loadState.value = 'loaded'
  const img = e.target as HTMLImageElement
  // Fill missing dimensions from the natural size when the API omitted meta
  const item = overlay.lightbox.items[overlay.lightbox.index]
  if (item && (!item.meta?.width || !item.meta?.height) && img.naturalWidth && img.naturalHeight) {
    item.meta = {
      ...(item.meta || {}),
      width: item.meta?.width || img.naturalWidth,
      height: item.meta?.height || img.naturalHeight,
      aspect: item.meta?.aspect || img.naturalWidth / img.naturalHeight,
    }
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="overlay.lightbox.open"
      ref="rootRef"
      class="neo-lightbox"
      :class="{ 'neo-lightbox--zoomed': isZoomed }"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      @click="onBackdropClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
      @wheel.prevent="onWheel"
      @dblclick="onDblClick"
    >
      <p v-if="galleryLiveLabel" class="neo-sr-only" aria-live="polite">
        {{ galleryLiveLabel }}
      </p>
      <button
        type="button"
        class="neo-btn neo-btn--ghost neo-lightbox__close"
        aria-label="Close"
        @click="overlay.closeLightbox()"
      >
        Close
      </button>
      <button
        v-if="hasGallery && !isZoomed"
        type="button"
        class="neo-btn neo-btn--ghost neo-lightbox__nav neo-lightbox__nav--prev"
        aria-label="Previous image"
        @click="overlay.lightboxStep(-1)"
      >
        ‹
      </button>
      <figure class="neo-lightbox__figure">
        <div ref="stageRef" class="neo-lightbox__stage" :style="imgStyle">
          <!-- Cached thumbnail + spinner until the full-size image arrives -->
          <div v-if="loadState === 'loading'" class="neo-lightbox__loading" role="status">
            <img
              v-if="preview"
              class="neo-lightbox__img neo-lightbox__img--preview"
              :src="preview"
              alt=""
              draggable="false"
            />
            <span class="neo-lightbox__spinner" aria-hidden="true" />
            <span class="neo-sr-only">Loading image</span>
          </div>
          <div v-if="loadState === 'error'" class="neo-lightbox__error" role="alert">
            <p>Couldn’t load this image.</p>
            <a
              :href="overlay.lightbox.src"
              target="_blank"
              rel="noopener noreferrer"
              class="neo-btn neo-btn--ghost"
            >
              Open original
            </a>
          </div>
          <img
            v-show="loadState === 'loaded'"
            :key="overlay.lightbox.src"
            class="neo-lightbox__img"
            :src="overlay.lightbox.src"
            :alt="overlay.lightbox.alt"
            draggable="false"
            @load="onImgLoad"
            @error="loadState = 'error'"
          />
          <span
            v-if="showHud && focusCss && loadState === 'loaded'"
            class="neo-lightbox__focus"
            :style="{ left: focusCss.left, top: focusCss.top }"
            aria-hidden="true"
          />
        </div>
        <!-- Alt text is for everyone, not just screen readers -->
        <figcaption v-if="caption && !showHud" class="neo-lightbox__alt">
          {{ caption }}
        </figcaption>
      </figure>
      <button
        v-if="hasGallery && !isZoomed"
        type="button"
        class="neo-btn neo-btn--ghost neo-lightbox__nav neo-lightbox__nav--next"
        aria-label="Next image"
        @click="overlay.lightboxStep(1)"
      >
        ›
      </button>

      <div class="neo-lightbox__tools" role="toolbar" aria-label="Image tools">
        <button
          type="button"
          class="neo-lightbox__tool"
          :aria-pressed="showHud"
          :title="showHud ? 'Hide details (I)' : 'Show details (I)'"
          @click="showHud = !showHud"
        >
          Info
        </button>
        <button type="button" class="neo-lightbox__tool" aria-label="Zoom out" @click="zoomBy(1 / 1.25)">
          −
        </button>
        <span class="neo-lightbox__zoom-label" aria-live="polite">{{ zoomLabel }}</span>
        <button type="button" class="neo-lightbox__tool" aria-label="Zoom in" @click="zoomBy(1.25)">
          +
        </button>
        <button
          type="button"
          class="neo-lightbox__tool"
          :disabled="!isZoomed"
          aria-label="Reset zoom"
          @click="resetTransform"
        >
          Reset
        </button>
      </div>

      <aside v-if="showHud" class="neo-lightbox__hud" aria-label="Image details">
        <p v-if="dimLabel" class="neo-lightbox__hud-row">
          <strong>Size</strong>
          <span>{{ dimLabel.pixels }} · {{ dimLabel.mp }} · {{ dimLabel.aspect }}</span>
        </p>
        <p class="neo-lightbox__hud-row">
          <strong>Zoom</strong>
          <span>{{ zoomLabel }}</span>
        </p>
        <p v-if="meta?.focus" class="neo-lightbox__hud-row">
          <strong>Focus</strong>
          <span>{{ meta.focus.x.toFixed(2) }}, {{ meta.focus.y.toFixed(2) }}</span>
        </p>
        <div v-if="palette.length" class="neo-lightbox__hud-row neo-lightbox__hud-row--swatches">
          <strong>Palette</strong>
          <span class="neo-lightbox__swatches" aria-hidden="true">
            <span
              v-for="(c, i) in palette"
              :key="i"
              class="neo-lightbox__swatch"
              :style="{ background: c }"
            />
          </span>
        </div>
        <p v-if="meta?.blurhash" class="neo-lightbox__hud-row neo-lightbox__hud-row--mono">
          <strong>Blurhash</strong>
          <code>{{ meta.blurhash }}</code>
        </p>
        <div class="neo-lightbox__hud-alt">
          <div class="neo-lightbox__hud-alt-head">
            <strong>Alt text</strong>
            <span class="neo-lightbox__hud-count">
              {{ (caption || overlay.lightbox.alt || '').length }} chars
            </span>
            <button
              v-if="caption || overlay.lightbox.alt"
              type="button"
              class="neo-lightbox__tool neo-lightbox__tool--sm"
              @click="copyAlt"
            >
              Copy
            </button>
          </div>
          <p class="neo-lightbox__hud-alt-body">
            {{ caption || overlay.lightbox.alt || 'No description provided.' }}
          </p>
          <p v-if="copiedNote" class="neo-lightbox__hud-note" role="status">{{ copiedNote }}</p>
        </div>
      </aside>

      <p v-if="positionLabel" class="neo-lightbox__counter" aria-live="polite">{{ positionLabel }}</p>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.neo-lightbox {
  position: fixed;
  inset: 0;
  z-index: var(--neo-z-dialog-top, 1065);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--neo-spacing-6, 1.25rem);
  background: rgba(0, 0, 0, 0.88);
  // Own pan / pinch; don't fight the browser's native page zoom
  touch-action: none;
  overflow: hidden;

  &--zoomed {
    cursor: grab;

    &:active {
      cursor: grabbing;
    }
  }
}

.neo-lightbox__figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  margin: 0;
  max-width: 100%;
  max-height: 100%;
  pointer-events: none;
}

.neo-lightbox__stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  transform-origin: center center;
  transition:
    transform var(--neo-dur-quick, 160ms) var(--neo-ease-out),
    opacity var(--neo-dur-quick, 160ms) var(--neo-ease-out);
  pointer-events: auto;
  will-change: transform;
}

.neo-lightbox__close {
  position: absolute;
  top: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-top));
  right: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-right));
  color: #fff;
  border-color: rgba(255, 255, 255, 0.35);
  z-index: 2;

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
  z-index: 2;

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
  animation: lightbox-media-in var(--neo-dur-normal, 240ms) var(--neo-ease-spring, var(--neo-ease-out)) both;

  .neo-lightbox__figure:has(.neo-lightbox__alt) & {
    max-height: 70dvh;
  }
}

.neo-lightbox__focus {
  position: absolute;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 50%;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.55),
    0 0 12px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  z-index: 1;

  &::before,
  &::after {
    content: '';
    position: absolute;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
  }

  &::before {
    left: 50%;
    top: -6px;
    bottom: -6px;
    width: 1px;
    transform: translateX(-50%);
  }

  &::after {
    top: 50%;
    left: -6px;
    right: -6px;
    height: 1px;
    transform: translateY(-50%);
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
  touch-action: pan-y;
  pointer-events: auto;
  animation: lightbox-caption-in var(--neo-dur-normal, 240ms) var(--neo-ease-out)
    var(--neo-delay-secondary, 50ms) both;
}

.neo-lightbox__tools {
  position: absolute;
  right: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-right));
  bottom: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-bottom));
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(8px);
}

.neo-lightbox__tool {
  min-width: 2.25rem;
  min-height: 2.25rem;
  padding: 0 0.55rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 650;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.14);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  &[aria-pressed='true'] {
    background: rgba(255, 255, 255, 0.22);
  }

  &--sm {
    min-width: auto;
    min-height: 1.75rem;
    font-size: 0.75rem;
  }
}

.neo-lightbox__zoom-label {
  min-width: 3rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.neo-lightbox__hud {
  position: absolute;
  left: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-left));
  bottom: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-bottom));
  z-index: 3;
  width: min(22rem, calc(100vw - 8rem));
  max-height: min(50dvh, 22rem);
  overflow-y: auto;
  padding: 0.75rem 0.85rem;
  border-radius: 12px;
  background: rgba(10, 10, 12, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  pointer-events: auto;
}

.neo-lightbox__hud-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.65rem;
  margin: 0 0 0.45rem;
  font-size: 0.8125rem;
  line-height: 1.35;

  strong {
    flex: 0 0 4.5rem;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
  }

  code {
    font-size: 0.7rem;
    word-break: break-all;
    color: rgba(255, 255, 255, 0.8);
  }

  &--swatches {
    align-items: center;
  }

  &--mono {
    align-items: flex-start;
  }
}

.neo-lightbox__swatches {
  display: inline-flex;
  gap: 0.3rem;
}

.neo-lightbox__swatch {
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.neo-lightbox__hud-alt {
  margin-top: 0.35rem;
  padding-top: 0.55rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

.neo-lightbox__hud-alt-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.35rem;

  strong {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
  }
}

.neo-lightbox__hud-count {
  margin-right: auto;
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
}

.neo-lightbox__hud-alt-body {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  white-space: pre-line;
  max-height: 8rem;
  overflow-y: auto;
}

.neo-lightbox__hud-note {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.65);
}

@keyframes lightbox-media-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes lightbox-caption-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.neo-lightbox__loading {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 8rem;
  min-height: 8rem;
}

.neo-lightbox__img--preview {
  filter: blur(2px);
  opacity: 0.7;
}

.neo-lightbox__spinner {
  position: absolute;
  width: 2rem;
  height: 2rem;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: neo-lightbox-spin 0.8s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation-duration: 2.4s;
  }
}

@keyframes neo-lightbox-spin {
  to {
    transform: rotate(360deg);
  }
}

.neo-lightbox__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  color: rgba(255, 255, 255, 0.88);
  text-align: center;

  p {
    margin: 0;
  }

  a {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.35);
  }
}

.neo-lightbox__counter {
  position: absolute;
  bottom: max(var(--neo-spacing-4, 1rem), env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.875rem;
  pointer-events: none;

  // Keep clear of the zoom tools on the right
  .neo-lightbox:has(.neo-lightbox__tools) & {
    bottom: max(3.5rem, calc(env(safe-area-inset-bottom) + 3rem));
  }
}
</style>
