<script setup lang="ts">
import type { mastodon } from 'masto'

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
</script>

<template>
  <a
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
}

.preview-card__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-card__body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  padding: 0.65rem 0.75rem;
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
</style>
