<script setup lang="ts">
/**
 * Media attachments on a post card.
 * `plain` (inside an opened content warning) lists every attachment as-is; otherwise
 * attachments sit in a grid / swipe carousel behind the sensitive-media gate.
 */
import type { mastodon } from 'masto'
import { gifvAutoplay } from '~/utils/gifvAutoplay'

withDefaults(
  defineProps<{
    items: mastodon.v1.MediaAttachment[]
    /** Inside an opened CW: no gate, grid or carousel */
    plain?: boolean
    /** Sensitive-media gate is closed */
    hidden?: boolean
    /** Two or more attachments → horizontal swipe track */
    carousel?: boolean
    /** Server "autoplay GIFs" reading preference */
    autoplayGifs?: boolean
  }>(),
  { plain: false, hidden: false, carousel: false, autoplayGifs: false },
)

const emit = defineEmits<{
  open: [media: mastodon.v1.MediaAttachment]
  reveal: []
}>()

const vGifvAutoplay = gifvAutoplay

type MediaSize = { width?: number | null; height?: number | null }
/** Reserve the box before the image loads: original → small → 16:9 default. */
const mediaAspectRatio = (media: mastodon.v1.MediaAttachment) => {
  const meta = media.meta as { original?: MediaSize; small?: MediaSize } | null | undefined
  for (const size of [meta?.original, meta?.small]) {
    const w = size?.width
    const h = size?.height
    if (w && h && w > 0 && h > 0) return `${w} / ${h}`
  }
  return '16 / 9'
}
</script>

<template>
  <div class="status-media" :class="{ 'status-media--carousel': !plain && carousel && !hidden }">
    <template v-if="plain">
      <template v-for="(media, mediaIdx) in items" :key="media.id">
        <button
          v-if="media.type === 'image'"
          type="button"
          class="status-media-hit"
          :aria-label="media.description || (items.length > 1 ? `View image ${mediaIdx + 1} of ${items.length}` : 'View image')"
          @click.stop="emit('open', media)"
        >
          <img
            :src="media.previewUrl ?? media.url ?? undefined"
            :alt="media.description || ''"
            class="status-media-image"
            :style="{ aspectRatio: mediaAspectRatio(media) }"
            loading="lazy"
            decoding="async"
          />
          <span
            v-if="media.description?.trim()"
            class="status-media-alt-badge"
            title="Has alt text"
          >ALT</span>
          <span
            v-else
            class="status-media-alt-badge status-media-alt-badge--missing"
            title="No description"
          >No description</span>
        </button>
        <video
          v-else-if="media.type === 'video' || media.type === 'gifv'"
          :src="media.url ?? undefined"
          :poster="media.previewUrl ?? undefined"
          controls
          preload="none"
          v-gifv-autoplay="media.type === 'gifv' && autoplayGifs"
          :loop="media.type === 'gifv'"
          :muted="media.type === 'gifv'"
          playsinline
          :aria-label="media.description?.trim() || (media.type === 'gifv' ? 'Animated image' : 'Video attachment')"
          class="status-media-video"
        />
        <audio
          v-else-if="media.type === 'audio'"
          :src="media.url ?? undefined"
          controls
          :aria-label="media.description?.trim() || 'Audio attachment'"
          class="status-media-audio"
        />
      </template>
    </template>
    <template v-else>
      <button
        v-if="hidden"
        type="button"
        class="status-media-cw"
        @click.stop="emit('reveal')"
      >
        <span>Sensitive media</span>
        <span class="status-media-cw__hint">Tap to reveal</span>
      </button>
      <template v-else>
        <div :class="carousel ? 'status-media__track' : 'status-media__grid'">
          <template v-for="(media, mediaIdx) in items" :key="media.id">
            <button
              v-if="media.type === 'image'"
              type="button"
              class="status-media-hit"
              :aria-label="media.description || (items.length > 1 ? `View image ${mediaIdx + 1} of ${items.length}` : 'View image')"
              @click.stop="emit('open', media)"
            >
              <img
                :src="media.previewUrl ?? media.url ?? undefined"
                :alt="media.description || ''"
                class="status-media-image"
                :style="carousel ? undefined : { aspectRatio: mediaAspectRatio(media) }"
                loading="lazy"
                decoding="async"
              />
              <span
                v-if="media.description?.trim()"
                class="status-media-alt-badge"
                title="Has alt text"
              >ALT</span>
              <span
                v-else
                class="status-media-alt-badge status-media-alt-badge--missing"
                title="No description"
              >No description</span>
              <span
                v-if="carousel"
                class="status-media__index"
                aria-hidden="true"
              >{{ mediaIdx + 1 }}/{{ items.length }}</span>
            </button>
            <video
              v-else-if="media.type === 'video' || media.type === 'gifv'"
              :src="media.url ?? undefined"
              :poster="media.previewUrl ?? undefined"
              controls
              preload="none"
              v-gifv-autoplay="media.type === 'gifv' && autoplayGifs"
              :loop="media.type === 'gifv'"
              :muted="media.type === 'gifv'"
              playsinline
              :aria-label="media.description?.trim() || (media.type === 'gifv' ? 'Animated image' : 'Video attachment')"
              class="status-media-video"
            />
            <audio
              v-else-if="media.type === 'audio'"
              :src="media.url ?? undefined"
              controls
              :aria-label="media.description?.trim() || 'Audio attachment'"
              class="status-media-audio"
            />
          </template>
        </div>
      </template>
    </template>
  </div>
</template>

<style lang="scss" scoped>
// Media
.status-media {
  position: relative;
  margin-top: 0.5rem;
  border-radius: 12px;
  overflow: hidden;
  max-width: 100%;

  &__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.375rem;

    &:has(> *:nth-child(2)) {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  &--carousel {
    overflow: visible;
  }

  &__track {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scroll-padding-inline: 0;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 0.15rem;
    scrollbar-width: thin;

    .status-media-hit,
    .status-media-video,
    .status-media-audio {
      flex: 0 0 85%;
      max-width: 85%;
      scroll-snap-align: start;
      border-radius: 12px;
      overflow: hidden;
      background: var(--neo-bg-tertiary);
    }

    .status-media-image,
    .status-media-video {
      width: 100%;
      height: min(52vw, 22rem);
      object-fit: cover;
      aspect-ratio: auto;
    }
  }

  &__index {
    position: absolute;
    top: 0.45rem;
    right: 0.45rem;
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, #000 55%, transparent);
    color: #fff;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
}

.status-media-hit {
  position: relative;
}

.status-media-cw {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 140px;
  padding: 1rem;
  border: 1px dashed var(--neo-border-color);
  border-radius: 12px;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-secondary);
  font: inherit;
  cursor: pointer;
  text-align: center;

  &__hint {
    font-size: 0.8em;
    color: var(--neo-text-muted);
  }
}

.status-media-hit {
  display: block;
  padding: 0;
  margin: 0;
  border: none;
  background: none;
  cursor: zoom-in;
  overflow: hidden;
  max-width: 100%;
}

.status-media-hit {
  position: relative;
}

.status-media-alt-badge {
  position: absolute;
  left: 0.5rem;
  bottom: 0.5rem;
  padding: 0.125rem 0.375rem;
  border-radius: var(--neo-radius-xs, 2px);
  background: color-mix(in srgb, var(--neo-bg-primary) 82%, transparent);
  color: var(--neo-text-secondary);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  pointer-events: none;

  &--missing {
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: var(--neo-text-muted);
  }
}

.status-media-image {
  width: 100%;
  max-width: 100%;
  height: auto;
  max-height: min(68dvh, 520px);
  object-fit: cover;
  border-radius: var(--neo-radius-md, 8px);
  display: block;
  cursor: pointer;
  transition: opacity var(--neo-transition-fast, 0.15s ease);
  background: var(--neo-bg-tertiary);

  @media (max-height: 500px) and (orientation: landscape) {
    max-height: calc(100dvh - 4.5rem);
  }

  &:hover { opacity: 0.95; }
}

.status-media-video,
.status-media-audio {
  width: 100%;
  max-width: 100%;
  border-radius: var(--neo-radius-md, 8px);
  display: block;
}

.status-media-video {
  max-height: min(68dvh, 560px);
  object-fit: contain;
  background: #000;

  @media (max-height: 500px) and (orientation: landscape) {
    max-height: calc(100dvh - 4.5rem);
  }
}

@media (min-width: 1024px) {
  .status-media-image {
    max-height: 400px;
  }
}

:global(.status-card--reduce-motion) .status-media-image {
  transition: none !important;
  animation: none !important;
}
</style>
