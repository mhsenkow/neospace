<script setup lang="ts">
/**
 * In-app thread / conversation view.
 * Direct messages → chat bubbles (Threads / IG style).
 * Public posts → classic threaded cards.
 */

import type { mastodon } from 'masto'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import { useConversationsStore } from '~/stores/conversations'
import { dayKey, daySeparatorLabel, safeHttpUrl } from '~/utils/dmHelpers'
import { createRaceGuard } from '~/composables/useRace'
import { mapErrorToMessage } from '~/utils/friendlyError'
import { clearReadAccountOverride, setReadAccountOverride } from '~/composables/useMasto'
import { useKeyboardBottomInset } from '~/composables/useKeyboardViewport'
import { plainTextOf } from '~/utils/plainText'
import { useDebouncedValue } from '~/composables/useDebouncedValue'
import { getMainScroller } from '~/utils/pageScroll'

const route = useRoute()
const router = useRouter()
const statusStore = useStatusStore()
const instancesStore = useInstancesStore()
const conversationsStore = useConversationsStore()
const loadRace = createRaceGuard()
/** Id our own canonicalising router.replace lands on — its route change isn't a new load */
let replacedToId: string | null = null
let dmRefreshActive = false

let readOverrideOwner = 0
const syncReadAccountOverride = () => {
  const account = route.query.account
  readOverrideOwner = setReadAccountOverride(typeof account === 'string' ? account : null)
}
syncReadAccountOverride()
watch(() => route.query.account, syncReadAccountOverride)
// Only clears if this page still owns the override (the next page may have set it already)
onBeforeUnmount(() => clearReadAccountOverride(readOverrideOwner))

const isLoading = ref(true)
const isRefreshing = ref(false)
const error = ref<string | null>(null)
const focusStatus = ref<mastodon.v1.Status | null>(null)
const ancestors = ref<mastodon.v1.Status[]>([])
const descendants = ref<mastodon.v1.Status[]>([])
const focusEl = ref<HTMLElement | null>(null)
const chatEndEl = ref<HTMLElement | null>(null)
let threadPoll: ReturnType<typeof setInterval> | null = null
let resolvedThreadId: string | null = null

const paramId = computed(() => String(route.params.id || ''))
const queryUrl = computed(() => {
  const u = route.query.url
  return typeof u === 'string' ? u : null
})

const canReply = computed(() => instancesStore.isAuthenticated)
/** ?url= is user-controllable — never render a javascript:/data: href from it */
const originalUrl = computed(
  () => safeHttpUrl(focusStatus.value?.url) || safeHttpUrl(queryUrl.value),
)
const isDirectThread = computed(() => focusStatus.value?.visibility === 'direct')

/** Chronological chat messages */
const chatMessages = computed(() => {
  if (!focusStatus.value) return [] as mastodon.v1.Status[]
  return [...ancestors.value, focusStatus.value, ...descendants.value]
})

const threadQuery = ref('')
/** Debounced find-in-thread query — filtering parses every message */
const threadFindQuery = useDebouncedValue(threadQuery, 150)

const statusMatchesQuery = (s: mastodon.v1.Status, q: string) => {
  if (!q) return true
  const hay = [
    plainTextOf(s),
    s.spoilerText || '',
    s.account?.displayName || '',
    s.account?.username || '',
    s.account?.acct || '',
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

/** Filtered chat stream (client-side find-in-conversation) */
const visibleChatMessages = computed(() => {
  const q = threadFindQuery.value.trim().toLowerCase()
  if (!q) return chatMessages.value
  return chatMessages.value.filter((s) => statusMatchesQuery(s, q))
})

/**
 * Who is reading (and replying): ?account= (opened from another account's
 * notification) overrides the active account for every client call here, so
 * "mine" and the recipient list must be judged as that account too.
 */
const overrideInstance = computed(() => {
  const id = route.query.account
  if (typeof id !== 'string') return null
  return instancesStore.instances.find((i) => i.id === id && i.accessToken && i.user) || null
})
const viewer = computed(() => overrideInstance.value?.user || instancesStore.currentUser)
/** The global DM inbox (conversations store) is the active account's — leave it alone */
const readsAsOtherAccount = computed(
  () => !!overrideInstance.value && overrideInstance.value.id !== instancesStore.activeAccountId,
)

const myAcct = computed(() => viewer.value?.acct?.toLowerCase() || '')
const myId = computed(() => viewer.value?.id || '')

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

/**
 * All other people in this DM (group-aware). Only direct posts define the
 * audience — a public ancestor's author (DM started as a private reply to a
 * public thread) must not be silently mentioned into the conversation.
 */
const otherParticipants = computed((): ChatPerson[] => {
  const byId = new Map<string, ChatPerson>()
  const direct = chatMessages.value.filter((s) => s.visibility === 'direct')
  for (const s of direct) {
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
  // Mentioned people who haven't written yet are in the audience too (Mastodon
  // replies keep every mention of the post they answer)
  for (const s of direct) {
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
/** Leading-mention stripping in bubbles: incoming DMs open with "@me" */
const bubbleMentionAccts = computed(() =>
  myAcct.value ? [...recipientAccts.value, myAcct.value] : recipientAccts.value,
)
/** Stable per conversation — re-keying on every new message wiped the draft and focus */
const chatThreadKey = computed(() => chatMessages.value[0]?.id || focusStatus.value?.id || '')

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

/** DM replies chain to the latest message; public replies always target the focus post */
const replyTarget = computed(() => {
  if (isDirectThread.value) {
    return chatMessages.value.at(-1) || focusStatus.value
  }
  return focusStatus.value
})

/** Mentions prepended on send — keep the reply field empty (Threads / ChatComposer) */
const replyMentionAccts = computed(() => {
  if (isDirectThread.value) return recipientAccts.value
  const acct = focusStatus.value?.account?.acct
  return acct ? [acct] : []
})

const dayLabelFor = (status: mastodon.v1.Status, index: number) => {
  const prev = visibleChatMessages.value[index - 1]
  if (!prev || dayKey(prev.createdAt) !== dayKey(status.createdAt)) {
    return daySeparatorLabel(status.createdAt)
  }
  return null
}

/** Show avatar/name when speaker changes */
const showBubbleMeta = (status: mastodon.v1.Status, index: number) => {
  if (isMine(status)) return false
  if (index === 0) return true
  const prev = visibleChatMessages.value[index - 1]
  return !prev || prev.account.id !== status.account.id
}

/** Resolved local id for public inline reply (foreign URLs) */
const publicReplyId = ref<string | null>(null)
/** True while resolveReplyId is in flight — dock shows disabled immediately */
const replyResolving = ref(false)
let replyResolveToken = 0

watch(
  () => [replyTarget.value?.id, replyTarget.value?.url, replyTarget.value?.uri, isDirectThread.value] as const,
  async ([id, url, uri, isDm]) => {
    const token = ++replyResolveToken
    if (!id || isDm) {
      publicReplyId.value = null
      replyResolving.value = false
      return
    }
    // Show dock immediately with the local id; refine after network resolve
    publicReplyId.value = id
    replyResolving.value = true
    try {
      const resolved =
        (await statusStore.resolveReplyId({
          id,
          url: (typeof url === 'string' && url) || (typeof uri === 'string' && uri) || queryUrl.value,
        })) || id
      if (token !== replyResolveToken) return
      publicReplyId.value = resolved
    } finally {
      if (token === replyResolveToken) replyResolving.value = false
    }
  },
  { immediate: true },
)

/** Flat reply list with depth from inReplyToId (root = focus post) */
type ReplyNode = { status: mastodon.v1.Status; depth: number }

const replyTree = computed((): ReplyNode[] => {
  const focusId = focusStatus.value?.id
  if (!focusId || !descendants.value.length) return []

  const byParent = new Map<string, mastodon.v1.Status[]>()
  for (const s of descendants.value) {
    const parent = s.inReplyToId || focusId
    const list = byParent.get(parent)
    if (list) list.push(s)
    else byParent.set(parent, [s])
  }

  const out: ReplyNode[] = []
  const seen = new Set<string>()
  const walk = (parentId: string, depth: number) => {
    const kids = byParent.get(parentId) || []
    for (const kid of kids) {
      if (seen.has(kid.id)) continue
      seen.add(kid.id)
      out.push({ status: kid, depth: Math.min(depth, 6) })
      walk(kid.id, depth + 1)
    }
  }
  walk(focusId, 0)

  // Orphans whose parent isn't in this context — append at depth 0
  for (const s of descendants.value) {
    if (seen.has(s.id)) continue
    out.push({ status: s, depth: 0 })
  }
  return out
})

const visibleAncestors = computed(() => {
  const q = threadFindQuery.value.trim().toLowerCase()
  if (!q) return ancestors.value
  return ancestors.value.filter((s) => statusMatchesQuery(s, q))
})

const threadStatusById = computed(() => {
  const map = new Map<string, mastodon.v1.Status>()
  for (const s of [...ancestors.value, ...descendants.value]) map.set(s.id, s)
  if (focusStatus.value) map.set(focusStatus.value.id, focusStatus.value)
  return map
})

/** Screen-reader context for nested replies: who it answers + nesting level */
const replyContextLabel = (node: ReplyNode) => {
  const parentId = node.status.inReplyToId
  const parent = parentId ? threadStatusById.value.get(parentId) : undefined
  const who = parent?.account?.acct ? ` to @${parent.account.acct}` : ''
  return `Reply${who}, level ${node.depth + 1}`
}

const visibleReplyTree = computed(() => {
  const q = threadFindQuery.value.trim().toLowerCase()
  if (!q) return replyTree.value
  return replyTree.value.filter((n) => statusMatchesQuery(n.status, q))
})

const showFocusInSearch = computed(() => {
  const q = threadFindQuery.value.trim().toLowerCase()
  if (!q || !focusStatus.value) return true
  return statusMatchesQuery(focusStatus.value, q)
})

const threadSearchStatus = computed(() => {
  const q = threadFindQuery.value.trim()
  if (!q) return ''
  const n = isDirectThread.value
    ? visibleChatMessages.value.length
    : (showFocusInSearch.value ? 1 : 0) +
      visibleAncestors.value.length +
      visibleReplyTree.value.length
  if (!n) return `No messages match “${q}”.`
  return `${n} match${n === 1 ? '' : 'es'}`
})

/** Keep public reply dock / DM bar above the soft keyboard */
const { insetStyle: replyDockStyle, keyboardOpen } = useKeyboardBottomInset()

const preferReducedMotion = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.classList.contains('reduce-motion'))

/** Reader is at (or very near) the latest message — page scroller aware (mobile `main`) */
const isNearPageBottom = (slack = 200) => {
  if (typeof window === 'undefined') return true
  const main = getMainScroller()
  if (main) return main.scrollHeight - main.scrollTop - main.clientHeight <= slack
  const doc = document.documentElement
  return doc.scrollHeight - window.scrollY - window.innerHeight <= slack
}

const scrollChatToEnd = async () => {
  await nextTick()
  chatEndEl.value?.scrollIntoView({
    block: 'end',
    behavior: preferReducedMotion() ? 'auto' : 'smooth',
  })
}

/**
 * Whether the next soft-keyboard open should keep the latest message in view.
 * Decided when a field gains focus (before the keyboard shrinks the viewport
 * and skews the measurement): composer focus while reading history, or the
 * find-in-thread field, must not yank the reader to the bottom.
 */
let keyboardFollowsChat = true
const onReplyFieldFocus = () => {
  keyboardFollowsChat = isNearPageBottom()
}
const onThreadSearchFocus = () => {
  keyboardFollowsChat = false
}

// Android: when the keyboard opens, keep the latest message above the composer
watch(keyboardOpen, (open) => {
  if (open && keyboardFollowsChat) void scrollChatToEnd()
})

const syncDmLiveRefresh = (isDm: boolean) => {
  if (isDm && instancesStore.isAuthenticated && !readsAsOtherAccount.value) {
    if (!dmRefreshActive) {
      conversationsStore.startLiveRefresh()
      dmRefreshActive = true
    }
  } else if (dmRefreshActive) {
    conversationsStore.stopLiveRefresh()
    dmRefreshActive = false
  }
}

const loadThread = async (opts: { quiet?: boolean } = {}) => {
  const ticket = loadRace.next()
  if (!opts.quiet) {
    isLoading.value = true
    focusStatus.value = null
    ancestors.value = []
    descendants.value = []
    resolvedThreadId = null
    threadQuery.value = ''
  } else {
    isRefreshing.value = true
  }
  error.value = null

  try {
    await instancesStore.initialize()
    if (!ticket.isCurrent()) return

    let resolvedId = resolvedThreadId
    if (!resolvedId || !opts.quiet) {
      resolvedId = await statusStore.resolveThreadId({
        id: paramId.value,
        url: queryUrl.value,
      })
    }
    if (!ticket.isCurrent()) return

    if (!resolvedId) {
      error.value = 'Couldn’t find that post on your server.'
      return
    }
    resolvedThreadId = resolvedId

    if (resolvedId !== paramId.value) {
      replacedToId = resolvedId
      await router.replace({
        path: `/status/${resolvedId}`,
        // Keep the read-account override (notification from another account)
        query: {
          ...(queryUrl.value ? { url: queryUrl.value } : {}),
          ...(typeof route.query.account === 'string' ? { account: route.query.account } : {}),
        },
      })
      if (!ticket.isCurrent()) return
    }

    const thread = await statusStore.fetchThread(resolvedId)
    if (!ticket.isCurrent()) return
    // Background refresh: follow new messages only if the reader is already at the end
    const followNew =
      !!opts.quiet &&
      thread.status.visibility === 'direct' &&
      thread.descendants.length > descendants.value.length &&
      isNearPageBottom()
    focusStatus.value = thread.status
    ancestors.value = thread.ancestors
    descendants.value = thread.descendants

    syncDmLiveRefresh(thread.status.visibility === 'direct')

    if (followNew) void scrollChatToEnd()

    if (
      thread.status.visibility === 'direct' &&
      instancesStore.isAuthenticated &&
      !readsAsOtherAccount.value
    ) {
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
      if (!ticket.isCurrent()) return
      const behavior = preferReducedMotion() ? 'auto' : 'smooth'
      if (thread.status.visibility === 'direct') {
        await scrollChatToEnd()
      } else {
        focusEl.value?.scrollIntoView({ block: 'center', behavior })
        focusEl.value?.focus?.({ preventScroll: true })
      }
    }
  } catch (e: any) {
    if (!ticket.isCurrent()) return
    if (!opts.quiet) {
      const friendly = mapErrorToMessage(e)
      error.value = friendly.detail || friendly.title || e?.message || 'Failed to load thread'
    }
  } finally {
    if (ticket.isCurrent()) {
      isLoading.value = false
      isRefreshing.value = false
    }
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
  // Land on the new reply immediately — don't wait on a quiet reload
  await nextTick()
  if (isDirectThread.value) await scrollChatToEnd()
  else {
    chatEndEl.value?.scrollIntoView({
      block: 'end',
      behavior: preferReducedMotion() ? 'auto' : 'smooth',
    })
  }
  // Echo / nesting from the server in the background — don't yank a reader
  // who scrolled up meanwhile
  void loadThread({ quiet: true }).then(() => {
    if (isDirectThread.value && isNearPageBottom()) void scrollChatToEnd()
  })
}

/** A message deleted from its bubble menu — drop it now instead of on the next poll */
const onMessageDeleted = (statusId: string) => {
  ancestors.value = ancestors.value.filter((s) => s.id !== statusId)
  descendants.value = descendants.value.filter((s) => s.id !== statusId)
  if (focusStatus.value?.id !== statusId) return
  // The focused post is gone (its context would 404) — move to what's left
  const rest = [...ancestors.value, ...descendants.value]
  const next = rest.at(-1)
  if (next) {
    // Drop ?url= (it named the deleted post); keep the read-account override
    const account = route.query.account
    void router.replace({
      path: `/status/${next.id}`,
      query: typeof account === 'string' ? { account } : {},
    })
  } else void router.push('/messages')
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
})

onUnmounted(() => {
  stopThreadPoll()
  loadRace.abort()
  syncDmLiveRefresh(false)
})

watch(() => [route.params.id, route.query.url], () => {
  // Skip only the route change our own replace caused — a flag would also
  // swallow a newer navigation that superseded (aborted) that replace
  const own = replacedToId !== null && String(route.params.id || '') === replacedToId
  replacedToId = null
  if (own) return
  stopThreadPoll()
  resolvedThreadId = null
  void loadThread().then(() => startThreadPoll())
})

watch(isDirectThread, (dm) => {
  syncDmLiveRefresh(dm)
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
        <!-- The person button replaces SubviewChrome's h1 — keep a page heading -->
        <h1 class="sr-only">Conversation with {{ threadTitle }}</h1>
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
          <NeoIcon name="lock" :size="16" :stroke="2" aria-hidden="true" />
          <span class="sr-only">Private message</span>
        </span>
      </template>
    </SubviewChrome>

    <SubviewChrome v-else class="thread-subview" :title="threadTitle || 'Thread'">
      <template #actions>
        <a
          v-if="originalUrl"
          class="subview-chrome__btn"
          :href="originalUrl"
          target="_blank"
          rel="noopener noreferrer"
          title="Open original"
          aria-label="Open original"
        >
          <NeoIcon name="globe" :size="18" :stroke="1.75" />
        </a>
      </template>
    </SubviewChrome>

    <div
      v-if="focusStatus && !isLoading && !error && !keyboardOpen"
      class="thread-search neo-sticky-bar neo-sticky-bar--under-chrome"
    >
      <label class="thread-search__field">
        <span class="sr-only">{{ isDirectThread ? 'Search conversation' : 'Search thread' }}</span>
        <NeoIcon name="search" :size="16" :stroke="1.75" class="thread-search__icon" aria-hidden="true" />
        <input
          v-model="threadQuery"
          type="search"
          class="thread-search__input"
          :placeholder="isDirectThread ? 'Search conversation…' : 'Search thread…'"
          autocomplete="off"
          enterkeyhint="search"
          @focus="onThreadSearchFocus"
        />
      </label>
      <p v-if="threadSearchStatus" class="thread-search__status" role="status" aria-live="polite">
        {{ threadSearchStatus }}
      </p>
    </div>

    <div v-if="isLoading" class="thread-loading" aria-busy="true">
      <FunLoader variant="region" :label="isDirectThread ? 'Loading messages' : 'Loading conversation'" />
    </div>

    <div v-else-if="error" class="thread-state thread-state--error" role="alert">
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
      <div
        class="chat-stream"
        role="log"
        :aria-live="threadFindQuery.trim() ? 'off' : 'polite'"
        aria-relevant="additions"
        aria-label="Conversation messages"
      >
        <p v-if="!threadFindQuery.trim() && chatMessages.length <= 1" class="chat-empty">
          Private conversation — everyone mentioned can see these messages.
        </p>
        <p v-else-if="!threadFindQuery.trim() && chatMessages.length >= 40" class="chat-empty chat-empty--soft">
          Older messages may be truncated by your server’s context limit.
        </p>
        <p v-else-if="threadFindQuery.trim() && !visibleChatMessages.length" class="chat-empty">
          No messages match “{{ threadFindQuery.trim() }}”.
        </p>

        <template v-for="(status, index) in visibleChatMessages" :key="status.id">
          <div
            v-if="dayLabelFor(status, index)"
            class="chat-day-separator"
            role="separator"
            :aria-label="dayLabelFor(status, index) || undefined"
          >
            <span>{{ dayLabelFor(status, index) }}</span>
          </div>
          <MessageBubble
            :status="status"
            :mine="isMine(status)"
            :show-meta="showBubbleMeta(status, index)"
            :participant-accts="bubbleMentionAccts"
            @deleted="onMessageDeleted"
          />
        </template>
        <div ref="chatEndEl" class="chat-end" />
      </div>

      <ChatComposer
        v-if="canReply && replyTarget"
        :key="chatThreadKey"
        :in-reply-to-id="replyTarget.id"
        :recipient-accts="recipientAccts"
        placeholder="Message…"
        @posted="onReplyPosted"
        @focusin="onReplyFieldFocus"
      />
      <div v-else class="thread-signin-hint">
        <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in to reply</NuxtLink>
      </div>
    </template>

    <!-- Public thread view -->
    <template v-else>
      <div class="thread-stream">
        <RealPostCard
          v-for="status in visibleAncestors"
          :key="status.id"
          :status="status"
          hide-inline-reply
          class="thread-post thread-post--ancestor"
          @replied="onReplyPosted"
        />

        <div
          v-if="showFocusInSearch"
          ref="focusEl"
          class="thread-focus"
          tabindex="-1"
          aria-current="true"
        >
          <RealPostCard
            v-if="focusStatus"
            :status="focusStatus"
            hide-inline-reply
            class="thread-post thread-post--focus"
            @replied="onReplyPosted"
          />
        </div>

        <template v-for="node in visibleReplyTree" :key="node.status.id">
          <!-- Nesting is otherwise only visual (indent) -->
          <p v-if="node.depth > 0" class="sr-only">{{ replyContextLabel(node) }}</p>
          <RealPostCard
            :status="node.status"
            hide-inline-reply
            class="thread-post thread-post--reply"
            :class="{ 'thread-post--nested': node.depth > 0 }"
            :style="{ '--thread-depth': String(node.depth) }"
            @replied="onReplyPosted"
          />
        </template>

        <p
          v-if="threadFindQuery.trim() && !showFocusInSearch && !visibleAncestors.length && !visibleReplyTree.length"
          class="thread-lonely"
        >
          No posts match “{{ threadFindQuery.trim() }}”.
        </p>
        <p v-else-if="!threadFindQuery.trim() && !descendants.length && !ancestors.length" class="thread-lonely">
          No replies yet — be the first.
        </p>

        <div ref="chatEndEl" class="chat-end" aria-hidden="true" />
      </div>

      <!-- Threads-style: type in the bar above the keyboard (show disabled while resolving) -->
      <div
        v-if="focusStatus && canReply"
        class="thread-reply-dock"
        data-keyboard-fixed
        :class="{
          'thread-reply-dock--pending': replyResolving || !publicReplyId,
          'thread-reply-dock--keyboard': keyboardOpen,
        }"
        :style="replyDockStyle"
        :aria-busy="replyResolving || !publicReplyId || undefined"
        @focusin="onReplyFieldFocus"
      >
        <div class="thread-reply-dock__inner">
          <RealComposeBox
            :key="publicReplyId || focusStatus.id"
            compact
            :accept-handoff="false"
            :disabled="replyResolving || !publicReplyId"
            :in-reply-to-id="publicReplyId || focusStatus.id"
            :mention-accts="replyMentionAccts"
            :initial-visibility="focusStatus.visibility === 'direct' ? 'direct' : focusStatus.visibility"
            :placeholder="`Reply to @${focusStatus.account.acct}…`"
            title="Reply"
            @posted="onReplyPosted"
          />
        </div>
      </div>

      <div v-else-if="focusStatus && !canReply" class="thread-signin-hint">
        <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in to reply</NuxtLink>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.thread-search {
  margin: 0 0.5rem 0.5rem;
  padding: 0.45rem 0 0.55rem;
  background: var(--neo-bg-primary);
  border-bottom: 1px solid var(--neo-border-color);

  .thread-page--dm & {
    margin-left: 0.75rem;
    margin-right: 0.75rem;
  }

  &__field {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.35rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--neo-border-color);
    border-radius: var(--neo-radius-md, 12px);
    background: var(--neo-bg-tertiary);
    box-sizing: border-box;

    &:focus-within {
      border-color: color-mix(in srgb, var(--neo-accent) 50%, var(--neo-border-color));
      box-shadow: 0 0 0 3px var(--neo-accent-soft);
    }
  }

  &__icon {
    flex-shrink: 0;
    color: var(--neo-text-muted);
  }

  &__input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--neo-text-primary);
    font: inherit;
    font-size: 0.875rem;
    outline: none;

    &::placeholder {
      color: var(--neo-text-muted);
    }
  }

  &__status {
    margin: 0.35rem 0.15rem 0;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }
}

.thread-page {
  width: 100%;
  max-width: 40rem;
  min-width: 0;
  margin: 0 auto;
  padding: 0.5rem 0.5rem 1.5rem;
  box-sizing: border-box;

  &--can-reply {
    padding-bottom: calc(
      6.5rem + env(safe-area-inset-bottom, 0px) + var(--neo-keyboard-inset, 0px)
    );
  }

  &--signin-hint {
    padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
  }

  &--dm {
    max-width: 36rem;
    padding-left: 0;
    padding-right: 0;
    /* Room for ChatComposer + soft keyboard lift */
    padding-bottom: calc(
      6.5rem + env(safe-area-inset-bottom, 0px) + var(--neo-keyboard-inset, 0px)
    );
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

.chat-day-separator {
  align-self: center;
  margin: 0.85rem 0 0.45rem;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--neo-text-primary) 6%, transparent);
  font-size: 0.6875rem;
  color: var(--neo-text-tertiary);
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
  justify-content: center;
  width: 100%;
  min-height: min(55dvh, 26rem);
  padding: 1.25rem;
  box-sizing: border-box;
}

.chat-end {
  height: 1px;
  /* scrollIntoView({ block: 'end' }) would park the latest message under the
     fixed composer / reply dock — stop that far above the bottom instead */
  scroll-margin-bottom: calc(6.5rem + env(safe-area-inset-bottom, 0px) + var(--neo-keyboard-inset, 0px));
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

.thread-stream {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.thread-post--reply {
  margin-left: calc(var(--thread-depth, 0) * 0.85rem);

  /* 6 levels × 0.85rem ate a third of a 320px screen — narrower steps on phones */
  @media (max-width: 480px) {
    margin-left: calc(var(--thread-depth, 0) * 0.4rem);
  }
}

.thread-post--nested {
  padding-left: 0.5rem;
  border-left: 2px solid color-mix(in srgb, var(--neo-accent) 28%, var(--neo-border-color));
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
    left: var(--neo-sidebar-width, 248px);
  }
}

.thread-reply-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  padding: 0.55rem 0.75rem calc(0.65rem + env(safe-area-inset-bottom, 0px));
  background: color-mix(in srgb, var(--neo-bg-primary) 96%, transparent);
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);

  &--pending {
    opacity: 0.72;
    pointer-events: none;
  }

  &--keyboard {
    padding: 0.3rem 0.5rem 0.3rem;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;

    :deep(.compose-footer) {
      padding-top: 0.2rem;
      gap: 0.3rem;
    }

    :deep(.compose-language),
    :deep(.compose-media-count),
    :deep(.compose-visibility) {
      display: none;
    }

    :deep(.compose-input) {
      min-height: 2.35rem;
      max-height: 5rem;
    }

    /* Reclaim width — send lives in the field */
    :deep(.compose-avatar) {
      display: none;
    }

    :deep(.compose--compact.compose--expanded) {
      padding: 0.35rem 0.45rem 0.3rem;
    }
  }

  @media (min-width: 1024px) {
    left: var(--neo-sidebar-width, 248px);
    padding: 0.7rem 1rem 0.85rem;
  }

  &__inner {
    width: 100%;
    max-width: 40rem;
  }

  :deep(.compose--compact) {
    width: 100%;
  }

  :deep(.compose-input) {
    font-size: max(16px, 1rem);
  }

  :deep(.compose-send) {
    min-height: 44px;
    min-width: 44px;
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
