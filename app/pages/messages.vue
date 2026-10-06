<script setup lang="ts">
/**
 * Direct messages — Mastodon conversations (direct-visibility threads).
 */

import { useConversationsStore } from '~/stores/conversations'
import { useInstancesStore } from '~/stores/instances'
import { useComposeSheetStore } from '~/stores/composeSheet'
import type { mastodon } from 'masto'

const conversationsStore = useConversationsStore()
const instancesStore = useInstancesStore()
const composeSheet = useComposeSheetStore()
const router = useRouter()

const canView = computed(() => instancesStore.hasAuthenticatedInstance)

const stripHtml = (html: string) =>
  html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

const participantLabel = (c: mastodon.v1.Conversation) => {
  const names = (c.accounts || [])
    .map((a) => a.displayName || a.username)
    .filter(Boolean)
  if (!names.length) return 'Direct message'
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} +${names.length - 1}`
}

const participantAccts = (c: mastodon.v1.Conversation) =>
  (c.accounts || []).map((a) => `@${a.acct}`).join(' ')

const previewText = (c: mastodon.v1.Conversation) => {
  const status = c.lastStatus
  if (!status?.content) return 'No messages yet'
  const text = stripHtml(status.content)
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

const formatTime = (dateString?: string | null) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const openConversation = async (c: mastodon.v1.Conversation) => {
  if (c.unread) await conversationsStore.markRead(c.id)
  const statusId = c.lastStatus?.id
  if (statusId) {
    await router.push(`/status/${statusId}`)
  }
}

const startNewMessage = () => {
  composeSheet.show({
    visibility: 'direct',
    placeholder: 'Message @someone… (only they can see it)',
  })
}

onMounted(() => {
  if (canView.value) conversationsStore.fetchConversations(true)
})

watch(canView, (ok) => {
  if (ok) conversationsStore.fetchConversations(true)
})

useHead({ title: 'Messages | NeoSpace' })
</script>

<template>
  <div class="messages-page">
    <header class="messages-header">
      <div class="messages-header__row">
        <h1 class="messages-header__title">Messages</h1>
        <button
          v-if="canView"
          type="button"
          class="neo-btn neo-btn--tertiary neo-btn--icon messages-header__new"
          title="New message"
          aria-label="New message"
          @click="startNewMessage"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <p class="messages-header__hint">
        Direct messages on Mastodon — only mentioned people can see them.
      </p>
    </header>

    <div v-if="!canView" class="messages-state">
      <span>🔒</span>
      <p class="messages-state__title">Sign in to see messages</p>
      <p>Direct conversations follow your Mastodon account.</p>
      <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in</NuxtLink>
    </div>

    <div v-else-if="conversationsStore.isLoading && !conversationsStore.conversations.length" class="messages-state">
      <p>Loading messages…</p>
    </div>

    <div v-else-if="conversationsStore.error && !conversationsStore.conversations.length" class="messages-state">
      <p class="messages-state__title">Couldn't load messages</p>
      <p>{{ conversationsStore.error }}</p>
      <button type="button" class="neo-btn neo-btn--secondary neo-btn--sm" @click="conversationsStore.fetchConversations(true)">
        Retry
      </button>
    </div>

    <div v-else-if="!conversationsStore.conversations.length" class="messages-state">
      <span>💬</span>
      <p class="messages-state__title">No messages yet</p>
      <p>Start a direct post with @mentions — it'll show up here.</p>
      <button type="button" class="neo-btn neo-btn--primary neo-btn--sm" @click="startNewMessage">
        New message
      </button>
    </div>

    <ul v-else class="messages-list">
      <li v-for="c in conversationsStore.conversations" :key="c.id">
        <button
          type="button"
          class="messages-row"
          :class="{ 'messages-row--unread': c.unread }"
          @click="openConversation(c)"
        >
          <div class="messages-row__avatars">
            <img
              v-for="(acct, i) in (c.accounts || []).slice(0, 2)"
              :key="acct.id"
              :src="acct.avatar"
              :alt="acct.displayName || acct.username"
              class="messages-row__avatar"
              :class="{ 'messages-row__avatar--stack': i > 0 }"
            />
          </div>
          <div class="messages-row__body">
            <div class="messages-row__top">
              <span class="messages-row__name">{{ participantLabel(c) }}</span>
              <time class="messages-row__time">{{ formatTime(c.lastStatus?.createdAt) }}</time>
            </div>
            <p class="messages-row__preview">{{ previewText(c) }}</p>
            <p v-if="participantAccts(c)" class="messages-row__accts">{{ participantAccts(c) }}</p>
          </div>
          <span v-if="c.unread" class="messages-row__dot" aria-label="Unread" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
.messages-page {
  max-width: 640px;
  margin: 0 auto;
  min-height: 50vh;
}

.messages-header {
  padding: 1rem 1rem 0.5rem;
  border-bottom: 1px solid var(--neo-border-color);

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  &__title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--neo-text-primary);
  }

  &__new {
    width: 40px;
    height: 40px;
  }

  &__hint {
    margin: 0.35rem 0 0.75rem;
    font-size: 0.8125rem;
    color: var(--neo-text-tertiary);
  }
}

.messages-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1.5rem;
  text-align: center;
  color: var(--neo-text-muted);

  &__title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  p {
    margin: 0;
    max-width: 28ch;
    font-size: 0.875rem;
    line-height: 1.45;
  }

  span {
    font-size: 1.75rem;
  }
}

.messages-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.messages-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  width: 100%;
  padding: 0.85rem 1rem;
  text-align: left;
  border: none;
  border-bottom: 1px solid var(--neo-border-color);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 0.12s ease;

  &:hover,
  &:active {
    background: var(--neo-bg-tertiary);
  }

  &--unread {
    background: color-mix(in srgb, var(--neo-accent) 5%, transparent);

    .messages-row__name {
      font-weight: 700;
    }

    .messages-row__preview {
      color: var(--neo-text-secondary);
      font-weight: 500;
    }
  }

  &__avatars {
    position: relative;
    width: 48px;
    height: 48px;
    flex-shrink: 0;
  }

  &__avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid var(--neo-bg-primary);

    &--stack {
      position: absolute;
      right: -4px;
      bottom: -4px;
      width: 28px;
      height: 28px;
    }
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  &__name {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--neo-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__time {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--neo-text-quaternary);
  }

  &__preview {
    margin: 0.2rem 0 0;
    font-size: 0.875rem;
    color: var(--neo-text-tertiary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__accts {
    margin: 0.15rem 0 0;
    font-size: 0.75rem;
    color: var(--neo-text-quaternary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    margin-top: 0.45rem;
    border-radius: 50%;
    background: var(--neo-accent);
  }
}

@media (min-width: 1024px) {
  .messages-page {
    padding-top: 0.5rem;
  }
}
</style>
