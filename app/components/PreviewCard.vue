<script setup lang="ts">
import type { mastodon } from 'masto'
import { resolvePeerTubeEmbed } from '~/utils/peertube'

const props = defineProps<{
  card: mastodon.v1.PreviewCard
}>()

const hostname = computed(() => {
  try {
    return new URL(props.card.url).hostname.replace(/^www\./, '')
  } catch {
    return props.card.providerName || ''
  }
})

const hasImage = computed(() => !!props.card.image)

const embedSrc = computed(() => resolvePeerTubeEmbed(props.card))

const playing = ref(false)

watch(
  () => props.card.url,
  () => {
    playing.value = false
  },
)

const startPlayback = () => {
  if (!embedSrc.value) return
  playing.value = true
}
</script>

<template>
  <div v-if="embedSrc" class="preview-card preview-card--video">
    <div v-if="!playing" class="preview-card__poster">
      <button
        type="button"
        class="preview-card__play-hit"
        :aria-label="card.title ? `Play ${card.title}` : 'Play video'"
        @click="startPlayback"
      >
        <span v-if="hasImage" class="preview-card__media preview-card__media--poster">
          <img
            :src="card.image!"
            alt=""
            class="preview-card__image"
            loading="lazy"
            decoding="async"
          />
        </span>
        <span v-else class="preview-card__media preview-card__media--empty" aria-hidden="true" />
        <span class="preview-card__play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M8 5.5v13l11-6.5-11-6.5z" />
          </svg>
        </span>
      </button>
      <a
        class="preview-card__body preview-card__body--link"
        :href="card.url"
        target="_blank"
        rel="noopener noreferrer nofollow"
        :aria-label="card.title ? `${card.title} — ${hostname}` : hostname || card.url"
      >
        <p v-if="hostname" class="preview-card__host">{{ hostname }}</p>
        <p v-if="card.title" class="preview-card__title">{{ card.title }}</p>
        <p v-if="card.description" class="preview-card__desc">{{ card.description }}</p>
      </a>
    </div>
    <div v-else class="preview-card__embed-wrap">
      <iframe
        class="preview-card__embed"
        :src="embedSrc"
        :title="card.title || 'PeerTube video'"
        allow="fullscreen; picture-in-picture"
        allowfullscreen
        loading="lazy"
        referrerpolicy="strict-origin-when-cross-origin"
      />
      <a
        class="preview-card__open"
        :href="card.url"
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        Open on {{ hostname || 'PeerTube' }}
      </a>
    </div>
  </div>

  <a
    v-else
    class="preview-card"
    :href="card.url"
    target="_blank"
    rel="noopener noreferrer nofollow"
    :aria-label="card.title ? `${card.title} — ${hostname}` : hostname || card.url"
  >
    <div class="preview-card__inner">
      <div v-if="hasImage" class="preview-card__media">
        <img
          :src="card.image!"
          alt=""
          class="preview-card__image"
          loading="lazy"
          decoding="async"
        />
      </div>
      <div class="preview-card__body">
        <p v-if="hostname" class="preview-card__host">{{ hostname }}</p>
        <p v-if="card.title" class="preview-card__title">{{ card.title }}</p>
        <p v-if="card.description" class="preview-card__desc">{{ card.description }}</p>
      </div>
    </div>
  </a>
</template>

<style lang="scss" scoped>
.preview-card {
  display: block;
  // Lay out by the card's own width — board columns are ~250px even on wide screens
  container-type: inline-size;
  margin-top: 0.5rem;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md);
  background: var(--neo-bg-secondary);
  color: inherit;
  text-decoration: none;
  transition: background-color 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: var(--neo-bg-hover, var(--neo-bg-tertiary));
    border-color: color-mix(in srgb, var(--neo-border-color) 70%, var(--neo-accent));
  }

  &--video {
    text-decoration: none;

    &:hover {
      background: var(--neo-bg-secondary);
      border-color: var(--neo-border-color);
    }
  }
}

.preview-card__inner {
  display: flex;
  flex-direction: column;

  // Side-by-side only when the text column keeps ~240px
  @container (min-width: 360px) {
    flex-direction: row;
    align-items: stretch;
  }
}

.preview-card__poster {
  display: flex;
  flex-direction: column;
}

.preview-card__play-hit {
  position: relative;
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: var(--neo-bg-tertiary);
  cursor: pointer;
  color: inherit;

  &:focus-visible {
    outline: 2px solid var(--neo-accent);
    outline-offset: -2px;
  }
}

.preview-card__media {
  flex-shrink: 0;
  width: 100%;
  // Reserve the box before the lazy image loads (link-card OG ratio) — no shift
  aspect-ratio: 1.91 / 1;
  max-height: 160px;
  overflow: hidden;
  background: var(--neo-bg-tertiary);

  @container (min-width: 360px) {
    width: 7.5rem;
    aspect-ratio: auto;
    max-height: none;
    min-height: 5.5rem;
  }

  &--poster {
    aspect-ratio: 16 / 9;
    max-height: none;

    @container (min-width: 360px) {
      width: 100%;
      min-height: 0;
    }
  }

  &--empty {
    aspect-ratio: 16 / 9;
    max-height: none;
    min-height: 7rem;
    background: color-mix(in srgb, var(--neo-bg-tertiary) 80%, var(--neo-accent) 20%);
  }
}

.preview-card__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-card__play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;

  svg {
    width: 3rem;
    height: 3rem;
    padding: 0.55rem 0.55rem 0.55rem 0.7rem;
    border-radius: 999px;
    background: color-mix(in srgb, #000 55%, transparent);
    color: #fff;
    box-shadow: 0 2px 10px color-mix(in srgb, #000 35%, transparent);
  }
}

.preview-card__body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  padding: 0.65rem 0.75rem;

  &--link {
    color: inherit;
    text-decoration: none;

    &:hover .preview-card__title {
      color: var(--neo-accent);
    }
  }
}

.preview-card__host {
  margin: 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-card__title,
.preview-card__desc {
  overflow-wrap: anywhere;
}

.preview-card__title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.preview-card__desc {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.preview-card__embed-wrap {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: #000;
}

.preview-card__embed {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  background: #000;
}

.preview-card__open {
  padding: 0.45rem 0.75rem;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  background: var(--neo-bg-secondary);
  text-decoration: none;

  &:hover {
    color: var(--neo-accent);
  }
}
</style>
