<script setup lang="ts">
/**
 * Direct messages — Mastodon conversations (direct-visibility threads).
 */

import { useConversationsStore } from '~/stores/conversations'
import { useInstancesStore } from '~/stores/instances'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useAccountSearch } from '~/composables/useAccountSearch'
import {
  openOrComposeDirect,
  participantAccts,
  participantLabel,
} from '~/utils/dmHelpers'
import type { mastodon } from 'masto'

const conversationsStore = useConversationsStore()
const instancesStore = useInstancesStore()
const composeSheet = useComposeSheetStore()
const router = useRouter()
const { following, isLoadingFollowing, loadFollowing } = useAccountSearch()

const canView = computed(() => instancesStore.hasAuthenticatedInstance)
const searchQuery = ref('')
const pullDist = ref(0)
const pulling = ref(false)
const listEl = ref<HTMLElement | null>(null)
let pullStartY = 0
let pullActive = false

const myId = computed(() => instancesStore.currentUser?.id || '')
const myAcct = computed(() => instancesStore.currentUser?.acct || '')

const filteredConversations = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const list = conversationsStore.conversations
  if (!q) return list
  return list.filter((c) => {
    const names = (c.accounts || [])
      .map((a) => `${a.displayName || ''} ${a.username || ''} ${a.acct || ''}`)
      .join(' ')
      .toLowerCase()
    const preview = conversationsStore.previewFor(c, myId.value, myAcct.value).toLowerCase()
    return names.includes(q) || preview.includes(q)
  })
})

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

const suggestedPeople = computed(() => {
  const chatting = new Set(
    conversationsStore.conversations.flatMap((c) => (c.accounts || []).map((a) => a.id)),
  )
  return following.value.filter((a) => !chatting.has(a.id)).slice(0, 8)
})

const isSparseInbox = computed(
  () =>
    canView.value &&
    conversationsStore.conversations.length > 0 &&
    conversationsStore.conversations.length < 5,
)

const afterMessagePosted = async (status: mastodon.v1.Status) => {
  await conversationsStore.fetchConversations(true)
  await router.push(`/status/${status.id}`)
}

const openConversation = async (c: mastodon.v1.Conversation) => {
  const statusId = c.lastStatus?.id
  if (!statusId) return
  if (c.unread) await conversationsStore.markRead(c.id)
  await router.push(`/status/${statusId}`)
}

const archiveConversation = async (c: mastodon.v1.Conversation, e: Event) => {
  e.stopPropagation()
  e.preventDefault()
  if (!confirm('Remove this chat from your inbox? Messages stay on the server.')) return
  try {
    await conversationsStore.remove(c.id)
  } catch {
    /* store sets error */
  }
}

const startNewMessage = () => {
  composeSheet.show({
    pickRecipient: true,
    visibility: 'direct',
    title: 'New message',
    onPosted: afterMessagePosted,
  })
}

const messageAccount = async (account: mastodon.v1.Account) => {
  await openOrComposeDirect(account, router, { onPosted: afterMessagePosted })
}

const refreshInbox = async () => {
  if (!canView.value) return
  await Promise.all([
    conversationsStore.fetchConversations({ force: true, quiet: !!conversationsStore.conversations.length }),
    loadFollowing(80, true),
  ])
}

const onTouchStart = (e: TouchEvent) => {
  const el = listEl.value
  if (!el || el.scrollTop > 2) return
  pullStartY = e.touches[0]?.clientY || 0
  pullActive = true
}

const onTouchMove = (e: TouchEvent) => {
  if (!pullActive) return
  const y = e.touches[0]?.clientY || 0
  const dist = Math.max(0, y - pullStartY)
  if (dist > 8) {
    pulling.value = true
    pullDist.value = Math.min(96, dist * 0.55)
  }
}

const onTouchEnd = async () => {
  if (!pullActive) return
  pullActive = false
  const shouldRefresh = pullDist.value > 52
  pulling.value = false
  pullDist.value = 0
  if (shouldRefresh) await refreshInbox()
}

onMounted(() => {
  if (canView.value) {
    void refreshInbox()
    conversationsStore.startLiveRefresh()
  }
})

onUnmounted(() => {
  conversationsStore.stopLiveRefresh()
})

watch(canView, (ok) => {
  if (ok) {
    void refreshInbox()
    conversationsStore.startLiveRefresh()
  } else {
    conversationsStore.stopLiveRefresh()
  }
})

useHead({ title: 'Messages | NeoSpace' })
</script>

<template>
  <div class="messages-page">
    <header class="messages-header">
      <div class="messages-header__row">
        <h1 class="messages-header__title">Messages</h1>
        <div class="messages-header__tools">
          <button
            v-if="canView"
            type="button"
            class="neo-btn neo-btn--tertiary neo-btn--icon"
            title="Refresh"
            aria-label="Refresh messages"
            :disabled="conversationsStore.isRefreshing || conversationsStore.isLoading"
            @click="refreshInbox"
          >
            <FunLoader
              v-if="conversationsStore.isRefreshing"
              variant="seed"
              :size="22"
              label="Refreshing"
            />
            <NeoIcon v-else name="refresh" :size="18" :stroke="2" />
          </button>
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
      </div>
      <label v-if="canView && conversationsStore.conversations.length" class="messages-search">
        <span class="sr-only">Search messages</span>
        <input
          v-model="searchQuery"
          type="search"
          class="messages-search__input"
          placeholder="Search chats…"
          autocomplete="off"
        />
      </label>
    </header>

    <div v-if="!canView" class="messages-state">
      <span class="messages-state__icon"><NeoIcon name="lock" :size="32" :stroke="1.5" /></span>
      <p class="messages-state__title">Messages</p>
      <p>Sign in to continue.</p>
      <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in</NuxtLink>
    </div>

    <div
      v-else-if="conversationsStore.isLoading && !conversationsStore.conversations.length"
      class="messages-loading"
      aria-busy="true"
    >
      <FunLoader variant="region" label="Loading messages" />
    </div>

    <div v-else-if="conversationsStore.error && !conversationsStore.conversations.length" class="messages-state">
      <p class="messages-state__title">Couldn't load messages</p>
      <p>{{ conversationsStore.error }}</p>
      <button type="button" class="neo-btn neo-btn--secondary neo-btn--sm" @click="refreshInbox">
        Retry
      </button>
    </div>

    <div v-else-if="!conversationsStore.conversations.length" class="messages-empty">
      <div class="messages-state">
        <span class="messages-state__icon"><NeoIcon name="message" :size="32" :stroke="1.5" /></span>
        <p class="messages-state__title">No messages</p>
        <div class="messages-empty__actions">
          <button type="button" class="neo-btn neo-btn--primary neo-btn--sm" @click="startNewMessage">
            New message
          </button>
          <NuxtLink to="/explore?tab=people" class="neo-btn neo-btn--ghost neo-btn--sm">People</NuxtLink>
        </div>
      </div>

      <section v-if="suggestedPeople.length || isLoadingFollowing" class="messages-suggest">
        <h2 class="messages-suggest__title">People you follow</h2>
        <div v-if="isLoadingFollowing && !suggestedPeople.length" class="messages-suggest__grow" aria-busy="true">
          <FunLoader variant="pull" />
        </div>
        <div v-else class="messages-suggest__grid">
          <button
            v-for="account in suggestedPeople"
            :key="account.id"
            type="button"
            class="messages-suggest__card"
            @click="messageAccount(account)"
          >
            <img :src="account.avatar" alt="" class="messages-suggest__avatar" />
            <span class="messages-suggest__name">{{ account.displayName || account.username }}</span>
            <span class="messages-suggest__acct">@{{ account.acct }}</span>
            <span class="messages-suggest__cta">Message</span>
          </button>
        </div>
      </section>
    </div>

    <template v-else>
      <div
        ref="listEl"
        class="messages-scroll"
        @touchstart.passive="onTouchStart"
        @touchmove.passive="onTouchMove"
        @touchend="onTouchEnd"
      >
        <div
          class="messages-pull"
          :class="{ 'messages-pull--on': pulling || conversationsStore.isRefreshing }"
          :style="{ height: `${pulling ? pullDist : conversationsStore.isRefreshing ? 64 : 0}px` }"
          aria-hidden="true"
        >
          <FunLoader v-if="pulling || conversationsStore.isRefreshing" variant="pull" />
        </div>

        <ul class="messages-list">
          <li v-for="c in filteredConversations" :key="c.id">
            <div
              class="messages-row"
              :class="{
                'messages-row--unread': c.unread,
                'messages-row--disabled': !c.lastStatus?.id,
              }"
            >
              <button
                type="button"
                class="messages-row__main"
                :disabled="!c.lastStatus?.id"
                :aria-disabled="!c.lastStatus?.id"
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
                  <p class="messages-row__preview">
                    {{
                      c.lastStatus
                        ? conversationsStore.previewFor(c, myId, myAcct)
                        : 'No messages yet'
                    }}
                  </p>
                  <p v-if="participantAccts(c)" class="messages-row__accts">{{ participantAccts(c) }}</p>
                </div>
                <span v-if="c.unread" class="messages-row__dot" aria-label="Unread" />
              </button>
              <button
                type="button"
                class="messages-row__archive"
                title="Remove from inbox"
                aria-label="Remove from inbox"
                @click="archiveConversation(c, $event)"
              >
                <NeoIcon name="x" :size="16" :stroke="2" />
              </button>
            </div>
          </li>
        </ul>

        <p v-if="searchQuery && !filteredConversations.length" class="messages-filter-empty">
          No chats match “{{ searchQuery }}”.
        </p>

        <div v-if="!searchQuery && conversationsStore.hasMore" class="messages-more">
          <button
            type="button"
            class="neo-btn neo-btn--secondary neo-btn--sm"
            :disabled="conversationsStore.isLoadingMore"
            @click="conversationsStore.loadMore()"
          >
            <FunLoader
              v-if="conversationsStore.isLoadingMore"
              variant="seed"
              :size="28"
              label="Loading"
            />
            <span v-else>Load more</span>
          </button>
        </div>

        <section
          v-if="isSparseInbox && (suggestedPeople.length || isLoadingFollowing)"
          class="messages-suggest messages-suggest--inline"
        >
          <div class="messages-suggest__head">
            <h2 class="messages-suggest__title">New chat</h2>
            <p class="messages-suggest__lede">People you follow</p>
          </div>
          <div class="messages-suggest__chips">
            <button
              v-for="account in suggestedPeople"
              :key="account.id"
              type="button"
              class="messages-suggest__chip"
              @click="messageAccount(account)"
            >
              <img :src="account.avatar" alt="" />
              <span>{{ account.displayName || account.username }}</span>
            </button>
            <button type="button" class="messages-suggest__chip messages-suggest__chip--more" @click="startNewMessage">
              <span class="messages-suggest__plus">+</span>
              <span>Someone else</span>
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.messages-page {
  max-width: 640px;
  margin: 0 auto;
  min-height: 50vh;
  padding-bottom: 2rem;
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

  &__tools {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }

  &__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 650;
    letter-spacing: -0.03em;
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

.messages-search {
  display: block;
  margin: 0 0 0.65rem;

  &__input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 0.85rem;
    border-radius: 12px;
    border: 1px solid var(--neo-border-color);
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
    font: inherit;
    font-size: 0.875rem;

    &:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--neo-accent) 50%, var(--neo-border-color));
      box-shadow: 0 0 0 3px var(--neo-accent-soft);
    }
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.messages-loading {
  display: flex;
  align-items: stretch;
  min-height: min(55dvh, 26rem);
  padding: 1.25rem;
  box-sizing: border-box;
}

.messages-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.5rem 1.5rem 1.5rem;
  text-align: center;
  color: var(--neo-text-muted);

  &__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--neo-text-tertiary);
    margin-bottom: 0.25rem;
  }

  &__title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  p {
    margin: 0;
    max-width: 32ch;
    font-size: 0.875rem;
    line-height: 1.45;
  }
}

.messages-empty__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 0.35rem;
}

.messages-scroll {
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.messages-pull {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: height 0.15s ease;
  background: color-mix(in srgb, var(--neo-accent) 4%, transparent);

  &--on {
    min-height: 0;
  }
}

.messages-suggest {
  padding: 0.5rem 1rem 1.5rem;

  &--inline {
    margin-top: 0.5rem;
    border-top: 1px solid var(--neo-border-color);
    padding-top: 1.15rem;
  }

  &__grow {
    height: 4.5rem;
    margin-top: 0.75rem;
  }

  &__head {
    margin-bottom: 0.75rem;
  }

  &__title {
    margin: 0 0 0.25rem;
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--neo-text-muted);
  }

  &__lede {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--neo-text-tertiary);
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.65rem;
    margin-top: 0.85rem;
  }

  &__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.85rem 0.65rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    background: var(--neo-bg-secondary);
    cursor: pointer;
    color: inherit;
    text-align: center;

    &:hover,
    &:active {
      border-color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }
  }

  &__avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
    margin-bottom: 0.25rem;
  }

  &__name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__acct {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__cta {
    margin-top: 0.35rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--neo-accent);
  }

  &__chips {
    display: flex;
    gap: 0.55rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 0.15rem 0 0.35rem;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex: 0 0 auto;
    padding: 0.4rem 0.75rem 0.4rem 0.4rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 999px;
    background: var(--neo-bg-secondary);
    cursor: pointer;
    color: var(--neo-text-primary);
    font-size: 0.8125rem;
    font-weight: 600;

    img {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
    }

    &:hover {
      border-color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }

    &--more {
      color: var(--neo-accent);
    }
  }

  &__plus {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--neo-accent-soft);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    line-height: 1;
  }
}

.messages-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.messages-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--neo-border-color);

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

  &--disabled .messages-row__main {
    opacity: 0.55;
    cursor: not-allowed;
  }

  &__main {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
    padding: 0.85rem 0.35rem 0.85rem 1rem;
    text-align: left;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;

    &:hover:not(:disabled),
    &:active:not(:disabled) {
      background: var(--neo-bg-tertiary);
    }
  }

  &__archive {
    flex-shrink: 0;
    width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--neo-text-quaternary);
    cursor: pointer;

    &:hover {
      color: var(--neo-text-primary);
      background: var(--neo-bg-tertiary);
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

.messages-filter-empty,
.messages-more {
  padding: 1rem;
  text-align: center;
  color: var(--neo-text-muted);
  font-size: 0.875rem;
}

.messages-more {
  display: flex;
  justify-content: center;
}

@media (min-width: 1024px) {
  .messages-page {
    padding-top: 0.5rem;
  }
}
</style>
