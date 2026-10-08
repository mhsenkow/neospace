<script setup lang="ts">
/**
 * Lean post peek for Edward Mode — not a full thread view.
 */

import type { ExtendedStatus } from '~/stores/instances'
import { sanitizeStatusHtml, stripHtml } from '~/utils/sanitizeHtml'

const props = defineProps<{
  status: ExtendedStatus
}>()

const emit = defineEmits<{
  close: []
  openThread: []
}>()

const panelEl = ref<HTMLElement | null>(null)

const body = computed(() => props.status.reblog || props.status)
const isBoost = computed(() => !!props.status.reblog)
const displayName = computed(
  () =>
    body.value.account?.displayName ||
    body.value.account?.username ||
    body.value.account?.acct ||
    'someone',
)
const acct = computed(() => body.value.account?.acct || '')
const avatar = computed(() => body.value.account?.avatar || body.value.account?.avatarStatic || '')
const safeHtml = computed(() => sanitizeStatusHtml(body.value.content || ''))
const spoiler = computed(() => (body.value.spoilerText || '').trim())
const media = computed(() => body.value.mediaAttachments || [])
const favourites = computed(() => body.value.favouritesCount ?? 0)
const reblogs = computed(() => body.value.reblogsCount ?? 0)
const replies = computed(() => body.value.repliesCount ?? 0)
const plainPreview = computed(() => stripHtml(body.value.content || '').slice(0, 280))

const onBackdrop = (e: MouseEvent) => {
  if (e.target === e.currentTarget) emit('close')
}

onMounted(() => {
  nextTick(() => panelEl.value?.focus())
})
</script>

<template>
  <div
    class="edward-modal"
    role="presentation"
    @click="onBackdrop"
  >
    <div
      ref="panelEl"
      class="edward-modal__panel"
      role="dialog"
      aria-modal="true"
      aria-label="Thought"
      tabindex="-1"
      @click.stop
    >
      <header class="edward-modal__head">
        <div class="edward-modal__who">
          <img
            v-if="avatar"
            class="edward-modal__avatar"
            :src="avatar"
            alt=""
            width="40"
            height="40"
            loading="lazy"
          >
          <div class="edward-modal__meta">
            <span class="edward-modal__name">{{ displayName }}</span>
            <span v-if="acct" class="edward-modal__acct">@{{ acct }}</span>
            <span v-if="isBoost" class="edward-modal__boost">boosted</span>
          </div>
        </div>
        <button
          type="button"
          class="edward-modal__x"
          aria-label="Close"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <p v-if="spoiler" class="edward-modal__cw">{{ spoiler }}</p>

      <div
        v-if="safeHtml"
        class="edward-modal__content"
        v-html="safeHtml"
      />
      <p v-else class="edward-modal__content edward-modal__content--plain">
        {{ plainPreview }}
      </p>

      <div v-if="media.length" class="edward-modal__media">
        <img
          v-for="(m, i) in media.slice(0, 4)"
          :key="m.id || i"
          :src="(m.previewUrl || m.url) ?? undefined"
          :alt="m.description || ''"
          loading="lazy"
        >
      </div>

      <footer class="edward-modal__foot">
        <div class="edward-modal__stats" aria-label="Engagement">
          <span>{{ favourites }} fav</span>
          <span>{{ reblogs }} boost</span>
          <span>{{ replies }} reply</span>
        </div>
        <div class="edward-modal__actions">
          <button type="button" class="edward-modal__btn" @click="emit('close')">
            stay
          </button>
          <button type="button" class="edward-modal__btn edward-modal__btn--primary" @click="emit('openThread')">
            open thread
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.edward-modal {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  background: color-mix(in srgb, #020308 55%, transparent);
  backdrop-filter: blur(6px);
}

.edward-modal__panel {
  width: min(440px, 100%);
  max-height: min(78vh, 640px);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 1rem 1.1rem 1.1rem;
  background: color-mix(in srgb, #0c1420 94%, #5ad0e0 6%);
  border: 1px solid color-mix(in srgb, #6a90b0 45%, transparent);
  border-radius: 2px;
  box-shadow: 0 16px 48px color-mix(in srgb, #000 55%, transparent);
  color: #e2ebf4;
  outline: none;

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 2px;
  }
}

.edward-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.edward-modal__who {
  display: flex;
  gap: 0.65rem;
  min-width: 0;
}

.edward-modal__avatar {
  width: 40px;
  height: 40px;
  border-radius: 2px;
  object-fit: cover;
  flex-shrink: 0;
  background: #1a2433;
}

.edward-modal__meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.edward-modal__name {
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.edward-modal__acct {
  font-size: 0.75rem;
  color: color-mix(in srgb, #e2ebf4 55%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.edward-modal__boost {
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9e7aea;
}

.edward-modal__x {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: color-mix(in srgb, #e2ebf4 70%, transparent);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: #fff;
    background: color-mix(in srgb, #fff 8%, transparent);
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }
}

.edward-modal__cw {
  margin: 0 0 0.65rem;
  padding: 0.4rem 0.55rem;
  font-size: 0.75rem;
  background: color-mix(in srgb, #f2ad52 12%, transparent);
  border: 1px solid color-mix(in srgb, #f2ad52 35%, transparent);
  border-radius: 2px;
  color: #f2ad52;
}

.edward-modal__content {
  margin: 0 0 0.85rem;
  font-size: 0.875rem;
  line-height: 1.45;
  word-break: break-word;

  :deep(a) {
    color: #59d1e0;
  }

  :deep(p) {
    margin: 0 0 0.5em;

    &:last-child {
      margin-bottom: 0;
    }
  }

  &--plain {
    color: color-mix(in srgb, #e2ebf4 85%, transparent);
  }
}

.edward-modal__media {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin-bottom: 0.85rem;

  img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 2px;
    background: #1a2433;
  }
}

.edward-modal__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px solid color-mix(in srgb, #6a90b0 30%, transparent);
}

.edward-modal__stats {
  display: flex;
  gap: 0.75rem;
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, #e2ebf4 55%, transparent);
}

.edward-modal__actions {
  display: flex;
  gap: 0.4rem;
}

.edward-modal__btn {
  padding: 0.4rem 0.75rem;
  border: 1px solid color-mix(in srgb, #6a90b0 45%, transparent);
  border-radius: 2px;
  background: transparent;
  color: #e2ebf4;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    border-color: #59d1e0;
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }

  &--primary {
    background: color-mix(in srgb, #59d1e0 18%, transparent);
    border-color: color-mix(in srgb, #59d1e0 55%, transparent);
  }
}
</style>
