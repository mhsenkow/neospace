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
import { compareId } from '~/utils/compareId'
import { findThreadConversation, threadNeedsRefetch } from '~/utils/dmThread'
import { earlierPostMissing } from '~/utils/threadMerge'
import { createRaceGuard } from '~/composables/useRace'
import { CHAT_DRAFT_PREFIX } from '~/composables/useDraft'
import { onDeletedStatus } from '~/composables/useDeletedStatus'
import { dropDeletedStatus, matchesDeletedStatus, type DeletedStatusEvent } from '~/utils/deletedStatus'
import { mapErrorToMessage } from '~/utils/friendlyError'
import {
  activeClient,
  clearReadAccountOverride,
  setReadAccountOverride,
} from '~/composables/useMasto'
import { useKeyboardBottomInset } from '~/composables/useKeyboardViewport'
import { useMobileViewport } from '~/composables/useBreakpoint'
import { plainTextOf } from '~/utils/plainText'
import { useDebouncedValue } from '~/composables/useDebouncedValue'
import { getMainScroller, getPageScrollTop, scrollPageTo } from '~/utils/pageScroll'
type DmContextPane = 'chat' | 'profile'

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
/** Replies found by the quiet public-thread poll, held back until the reader asks for them */
const pendingThread = ref<{
  status: mastodon.v1.Status
  ancestors: mastodon.v1.Status[]
  descendants: mastodon.v1.Status[]
  newCount: number
} | null>(null)
const pollRace = createRaceGuard()
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

/** Honor OS + in-app reduced motion for JS-driven scrolling / pane flips */
const preferReducedMotion = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.classList.contains('reduce-motion'))

/** Chronological chat messages */
const chatMessages = computed(() => {
  if (!focusStatus.value) return [] as mastodon.v1.Status[]
  // The API returns descendants depth-first — branched DMs would render out of time order
  // (and `.at(-1)` wouldn't be the newest message). Snowflake ids sort chronologically.
  return [...ancestors.value, focusStatus.value, ...descendants.value].sort((a, b) =>
    compareId(a.id, b.id),
  )
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
  followersCount?: number | null
  statusesCount?: number | null
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
      followersCount: a.followersCount,
      statusesCount: a.statusesCount,
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

/** Mobile DM: Sniffies-style chat ↔ profile flip under the composer */
const isMobile = useMobileViewport()
const showDmContextChrome = computed(
  () => isDirectThread.value && isMobile.value && otherParticipants.value.length > 0,
)
const dmPane = ref<DmContextPane>('chat')
const peekAccountId = ref<string | null>(null)
const peekAccount = ref<mastodon.v1.Account | null>(null)
const peekLoading = ref(false)
const peekError = ref<string | null>(null)
const peekStatuses = ref<mastodon.v1.Status[]>([])
const peekStatusesLoading = ref(false)
const peekStatusesError = ref<string | null>(null)
const peekMaxId = ref<string | null>(null)
const peekHasMore = ref(true)
const peekRace = createRaceGuard()
const peekStatusesRace = createRaceGuard()
const chatBottomStackEl = ref<HTMLElement | null>(null)
const chatBottomH = ref(0)
let chatBottomRo: ResizeObserver | null = null
let savedChatScroll = 0

const peekSeed = computed((): ChatPerson | null => {
  const people = otherParticipants.value
  if (!people.length) return null
  return people.find((p) => p.id && p.id === peekAccountId.value) || people[0] || null
})

watch(
  otherParticipants,
  (people) => {
    if (!people.length) {
      peekAccountId.value = null
      return
    }
    if (!peekAccountId.value || !people.some((p) => p.id === peekAccountId.value)) {
      peekAccountId.value = people[0]?.id || null
    }
  },
  { immediate: true },
)

const resetPeekStatuses = () => {
  peekStatusesRace.next()
  peekStatuses.value = []
  peekMaxId.value = null
  peekHasMore.value = true
  peekStatusesError.value = null
  peekStatusesLoading.value = false
}

const loadPeekStatuses = async (refresh = false) => {
  const account = peekAccount.value
  if (!account || !instancesStore.isAuthenticated) return
  if (refresh) {
    peekStatuses.value = []
    peekMaxId.value = null
    peekHasMore.value = true
    peekStatusesError.value = null
  }
  if (!peekHasMore.value && !refresh) return
  const ticket = peekStatusesRace.next()
  peekStatusesLoading.value = true
  try {
    const client = activeClient()
    const page = await client.v1.accounts.$select(account.id).statuses.list({
      limit: 20,
      maxId: peekMaxId.value || undefined,
      excludeReplies: true,
    })
    if (!ticket.isCurrent()) return
    peekStatuses.value = refresh ? page : [...peekStatuses.value, ...page]
    if (page.length > 0) peekMaxId.value = page[page.length - 1]!.id
    peekHasMore.value = page.length === 20
  } catch (e: unknown) {
    if (!ticket.isCurrent()) return
    peekStatusesError.value = e instanceof Error ? e.message : 'Couldn’t load posts'
  } finally {
    if (ticket.isCurrent()) peekStatusesLoading.value = false
  }
}

const loadPeekAccount = async () => {
  const seed = peekSeed.value
  if (!seed?.acct || !instancesStore.isAuthenticated) {
    peekAccount.value = null
    peekError.value = null
    peekLoading.value = false
    resetPeekStatuses()
    return
  }
  const ticket = peekRace.next()
  peekLoading.value = true
  peekError.value = null
  resetPeekStatuses()
  try {
    const client = activeClient()
    let account: mastodon.v1.Account | null = null
    if (seed.id) {
      try {
        account = await client.v1.accounts.$select(seed.id).fetch()
      } catch {
        /* fall through to lookup */
      }
    }
    if (!account) {
      try {
        account = await client.v1.accounts.lookup({ acct: seed.acct.replace(/^@/, '') })
      } catch {
        const id = await statusStore.resolveAccount(seed.acct)
        if (id) account = await client.v1.accounts.$select(id).fetch()
      }
    }
    if (!ticket.isCurrent()) return
    peekAccount.value = account
    if (!account) {
      peekError.value = 'Couldn’t load profile'
      return
    }
    void loadPeekStatuses(true)
  } catch (e: unknown) {
    if (!ticket.isCurrent()) return
    peekError.value = e instanceof Error ? e.message : 'Couldn’t load profile'
    peekAccount.value = null
  } finally {
    if (ticket.isCurrent()) peekLoading.value = false
  }
}

watch(
  () =>
    [
      showDmContextChrome.value,
      peekSeed.value?.id || '',
      peekSeed.value?.acct || '',
    ] as const,
  ([show]) => {
    if (show) void loadPeekAccount()
    else {
      peekRace.next()
      peekAccount.value = null
      peekError.value = null
      peekLoading.value = false
      resetPeekStatuses()
    }
  },
  { immediate: true },
)

const selectPeekPerson = (id: string) => {
  if (!id || id === peekAccountId.value) return
  peekAccountId.value = id
}

const dmPaneAnimating = ref(false)
let dmPaneAnimTimer: ReturnType<typeof setTimeout> | null = null

const flashDmPaneMotion = () => {
  if (preferReducedMotion()) return
  dmPaneAnimating.value = false
  nextTick(() => {
    dmPaneAnimating.value = true
    if (dmPaneAnimTimer) clearTimeout(dmPaneAnimTimer)
    dmPaneAnimTimer = setTimeout(() => {
      dmPaneAnimating.value = false
    }, 200)
  })
}

const setDmPane = (pane: DmContextPane) => {
  if (pane === dmPane.value) return
  if (dmPane.value === 'chat' && pane === 'profile') {
    savedChatScroll = getPageScrollTop()
  }
  dmPane.value = pane
  flashDmPaneMotion()
  if (pane === 'chat') {
    nextTick(() => scrollPageTo(savedChatScroll, 'auto'))
  } else {
    nextTick(() => scrollPageTo(0, preferReducedMotion() ? 'auto' : 'smooth'))
  }
}

watch(chatBottomStackEl, (el) => {
  chatBottomRo?.disconnect()
  chatBottomRo = null
  if (!el || typeof ResizeObserver === 'undefined') {
    chatBottomH.value = 0
    return
  }
  const measure = () => {
    chatBottomH.value = Math.ceil(el.getBoundingClientRect().height)
  }
  measure()
  chatBottomRo = new ResizeObserver(measure)
  chatBottomRo.observe(el)
})

const recipientAccts = computed(() => otherParticipants.value.map((p) => p.acct).filter(Boolean))
/** Leading-mention stripping in bubbles: incoming DMs open with "@me" */
const bubbleMentionAccts = computed(() =>
  myAcct.value ? [...recipientAccts.value, myAcct.value] : recipientAccts.value,
)
/** Stable per conversation — re-keying on every new message wiped the draft and focus */
const chatThreadKey = computed(() => chatMessages.value[0]?.id || focusStatus.value?.id || '')

/** Same slot for the desktop and mobile composers, and across Chat ↔ Profile flips */
const chatDraftSlot = computed(() =>
  chatThreadKey.value ? `${CHAT_DRAFT_PREFIX}${chatThreadKey.value}` : undefined,
)

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
  const focus = focusStatus.value
  if (!focus) return []
  // Reply to the author (unless that's you) and keep everyone else the post mentions
  const seen = new Set<string>()
  const out: string[] = []
  for (const acct of [focus.account?.acct, ...(focus.mentions || []).map((m) => m.acct)]) {
    const key = (acct || '').toLowerCase()
    if (!key || key === myAcct.value || seen.has(key)) continue
    seen.add(key)
    out.push(acct as string)
  }
  return out
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

/** Stamp the last bubble of a run, or any bubble followed by a >5 minute gap */
const BUBBLE_TIME_GAP_MS = 5 * 60_000
const showBubbleTime = (status: mastodon.v1.Status, index: number) => {
  const next = visibleChatMessages.value[index + 1]
  if (!next) return true
  if (next.account.id !== status.account.id) return true
  const gap = new Date(next.createdAt).getTime() - new Date(status.createdAt).getTime()
  return !(gap >= 0 && gap <= BUBBLE_TIME_GAP_MS)
}

/** Same sender as the bubble above within the stamp gap, with no day separator between */
const bubbleJoinsPrev = (status: mastodon.v1.Status, index: number) => {
  const prev = visibleChatMessages.value[index - 1]
  if (!prev || prev.account.id !== status.account.id) return false
  if (dayLabelFor(status, index)) return false
  const gap = new Date(status.createdAt).getTime() - new Date(prev.createdAt).getTime()
  return gap >= 0 && gap <= BUBBLE_TIME_GAP_MS
}
const bubbleJoinsNext = (status: mastodon.v1.Status, index: number) => {
  const next = visibleChatMessages.value[index + 1]
  return !!next && bubbleJoinsPrev(next, index + 1)
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

/** The chain above the thread is cut off (deleted / blocked / never reached this server) */
const earlierMissing = computed(() =>
  isDirectThread.value || !focusStatus.value
    ? null
    : earlierPostMissing(focusStatus.value, ancestors.value),
)

/**
 * Replies the focus post's server counts but this server never received. Decision (NS-628): we do
 * not merge the origin server's public context — its ids can't be acted on from here (like, reply,
 * boost need this server's copy) — so the gap is named, with a way to read the full thread.
 */
const unseenReplyCount = computed(() => {
  const focus = focusStatus.value
  if (!focus || isDirectThread.value) return 0
  const loaded = descendants.value.filter((s) => s.inReplyToId === focus.id).length
  return Math.max(0, (focus.repliesCount || 0) - loaded)
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

/** Reader is at (or very near) the latest message — page scroller aware (mobile `main`) */
const isNearPageBottom = (slack = 200) => {
  if (typeof window === 'undefined') return true
  const main = getMainScroller()
  if (main) return main.scrollHeight - main.scrollTop - main.clientHeight <= slack
  const doc = document.documentElement
  return doc.scrollHeight - window.scrollY - window.innerHeight <= slack
}

let stopImageFollow: (() => void) | null = null

/**
 * Lazy bubble images have no intrinsic size, so as they load they push the newest
 * message under the composer. For a few seconds after landing at the end, re-pin on
 * each image load — but only while the reader is still at the bottom.
 */
const followImagesToEnd = () => {
  stopImageFollow?.()
  const root = document
  const onLoad = (e: Event) => {
    const t = e.target
    if (!(t instanceof HTMLImageElement) || !t.closest('.chat-stream')) return
    if (isNearPageBottom(400)) chatEndEl.value?.scrollIntoView({ block: 'end', behavior: 'auto' })
  }
  root.addEventListener('load', onLoad, true)
  const timer = window.setTimeout(() => stopImageFollow?.(), 4000)
  stopImageFollow = () => {
    root.removeEventListener('load', onLoad, true)
    window.clearTimeout(timer)
    stopImageFollow = null
  }
}

const scrollChatToEnd = async () => {
  await nextTick()
  chatEndEl.value?.scrollIntoView({
    block: 'end',
    behavior: preferReducedMotion() ? 'auto' : 'smooth',
  })
  if (typeof window !== 'undefined') followImagesToEnd()
}

/** A DM opened for an older message (e.g. from a notification): bring it into view and flash it */
const scrollToChatMessage = async (id: string) => {
  await nextTick()
  const el = document.querySelector<HTMLElement>(`.chat-stream [data-status-id="${CSS.escape(id)}"]`)
  if (!el) return false
  el.scrollIntoView({ block: 'center', behavior: preferReducedMotion() ? 'auto' : 'smooth' })
  el.classList.add('msg-target')
  window.setTimeout(() => el.classList.remove('msg-target'), 2200)
  return true
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
/** The find bar hides while *another* field has the keyboard up — never under its own focus */
const threadSearchFocused = ref(false)
const onThreadSearchFocus = () => {
  keyboardFollowsChat = false
}

// Android: when the keyboard opens, keep the latest message above the composer
watch(keyboardOpen, (open) => {
  if (!open) return
  // Typing while the profile pane is up → back to the conversation, at the latest message
  if (dmPane.value === 'profile') {
    dmPane.value = 'chat'
    void scrollChatToEnd()
    return
  }
  if (keyboardFollowsChat) void scrollChatToEnd()
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
    pendingThread.value = null
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
    pendingThread.value = null

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
        const lastId = thread.descendants.at(-1)?.id ?? thread.status.id
        const olderTarget = thread.status.id !== lastId && thread.descendants.length > 0
        if (!(olderTarget && (await scrollToChatMessage(thread.status.id)))) {
          await scrollChatToEnd()
        }
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

/** The focused post is gone (its context would 404) — move to what's left */
const leaveDeletedFocus = () => {
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

/** A message deleted from its bubble menu — drop it now instead of on the next poll */
const onMessageDeleted = (statusId: string) => {
  ancestors.value = ancestors.value.filter((s) => s.id !== statusId)
  descendants.value = descendants.value.filter((s) => s.id !== statusId)
  if (focusStatus.value?.id !== statusId) return
  leaveDeletedFocus()
}

/** Any post deleted elsewhere in the app (card menu on this thread, board, profile) */
const onPostDeleted = (event: DeletedStatusEvent) => {
  const focusGone = !!focusStatus.value && matchesDeletedStatus(focusStatus.value, event)
  ancestors.value = dropDeletedStatus(ancestors.value, event)
  descendants.value = dropDeletedStatus(descendants.value, event)
  if (focusGone) leaveDeletedFocus()
}
const stopDeletedListen = onDeletedStatus(onPostDeleted)
onBeforeUnmount(stopDeletedListen)

const goProfile = () => {
  const person = peekSeed.value || otherParticipant.value
  const acct = person?.acct
  if (!acct) return
  if (showDmContextChrome.value) {
    if (person?.id) peekAccountId.value = person.id
    setDmPane('profile')
    return
  }
  router.push({ path: '/profile', query: { user: acct } })
}


const stopThreadPoll = () => {
  if (threadPoll) {
    clearInterval(threadPoll)
    threadPoll = null
  }
}

/** Public threads: look for new replies quietly and offer a "N new replies" pill */
const POLL_PUBLIC_MS = 60_000
const pollPublicReplies = async () => {
  if (typeof document !== 'undefined' && document.hidden) return
  const id = resolvedThreadId
  if (!id || !focusStatus.value || isLoading.value || isRefreshing.value || isDirectThread.value) return
  const ticket = pollRace.next()
  try {
    const thread = await statusStore.fetchThread(id)
    if (!ticket.isCurrent() || isDirectThread.value) return
    const known = new Set(descendants.value.map((s) => s.id))
    const newCount = thread.descendants.filter((s) => !known.has(s.id)).length
    pendingThread.value = newCount > 0 ? { ...thread, newCount } : null
  } catch {
    /* quiet — the manual refresh button reports errors */
  }
}

/** Show the replies the poll found (keeps the reader where they are; pill clears) */
const showPendingReplies = () => {
  const pending = pendingThread.value
  if (!pending) return
  focusStatus.value = pending.status
  ancestors.value = pending.ancestors
  descendants.value = pending.descendants
  pendingThread.value = null
}

const startThreadPoll = () => {
  stopThreadPoll()
  if (!isDirectThread.value) {
    threadPoll = setInterval(() => void pollPublicReplies(), POLL_PUBLIC_MS)
    return
  }
  // The inbox poll (shell) already tracks the active account's DMs — the watcher below
  // refetches only when this conversation's last message changes. Another account's
  // thread (?account=) isn't in that inbox, so it keeps its own timer.
  if (!readsAsOtherAccount.value) return
  threadPoll = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    void loadThread({ quiet: true })
  }, 40_000)
}

const loadedStatusIds = computed(() => new Set(chatMessages.value.map((s) => s.id)))
const dmConversation = computed(() => {
  if (!isDirectThread.value || readsAsOtherAccount.value || !focusStatus.value) return null
  return findThreadConversation(conversationsStore.conversations, {
    statusIds: [...loadedStatusIds.value],
    accountIds: otherParticipants.value.map((p) => p.id).filter((id): id is string => !!id),
  })
})
watch(
  () => dmConversation.value?.lastStatus?.id,
  () => {
    if (isLoading.value || isRefreshing.value) return
    if (threadNeedsRefetch(dmConversation.value, loadedStatusIds.value)) {
      void loadThread({ quiet: true })
    }
  },
)

/** Catch a DM up as soon as the tab is visible again, instead of waiting out the 40s poll */
let lastVisibleCatchUp = 0
const onVisibilityChange = () => {
  if (document.hidden || !isDirectThread.value) return
  const now = Date.now()
  if (now - lastVisibleCatchUp < 5_000) return
  lastVisibleCatchUp = now
  void loadThread({ quiet: true })
}

onMounted(() => {
  void loadThread().then(() => startThreadPoll())
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopThreadPoll()
  stopImageFollow?.()
  loadRace.abort()
  pollRace.abort()
  peekRace.abort()
  peekStatusesRace.abort()
  chatBottomRo?.disconnect()
  chatBottomRo = null
  if (dmPaneAnimTimer) clearTimeout(dmPaneAnimTimer)
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
  dmPane.value = 'chat'
  void loadThread().then(() => startThreadPoll())
})

watch(isDirectThread, (dm) => {
  syncDmLiveRefresh(dm)
  startThreadPoll()
  if (!dm) dmPane.value = 'chat'
})

watch(showDmContextChrome, (show) => {
  if (!show) dmPane.value = 'chat'
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
      'thread-page--dm-context': showDmContextChrome,
      'thread-page--dm-profile': showDmContextChrome && dmPane === 'profile',
    }"
    :style="
      showDmContextChrome && chatBottomH
        ? { '--neo-chat-bottom-h': `${chatBottomH}px` }
        : undefined
    "
  >
    <!-- Chrome + search stick as one unit so tall DM headers / iPad safe-area
         don’t leave the find bar overlapping the person row. -->
    <div class="thread-top-stack">
      <!-- DM header: person, not “Open original” -->
      <SubviewChrome
        v-if="isDirectThread && focusStatus"
        class="thread-subview"
        back-fallback="/messages"
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
          <button
            v-if="focusStatus"
            type="button"
            class="subview-chrome__btn"
            aria-label="Refresh thread"
            :disabled="isRefreshing"
            @click="loadThread({ quiet: true })"
          >
            <FunLoader v-if="isRefreshing" variant="seed" :size="22" label="Refreshing" />
            <NeoIcon v-else name="refresh" :size="16" :stroke="2" />
          </button>
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
        v-if="focusStatus && !isLoading && !error && (!keyboardOpen || threadSearchFocused)"
        class="thread-search neo-sticky-bar neo-sticky-bar--under-chrome"
        @focusin="threadSearchFocused = true"
        @focusout="threadSearchFocused = false"
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
        id="dm-context-panel"
        class="dm-context-panel"
        :role="showDmContextChrome ? 'tabpanel' : undefined"
        :aria-labelledby="
          showDmContextChrome
            ? dmPane === 'chat'
              ? 'dm-context-tab-chat'
              : 'dm-context-tab-profile'
            : undefined
        "
      >
        <div
          v-show="!showDmContextChrome || dmPane === 'chat'"
          class="chat-stream"
          :class="{ 'dm-pane-enter': dmPaneAnimating && dmPane === 'chat' }"
          role="log"
          :aria-live="
            threadFindQuery.trim() || (showDmContextChrome && dmPane === 'profile')
              ? 'off'
              : 'polite'
          "
          aria-relevant="additions"
          aria-label="Conversation messages"
        >
          <p v-if="!threadFindQuery.trim() && chatMessages.length <= 1" class="chat-empty">
            Private conversation — everyone mentioned can see these messages.
          </p>
          <p
            v-else-if="!threadFindQuery.trim() && chatMessages.length >= 40"
            class="chat-empty chat-empty--soft"
          >
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
              :data-status-id="status.id"
              :show-meta="showBubbleMeta(status, index)"
              :show-time="showBubbleTime(status, index)"
              :join-prev="bubbleJoinsPrev(status, index)"
              :join-next="bubbleJoinsNext(status, index)"
              :participant-accts="bubbleMentionAccts"
              @deleted="onMessageDeleted"
            />
          </template>
          <div ref="chatEndEl" class="chat-end" />
        </div>

        <div
          v-show="showDmContextChrome && dmPane === 'profile'"
          class="dm-profile-peek"
          :class="{ 'dm-pane-enter': dmPaneAnimating && dmPane === 'profile' }"
          :aria-label="
            peekSeed
              ? `Profile of ${peekSeed.displayName || peekSeed.username || peekSeed.acct}`
              : 'Profile'
          "
        >
          <div
            v-if="otherParticipants.length > 1"
            class="dm-profile-peek__chips"
            role="group"
            aria-label="People in this conversation"
          >
            <button
              v-for="p in otherParticipants"
              :key="p.id || p.acct"
              type="button"
              class="dm-profile-peek__chip"
              :class="{ 'dm-profile-peek__chip--active': p.id === peekSeed?.id }"
              :aria-pressed="p.id === peekSeed?.id"
              :disabled="!p.id"
              @click="p.id && selectPeekPerson(p.id)"
            >
              <img
                v-if="p.avatar"
                :src="p.avatar"
                alt=""
                class="dm-profile-peek__chip-avatar"
              />
              <span
                v-else
                class="dm-profile-peek__chip-avatar dm-profile-peek__chip-avatar--placeholder"
                aria-hidden="true"
              >
                {{ (p.displayName || p.username || p.acct || '?').slice(0, 1).toUpperCase() }}
              </span>
              <span class="dm-profile-peek__chip-name">
                {{ p.displayName || p.username || p.acct }}
              </span>
            </button>
          </div>

          <div v-if="peekLoading && !peekAccount" class="thread-loading" aria-busy="true">
            <FunLoader variant="region" label="Loading profile" />
          </div>
          <template v-else-if="peekAccount">
            <ProfilePeekCard
              :account="peekAccount"
              hide-open
              full-bio
            />
            <div
              v-if="peekStatusesLoading && !peekStatuses.length"
              class="thread-loading"
              aria-busy="true"
            >
              <FunLoader variant="region" label="Loading posts" />
            </div>
            <div v-else-if="peekStatuses.length" class="dm-profile-peek__posts">
              <RealPostCard
                v-for="status in peekStatuses"
                :key="status.id"
                :status="status"
              />
              <button
                v-if="peekHasMore"
                type="button"
                class="neo-btn neo-btn--secondary dm-profile-peek__more"
                :disabled="peekStatusesLoading"
                @click="loadPeekStatuses(false)"
              >
                {{ peekStatusesLoading ? 'Loading…' : 'Load more' }}
              </button>
            </div>
            <p
              v-else-if="!peekStatusesLoading && !peekStatusesError"
              class="dm-profile-peek__error"
            >
              No posts yet.
            </p>
            <p v-if="peekStatusesError" class="dm-profile-peek__error" role="alert">
              {{ peekStatusesError }}
            </p>
          </template>
          <p v-else-if="peekError" class="dm-profile-peek__error" role="alert">
            {{ peekError }}
          </p>
          <p v-else class="dm-profile-peek__error">No profile to show.</p>
        </div>
      </div>

      <!-- Desktop / tablet: fixed composer (unchanged) -->
      <ChatComposer
        v-if="!showDmContextChrome && canReply && replyTarget"
        :key="chatThreadKey"
        :draft-slot="chatDraftSlot"
        :in-reply-to-id="replyTarget.id"
        :recipient-accts="recipientAccts"
        placeholder="Message…"
        @posted="onReplyPosted"
        @focusin="onReplyFieldFocus"
      />
      <div
        v-else-if="!showDmContextChrome && !canReply"
        class="thread-signin-hint"
      >
        <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in to reply</NuxtLink>
      </div>

      <!-- Mobile: composer + context sub-footer stack -->
      <div
        v-if="showDmContextChrome"
        ref="chatBottomStackEl"
        class="chat-bottom-stack"
        data-keyboard-fixed
        :style="replyDockStyle"
      >
        <ChatComposer
          v-if="dmPane === 'chat' && canReply && replyTarget"
          :key="chatThreadKey"
          :draft-slot="chatDraftSlot"
          embedded
          :in-reply-to-id="replyTarget.id"
          :recipient-accts="recipientAccts"
          placeholder="Message…"
          @posted="onReplyPosted"
          @focusin="onReplyFieldFocus"
        >
          <template #trailing>
            <DmContextFooter :pane="dmPane" @update:pane="setDmPane" />
          </template>
        </ChatComposer>
        <div
          v-else-if="dmPane === 'chat' && !canReply"
          class="thread-signin-hint thread-signin-hint--inline"
        >
          <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in to reply</NuxtLink>
          <DmContextFooter :pane="dmPane" @update:pane="setDmPane" />
        </div>
        <div v-else class="chat-bottom-stack__profile-bar">
          <DmContextFooter :pane="dmPane" @update:pane="setDmPane" />
        </div>
      </div>
    </template>

    <!-- Public thread view -->
    <template v-else>
      <div class="thread-stream">
        <button
          v-if="pendingThread"
          type="button"
          class="thread-new-pill"
          @click="showPendingReplies"
        >
          {{ pendingThread.newCount }} new {{ pendingThread.newCount === 1 ? 'reply' : 'replies' }}
        </button>
        <p v-if="earlierMissing && !threadFindQuery.trim()" class="thread-gap" role="note">
          Earlier post unavailable
          <template v-if="earlierMissing.url">
            ·
            <a :href="earlierMissing.url" target="_blank" rel="noopener noreferrer">Open original</a>
          </template>
        </p>
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
        <p v-else-if="!threadFindQuery.trim() && !descendants.length && !ancestors.length && !unseenReplyCount" class="thread-lonely">
          No replies yet — be the first.
        </p>
        <p v-if="unseenReplyCount && !threadFindQuery.trim()" class="thread-gap" role="note">
          {{ unseenReplyCount }} {{ unseenReplyCount === 1 ? 'reply isn’t' : 'replies aren’t' }} shown — hidden, blocked, or not on your server yet.
          <template v-if="originalUrl">
            <a :href="originalUrl" target="_blank" rel="noopener noreferrer">Read the full thread on the original server</a>
          </template>
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
.thread-top-stack {
  position: sticky;
  top: 0;
  z-index: var(--neo-z-shell-header, 40);
  background: var(--neo-bg-primary);

  /* Inner chrome is in-flow inside the sticky stack (variable DM header height) */
  :deep(.subview-chrome) {
    position: relative;
    top: auto;
    z-index: auto;
    margin-left: 0;
    margin-right: 0;
  }

  @media (min-width: 1024px) {
    margin: 0 -1.25rem;
    padding: 0 1.25rem;
    border-bottom: 1px solid var(--neo-border-color);

    :deep(.subview-chrome) {
      border-bottom: none;
    }
  }

  @media (min-width: 1200px) {
    margin: 0 -2rem;
    padding: 0 2rem;
  }
}

.thread-search {
  margin: 0 0.5rem 0.5rem;
  padding: 0.45rem 0 0.55rem;
  background: var(--neo-bg-primary);
  border-bottom: 1px solid var(--neo-border-color);

  .thread-page--dm & {
    margin-left: 0.75rem;
    margin-right: 0.75rem;
  }

  .thread-top-stack & {
    margin-bottom: 0;
    border-bottom: none;
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

  &--dm-context {
    /* Measured chat-bottom-stack (composer + sub-footer) */
    padding-bottom: calc(
      var(--neo-chat-bottom-h, 7.5rem) + 0.5rem + var(--neo-keyboard-inset, 0px)
    );
  }

  &--dm-profile {
    /* Profile pane: sub-footer only (no composer) */
    padding-bottom: calc(
      var(--neo-chat-bottom-h, 4.25rem) + 0.5rem + var(--neo-keyboard-inset, 0px)
    );
  }
}

.dm-context-panel {
  width: 100%;
  min-width: 0;
}

.chat-bottom-stack {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0 1rem calc(0.45rem + env(safe-area-inset-bottom, 0px));
  background: color-mix(in srgb, var(--neo-bg-primary) 96%, transparent);
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-sizing: border-box;

  html[data-keyboard-open] & {
    padding-bottom: 0.35rem;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  &__profile-bar {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    max-width: 36rem;
    width: 100%;
    margin: 0 auto;
    padding: 0.35rem 0.1rem 0.15rem;
    box-sizing: border-box;
  }
}

.dm-profile-peek {
  width: 100%;
  max-width: 36rem;
  margin: 0 auto;
  padding: 0.25rem 0.75rem 1rem;
  box-sizing: border-box;

  &__posts {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin: 0;
    padding: 0.35rem 0 0.5rem;
    width: 100%;
    box-sizing: border-box;

    :deep(.status-card) {
      width: 100%;
    }
  }

  &__more {
    width: 100%;
    justify-content: center;
    margin-top: 0.25rem;
  }

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0 0 0.65rem;
    padding: 0.15rem 0;
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    max-width: 100%;
    padding: 0.28rem 0.65rem 0.28rem 0.28rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 999px;
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-secondary);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;

    &--active {
      border-color: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-border-color));
      background: var(--neo-accent-soft);
      color: var(--neo-text-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--neo-focus, var(--neo-accent));
      outline-offset: 2px;
    }
  }

  &__chip-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--neo-bg-primary);

    &--placeholder {
      display: grid;
      place-items: center;
      font-size: 0.65rem;
      font-weight: 700;
      color: var(--neo-text-muted);
    }
  }

  &__chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__error {
    margin: 1rem 0.25rem;
    font-size: 0.875rem;
    color: var(--neo-text-muted);
  }
}

@media (prefers-reduced-motion: no-preference) {
  html:not(.reduce-motion) .dm-pane-enter {
    animation: dm-pane-in 180ms ease-out;
  }
}

@keyframes dm-pane-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.thread-subview {
  margin-bottom: 0;

  .thread-top-stack:not(:has(.thread-search)) & {
    margin-bottom: 0.35rem;
  }
}

.chat-header {
  &__person {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
    max-width: 100%;
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

  @media (min-width: 768px) and (max-width: 1023px) {
    /* iPad portrait: tighter person row so refresh/lock stay visible */
    &__avatar {
      width: 32px;
      height: 32px;
    }

    &__avatars {
      width: 32px;
      height: 32px;
    }

    &__name {
      font-size: 0.875rem;
    }
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

// Briefly flag the message a notification pointed at (bubble is a child component: :deep)
.chat-stream :deep(.msg-target) {
  outline: 2px solid var(--neo-accent);
  outline-offset: 3px;
  border-radius: var(--neo-radius-md, 8px);
  transition: outline-color 0.6s ease;
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

.thread-new-pill {
  position: sticky;
  top: calc(var(--neo-thread-top-h, 7rem) + 0.5rem);
  z-index: 5;
  align-self: center;
  margin: 0.5rem auto;
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-accent);
  color: var(--neo-text-on-accent);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px color-mix(in srgb, var(--neo-text-primary) 18%, transparent);
}

.thread-gap {
  margin: 0.6rem 0;
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  text-align: center;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);

  a {
    color: var(--neo-accent);
    font-weight: 600;
  }
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

  &--inline {
    position: relative;
    left: auto;
    right: auto;
    bottom: auto;
    z-index: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.55rem 0 0.35rem;
    border-top: none;
    background: transparent;
    backdrop-filter: none;
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
