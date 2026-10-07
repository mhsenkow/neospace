<script setup lang="ts">
import type { mastodon } from 'masto'

const props = defineProps<{
  account: mastodon.v1.Account
  safeDisplayName: string
  accountHandle: string
  cardLabelId: string
  createdAt: string
  threadTo?: { path: string; query?: Record<string, string> } | null
  /** When false, link out to account.url instead of in-app profile */
  inAppProfile?: boolean
}>()

const emit = defineEmits<{
  profileClick: [acct: string, event: MouseEvent]
}>()

const { formatRelativeTime, formatAbsoluteTime } = useRelativeTime()
</script>

<template>
  <header class="status-header">
    <button
      v-if="inAppProfile !== false"
      type="button"
      :id="cardLabelId"
      class="status-author"
      @click.stop="emit('profileClick', account.acct, $event)"
    >
      <span class="status-display-name" v-html="safeDisplayName" />
      <span class="status-handle">{{ accountHandle }}</span>
    </button>
    <a
      v-else
      :id="cardLabelId"
      :href="account.url"
      target="_blank"
      rel="noopener noreferrer"
      class="status-author"
    >
      <span class="status-display-name" v-html="safeDisplayName" />
      <span class="status-handle">{{ accountHandle }}</span>
    </a>
    <NuxtLink
      v-if="threadTo"
      :to="threadTo"
      class="status-time"
      @click.stop
    >
      <time
        :datetime="createdAt"
        :title="formatAbsoluteTime(createdAt)"
      >{{ formatRelativeTime(createdAt) }}</time>
    </NuxtLink>
    <time
      v-else
      class="status-time"
      :datetime="createdAt"
      :title="formatAbsoluteTime(createdAt)"
    >{{ formatRelativeTime(createdAt) }}</time>
    <slot />
  </header>
</template>

<style lang="scss" scoped>
.status-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  max-width: 100%;
  overflow: visible;
}

.status-author {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  text-decoration: none;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  min-height: 32px;
  padding: 0.15rem 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;

  &:hover .status-display-name {
    text-decoration: underline;
  }
}

.status-display-name {
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;

  :deep(img.emoji) {
    height: 1em;
    width: auto;
    vertical-align: -0.15em;
    display: inline;
  }
}

.status-handle {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 400;
  color: var(--neo-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
}

.status-time {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  white-space: nowrap;
  text-decoration: none;
  flex-shrink: 0;

  &:hover {
    text-decoration: underline;
  }
}
</style>
