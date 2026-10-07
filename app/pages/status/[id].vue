<script setup lang="ts">
/**
 * In-app thread / conversation view.
 * Direct messages → chat bubbles (Threads / IG style).
 * Public posts → classic threaded cards.
 */

import type { mastodon } from 'masto'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useConversationsStore } from '~/stores/conversations'
import { dayKey, daySeparatorLabel } from '~/utils/dmHelpers'

const route = useRoute()
const router = useRouter()
const statusStore = useStatusStore()
const instancesStore = useInstancesStore()
const composeSheet = useComposeSheetStore()
const conversationsStore = useConversationsStore()

const isLoading = ref(true)
const isRefreshing = ref(false)
const error = ref<string | null>(null)
const focusStatus = ref<mastodon.v1.Status | null>(null)
const ancestors = ref<mastodon.v1.Status[]>([])
const descendants = ref<mastodon.v1.Status[]>([])
const focusEl = ref<HTMLElement | null>(null)
const chatEndEl = ref<HTMLElement | null>(null)
let threadPoll: ReturnType<typeof setInterval> | null = null

const paramId = computed(() => String(route.params.id || ''))
const queryUrl = computed(() => {
  const u = route.query.url
  return typeof u === 'string' ? u : null
})

const canReply = computed(() => instancesStore.isAuthenticated)
const isDirectThread = computed(() => focusStatus.value?.visibility === 'direct')

/** Chronological chat messages */
const chatMessages = computed(() => {
  if (!focusStatus.value) return [] as mastodon.v1.Status[]
  return [...ancestors.value, focusStatus.value, ...descendants.value]
})

const myAcct = computed(() => instancesStore.currentUser?.acct?.toLowerCase() || '')
const myId = computed(() => instancesStore.currentUser?.id || '')

const isMine = (status: mastodon.v1.Status) => {
  if (!myId.value && !myAcct.value) return false
  return (
    status.account.id === myId.value ||
    status.account.acct?.toLowerCase() === myAcct.value
  )
}

type ChatPerson = {
  id?: string
  acct: string
  username?: string
  displayName?: string | null
  avatar?: string | null
}

/** All other people in this DM (group-aware) */
const otherParticipants = computed((): ChatPerson[] => {
  const byId = new Map<string, ChatPerson>()
  for (const s of chatMessages.value) {
    if (isMine(s)) continue
    const a = s.account
    if (!a?.id || byId.has(a.id)) continue
    byId.set(a.id, {
      id: a.id,
      acct: a.acct,
      username: a.username,
      displayName: a.displayName || a.username,
      avatar: a.avatar,
    })
  }
  // Mentions on our messages may include people who haven't replied yet
  for (const s of chatMessages.value) {
    if (!isMine(s)) continue
    for (const m of s.mentions || []) {
      if (!m.id || m.id === myId.value) continue
      if (m.acct?.toLowerCase() === myAcct.value) continue
      if (byId.has(m.id)) continue
      byId.set(m.id, {
        id: m.id,
        acct: m.acct,
        username: m.username,
        displayName: m.username,
        avatar: null,
      })
    }
  }
  return [...byId.values()]
})

const otherParticipant = computed((): ChatPerson | null => otherParticipants.value[0] || null)

const recipientAccts = computed(() => otherParticipants.value.map((p) => p.acct).filter(Boolean))

const threadTitle = computed(() => {
  if (!focusStatus.value) return 'Thread'
  if (!isDirectThread.value) return 'Thread'
  const people = otherParticipants.value
  if (!people.length) return 'Message'
  if (people.length === 1) {
    return people[0]!.displayName || people[0]!.username || people[0]!.acct || 'Message'
  }
  if (people.length === 2) {
    return `${people[0]!.displayName || people[0]!.username} & ${people[1]!.displayName || people[1]!.username}`
  }
  return `${people[0]!.displayName || people[0]!.username} +${people.length - 1}`
})

const threadSubtitle = computed(() => {
  if (!isDirectThread.value || !otherParticipants.value.length) return ''
  return otherParticipants.value.map((p) => `@${p.acct}`).join(' · ')
})

const replyTarget = computed(() => chatMessages.value.at(-1) || focusStatus.value)

const replyPrefill = computed(() => {
  if (!isDirectThread.value) {
    const acct = focusStatus.value?.account?.acct
    return acct ? `@${acct} ` : ''
  }
  return recipientAccts.value.map((a) => `@${a}`).join(' ') + (recipientAccts.value.length ? ' ' : '')
})

const dayLabelFor = (status: mastodon.v1.Status, index: number) => {
  const prev = chatMessages.value[index - 1]
  if (!prev || dayKey(prev.createdAt) !== dayKey(status.createdAt)) {
    return daySeparatorLabel(status.createdAt)
  }
  return null
}

const contextFromStatus = (s: mastodon.v1.Status) => {
  const text = (s.content || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .trim()
  return {
    id: s.id,
    name: s.account.displayName || s.account.username,
    handle: s.account.acct,
    avatar: s.account.avatar,
    text: text.slice(0, 280),
    url: s.url || s.uri,
  }
}

/** Show avatar/name when speaker changes */
const showBubbleMeta = (status: mastodon.v1.Status, index: number) => {
  if (isMine(status)) return false
  if (index === 0) return true
  const prev = chatMessages.value[index - 1]
  return !prev || prev.account.id !== status.account.id
}

const openFocusReply = async () => {
  const s = replyTarget.value
  if (!s || !canReply.value) return
  // Public threads still use the sheet; DMs type inline via ChatComposer
  if (isDirectThread.value) return
  const replyId =
    (await statusStore.resolveReplyId({
      id: s.id,
      url: s.url || s.uri || queryUrl.value,
    })) || s.id
  const handle = s.account.acct
  composeSheet.show({
    title: 'Reply',
    placeholder: `Reply to @${handle}…`,
    initialText: `@${handle} `,
    inReplyToId: replyId,
    contextPost: contextFromStatus(s),
    onPosted: onReplyPosted,
  })
}

const scrollChatToEnd = async () => {
  await nextTick()
  chatEndEl.value?.scrollIntoView({ block: 'end', behavior: 'smooth' })
}

const loadThread = async (opts: { quiet?: boolean } = {}) => {
  if (!opts.quiet) {
    isLoading.value = true
    focusStatus.value = null
    ancestors.value = []
    descendants.value = []
  } else {
    isRefreshing.value = true
  }
  error.value = null

  try {
    await instancesStore.initialize()

    const resolvedId = await statusStore.resolveThreadId({
      id: paramId.value,
      url: queryUrl.value,
    })

    if (!resolvedId) {
      error.value = 'Couldn’t find that post on your server.'
      return
    }

    if (resolvedId !== paramId.value) {
      await router.replace({
        path: `/status/${resolvedId}`,
        query: queryUrl.value ? { url: queryUrl.value } : undefined,
      })
    }

    const thread = await statusStore.fetchThread(resolvedId)
    focusStatus.value = thread.status
    ancestors.value = thread.ancestors
    descendants.value = thread.descendants

    if (thread.status.visibility === 'direct' && instancesStore.isAuthenticated) {
      const statusIds = [
        ...thread.ancestors.map((s) => s.id),
        thread.status.id,
        ...thread.descendants.map((s) => s.id),
      ]
      const accountIds = otherParticipants.value
        .map((p) => p.id)
        .filter((id): id is string => !!id)
      void conversationsStore.markReadForThread({ statusIds, accountIds })
    }

    if (!opts.quiet) {
      await nextTick()
      if (thread.status.visibility === 'direct') {
        await scrollChatToEnd()
      } else {
        focusEl.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }
  } catch (e: any) {
    if (!opts.quiet) error.value = e?.message || 'Failed to load thread'
  } finally {
    isLoading.value = false
    isRefreshing.value = false
  }
}

const onReplyPosted = async (status: mastodon.v1.Status) => {
  if (!descendants.value.some((s) => s.id === status.id)) {
    descendants.value = [...descendants.value, status]
  }
  if (focusStatus.value) {
    focusStatus.value = {
      ...focusStatus.value,
      repliesCount: (focusStatus.value.repliesCount || 0) + 1,
    }
  }
  await loadThread({ quiet: true })
  if (isDirectThread.value) await scrollChatToEnd()
}

const goProfile = () => {
  const acct = otherParticipant.value?.acct
  if (!acct) return
  router.push({ path: '/profile', query: { user: acct } })
}

const stopThreadPoll = () => {
  if (threadPoll) {
    clearInterval(threadPoll)
    threadPoll = null
  }
}

const startThreadPoll = () => {
  stopThreadPoll()
  if (!isDirectThread.value) return
  threadPoll = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    void loadThread({ quiet: true })
  }, 40_000)
}

onMounted(() => {
  void loadThread().then(() => startThreadPoll())
  conversationsStore.startLiveRefresh()
})

onUnmounted(() => {
  stopThreadPoll()
  conversationsStore.stopLiveRefresh()
})

watch(() => [route.params.id, route.query.url], () => {
  stopThreadPoll()
  void loadThread().then(() => startThreadPoll())
})

watch(isDirectThread, (dm) => {
  if (dm) startThreadPoll()
  else stopThreadPoll()
})

useHead({
  title: computed(() => {
    if (!focusStatus.value) return 'Thread | NeoSpace'
    if (isDirectThread.value) return `${threadTitle.value} | NeoSpace`
    return `Thread · @${focusStatus.value.account.acct} | NeoSpace`
  }),
})
</script>

<template>
  <div
    class="thread-page"
    :class="{
      'thread-page--can-reply': canReply && focusStatus,
      'thread-page--signin-hint': !canReply && focusStatus && !isLoading && !error,
      'thread-page--dm': isDirectThread,
    }"
  >
    <!-- DM header: person, not “Open original” -->
    <SubviewChrome
      v-if="isDirectThread && focusStatus"
      class="thread-subview"
      :back-action="() => router.push('/messages')"
    >
      <template #title>
        <button type="button" class="chat-header__person" @click="goProfile">
          <div class="chat-header__avatars">
            <img
              v-for="(p, i) in otherParticipants.slice(0, 2)"
              :key="p.id || p.acct"
              v-show="p.avatar"
              :src="p.avatar || undefined"
              alt=""
              class="chat-header__avatar"
              :class="{ 'chat-header__avatar--stack': i > 0 }"
            />
            <span
              v-if="!otherParticipants.some((p) => p.avatar)"
              class="chat-header__avatar chat-header__avatar--placeholder"
              aria-hidden="true"
            >
              {{ (threadTitle || '?').slice(0, 1).toUpperCase() }}
            </span>
          </div>
          <span class="chat-header__text">
            <span class="chat-header__name">{{ threadTitle }}</span>
            <span v-if="threadSubtitle" class="chat-header__handle">{{ threadSubtitle }}</span>
          </span>
        </button>
      </template>
      <template #actions>
        <button
          type="button"
          class="subview-chrome__btn"
          title="Refresh"
          aria-label="Refresh conversation"
          :disabled="isRefreshing"
          @click="loadThread({ quiet: true })"
        >
          <FunLoader v-if="isRefreshing" variant="seed" :size="22" label="Refreshing" />
          <NeoIcon v-else name="refresh" :size="16" :stroke="2" />
        </button>
        <span class="chat-header__lock" title="Private message">
          <NeoIcon name="lock" :size="16" :stroke="2" />
        </span>
      </template>
    </SubviewChrome>

    <SubviewChrome v-else class="thread-subview" :title="threadTitle || 'Thread'">
      <template #actions>
        <a
          v-if="focusStatus?.url || queryUrl"
          class="subview-chrome__btn"
          :href="focusStatus?.url || queryUrl || '#'"
          target="_blank"
          rel="noopener noreferrer"
          title="Open original"
          aria-label="Open original"
        >
          <NeoIcon name="globe" :size="18" :stroke="1.75" />
        </a>
      </template>
    </SubviewChrome>

    <div v-if="isLoading" class="thread-loading" aria-busy="true">
      <FunLoader variant="region" :label="isDirectThread ? 'Loading messages' : 'Loading conversation'" />
    </div>

    <div v-else-if="error" class="thread-state thread-state--error">
      <p>{{ error }}</p>
      <div class="thread-state__actions">
        <button type="button" class="neo-btn neo-btn--secondary" @click="loadThread()">Retry</button>
        <NuxtLink v-if="!instancesStore.isAuthenticated" to="/login" class="neo-btn neo-btn--primary">
          Sign in
        </NuxtLink>
      </div>
    </div>

    <!-- Chat view -->
    <template v-else-if="isDirectThread">
      <div class="chat-stream">
        <p v-if="chatMessages.length <= 1" class="chat-empty">
          Private conversation — everyone mentioned can see these messages.
        </p>
        <p v-else-if="chatMessages.length >= 40" class="chat-empty chat-empty--soft">
          Older messages may be truncated by your server’s context limit.
        </p>

        <MessageBubble
          v-for="(status, index) in chatMessages"
          :key="status.id"
          :status="status"
          :mine="isMine(status)"
          :show-meta="showBubbleMeta(status, index)"
          :day-label="dayLabelFor(status, index)"
        />
        <div ref="chatEndEl" class="chat-end" />
      </div>

      <ChatComposer
        v-if="canReply && replyTarget"
        :key="replyTarget.id + recipientAccts.join(',')"
        :in-reply-to-id="replyTarget.id"
        :recipient-accts="recipientAccts"
        placeholder="Message…"
        @posted="onReplyPosted"
      />
      <div v-else class="thread-signin-hint">
        <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in to reply</NuxtLink>
      </div>
    </template>

    <!-- Public thread view -->
    <template v-else>
      <div class="thread-stream">
        <RealPostCard
          v-for="status in ancestors"
          :key="status.id"
          :status="status"
          hide-inline-reply
          class="thread-post thread-post--ancestor"
          @replied="onReplyPosted"
        />

        <div ref="focusEl" class="thread-focus">
          <RealPostCard
            v-if="focusStatus"
            :status="focusStatus"
            hide-inline-reply
            class="thread-post thread-post--focus"
            @replied="onReplyPosted"
          />
        </div>

        <RealPostCard
          v-for="status in descendants"
          :key="status.id"
          :status="status"
          hide-inline-reply
          class="thread-post thread-post--reply"
          @replied="onReplyPosted"
        />

        <p v-if="!descendants.length && !ancestors.length" class="thread-lonely">
          No replies yet — be the first.
        </p>
      </div>

      <button
        v-if="focusStatus && canReply"
        type="button"
        class="thread-reply-bar"
        @click="openFocusReply"
      >
        <img
          v-if="instancesStore.userAvatar"
          :src="instancesStore.userAvatar"
          alt=""
          class="thread-reply-bar__avatar"
        />
        <span class="thread-reply-bar__placeholder">
          Reply to @{{ focusStatus.account.acct }}…
        </span>
      </button>

      <div v-else-if="focusStatus && !canReply" class="thread-signin-hint">
        <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in to reply</NuxtLink>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.thread-page {
  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  padding: 0.5rem 0.5rem 1.5rem;
  box-sizing: border-box;

  &--can-reply {
    padding-bottom: calc(5.25rem + env(safe-area-inset-bottom, 0));
  }

  &--signin-hint {
    padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0));
  }

  &--dm {
    max-width: 36rem;
    padding-left: 0;
    padding-right: 0;
    padding-bottom: calc(6.5rem + env(safe-area-inset-bottom, 0));
  }
}

.thread-subview {
  margin-bottom: 0.35rem;
}

.chat-header {
  &__person {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
    padding: 0.25rem;
    border: none;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    color: inherit;

    &:hover {
      background: var(--neo-bg-hover);
    }
  }

  &__avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--neo-bg-tertiary);
    border: 2px solid var(--neo-bg-primary);

    &--stack {
      position: absolute;
      right: -6px;
      bottom: -4px;
      width: 22px;
      height: 22px;
    }

    &--placeholder {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
      font-weight: 700;
      color: var(--neo-text-inverse);
      background: var(--neo-accent);
    }
  }

  &__avatars {
    position: relative;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
  }

  &__text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
  }

  &__name {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__handle {
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__lock {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--neo-text-muted);
    padding-right: 0.35rem;
  }
}

.chat-stream {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-height: 40vh;
  padding: 0.5rem 0 1rem;
}

.chat-empty {
  margin: 1.25rem 1rem 0.5rem;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  line-height: 1.4;

  &--soft {
    margin-top: 0.35rem;
    opacity: 0.85;
  }
}

.thread-loading {
  display: flex;
  align-items: stretch;
  min-height: min(55dvh, 26rem);
  padding: 1.25rem;
  box-sizing: border-box;
}

.chat-end {
  height: 1px;
}

.thread-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  text-align: center;
  color: var(--neo-text-muted);

  &--error {
    color: var(--neo-danger);
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
  }
}

.thread-spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid var(--neo-border-color);
  border-top-color: var(--neo-accent);
  border-radius: 50%;
  animation: thread-spin 0.7s linear infinite;
}

@keyframes thread-spin {
  to {
    transform: rotate(360deg);
  }
}

.thread-stream {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.thread-focus {
  margin: 0.15rem 0;
  padding: 0.25rem;
  border-radius: 4px;
  background: var(--neo-accent-soft);
  border: 1px solid color-mix(in srgb, var(--neo-accent) 35%, transparent);
}

.thread-lonely {
  margin: 1.5rem 0 0;
  text-align: center;
  font-size: 0.875rem;
  color: var(--neo-text-muted);
}

.thread-signin-hint {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0));
  background: color-mix(in srgb, var(--neo-bg-primary) 94%, transparent);
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(10px);

  @media (min-width: 1024px) {
    left: 64px;
  }
}

.thread-reply-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  min-height: 52px;
  padding: 0.55rem 0.85rem calc(0.55rem + env(safe-area-inset-bottom, 0));
  background: color-mix(in srgb, var(--neo-bg-primary) 96%, transparent);
  border: none;
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(12px);
  cursor: pointer;
  text-align: left;
  color: inherit;

  @media (min-width: 1024px) {
    left: 64px;
    padding: 0.65rem 1rem 0.75rem;
  }

  &--chat {
    /* Hide mobile bottom nav overlap — messages already hide nav on /status */
  }

  &__avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  &__placeholder {
    flex: 1;
    min-width: 0;
    padding: 0.55rem 0.85rem;
    border-radius: 999px;
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-muted);
    font-size: 0.9375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@media (min-width: 1024px) {
  .thread-page:not(.thread-page--dm) {
    padding-top: 0.5rem;
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }
}
</style>
