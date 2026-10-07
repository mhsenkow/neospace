<script setup lang="ts">
/**
 * Chat bubble for direct-message threads (Threads / IG style).
 */

import type { mastodon } from 'masto'
import { sanitizeStatusHtml } from '~/utils/sanitizeHtml'
import { useOverlayStore } from '~/stores/overlay'
import { useStatusStore } from '~/stores/status'
import { useToastStore } from '~/stores/toast'

const props = defineProps<{
  status: mastodon.v1.Status
  mine: boolean
  /** Show avatar + name above bubble (start of a run from this person) */
  showMeta?: boolean
  /** Optimistic send state for own bubbles */
  delivery?: 'pending' | 'failed' | 'sent'
  /** Group-DM participant handles — only strip leading mention links for these */
  participantAccts?: string[]
}>()

const emit = defineEmits<{
  retry: []
  deleted: [statusId: string]
}>()

const overlay = useOverlayStore()
const statusStore = useStatusStore()
const toast = useToastStore()
const revealed = ref(false)
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const cwButtonRef = ref<HTMLButtonElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)
let longPressTimer: ReturnType<typeof setTimeout> | null = null

const isPending = computed(() => props.delivery === 'pending')
const isFailed = computed(() => props.delivery === 'failed')

const participantSet = computed(() => {
  const set = new Set<string>()
  for (const acct of props.participantAccts || []) {
    set.add(acct.replace(/^@/, '').toLowerCase())
  }
  return set
})

/** Strip only participant mention links at the start — keep "@home tonight" etc. */
const bubbleHtml = computed(() => {
  let html = props.status.content || ''
  if (participantSet.value.size) {
    html = html.replace(
      /^(?:\s*<p>)?(?:\s*<a[^>]*class="[^"]*mention[^"]*"[^>]*>.*?<\/a>\s*)+/i,
      (m) => {
        const mentions = [...m.matchAll(/<a[^>]*class="[^"]*mention[^"]*"[^>]*>@?([^<]+)<\/a>/gi)]
        const allParticipants = mentions.every((match) => {
          const acct = (match[1] || '').replace(/^@/, '').toLowerCase()
          return participantSet.value.has(acct)
        })
        if (!allParticipants) return m
        const openP = m.match(/^(\s*<p>)/i)
        return openP ? openP[1]! : ''
      },
    )
  }
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

const createdDate = computed(() => new Date(props.status.createdAt))

const timeTitle = computed(() => {
  const date = createdDate.value
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
})

const timeLabel = computed(() => {
  const date = createdDate.value
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  })
})

const knownMedia = computed(() =>
  (props.status.mediaAttachments || []).filter((m) =>
    ['image', 'gifv', 'video', 'audio'].includes(m.type),
  ),
)

const unknownMedia = computed(() =>
  (props.status.mediaAttachments || []).filter(
    (m) => !['image', 'gifv', 'video', 'audio'].includes(m.type),
  ),
)

const speakerLabel = computed(() => {
  if (props.mine) return 'You said'
  const name = props.status.account.displayName || props.status.account.username
  return `${name} said`
})

const openLightbox = (item: mastodon.v1.MediaAttachment) => {
  const src = item.url || item.previewUrl
  if (!src) return
  overlay.openLightbox({
    src,
    alt: item.description?.trim() || 'Image with no description',
  })
}

const mediaButtonLabel = (item: mastodon.v1.MediaAttachment) => {
  const desc = item.description?.trim()
  return desc ? `Open image: ${desc}` : 'Open image: no description'
}

const toggleReveal = () => {
  revealed.value = !revealed.value
  if (revealed.value) {
    nextTick(() => contentRef.value?.focus())
  } else {
    nextTick(() => cwButtonRef.value?.focus())
  }
}

const copyText = async () => {
  const text = bubbleHtml.value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.show({ message: 'Message copied', duration: 2000 })
  } catch {
    /* ignore */
  }
  menuOpen.value = false
}

const deleteOwn = async () => {
  menuOpen.value = false
  try {
    await statusStore.deleteStatus(props.status.id)
    emit('deleted', props.status.id)
    toast.show({ message: 'Message deleted', duration: 2500 })
  } catch (e: any) {
    toast.show({ message: e?.message || 'Couldn’t delete message' })
  }
}

const openAsPost = () => {
  menuOpen.value = false
  navigateTo(`/status/${props.status.id}`)
}

const onPointerDown = () => {
  if (longPressTimer) clearTimeout(longPressTimer)
  longPressTimer = setTimeout(() => {
    menuOpen.value = true
  }, 550)
}

const onPointerUp = () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

onBeforeUnmount(() => {
  if (longPressTimer) clearTimeout(longPressTimer)
})
</script>

<template>
  <article
    class="msg-bubble"
    :class="{
      'msg-bubble--mine': mine,
      'msg-bubble--theirs': !mine,
      'msg-bubble--meta': showMeta,
      'msg-bubble--pending': isPending,
      'msg-bubble--failed': isFailed,
      'msg-bubble--menu': menuOpen,
    }"
    :aria-label="`${speakerLabel}, ${timeTitle}${isPending ? ', sending' : isFailed ? ', not delivered' : ''}`"
    :aria-busy="isPending || undefined"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <span class="sr-only">{{ speakerLabel }}</span>

    <div v-if="showMeta && !mine" class="msg-bubble__who">
      <img
        :src="status.account.avatar"
        alt=""
        class="msg-bubble__avatar"
      />
      <span class="msg-bubble__name">{{ status.account.displayName || status.account.username }}</span>
    </div>

    <div class="msg-bubble__row">
      <div ref="menuRef" class="msg-bubble__stack">
        <div
          v-if="menuOpen"
          class="msg-bubble__menu"
          role="menu"
          @click.stop
        >
          <button type="button" role="menuitem" @click="copyText">Copy text</button>
          <button v-if="mine" type="button" role="menuitem" @click="deleteOwn">Delete</button>
          <button type="button" role="menuitem" @click="openAsPost">Open as post</button>
        </div>

        <button
          v-if="showSpoilerGate"
          ref="cwButtonRef"
          type="button"
          class="msg-bubble__cw"
          :aria-expanded="revealed"
          @click="toggleReveal"
        >
          <NeoIcon name="eye-off" :size="14" :stroke="2" />
          <span>{{ status.spoilerText?.trim() || 'Sensitive content' }}</span>
          <span class="msg-bubble__cw-action">{{ revealed ? 'Hide' : 'Show' }}</span>
        </button>

        <div
          v-else
          ref="contentRef"
          class="msg-bubble__content"
          tabindex="-1"
        >
          <div
            v-if="hasText"
            class="msg-bubble__body"
            v-html="bubbleHtml"
          />

          <div v-if="knownMedia.length || unknownMedia.length" class="msg-bubble__media">
            <template v-for="item in knownMedia" :key="item.id">
              <button
                v-if="item.type === 'image' || item.type === 'gifv'"
                type="button"
                class="msg-bubble__media-btn"
                :aria-label="mediaButtonLabel(item)"
                @click="openLightbox(item)"
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
                :poster="item.previewUrl || undefined"
                class="msg-bubble__img"
                controls
                playsinline
                preload="none"
                :aria-label="item.description?.trim() || 'Video attachment'"
              />
              <audio
                v-else-if="item.type === 'audio'"
                :src="item.url"
                class="msg-bubble__audio"
                controls
                preload="metadata"
                :aria-label="item.description?.trim() || 'Audio attachment'"
              />
            </template>
            <p v-for="item in unknownMedia" :key="item.id" class="msg-bubble__unknown">
              Attachment unavailable —
              <a
                v-if="item.url || status.url"
                :href="item.url || status.url || undefined"
                target="_blank"
                rel="noopener noreferrer"
              >open original</a>
              <span v-else>open original</span>
            </p>
          </div>
        </div>

        <time
          v-if="!isPending && !isFailed"
          class="msg-bubble__time"
          :datetime="status.createdAt"
          :title="timeTitle"
        >{{ timeLabel }}</time>
        <p v-else-if="isPending" class="msg-bubble__delivery" role="status">Sending…</p>
        <button
          v-else
          type="button"
          class="msg-bubble__delivery msg-bubble__delivery--failed"
          @click="emit('retry')"
        >
          Not delivered · Retry
        </button>
      </div>

      <button
        type="button"
        class="msg-bubble__actions-trigger"
        aria-label="Message actions"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click.stop="menuOpen = !menuOpen"
      >
        <NeoIcon name="more" :size="16" :stroke="2" />
      </button>
    </div>
  </article>
</template>

<style lang="scss" scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

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

  &__who {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.15rem;
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
    color: var(--neo-text-secondary);
  }

  &__row {
    display: flex;
    align-items: flex-end;
    gap: 0.25rem;
    max-width: min(85%, 28rem);
  }

  &__stack {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    position: relative;
  }

  &__menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.25rem);
    z-index: 2;
    display: flex;
    flex-direction: column;
    min-width: 9rem;
    padding: 0.25rem;
    border-radius: var(--neo-radius-md, 10px);
    border: 1px solid var(--neo-border-color);
    background: var(--neo-bg-primary);
    box-shadow: var(--neo-shadow-md);

    button {
      padding: 0.45rem 0.65rem;
      border: none;
      border-radius: var(--neo-radius-sm, 6px);
      background: transparent;
      text-align: left;
      font: inherit;
      font-size: 0.8125rem;
      color: var(--neo-text-primary);
      cursor: pointer;

      &:hover {
        background: var(--neo-bg-tertiary);
      }
    }
  }

  &__actions-trigger {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--neo-text-tertiary);
    cursor: pointer;
    opacity: 0;

    .msg-bubble:focus-within &,
    .msg-bubble--menu &,
    &:focus-visible {
      opacity: 1;
    }
  }

  &__cw {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--neo-border-color);
    border-radius: var(--neo-radius-lg, 1rem);
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-secondary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    text-align: left;
  }

  &__cw-action {
    margin-left: 0.25rem;
    font-weight: 600;
    color: var(--neo-accent);
  }

  &__body {
    padding: 0.55rem 0.8rem;
    border-radius: var(--neo-radius-lg, 1.1rem);
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
    font-size: 0.9375rem;
    line-height: 1.4;
    overflow-wrap: anywhere;

    :deep(p) {
      margin: 0;
    }

    :deep(a) {
      color: var(--neo-accent);
    }
  }

  &--mine &__body {
    background: var(--neo-accent);
    color: var(--neo-text-on-accent, var(--neo-text-inverse));
  }

  &__media {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  &__media-btn {
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: var(--neo-radius-md, 0.85rem);
    overflow: hidden;
  }

  &__img {
    display: block;
    max-width: 100%;
    max-height: 16rem;
    border-radius: var(--neo-radius-md, 0.85rem);
    object-fit: cover;
  }

  &__audio {
    width: min(100%, 16rem);
  }

  &__unknown {
    margin: 0;
    padding: 0.45rem 0.65rem;
    border-radius: var(--neo-radius-md, 0.85rem);
    background: var(--neo-bg-tertiary);
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);

    a {
      color: var(--neo-accent);
    }
  }

  &__time {
    font-size: 0.75rem;
    color: var(--neo-text-tertiary);
    padding: 0 0.35rem;
  }

  &--mine &__time {
    text-align: right;
  }

  &--pending &__body {
    opacity: 0.72;
  }

  &__delivery {
    margin: 0;
    padding: 0 0.35rem;
    border: none;
    background: none;
    font: inherit;
    font-size: 0.75rem;
    color: var(--neo-text-tertiary);
    text-align: right;

    &--failed {
      color: var(--neo-danger, #c44);
      cursor: pointer;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  }
}
</style>
