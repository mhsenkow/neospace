<script setup lang="ts">
/**
 * Chat bubble for direct-message threads (Threads / IG style).
 */

import type { mastodon } from 'masto'
import { sanitizeStatusHtml } from '~/utils/sanitizeHtml'

const props = defineProps<{
  status: mastodon.v1.Status
  mine: boolean
  /** Show avatar + name above bubble (start of a run from this person) */
  showMeta?: boolean
  /** Optional day chip above this bubble */
  dayLabel?: string | null
}>()

const revealed = ref(false)

/** Drop leading @handles so bubbles read like chat, not posts */
const bubbleHtml = computed(() => {
  let html = props.status.content || ''
  html = html.replace(
    /^(?:\s*<p>)?(?:\s*<a[^>]*class="[^"]*mention[^"]*"[^>]*>.*?<\/a>\s*)+/i,
    (m) => {
      const openP = m.match(/^(\s*<p>)/i)
      return openP ? openP[1]! : ''
    },
  )
  html = html.replace(/^(?:\s*<p>)?\s*(?:@[a-z0-9_]+(?:@[a-z0-9.-]+)?\s*)+/i, (m) => {
    const openP = m.match(/^(\s*<p>)/i)
    return openP ? openP[1]! : ''
  })
  return sanitizeStatusHtml(html)
})

const hasText = computed(() =>
  bubbleHtml.value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().length > 0,
)

const isSensitive = computed(
  () =>
    !!props.status.sensitive ||
    !!(props.status.spoilerText && props.status.spoilerText.trim()),
)

const showSpoilerGate = computed(() => isSensitive.value && !revealed.value)

const timeLabel = computed(() => {
  const date = new Date(props.status.createdAt)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
})

const media = computed(() =>
  (props.status.mediaAttachments || []).filter((m) =>
    ['image', 'gifv', 'video', 'audio'].includes(m.type),
  ),
)

const lightboxUrl = ref<string | null>(null)

const openLightbox = (url?: string | null) => {
  if (url) lightboxUrl.value = url
}

const closeLightbox = () => {
  lightboxUrl.value = null
}
</script>

<template>
  <article
    class="msg-bubble"
    :class="{
      'msg-bubble--mine': mine,
      'msg-bubble--theirs': !mine,
      'msg-bubble--meta': showMeta,
    }"
  >
    <div v-if="dayLabel" class="msg-bubble__day">
      <span>{{ dayLabel }}</span>
    </div>

    <div v-if="showMeta && !mine" class="msg-bubble__who">
      <img
        :src="status.account.avatar"
        alt=""
        class="msg-bubble__avatar"
      />
      <span class="msg-bubble__name">{{ status.account.displayName || status.account.username }}</span>
    </div>

    <div class="msg-bubble__row">
      <div class="msg-bubble__stack">
        <button
          v-if="showSpoilerGate"
          type="button"
          class="msg-bubble__cw"
          @click="revealed = true"
        >
          <NeoIcon name="eye-off" :size="14" :stroke="2" />
          <span>{{ status.spoilerText?.trim() || 'Sensitive content' }}</span>
          <span class="msg-bubble__cw-action">Show</span>
        </button>

        <template v-else>
          <div
            v-if="hasText"
            class="msg-bubble__body"
            v-html="bubbleHtml"
          />

          <div v-if="media.length" class="msg-bubble__media">
            <template v-for="item in media" :key="item.id">
              <button
                v-if="item.type === 'image' || item.type === 'gifv'"
                type="button"
                class="msg-bubble__media-btn"
                @click="openLightbox(item.url || item.previewUrl)"
              >
                <img
                  :src="item.previewUrl || item.url"
                  :alt="item.description || ''"
                  class="msg-bubble__img"
                  loading="lazy"
                />
              </button>
              <video
                v-else-if="item.type === 'video'"
                :src="item.url"
                class="msg-bubble__img"
                controls
                playsinline
              />
              <audio
                v-else-if="item.type === 'audio'"
                :src="item.url"
                class="msg-bubble__audio"
                controls
                preload="metadata"
              />
            </template>
          </div>
        </template>

        <time class="msg-bubble__time" :datetime="status.createdAt">{{ timeLabel }}</time>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="lightboxUrl"
        class="msg-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label="Media"
        @click="closeLightbox"
        @keydown.escape="closeLightbox"
      >
        <img :src="lightboxUrl" alt="" class="msg-lightbox__img" />
      </div>
    </Teleport>
  </article>
</template>

<style lang="scss" scoped>
.msg-bubble {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-width: 100%;
  padding: 0.1rem 0.75rem;

  &--mine {
    align-items: flex-end;
  }

  &--theirs {
    align-items: flex-start;
  }

  &--meta {
    margin-top: 0.65rem;
  }

  &__day {
    align-self: center;
    margin: 0.85rem 0 0.45rem;
    padding: 0.2rem 0.65rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--neo-text-primary) 6%, transparent);
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    letter-spacing: 0.02em;
  }

  &__who {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.15rem 0.15rem;
  }

  &__avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    object-fit: cover;
  }

  &__name {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-muted);
  }

  &__row {
    display: flex;
    max-width: min(85%, 22rem);
  }

  &__stack {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }

  &__cw {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.65rem 0.85rem;
    border-radius: 18px;
    border: 1px dashed var(--neo-border-color);
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-secondary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    text-align: left;

    .msg-bubble--mine & {
      border-color: color-mix(in srgb, var(--neo-accent) 40%, transparent);
      background: color-mix(in srgb, var(--neo-accent) 18%, transparent);
    }
  }

  &__cw-action {
    margin-left: 0.25rem;
    font-weight: 700;
    color: var(--neo-accent);
  }

  &__body {
    padding: 0.65rem 0.85rem;
    border-radius: 18px;
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--neo-text-primary);
    word-break: break-word;

    :deep(p) {
      margin: 0;

      & + p {
        margin-top: 0.4rem;
      }
    }

    :deep(a) {
      color: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .msg-bubble--mine & {
      background: var(--neo-accent);
      color: var(--neo-text-inverse, #fff);
      border-bottom-right-radius: 6px;
    }

    .msg-bubble--theirs & {
      background: var(--neo-bg-tertiary);
      border: 1px solid var(--neo-border-color);
      border-bottom-left-radius: 6px;
    }
  }

  &__media {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    border-radius: 16px;
    overflow: hidden;
    max-width: 100%;
  }

  &__media-btn {
    display: block;
    padding: 0;
    border: none;
    background: transparent;
    cursor: zoom-in;
  }

  &__img {
    display: block;
    width: 100%;
    max-height: 280px;
    object-fit: cover;
    border-radius: 14px;
    background: var(--neo-bg-tertiary);
  }

  &__audio {
    width: 100%;
    min-width: 12rem;
  }

  &__time {
    font-size: 0.6875rem;
    color: var(--neo-text-quaternary);
    padding: 0 0.35rem;

    .msg-bubble--mine & {
      text-align: right;
    }
  }
}

.msg-lightbox {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: color-mix(in srgb, #000 72%, transparent);
  cursor: zoom-out;

  &__img {
    max-width: min(96vw, 56rem);
    max-height: 90dvh;
    object-fit: contain;
    border-radius: 8px;
  }
}
</style>
