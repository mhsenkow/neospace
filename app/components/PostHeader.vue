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
      @click="emit('profileClick', account.acct, $event)"
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
