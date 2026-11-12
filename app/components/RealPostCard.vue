<script lang="ts">
import { watch } from 'vue'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'

/** Shared across every card — one ResizeObserver instead of one per post. */
const contentSizeCallbacks = new WeakMap<Element, () => void>()
let contentSizeObserver: ResizeObserver | null = null

/** Returns false when ResizeObserver is unavailable (caller measures itself). */
function observeContentSize(el: Element, cb: () => void): boolean {
  if (typeof ResizeObserver === 'undefined') return false
  contentSizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) contentSizeCallbacks.get(entry.target)?.()
  })
  const known = contentSizeCallbacks.has(el)
  contentSizeCallbacks.set(el, cb)
  // Re-observing would queue a second initial measure — mount already got one
  if (!known) contentSizeObserver.observe(el)
  return true
}

function unobserveContentSize(el: Element) {
  contentSizeCallbacks.delete(el)
  contentSizeObserver?.unobserve(el)
}
</script>

<script setup lang="ts">
import type { mastodon } from 'masto'
import { authorizeInteractionUrl, hostOf } from '~/utils/federation'
import { lookupAcctFor } from '~/utils/edwardSemantics'
import { activeCredentials } from '~/composables/useMasto'
import { useStatusStore } from '~/stores/status'
import { supportsLegalReports } from '~/utils/serverCapabilities'
import { mediaIsHidden } from '~/utils/readingPrefs'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useColumnsStore } from '~/stores/columns'
import { useSettingsStore } from '~/stores/settings'
import { useComposeSheetStore, type ComposeContextPost } from '~/stores/composeSheet'
import { useToastStore } from '~/stores/toast'
import { useOverlayStore } from '~/stores/overlay'
import { sanitizeDisplayName, sanitizeStatusHtml } from '~/utils/sanitizeHtml'
import { stripHtml } from '~/utils/stripHtml'
import { emojiUrlSet, emojify } from '~/utils/emojify'
import { usePostActions } from '~/composables/usePostActions'
import { useRelationshipCache } from '~/composables/useRelationshipCache'
import { useMobileViewport } from '~/composables/useBreakpoint'
import {
  localBurstPoint,
  resolveFlipContentClick,
  useCardSwipeActions,
} from '~/composables/useCardSwipeActions'
import type { CollapsedReblogStatus } from '~/utils/statusIdentity'
import { provenOwnStatus, sameActingAccount, type ActingAccount } from '~/utils/statusOwnership'
import { buildDeletedStatusEvent, type DeletedStatusEvent } from '~/utils/deletedStatus'
import { emitDeletedStatus } from '~/composables/useDeletedStatus'
import { discardRedraftSnapshot, redraftSlot, saveRedraftSnapshot } from '~/utils/redraft'
import { draftSaveMessage } from '~/composables/useDraft'
import { httpStatusFrom } from '~/utils/friendlyError'
import { logError } from '~/utils/log'
import { mediaAttachmentLoupeMeta } from '~/utils/mediaLoupe'
import type { RankBreakdown } from '~/utils/rankers'
import {
  inspectStatusSignals,
  signalsToJsonSummary,
  type StatusSignals,
} from '~/utils/signalInspector'
import { hostnameOf } from '~/utils/instances'
import { formatCompactCount } from '~/utils/formatCount'
import { fetchStatusTranslation, languagesDiffer } from '~/utils/statusTranslate'

/** Reply couldn't import the post: say which server, and offer its own web page (does the import server-side) */
const replyHandOff = (uri: string) => {
  let home = ''
  try {
    home = activeCredentials().url
  } catch {
    /* guest */
  }
  const host = hostOf(home) || 'your server'
  return {
    message: `Couldn’t bring this post to ${host} to reply — it may be private, deleted, or blocked between servers.`,
    ...(home && uri
      ? { actionLabel: `Open on ${host}`, onAction: () => window.open(authorizeInteractionUrl(home, uri), '_blank', 'noopener') }
      : {}),
  }
}


interface Props {
  status: mastodon.v1.Status
  /** When true, skip per-card inline reply (thread page has sticky composer) */
  hideInlineReply?: boolean
  /** flow = list card, flip = full-bleed snap slide */
  variant?: 'flow' | 'flip'
  /**
   * Continuous avatar-column connector on the thread page.
   * `top` connects into this card, `bottom` continues below, `both` does both.
   */
  threadConnect?: 'none' | 'top' | 'bottom' | 'both'
  /** Thread focus post — show the whole body, no See more clamp */
  forceExpanded?: boolean
  /** Board column this card belongs to. Avatar taps peek in-column when the board has more than one column. */
  columnId?: string
}

const props = withDefaults(defineProps<Props>(), {
  hideInlineReply: false,
  variant: 'flow',
  threadConnect: 'none',
  forceExpanded: false,
})
const emit = defineEmits<{
  replied: [status: mastodon.v1.Status]
  /**
   * Own post deleted (plain delete or delete & redraft). Every mounted surface also gets
   * the same account-scoped event through `onDeletedStatus` — hosts rarely need this.
   */
  deleted: [event: DeletedStatusEvent]
}>()

const statusStore = useStatusStore()
const instancesStore = useInstancesStore()
const columnsStore = useColumnsStore()
const settingsStore = useSettingsStore()
const composeSheet = useComposeSheetStore()
const toastStore = useToastStore()
const overlayStore = useOverlayStore()
const router = useRouter()

/**
 * Multi-column boards peel this column into a profile peek (back restores the feed).
 * A single column, or a card with no column, still opens /profile.
 */
const openProfile = (acct: string | undefined | null, e?: Event) => {
  if (!acct) return
  if (e && typeof e.preventDefault === 'function') e.preventDefault()
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
  const handle = acct.replace(/^@/, '')
  if (props.columnId && columnsStore.isMultiColumn && instancesStore.hasAuthenticatedInstance) {
    columnsStore.peekProfileInColumn(props.columnId, handle)
    return
  }
  router.push({ path: '/profile', query: { user: handle } })
}

const onHeaderProfileClick = (acct: string, e: MouseEvent) => {
  openProfile(acct || authorAcct.value, e)
}

// reactive(): timelines hold statuses in a shallowRef, so wrap here (no-op for
// already-reactive objects) — optimistic like/boost/bookmark mutate in place.
const displayStatus = computed(
  () => reactive(props.status.reblog || props.status) as mastodon.v1.Status,
)

/** Full user@host for mute/block/report/reply — bare local handles from foreign servers must be qualified */
const authorAcct = computed(() => {
  const acct = displayStatus.value.account?.acct
  if (!acct) return ''
  const ext = props.status as ExtendedStatus
  let activeUrl = ''
  try {
    activeUrl = activeCredentials().url
  } catch {
    /* guest */
  }
  return lookupAcctFor(acct, displayStatus.value.account?.url, ext._instanceUrl || null, activeUrl)
})

const accountEmojis = computed(() => displayStatus.value.account?.emojis || [])
const statusEmojis = computed(() => displayStatus.value.emojis || [])
const nameEmojiUrls = computed(() => emojiUrlSet(accountEmojis.value))
const safeDisplayName = computed(() => {
  const raw = displayStatus.value.account.displayName || displayStatus.value.account.username || ''
  return sanitizeDisplayName(emojify(raw, accountEmojis.value), nameEmojiUrls.value)
})
const showTranslation = ref(false)
const translationHtml = ref<string | null>(null)
const translationSpoiler = ref<string | null>(null)
const translationFrom = ref('')
const quoteTranslationText = ref<string | null>(null)
const isTranslating = ref(false)
const safeContent = computed(() => {
  const html =
    showTranslation.value && translationHtml.value
      ? translationHtml.value
      : displayStatus.value.content || ''
  return emojify(sanitizeStatusHtml(html), statusEmojis.value, { escape: false })
})
const contentLang = computed(() =>
  showTranslation.value
    ? settingsStore.defaultLanguage || undefined
    : displayStatus.value.language || undefined,
)
const displaySpoiler = computed(() =>
  showTranslation.value && translationSpoiler.value
    ? translationSpoiler.value
    : displayStatus.value.spoilerText || '',
)
const linkCard = computed(() => {
  const card = displayStatus.value.card
  // Remote servers (non-Mastodon forks) can send any scheme — link http(s) only
  if (!card?.url || !/^https?:\/\//i.test(card.url)) return null
  // Skip link cards when the post already has media (Mastodon often duplicates)
  if (displayStatus.value.mediaAttachments?.length) return null
  return card
})
/** Full @user@host so impersonators can’t hide behind a display name alone */
const accountHandle = computed(() => {
  const acct = displayStatus.value.account?.acct || ''
  if (!acct) return ''
  if (acct.includes('@')) return `@${acct}`
  try {
    const host = new URL(displayStatus.value.account.url).hostname
    return host ? `@${acct}@${host}` : `@${acct}`
  } catch {
    return `@${acct}`
  }
})
// useId: the same post can render in several board columns at once
const cardLabelId = `status-author-${useId()}`
const isReblog = computed(() => !!props.status.reblog)
/** Set by ranked algorithm feeds (useRankedFeed) / Home For You */
const rankWhy = computed(() => (props.status as { _rankWhy?: string })._rankWhy || '')
const rankBreakdown = computed(
  () => (props.status as { _rankBreakdown?: RankBreakdown })._rankBreakdown || null,
)
const rankXrayOpen = ref(false)

const inspectOpen = ref(false)
const inspectCopied = ref('')
const statusSignals = computed((): StatusSignals => {
  let browsingHost: string | null = null
  try {
    browsingHost = hostnameOf(activeCredentials().url) || null
  } catch {
    browsingHost = null
  }
  const ext = props.status as ExtendedStatus
  if (!browsingHost && ext._instanceUrl) browsingHost = hostnameOf(ext._instanceUrl) || null
  return inspectStatusSignals(props.status, { browsingHost })
})
const toggleInspect = () => {
  inspectOpen.value = !inspectOpen.value
  isMenuOpen.value = false
}
const copyInspectJson = async () => {
  try {
    await navigator.clipboard.writeText(signalsToJsonSummary('status', statusSignals.value))
    inspectCopied.value = 'Copied'
  } catch {
    inspectCopied.value = 'Couldn’t copy'
  }
  window.setTimeout(() => {
    inspectCopied.value = ''
  }, 1600)
}

const reblogger = computed(() => (isReblog.value ? props.status.account : null))
const collapsedRebloggers = computed(
  () => (props.status as CollapsedReblogStatus)._collapsedRebloggers,
)
const reblogLabel = computed(() => {
  const group = collapsedRebloggers.value
  if (group && group.length > 1) {
    const first = group[0]!.displayName || group[0]!.username || 'Someone'
    const others = group.length - 1
    return others === 1 ? `${first} and 1 other reposted` : `${first} and ${others} others reposted`
  }
  const who = reblogger.value?.displayName || reblogger.value?.username
  return who ? `${who} reposted` : 'Reposted'
})
const isFlip = computed(() => props.variant === 'flip')
const isMobileUi = useMobileViewport()
const flipMedia = computed(() => {
  const media = displayStatus.value.mediaAttachments || []
  return media.find((m) => m.type === 'image' || m.type === 'gifv' || m.type === 'video') || null
})
const pollLayout = computed((): 'default' | 'flip' | 'flip-media' => {
  if (!isFlip.value) return 'default'
  return flipMedia.value ? 'flip-media' : 'flip'
})
const useHammockPeek = computed(() => isMobileUi.value || isFlip.value)
const flipAlign = computed(() => settingsStore.localPreferences.flipTextAlign || 'center')
const flipSize = computed(() => settingsStore.localPreferences.flipTextSize || 'large')

const isMenuOpen = ref(false)
const isMuting = ref(false)
const isBlocking = ref(false)
const isOpeningReply = ref(false)
const shareOpen = ref(false)
const boostOpen = ref(false)

const prefersReducedMotion = usePrefersReducedMotion()

/** Long-post collapse — overflow-based toggle (not char-count only) */
const contentExpanded = ref(props.forceExpanded)
const contentEl = ref<HTMLElement | null>(null)
const contentOverflows = ref(false)
/** CW / sensitive media revealed by the reader */
const mediaRevealed = ref(false)
const cwOpen = ref(false)

const hasSpoiler = computed(() => !!displayStatus.value.spoilerText?.trim())
const isSensitive = computed(() => !!displayStatus.value.sensitive)
/** Server reading prefs (always expand CWs, show / hide all media, autoplay GIFs) */
const readingPrefs = computed(() => settingsStore.readingPrefs)
const mediaHidden = computed(() =>
  mediaIsHidden({
    hasMedia: !!displayStatus.value.mediaAttachments?.length,
    hasSpoiler: hasSpoiler.value,
    isSensitive: isSensitive.value,
    cwOpen: cwOpen.value,
    mediaRevealed: mediaRevealed.value,
    expandMedia: readingPrefs.value.expandMedia,
  }),
)

/** Apply "always expand" server prefs (initially, after a post swap, and when prefs load late) */
const applyReadingPrefs = () => {
  if (readingPrefs.value.expandSpoilers && hasSpoiler.value) cwOpen.value = true
  if (readingPrefs.value.expandMedia === 'show_all') mediaRevealed.value = true
}
watch(
  () => [readingPrefs.value.expandSpoilers, readingPrefs.value.expandMedia] as const,
  applyReadingPrefs,
  { immediate: true },
)

const onCwToggle = (e: Event) => {
  cwOpen.value = (e.target as HTMLDetailsElement).open
  if (cwOpen.value) mediaRevealed.value = true
}

const revealMedia = () => {
  mediaRevealed.value = true
  cwOpen.value = true
}

watch(
  () => props.status.uri || props.status.id,
  () => {
    // (usePostActions drops its resolved id/client on its own)
    mediaRevealed.value = false
    cwOpen.value = false
    contentExpanded.value = props.forceExpanded
    contentOverflows.value = false
    showTranslation.value = false
    translationHtml.value = null
    translationSpoiler.value = null
    translationFrom.value = ''
    quoteTranslationText.value = null
    rankXrayOpen.value = false
    inspectOpen.value = false
    applyReadingPrefs()
  },
)

const measureContentOverflow = () => {
  const el = contentEl.value
  if (!el || props.forceExpanded) {
    contentOverflows.value = false
    return
  }
  const wasClamped = el.classList.contains('status-content--clamped')
  if (contentExpanded.value && !wasClamped) {
    el.classList.add('status-content--clamped')
    contentOverflows.value = el.scrollHeight > el.clientHeight + 2
    el.classList.remove('status-content--clamped')
  } else {
    contentOverflows.value = el.scrollHeight > el.clientHeight + 2
  }
}

const showSeeMore = computed(
  () => !props.forceExpanded && (contentOverflows.value || contentExpanded.value),
)

// One app-wide observer; its initial callback on observe() is the mount-time
// measure, and later callbacks cover width changes (viewport, column resize)
// and expand/collapse. Without ResizeObserver, fall back to a manual measure.
const observeContent = (el: HTMLElement) => {
  if (!observeContentSize(el, measureContentOverflow)) nextTick(measureContentOverflow)
}

onMounted(() => {
  if (contentEl.value) observeContent(contentEl.value)
})

watch(contentEl, (el, prev) => {
  if (prev) unobserveContentSize(prev)
  if (el) observeContent(el)
  else contentOverflows.value = false
})

// New HTML can change scrollHeight without resizing the clamped box
watch(safeContent, () => nextTick(measureContentOverflow))

onUnmounted(() => {
  if (contentEl.value) unobserveContentSize(contentEl.value)
})

const hasReplies = computed(() => (displayStatus.value.repliesCount || 0) > 0)
const showThreadLineTop = computed(
  () => props.threadConnect === 'top' || props.threadConnect === 'both',
)
const showThreadLineBottom = computed(
  () =>
    props.threadConnect === 'bottom' ||
    props.threadConnect === 'both' ||
    (props.threadConnect === 'none' && hasReplies.value),
)

const isOwnPost = computed(() => {
  const user = instancesStore.currentUser
  if (!instancesStore.isAuthenticated || !user) return false
  return displayStatus.value.account.id === user.id ||
    displayStatus.value.account.acct === user.acct
})

const { relationshipOf, ensure: ensureRelationship, follow: followAccount } = useRelationshipCache()
const authorId = computed(() => displayStatus.value.account?.id || null)
const authorRelationship = relationshipOf(authorId)
watch(
  authorId,
  (id) => {
    if (id && !isOwnPost.value && instancesStore.hasAuthenticatedInstance) ensureRelationship(id)
  },
  { immediate: true },
)
const showFollowBadge = computed(() => {
  if (isRssItem.value) return false
  if (!instancesStore.hasAuthenticatedInstance || isOwnPost.value || isFlip.value) return false
  const rel = authorRelationship.value
  if (!rel) return true
  return !rel.following && !rel.requested && !rel.blocking && !rel.blockedBy
})
const followBadgeBusy = ref(false)
const followBadgeFlash = ref(false)
const onFollowBadge = async (e: Event) => {
  e.preventDefault()
  e.stopPropagation()
  const id = displayStatus.value.account?.id
  if (!id || !requireAuth() || followBadgeBusy.value) return
  followBadgeBusy.value = true
  try {
    await followAccount(id)
    followBadgeFlash.value = true
    if (typeof navigator !== 'undefined') navigator.vibrate?.(10)
    window.setTimeout(() => {
      followBadgeFlash.value = false
    }, 1100)
  } catch {
    toastStore.show({ message: 'Couldn’t follow that account', duration: 3500 })
  } finally {
    followBadgeBusy.value = false
  }
}

/** Double-tap / dblclick heart burst over media or body */
const heartBurst = ref(false)
const heartBurstPos = ref<{ x: number; y: number } | null>(null)
const cardEl = ref<HTMLElement | null>(null)
let heartBurstTimer: ReturnType<typeof setTimeout> | null = null
let lastTapAt = 0
let lastTapX = 0
let lastTapY = 0

const triggerHeartBurst = (clientX?: number, clientY?: number) => {
  const card = cardEl.value
  if (card && clientX != null && clientY != null) {
    heartBurstPos.value = localBurstPoint(clientX, clientY, card.getBoundingClientRect())
  } else {
    heartBurstPos.value = null
  }
  heartBurst.value = true
  if (heartBurstTimer) clearTimeout(heartBurstTimer)
  heartBurstTimer = setTimeout(() => {
    heartBurst.value = false
    heartBurstPos.value = null
    heartBurstTimer = null
  }, 780)
}

const likeFromDoubleTap = async (clientX?: number, clientY?: number) => {
  triggerHeartBurst(clientX, clientY)
  if (typeof navigator !== 'undefined') navigator.vibrate?.(12)
  // Already liked: replay animation only (Threads/IG — never accidental unlike)
  if (displayStatus.value.favourited) return
  await handleFavourite()
}

const onDoubleTapLike = (e: MouseEvent | TouchEvent) => {
  // Ignore interactive children
  const target = e.target as HTMLElement | null
  if (target?.closest('a, button, input, textarea, summary, video, audio, [role="button"]')) return

  if (e instanceof MouseEvent && e.type === 'dblclick') {
    e.preventDefault()
    e.stopPropagation()
    void likeFromDoubleTap(e.clientX, e.clientY)
    return
  }

  if (!(e instanceof TouchEvent) || e.touches.length > 1) return
  const touch = e.changedTouches[0]
  if (!touch) return
  const now = Date.now()
  const dx = Math.abs(touch.clientX - lastTapX)
  const dy = Math.abs(touch.clientY - lastTapY)
  if (now - lastTapAt < 320 && dx < 36 && dy < 36) {
    e.preventDefault()
    e.stopPropagation()
    lastTapAt = 0
    void likeFromDoubleTap(touch.clientX, touch.clientY)
    return
  }
  lastTapAt = now
  lastTapX = touch.clientX
  lastTapY = touch.clientY
}

const heartBurstStyle = computed(() => {
  const pos = heartBurstPos.value
  if (!pos) return undefined
  // Margin centers without fighting the burst keyframes' transform
  return {
    left: `${pos.x}px`,
    top: `${pos.y}px`,
    right: 'auto',
    bottom: 'auto',
    marginLeft: '-36px',
    marginTop: '-36px',
  } as Record<string, string>
})

onUnmounted(() => {
  if (heartBurstTimer) clearTimeout(heartBurstTimer)
})

/** Incoming quote — native object or trailing status URL in content */
type QuotePreview = {
  id?: string
  name: string
  handle: string
  avatar?: string | null
  text: string
  url?: string | null
}
const quotedStatus = computed((): QuotePreview | null => {
  const s = displayStatus.value as mastodon.v1.Status & {
    quote?: mastodon.v1.Status | null
    quotedStatus?: mastodon.v1.Status | null
  }
  const q = s.quote || s.quotedStatus
  if (q?.account) {
    const plain =
      showTranslation.value && quoteTranslationText.value
        ? stripHtml(quoteTranslationText.value)
        : stripHtml(q.content || '')
    return {
      id: q.id,
      name: q.account.displayName || q.account.username,
      handle: q.account.acct,
      avatar: q.account.avatar,
      text: plain.slice(0, 280),
      url: q.url || q.uri,
    }
  }
  return null
})

const engagementSummary = computed(() => {
  const replies = displayStatus.value.repliesCount || 0
  const likes = displayStatus.value.favouritesCount || 0
  const parts: string[] = []
  if (replies > 0) parts.push(`${formatNumber(replies)} ${replies === 1 ? 'reply' : 'replies'}`)
  if (likes > 0) parts.push(`${formatNumber(likes)} ${likes === 1 ? 'like' : 'likes'}`)
  return parts.join(' · ')
})

const mediaList = computed(() => displayStatus.value.mediaAttachments || [])
const useMediaCarousel = computed(() => mediaList.value.length >= 2)

/** The signed-in account actions are bound to — captured before any await, revalidated after. */
const actingAccount = (): ActingAccount | null => {
  const account = instancesStore.activeAccount
  if (!instancesStore.isAuthenticated || !account?.user) return null
  return { id: account.id, url: account.url, userId: account.user.id }
}

/**
 * Own post with proven provenance: the author is the acting account AND the post carries
 * an origin tag matching the acting account's server. Untagged posts and same-id authors
 * on other servers never get delete / pin (their ids mean something else here).
 */
const canManageOwn = computed(() =>
  provenOwnStatus(displayStatus.value, props.status as ExtendedStatus, actingAccount()),
)

/** Mastodon only pins public / unlisted posts; reblog rows can't be pinned */
const canPin = computed(
  () =>
    canManageOwn.value &&
    !props.status.reblog &&
    (displayStatus.value.visibility === 'public' || displayStatus.value.visibility === 'unlisted'),
)

const statusUrl = computed(() => displayStatus.value.url || displayStatus.value.uri)

const threadTo = computed(() => {
  const id = displayStatus.value.id
  if (!id) return null
  return {
    path: `/status/${id}`,
    query: statusUrl.value ? { url: statusUrl.value } : undefined,
  }
})

const isRssItem = computed(
  () => !!(displayStatus.value as ExtendedStatus & { _isRss?: boolean })._isRss,
)

const canInteract = computed(
  () => instancesStore.hasAuthenticatedInstance && !isRssItem.value,
)

/** In-app profile (posts + header); API client is from auth store */
const accountProfileTo = computed(() => {
  if (!instancesStore.isAuthenticated) return null
  const acct = displayStatus.value.account?.acct
  if (!acct) return null
  return { path: '/profile', query: { user: acct } }
})

const rebloggerProfileTo = computed(() => {
  if (!instancesStore.isAuthenticated || !reblogger.value?.acct) return null
  return { path: '/profile', query: { user: reblogger.value.acct } }
})

const formatNumber = formatCompactCount

const requireAuth = () => {
  if (canInteract.value) return true
  router.push('/login')
  return false
}

const {
  isFavouriting,
  isBoosting,
  isBookmarking,
  likePop,
  boostPop,
  bookmarkPop,
  handleFavourite,
  toggleBoost,
  handleBookmark: bookmarkAction,
  getActionContext,
  prewarm,
} = usePostActions({
  displayStatus,
  statusUrl,
  requireAuth,
  // Reblog unwrap drops provenance — keep the timeline row's origin for likes/boosts.
  sourceInstanceUrl: computed(
    () => (props.status as ExtendedStatus)._instanceUrl || null,
  ),
})

const swipeEnabled = computed(() => isMobileUi.value && !isFlip.value)
const {
  offset: swipeOffset,
  intent: swipeIntent,
  dragging: swipeDragging,
  bind: bindCardSwipe,
} = useCardSwipeActions({
  enabled: swipeEnabled,
  onLike: () => {
    void handleFavourite()
  },
  onReply: () => {
    openThreadPeek(true)
  },
})

watch(
  cardEl,
  (el) => {
    bindCardSwipe(el)
  },
  { immediate: true },
)

const cardSwipeStyle = computed(() => {
  if (!swipeDragging.value && swipeOffset.value === 0) return undefined
  const reduced = prefersReducedMotion.value
  return {
    transform: `translate3d(${swipeOffset.value}px, 0, 0)`,
    transition: swipeDragging.value || reduced ? 'none' : 'transform 220ms var(--neo-ease-out, ease-out)',
  } as Record<string, string>
})

const handleBoost = async () => {
  if (!canInteract.value) {
    router.push('/login')
    return
  }
  if (displayStatus.value.reblogged) {
    await toggleBoost(false)
    return
  }
  boostOpen.value = true
}

const contextFromStatus = (): ComposeContextPost => {
  const s = displayStatus.value
  return {
    id: s.id,
    name: s.account.displayName || s.account.username,
    handle: s.account.acct,
    avatar: s.account.avatar,
    text: stripHtml(s.content).slice(0, 280),
    url: statusUrl.value,
  }
}

const openReplyComposer = async () => {
  if (!requireAuth() || isOpeningReply.value) return
  isOpeningReply.value = true
  try {
    // Replies always post via the active account — resolve a local id first.
    // (Likes/boosts may use another linked account's client; create cannot.)
    const ext = displayStatus.value as ExtendedStatus
    const replyId = await statusStore.resolveReplyId({
      id: displayStatus.value.id,
      url: statusUrl.value,
      uri: displayStatus.value.uri,
      sourceInstanceUrl: ext._instanceUrl || null,
    })
    if (!replyId) {
      toastStore.show({
        ...replyHandOff(displayStatus.value.uri || statusUrl.value || ''),
        duration: 7000,
      })
      return
    }
    const handle = authorAcct.value || displayStatus.value.account.acct
    const isDm = displayStatus.value.visibility === 'direct'
    // Threads-style New thread modal with parent context (dock remains on the thread page)
    composeSheet.show({
      title: isDm ? 'Message' : 'New thread',
      placeholder: isDm ? `Message @${handle}…` : 'Share your thoughts…',
      // DMs keep the visible @; public replies mention on send (Threads-style empty field)
      initialText: isDm ? `@${handle} ` : '',
      mentionAccts: isDm ? undefined : [handle],
      inReplyToId: replyId,
      // Inherit parent visibility so replies to private posts don't go public
      visibility: isDm ? 'direct' : displayStatus.value.visibility,
      contextPost: contextFromStatus(),
      onPosted: (created) => {
        displayStatus.value.repliesCount = (displayStatus.value.repliesCount || 0) + 1
        emit('replied', created)
        toastStore.show({
          message: 'Reply posted',
          actionLabel: 'View',
          onAction: () => openThread(),
          duration: 3500,
        })
      },
    })
  } finally {
    isOpeningReply.value = false
  }
}

const openQuoteComposer = async () => {
  if (!requireAuth()) return
  const url = statusUrl.value
  if (!url) return
  // Same as replies: multi-account / remote ids 404 on create unless resolved
  // on the active posting account. URL-only quotes still work without an id.
  const ext = displayStatus.value as ExtendedStatus
  const quoteId = await statusStore.resolveReplyId({
    id: displayStatus.value.id,
    url,
    sourceInstanceUrl: ext._instanceUrl || null,
  })
  const contextPost = contextFromStatus()
  contextPost.id = quoteId || undefined
  composeSheet.show({
    title: 'Quote',
    placeholder: 'Add a comment…',
    initialText: '',
    quoteUrl: url,
    contextPost,
  })
}

const openThreadPeek = (focusInput = true) => {
  if (!requireAuth()) return
  overlayStore.openThreadPeek({
    status: displayStatus.value,
    focusInput,
    onReplied: (created) => {
      displayStatus.value.repliesCount = (displayStatus.value.repliesCount || 0) + 1
      emit('replied', created)
    },
  })
}

const handleReply = () => {
  if (useHammockPeek.value) {
    openThreadPeek(true)
    return
  }
  void openReplyComposer()
}

const copyLink = async () => {
  const url = statusUrl.value
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    toastStore.show({ message: 'Link copied', duration: 2000 })
  } catch {
    prompt('Copy this link:', url)
  }
}

const shareSheetMounted = ref(false)

const handleShare = async () => {
  if (!shareSheetMounted.value) {
    shareSheetMounted.value = true
    await nextTick()
  }
  shareOpen.value = true
}

const onShareSelect = async (id: string) => {
  shareOpen.value = false
  if (id === 'copy') {
    await copyLink()
    return
  }
  if (id === 'system') {
    const url = statusUrl.value
    if (!url || !navigator.share) return
    try {
      await navigator.share({
        text: stripHtml(displayStatus.value.content).slice(0, 200),
        url,
      })
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== 'AbortError') await copyLink()
    }
    return
  }
  if (id === 'quote') {
    void openQuoteComposer()
    return
  }
  if (id === 'original' && statusUrl.value) {
    window.open(statusUrl.value, '_blank', 'noopener,noreferrer')
  }
}

const onBoostSelect = (id: string) => {
  boostOpen.value = false
  if (id === 'repost') void toggleBoost(true)
  if (id === 'quote') void openQuoteComposer()
}

const shareActions = computed(() => {
  const items: { id: string; label: string; hint?: string }[] = [
    { id: 'copy', label: 'Copy link', hint: 'Share the original post URL' },
  ]
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    items.push({ id: 'system', label: 'Share via…', hint: 'Messages, apps, and more' })
  }
  if (canInteract.value) {
    items.push({ id: 'quote', label: 'Quote', hint: 'Post with your comment' })
  }
  if (statusUrl.value) {
    items.push({ id: 'original', label: 'Open original', hint: 'View on the author’s server' })
  }
  return items
})

const boostActions = computed(() => [
  { id: 'repost', label: 'Repost', hint: 'Share to your followers' },
  { id: 'quote', label: 'Quote', hint: 'Add your own comment' },
])

// ========================================
// Menu
// ========================================

const handleBookmark = () => bookmarkAction(isMenuOpen)

const handleMute = async () => {
  if (!canInteract.value || isMuting.value) return
  const acct = authorAcct.value
  if (!acct) return

  const confirmed = await overlayStore.openConfirm({
    title: `Mute @${acct}?`,
    body: "You won't see their posts in your timelines.",
    confirmLabel: 'Mute',
    danger: true,
  })
  if (!confirmed) return

  isMuting.value = true
  try {
    // Prefer local id when the post was fetched from the active server; else resolve the qualified acct
    const ext = props.status as ExtendedStatus
    let activeUrl = ''
    try {
      activeUrl = activeCredentials().url
    } catch {
      /* guest */
    }
    const fromActive =
      !!ext._instanceUrl && hostOf(ext._instanceUrl) === hostOf(activeUrl)
    await statusStore.muteAccount(
      displayStatus.value.account.id,
      fromActive ? undefined : { acct },
    )
  } catch (e) {
    logError('Mute error:', e)
    toastStore.show({ message: 'Couldn’t mute that account. Try again from your home server.' })
  } finally {
    isMuting.value = false
    isMenuOpen.value = false
  }
}

const handleBlock = async () => {
  if (!canInteract.value || isBlocking.value) return
  const acct = authorAcct.value
  if (!acct) return

  const confirmed = await overlayStore.openConfirm({
    title: `Block @${acct}?`,
    body: "They won't be able to see your posts or interact with you.",
    confirmLabel: 'Block',
    danger: true,
  })
  if (!confirmed) return

  isBlocking.value = true
  try {
    const ext = props.status as ExtendedStatus
    let activeUrl = ''
    try {
      activeUrl = activeCredentials().url
    } catch {
      /* guest */
    }
    const fromActive =
      !!ext._instanceUrl && hostOf(ext._instanceUrl) === hostOf(activeUrl)
    await statusStore.blockAccount(
      displayStatus.value.account.id,
      fromActive ? undefined : { acct },
    )
  } catch (e) {
    logError('Block error:', e)
    toastStore.show({ message: 'Couldn’t block that account. Try again from your home server.' })
  } finally {
    isBlocking.value = false
    isMenuOpen.value = false
  }
}

/** The post's account lives on the acting server already (no remote lookup needed) */
const reportFromActive = () => {
  const ext = props.status as ExtendedStatus
  let activeUrl = ''
  try {
    activeUrl = activeCredentials().url
  } catch {
    /* guest */
  }
  return !!ext._instanceUrl && hostOf(ext._instanceUrl) === hostOf(activeUrl)
}

const handleReport = async () => {
  if (!canInteract.value) return
  const acct = authorAcct.value
  if (!acct) return

  const reportedAccountId = displayStatus.value.account.id
  const payload = await overlayStore.openReport({
    accountAcct: acct,
    allowLegal: supportsLegalReports(instancesStore.serverCapabilities),
    // Same resolution as the report itself: a remote author's posts by their id on our server
    loadPosts: () =>
      statusStore.listReportablePosts(reportedAccountId, {
        acct: reportFromActive() ? undefined : acct,
      }),
    perform: async (report) => {
      const ctx = await getActionContext()
      const fromActive = reportFromActive()
      await statusStore.reportStatus(
        ctx?.id || displayStatus.value.id,
        displayStatus.value.account.id,
        report.comment || undefined,
        {
          statusUrl: statusUrl.value || undefined,
          acct: fromActive ? undefined : acct,
          category: report.category,
          forward: report.forward,
          extraStatusIds: report.extraStatusIds,
        },
      )
    },
  })
  isMenuOpen.value = false
  if (!payload) return
  toastStore.show({ message: 'Report submitted. Thank you for helping keep the community safe.' })
}

// ── Own-post management ──
const removed = ref(false)
const isDeleting = ref(false)
const isPinning = ref(false)

/** What a management action was confirmed against — checked again after every await. */
interface ManageTarget {
  account: ActingAccount
  statusId: string
  uri: string | null
  url: string | null
}

const captureManageTarget = (): ManageTarget | null => {
  const account = actingAccount()
  if (!account || !canManageOwn.value) return null
  const s = displayStatus.value
  return { account, statusId: s.id, uri: s.uri || null, url: s.url || null }
}

/** Same account, same post, still provably ours — false after an account switch mid-flow */
const stillManageable = (target: ManageTarget) =>
  sameActingAccount(target.account, actingAccount()) &&
  canManageOwn.value &&
  displayStatus.value.id === target.statusId

const accountChangedToast = (what: string) =>
  toastStore.show({ message: `Your account changed — ${what}.` })

/** Drop the card and tell every other mounted surface (board, profile, thread) */
const announceDeleted = (target: ManageTarget) => {
  removed.value = true
  const event = buildDeletedStatusEvent(
    { id: target.statusId, uri: target.uri, url: target.url },
    target.account,
  )
  emit('deleted', event)
  emitDeletedStatus(event)
}

const handleDelete = async () => {
  if (isDeleting.value) return
  const target = captureManageTarget()
  if (!target) return
  isMenuOpen.value = false
  const ok = await overlayStore.openConfirm({
    title: 'Delete this post?',
    body: 'It will be removed from your profile and timelines. This can’t be undone.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  if (!stillManageable(target)) {
    accountChangedToast('nothing was deleted')
    return
  }
  isDeleting.value = true
  try {
    await statusStore.deleteStatus(target.statusId, target.account.id)
    announceDeleted(target)
    toastStore.show({ message: 'Post deleted', duration: 2500 })
  } catch (e) {
    toastStore.show({ message: e instanceof Error ? e.message : 'Couldn’t delete post' })
  } finally {
    isDeleting.value = false
  }
}

/** Edit in place — keeps replies, media, and the original post id */
const handleEdit = async () => {
  if (isDeleting.value) return
  const target = captureManageTarget()
  if (!target) return
  isMenuOpen.value = false
  if (!sameActingAccount(target.account, actingAccount())) {
    toastStore.show({
      message: 'Switch to the account that posted this to edit it.',
      duration: 4000,
    })
    return
  }
  const source = await statusStore.fetchStatusSource(target.statusId, target.account.id)
  if (!source.ok) {
    toastStore.show({
      message:
        source.reason === 'unsupported'
          ? 'This server doesn’t support editing posts.'
          : source.reason === 'auth'
            ? 'Couldn’t read your post — sign in again.'
            : 'Couldn’t open this post for editing.',
      duration: 4000,
    })
    return
  }
  const s = displayStatus.value
  composeSheet.show({
    title: 'Edit post',
    initialText: source.text,
    spoilerText: source.spoilerText || s.spoilerText || '',
    visibility: s.visibility,
    editStatusId: target.statusId,
    editSensitive: !!s.sensitive,
    editAttachments: (s.mediaAttachments || [])
      .filter((media) => media.type === 'image' || media.type === 'gifv' || media.type === 'video')
      .map((media) => ({
        id: media.id,
        previewUrl: media.previewUrl || media.url || null,
        description: media.description || '',
      })),
    onPosted: (updated) => {
      // Patch the card immediately; feeds also hear emitComposedStatus from the sheet
      Object.assign(displayStatus.value, updated)
    },
  })
}

/** Delete, then reopen the text (and CW / visibility / reply target) in the composer */
const handleRedraft = async () => {
  if (isDeleting.value) return
  const target = captureManageTarget()
  if (!target) return
  isMenuOpen.value = false
  const s = displayStatus.value
  const lost = [s.mediaAttachments?.length ? 'attached media' : '', s.poll ? 'the poll' : '']
    .filter(Boolean)
    .join(' and ')
  const ok = await overlayStore.openConfirm({
    title: 'Delete and redraft?',
    body: `The post is deleted and its text reopens in the composer.${lost ? ` Replies and ${lost} won’t carry over.` : ' Replies won’t carry over.'}`,
    confirmLabel: 'Delete & redraft',
    danger: true,
  })
  if (!ok) return
  if (!stillManageable(target)) {
    accountChangedToast('nothing was deleted')
    return
  }
  isDeleting.value = true
  const accountId = target.account.id
  try {
    // 1. Read the source as the captured account. Only "this server has no source API"
    //    may fall back to the rendered HTML — offline / auth / unknown mean we never read
    //    the post, so nothing is deleted and the original stays put.
    const source = await statusStore.fetchStatusSource(target.statusId, accountId)
    if (!source.ok && source.reason !== 'unsupported') {
      toastStore.show({
        message:
          source.reason === 'auth'
            ? 'Couldn’t read your post — sign in again. It was not deleted.'
            : source.reason === 'network'
              ? 'Couldn’t reach your server. Your post was not deleted.'
              : 'Couldn’t read your post, so it was not deleted.',
        ...(source.reason === 'auth'
          ? {}
          : { actionLabel: 'Retry', onAction: () => void handleRedraft() }),
      })
      return
    }
    if (!stillManageable(target)) {
      accountChangedToast('nothing was deleted')
      return
    }

    const snapshot = {
      text: source.ok ? source.text : stripHtml(s.content),
      spoilerText: source.ok ? source.spoilerText : s.spoilerText ?? '',
      visibility: s.visibility,
    }
    // 2. Save a recoverable copy BEFORE the destructive call; no copy, no delete.
    const saved = saveRedraftSnapshot(accountId, target.statusId, snapshot)
    if (!saved.ok) {
      toastStore.show({ message: `${draftSaveMessage(saved.reason)} The post was not deleted.`, duration: 6000 })
      return
    }

    // 3. Delete as the same captured account.
    let deleted: { text: string | null; spoilerText: string | null }
    try {
      deleted = await statusStore.deleteStatus(target.statusId, accountId)
    } catch (e) {
      // A server answer means the post still exists — drop the copy. No answer (network)
      // is ambiguous, so the snapshot stays recoverable.
      if (httpStatusFrom(e) != null) discardRedraftSnapshot(accountId, target.statusId)
      throw e
    }
    announceDeleted(target)

    // The server's copy of the text is closest to what was posted when /source was unavailable
    if (!source.ok && (deleted.text || deleted.spoilerText)) {
      snapshot.text = deleted.text ?? snapshot.text
      snapshot.spoilerText = deleted.spoilerText ?? snapshot.spoilerText
      saveRedraftSnapshot(accountId, target.statusId, snapshot)
    }

    // 4. The composer posts as whoever is active — only open it for the captured account.
    //    The snapshot stays in Drafts until it is posted or discarded.
    if (!sameActingAccount(target.account, actingAccount())) {
      toastStore.show({
        message: 'Post deleted. Switch back to that account to finish your redraft — it’s saved in Drafts.',
        duration: 6000,
      })
      return
    }
    composeSheet.show({
      title: 'Redraft',
      initialText: snapshot.text,
      spoilerText: snapshot.spoilerText,
      visibility: s.visibility,
      inReplyToId: s.inReplyToId || null,
      draftSlot: redraftSlot(target.statusId),
    })
  } catch (e) {
    toastStore.show({ message: e instanceof Error ? e.message : 'Couldn’t delete post' })
  } finally {
    isDeleting.value = false
  }
}

const handleTogglePin = async () => {
  if (isPinning.value) return
  const target = captureManageTarget()
  if (!target || !canPin.value) return
  isPinning.value = true
  const s = displayStatus.value
  const want = !s.pinned
  try {
    const updated = want
      ? await statusStore.pinStatus(target.statusId, target.account.id)
      : await statusStore.unpinStatus(target.statusId, target.account.id)
    s.pinned = updated?.pinned ?? want
    toastStore.show({ message: want ? 'Pinned to your profile' : 'Unpinned', duration: 2400 })
  } catch (e) {
    toastStore.show({
      message: want
        ? 'Couldn’t pin — you can pin up to 5 public or unlisted posts'
        : 'Couldn’t unpin that post',
    })
  } finally {
    isPinning.value = false
    isMenuOpen.value = false
  }
}

// ── Polls ──
const isVoting = ref(false)

const handleVote = async (choices: number[]) => {
  const poll = displayStatus.value.poll
  if (!poll || isVoting.value || poll.expired || poll.voted || !choices.length) return
  if (!requireAuth()) return
  isVoting.value = true
  let refresh: (() => Promise<mastodon.v1.Poll | null>) | null = null
  try {
    // Vote on the server that owns the status: remote polls need the local copy's poll id
    const ctx = await getActionContext()
    if (!ctx) throw new Error('Not resolvable')
    const local = await ctx.client.v1.statuses.$select(ctx.id).fetch()
    const localPoll = local.poll
    if (!localPoll) throw new Error('Poll not found')
    if (localPoll.expired) {
      displayStatus.value.poll = localPoll
      toastStore.show({ message: 'This poll has closed' })
      return
    }
    // Same options in the same order, or the indexes would vote for the wrong thing
    const same =
      localPoll.options.length === poll.options.length &&
      localPoll.options.every((o, i) => o.title === poll.options[i]?.title)
    if (!same) throw new Error('Poll mismatch')
    refresh = async () => (await ctx.client.v1.polls.$select(localPoll.id).fetch()) ?? null
    const updated = await ctx.client.v1.polls.$select(localPoll.id).votes.create({ choices })
    displayStatus.value.poll = updated
    toastStore.show({ message: 'Vote sent', duration: 2200 })
  } catch (e) {
    // "Already voted" (another tab/device): pull the real poll state instead of a vague failure
    const text = e instanceof Error ? e.message : ''
    const code = (e as { statusCode?: number; status?: number } | null)?.statusCode ?? (e as { status?: number } | null)?.status
    if (refresh && (code === 422 || /already voted|expired/i.test(text))) {
      try {
        const fresh = await refresh()
        if (fresh) {
          displayStatus.value.poll = fresh
          toastStore.show({
            message: fresh.voted ? 'You already voted in this poll' : 'This poll has closed',
            duration: 3000,
          })
          return
        }
      } catch {
        // fall through to the generic message
      }
    }
    toastStore.show({
      message: 'Couldn’t send your vote — it may have closed, or your server can’t reach this poll.',
    })
  } finally {
    isVoting.value = false
  }
}

const handleCopyLink = async () => {
  try {
    await copyLink()
  } finally {
    isMenuOpen.value = false
  }
}

const topicTags = computed(() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of displayStatus.value.tags || []) {
    const name = (tag.name || '').replace(/^#/, '').trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= 2) break
  }
  return out
})

const openTopic = (tag: string) => {
  router.push(`/groups/${encodeURIComponent(tag.toLowerCase())}`)
}

const quotedStatusLanguage = computed(() => {
  const s = displayStatus.value as mastodon.v1.Status & {
    quote?: mastodon.v1.Status | null
    quotedStatus?: mastodon.v1.Status | null
  }
  return (s.quote || s.quotedStatus)?.language || null
})

const canOfferTranslate = computed(
  () =>
    canInteract.value &&
    instancesStore.serverCapabilities.translation === 'yes' &&
    (languagesDiffer(displayStatus.value.language, settingsStore.defaultLanguage) ||
      languagesDiffer(quotedStatusLanguage.value, settingsStore.defaultLanguage)),
)

const handleTranslate = async () => {
  isMenuOpen.value = false
  if (showTranslation.value || isTranslating.value) return
  if (translationHtml.value) {
    showTranslation.value = true
    contentExpanded.value = true
    return
  }
  isTranslating.value = true
  try {
    const creds = { ...activeCredentials(), lang: settingsStore.defaultLanguage }
    const result = await fetchStatusTranslation(displayStatus.value.id, creds)
    translationHtml.value = result.content
    translationSpoiler.value = result.spoilerText || null
    translationFrom.value = result.detectedSourceLanguage
    const quotedId = quotedStatus.value?.id
    if (quotedId && quotedId !== displayStatus.value.id) {
      try {
        const quoted = await fetchStatusTranslation(quotedId, creds)
        quoteTranslationText.value = quoted.content
      } catch (quoteError) {
        logError('quote translate failed:', quoteError)
      }
    }
    showTranslation.value = true
    contentExpanded.value = true
  } catch (e) {
    logError('translate failed:', e)
    toastStore.show({ message: 'Couldn’t translate this post', kind: 'error' })
  } finally {
    isTranslating.value = false
  }
}

const showOriginal = () => {
  showTranslation.value = false
}

const handleOpenOriginal = () => {
  if (statusUrl.value) {
    window.open(statusUrl.value, '_blank', 'noopener,noreferrer')
  }
  isMenuOpen.value = false
}

const openThread = () => {
  if (isRssItem.value) {
    const url = statusUrl.value
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    return
  }
  const to = threadTo.value
  if (!to) return
  router.push(to)
}

const viewThread = () => {
  if (useHammockPeek.value) {
    openThreadPeek(false)
    return
  }
  openThread()
}

const openQuoted = (q: QuotePreview) => {
  if (q.id) {
    router.push({ path: `/status/${q.id}`, query: q.url ? { url: q.url } : undefined })
    return
  }
  if (q.url) {
    window.open(q.url, '_blank', 'noopener')
  }
}

const onCardKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return
  const t = e.target as HTMLElement
  if (t.closest('a, button, input, textarea, summary, [role="button"]')) return
  e.preventDefault()
  openThread()
}

const onContentClick = (e: MouseEvent) => {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  if (sel && !sel.isCollapsed && sel.toString().trim()) return

  const target = e.target as HTMLElement
  const anchor = target.closest('a') as HTMLAnchorElement | null
  if (anchor) {
    const href = anchor.getAttribute('href') || ''
    const classes = `${anchor.className || ''} ${anchor.closest('.h-card')?.className || ''}`
    // In-app hashtag
    if (/\bhashtag\b/i.test(classes) || /\/tags\//i.test(href)) {
      e.preventDefault()
      const fromText = (anchor.textContent || '').replace(/^#/, '').trim()
      const fromHref = href.match(/\/tags\/([^/?#]+)/i)?.[1]
      const tag = decodeURIComponent(fromHref || fromText)
      if (tag) router.push(`/groups/${encodeURIComponent(tag)}`)
      return
    }
    // In-app mention
    if (/\bmention\b/i.test(classes) || /\bu-url\b/i.test(classes) || /\/@[^/]+/.test(href)) {
      e.preventDefault()
      let acct = (anchor.textContent || '').replace(/^@/, '').trim()
      const m = href.match(/\/@([^/?#]+)/)
      if (m?.[1]) {
        const user = decodeURIComponent(m[1])
        try {
          const host = new URL(href).hostname
          acct = user.includes('@') ? user : `${user}@${host}`
        } catch {
          acct = user
        }
      }
      if (acct) router.push({ path: '/profile', query: { user: acct } })
      return
    }
    return
  }
  const nav = resolveFlipContentClick({
    isFlip: isFlip.value,
    overflows: contentOverflows.value,
    expanded: contentExpanded.value,
  })
  if (nav === 'toggle-expand') {
    contentExpanded.value = !contentExpanded.value
    return
  }
  if (nav === 'noop') return
  openThread()
}

const openLightbox = (media: mastodon.v1.MediaAttachment) => {
  // Only images (with a src) go in the gallery — index by id, not by the
  // attachment position, or a video/audio before the image opens the wrong one.
  const images = (displayStatus.value.mediaAttachments || []).filter(
    (m) => m.type === 'image' && !!(m.url || m.previewUrl),
  )
  const items = images.map((m, i) => ({
    src: (m.url || m.previewUrl)!,
    alt:
      m.description ||
      (images.length > 1 ? `Image ${i + 1} of ${images.length}` : 'Image without description'),
    caption: m.description?.trim() || undefined,
    preview: m.previewUrl && m.previewUrl !== m.url ? m.previewUrl : undefined,
    meta: mediaAttachmentLoupeMeta(m),
  }))
  const index = images.findIndex((m) => m.id === media.id)
  const current = items[index]
  if (!current) return
  overlayStore.openLightbox({ ...current, items, index })
}

</script>

<template>
  <article
    v-if="!removed"
    ref="cardEl"
    class="status-card"
    :class="{
      'status-card--menu-open': isMenuOpen,
      'status-card--flip': isFlip,
      'status-card--flip-media': isFlip && !!flipMedia,
      'status-card--reduce-motion': prefersReducedMotion,
      'status-card--swipe-like': swipeIntent === 'like',
      'status-card--swipe-reply': swipeIntent === 'reply',
      [`status-card--flip-align-${flipAlign}`]: isFlip,
      [`status-card--flip-size-${flipSize}`]: isFlip,
    }"
    :style="cardSwipeStyle"
    :aria-labelledby="cardLabelId"
    tabindex="0"
    @keydown="onCardKeydown"
    @dblclick="onDoubleTapLike"
    @touchend.passive="onDoubleTapLike"
  >
    <div
      v-if="swipeIntent !== 'none' && Math.abs(swipeOffset) > 20"
      class="status-swipe-hint"
      :class="swipeIntent === 'like' ? 'status-swipe-hint--like' : 'status-swipe-hint--reply'"
      aria-hidden="true"
    >
      <NeoIcon :name="swipeIntent === 'like' ? 'heart' : 'message'" :size="22" :stroke="1.5" :filled="swipeIntent === 'like'" />
    </div>
    <!-- Ranked algorithm feeds / For You — tap for score X-Ray -->
    <PostRankXray
      v-if="rankWhy && !isFlip"
      v-model:open="rankXrayOpen"
      :rank-why="rankWhy"
      :rank-breakdown="rankBreakdown"
      :card-label-id="cardLabelId"
    />

    <!-- Reblog indicator -->
    <div v-if="isReblog && !isFlip" class="status-reblog">
      <NeoIcon name="reblog" :size="14" :stroke="2" />
      <button
        v-if="rebloggerProfileTo || reblogger?.acct"
        type="button"
        class="status-reblog-text status-reblog-text--link"
        @click="openProfile(reblogger?.acct, $event)"
      >
        {{ reblogLabel }}
      </button>
      <span v-else class="status-reblog-text">
        {{ reblogLabel }}
      </span>
    </div>

    <div class="status-main">
      <!-- Avatar Column -->
      <div class="status-avatar-col">
        <div v-if="showThreadLineTop" class="status-thread-line status-thread-line--top" aria-hidden="true" />
        <div class="status-avatar-wrap">
          <button
            v-if="accountProfileTo || displayStatus.account?.acct"
            type="button"
            class="status-avatar-link"
            :aria-label="`View profile of ${displayStatus.account.displayName || displayStatus.account.username} (${accountHandle})`"
            @click="openProfile(displayStatus.account.acct, $event)"
          >
            <img
              :src="displayStatus.account.avatar"
              alt=""
              class="status-avatar"
              loading="lazy"
              decoding="async"
            />
          </button>
          <a
            v-else
            :href="displayStatus.account.url"
            target="_blank"
            rel="noopener noreferrer"
            class="status-avatar-link"
            :aria-label="`View profile of ${displayStatus.account.displayName || displayStatus.account.username} (${accountHandle})`"
          >
            <img
              :src="displayStatus.account.avatar"
              alt=""
              class="status-avatar"
              loading="lazy"
              decoding="async"
            />
          </a>
          <Transition name="follow-badge">
            <button
              v-if="showFollowBadge || followBadgeFlash"
              type="button"
              class="status-follow-badge"
              :class="{ 'status-follow-badge--done': followBadgeFlash || authorRelationship?.following || authorRelationship?.requested }"
              :disabled="followBadgeBusy || followBadgeFlash || !!authorRelationship?.following || !!authorRelationship?.requested"
              :aria-label="followBadgeFlash || authorRelationship?.following || authorRelationship?.requested ? `Following ${displayStatus.account.displayName || displayStatus.account.username}` : `Follow ${displayStatus.account.displayName || displayStatus.account.username}`"
              @click="onFollowBadge"
            >
              <span class="status-follow-badge__glyphs" aria-hidden="true">
                <svg class="status-follow-badge__plus" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <svg class="status-follow-badge__check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            </button>
          </Transition>
        </div>
        <div v-if="showThreadLineBottom" class="status-thread-line" aria-hidden="true" />
      </div>

      <!-- Content Column -->
      <div class="status-content-col">
        <PostHeader
          :account="displayStatus.account"
          :safe-display-name="safeDisplayName"
          :account-handle="accountHandle"
          :card-label-id="cardLabelId"
          :created-at="displayStatus.createdAt"
          :thread-to="threadTo"
          :in-app-profile="!!(accountProfileTo || displayStatus.account?.acct)"
          @profile-click="onHeaderProfileClick"
        >
          <NeoMenu
            v-model:open="isMenuOpen"
            class="status-menu-container"
            label="More options"
          >
            <span class="status-more" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </span>
            <template #items>
              <PostMenuItems
                :status="displayStatus"
                :can-interact="canInteract"
                :is-own-post="isOwnPost"
                :can-manage-own="canManageOwn"
                :can-pin="canPin"
                :is-bookmarking="isBookmarking"
                :is-muting="isMuting"
                :is-blocking="isBlocking"
                :is-deleting="isDeleting"
                :is-pinning="isPinning"
                :inspect-open="inspectOpen"
                :can-translate="canOfferTranslate"
                :is-translating="isTranslating"
                @bookmark="handleBookmark"
                @translate="handleTranslate"
                @copy-link="handleCopyLink"
                @mute="handleMute"
                @block="handleBlock"
                @report="handleReport"
                @open-original="handleOpenOriginal"
                @toggle-inspect="toggleInspect"
                @toggle-pin="handleTogglePin"
                @edit="handleEdit"
                @redraft="handleRedraft"
                @delete="handleDelete"
              />
            </template>
          </NeoMenu>
        </PostHeader>

        <button
          v-if="canOfferTranslate && !showTranslation"
          type="button"
          class="status-translate"
          :disabled="isTranslating"
          @click.stop="handleTranslate"
        >
          {{ isTranslating ? 'Translating…' : 'Translate' }}
        </button>

        <div v-if="topicTags.length && contentOverflows && !contentExpanded" class="status-topics">
          <button
            v-for="tag in topicTags"
            :key="tag"
            type="button"
            class="status-topic"
            @click.stop="openTopic(tag)"
          >
            #{{ tag }}
          </button>
        </div>

        <!-- Content Warning / Spoiler — gates text, preview, poll, and media together -->
        <details
          v-if="hasSpoiler"
          class="status-cw"
          :open="cwOpen"
          @toggle="onCwToggle"
        >
          <summary class="status-cw-summary">{{ displaySpoiler }}</summary>
          <div
            class="status-content status-content--clickable"
            :lang="contentLang"
            v-html="safeContent"
            @click="onContentClick"
          />
          <p v-if="showTranslation" class="status-translation">
            Translated<template v-if="translationFrom"> from {{ translationFrom }}</template>
            <button type="button" class="status-translation__back" @click.stop="showOriginal">
              Show original
            </button>
          </p>
          <PreviewCard v-if="linkCard && !isFlip && cwOpen" :card="linkCard" />
          <PostMedia
            v-if="displayStatus.mediaAttachments?.length && cwOpen"
            plain
            :items="displayStatus.mediaAttachments"
            :autoplay-gifs="readingPrefs.autoplayGifs"
            @open="openLightbox"
          />
          <PostPoll
            v-if="displayStatus.poll && cwOpen"
            :poll="displayStatus.poll"
            :emojis="statusEmojis"
            :layout="pollLayout"
            :can-vote="canInteract"
            :voting="isVoting"
            @vote="handleVote"
          />
        </details>

        <!-- Regular Content (no spoiler text) -->
        <template v-else>
          <div
            class="status-content-wrap"
            :class="{ 'status-content-wrap--expanded': isFlip && contentExpanded }"
          >
            <div
              ref="contentEl"
              class="status-content status-content--clickable"
              :class="{ 'status-content--clamped': !contentExpanded }"
              :lang="contentLang"
              v-html="safeContent"
              @click="onContentClick"
            />
            <p v-if="showTranslation" class="status-translation">
              Translated<template v-if="translationFrom"> from {{ translationFrom }}</template>
              <button type="button" class="status-translation__back" @click.stop="showOriginal">
                Show original
              </button>
            </p>
            <button
              v-if="showSeeMore"
              type="button"
              class="status-see-more"
              :aria-expanded="contentExpanded"
              @click.stop="contentExpanded = !contentExpanded"
            >
              {{ contentExpanded ? 'See less' : 'See more' }}
            </button>
          </div>

          <!-- Incoming quote embed -->
          <PostQuoteCard
            v-if="quotedStatus && !isFlip"
            :quote="quotedStatus"
            @open="quotedStatus.url ? openQuoted(quotedStatus) : openThread()"
          />

          <!-- Link preview -->
          <PreviewCard v-if="linkCard && !isFlip" :card="linkCard" />

          <!-- Media: gated behind sensitive flag -->
          <PostMedia
            v-if="mediaList.length"
            :items="mediaList"
            :hidden="mediaHidden"
            :carousel="useMediaCarousel"
            :autoplay-gifs="readingPrefs.autoplayGifs"
            @open="openLightbox"
            @reveal="revealMedia"
          />

          <!-- Poll -->
          <PostPoll
            v-if="displayStatus.poll"
            :poll="displayStatus.poll"
            :emojis="statusEmojis"
            :layout="pollLayout"
            :can-vote="canInteract"
            :voting="isVoting"
            @vote="handleVote"
          />
        </template>

        <!-- Threads order: Like · Reply · Repost · Share + trailing Save -->
        <PostActionBar
          :status="displayStatus"
          :can-interact="canInteract"
          :is-favouriting="isFavouriting"
          :is-boosting="isBoosting"
          :is-bookmarking="isBookmarking"
          :is-opening-reply="isOpeningReply"
          :like-pop="likePop"
          :boost-pop="boostPop"
          :bookmark-pop="bookmarkPop"
          @favourite="handleFavourite"
          @reply="handleReply"
          @boost="handleBoost"
          @share="handleShare"
          @bookmark="handleBookmark"
          @prewarm="prewarm"
        />

        <!-- Engagement summary / thread teaser -->
        <div v-if="(engagementSummary || hasReplies) && !hideInlineReply" class="status-footer-row">
          <button
            class="status-thread-preview"
            @click="viewThread"
          >
            <span class="thread-preview-text">
              {{ engagementSummary || (displayStatus.repliesCount === 1 ? 'View reply' : `View ${formatNumber(displayStatus.repliesCount)} replies`) }}
            </span>
            <svg class="thread-preview-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <PostInspector
          v-if="inspectOpen"
          :signals="statusSignals"
          :copied="inspectCopied"
          @copy="copyInspectJson"
          @close="inspectOpen = false"
        />
      </div>
    </div>

    <div
      v-if="heartBurst"
      class="status-heart-burst"
      :class="{ 'status-heart-burst--anchored': !!heartBurstPos }"
      :style="heartBurstStyle"
      aria-hidden="true"
    >
      <NeoIcon name="heart" :size="72" :stroke="1.5" filled />
    </div>

    <Teleport v-if="shareSheetMounted || boostOpen" to="body">
      <PostActionSheet
        v-if="shareSheetMounted"
        :open="shareOpen"
        title="Share"
        :actions="shareActions"
        @select="onShareSelect"
        @close="shareOpen = false"
      />
      <PostActionSheet
        v-if="boostOpen"
        :open="boostOpen"
        title="Repost"
        :actions="boostActions"
        @select="onBoostSelect"
        @close="boostOpen = false"
      />
    </Teleport>
  </article>
</template>

<style lang="scss" scoped>
// ============================================
// THREADS-STYLE POST CARD
// ============================================

.status-card {
  position: relative;
  z-index: 0;
  padding: 0.75rem;
  background: var(--neo-bg-card);
  border-radius: 4px;
  overflow: visible;
  max-width: 100%;
  width: 100%;

  // Lift the hovered/focused card so tip popovers paint above the next article
  // (each card is its own stacking context; z-index on ::after alone can't escape).
  &:hover,
  &:focus-within {
    z-index: 5;
  }

  &--menu-open {
    z-index: 30;
  }

  @media (min-width: 400px) {
    padding: 0.875rem;
  }

  @media (max-width: 1023px) {
    background: var(--neo-bg-secondary);
    border: none;
    border-radius: 0;
    padding: 0.65rem 0.35rem;
    // Solid paints only — backdrop-filter on scrolling cards blacks out iOS Safari
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }

  // Full-bleed Flip slide (TikTok-ish, still LoomSpace)
  &--flip {
    height: var(--flip-port, 100%);
    min-height: var(--flip-port, 100%);
    max-height: var(--flip-port, 100%);
    margin: 0;
    padding: 0;
    border-radius: 0;
    background: var(--neo-bg-primary);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    scroll-snap-align: start;
    scroll-snap-stop: always;

    .status-main {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 0;
      position: relative;
    }

    .status-avatar-col {
      display: none;
    }

    .status-content-col {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    :deep(.status-header) {
      order: 2;
      padding: 0.65rem 4.25rem 0 1rem;
      align-items: center;
    }

    .status-content-wrap,
    .status-cw {
      order: 3;
      padding: 0.35rem 4.25rem 0.85rem 1rem;
      max-height: 32%;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      mask-image: linear-gradient(to bottom, #000 70%, transparent 100%);
    }

    .status-content--clamped {
      -webkit-line-clamp: 5;
    }

    :deep(.status-media) {
      order: 1;
      flex: 1 1 auto;
      min-height: 48%;
      margin: 0;
      border-radius: 0;
      max-width: none;
      background: var(--neo-bg-secondary);
    }

    :deep(.status-media-hit) {
      width: 100%;
      height: 100%;
      cursor: zoom-in;
    }

    :deep(.status-media-image),
    :deep(.status-media-video) {
      width: 100%;
      height: 100%;
      object-fit: cover;
      max-height: none;
      border-radius: 0;
    }

    &.status-card--flip-media .status-content-wrap,
    &.status-card--flip-media :deep(.status-header) {
      background: linear-gradient(
        to top,
        color-mix(in srgb, var(--neo-bg-primary) 92%, transparent) 0%,
        color-mix(in srgb, var(--neo-bg-primary) 55%, transparent) 55%,
        transparent 100%
      );
    }

    // Text-only Flip — title-card; align/size from Settings → Appearance
    &:not(.status-card--flip-media) {
      --flip-align: center;
      --flip-items: center;
      --flip-pad-inline: 3.75rem 1.5rem;
      --flip-type: 1.375rem;
      --flip-leading: 1.35;
      --flip-weight: 600;
      --flip-max: 22rem;
      --flip-clamp: 10;

      background:
        radial-gradient(
          ellipse 80% 50% at 50% 42%,
          color-mix(in srgb, var(--neo-accent) 8%, transparent),
          transparent 70%
        ),
        var(--neo-bg-primary);

      :deep(.status-media) {
        display: none;
      }

      .status-content-col {
        justify-content: center;
        padding: 2.5rem var(--flip-pad-inline) 5.5rem;
      }

      :deep(.status-header) {
        order: 1;
        justify-content: var(--flip-items);
        padding: 0 0 0.85rem;
        text-align: var(--flip-align);

        .status-author {
          justify-content: var(--flip-items);
        }

        .status-display-name {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--neo-text-tertiary);
        }

        .status-time {
          display: none;
        }
      }

      .status-menu-container {
        position: absolute;
        right: 0.5rem;
        top: 0.65rem;
      }

      .status-content-wrap,
      .status-cw {
        order: 2;
        flex: 0 1 auto;
        max-height: min(58%, 24rem);
        mask-image: none;
        padding: 0;
        text-align: var(--flip-align);
        display: flex;
        flex-direction: column;
        align-items: var(--flip-items);
        justify-content: center;
      }

      .status-content-wrap--expanded {
        max-height: 68%;
        overflow-y: auto;
        overscroll-behavior-y: contain;
        -webkit-overflow-scrolling: touch;
        justify-content: flex-start;
        mask-image: none;
      }

      .status-content {
        font-size: var(--flip-type);
        line-height: var(--flip-leading);
        font-weight: var(--flip-weight);
        letter-spacing: -0.02em;
        color: var(--neo-text-primary);
        width: 100%;
        max-width: var(--flip-max);

        :deep(p) {
          margin-bottom: 0.65rem;

          &:last-child {
            margin-bottom: 0;
          }
        }
      }

      .status-content--clamped {
        -webkit-line-clamp: var(--flip-clamp);
        display: -webkit-box;
      }

      .status-see-more {
        margin-top: 0.75rem;
        font-size: 0.9375rem;
        align-self: var(--flip-items);
      }

      .status-actions {
        bottom: 1.25rem;
      }
    }

    // Sibling modifiers (status-card--flip + status-card--flip-align-*), not nested BEM
    &:not(.status-card--flip-media).status-card--flip-align-left {
      --flip-align: left;
      --flip-items: flex-start;
      --flip-pad-inline: 4.25rem 1.35rem;
    }

    &:not(.status-card--flip-media).status-card--flip-align-center {
      --flip-align: center;
      --flip-items: center;
      --flip-pad-inline: 3.75rem 1.5rem;
    }

    &:not(.status-card--flip-media).status-card--flip-align-right {
      --flip-align: right;
      --flip-items: flex-end;
      --flip-pad-inline: 4.25rem 1.35rem;
    }

    &:not(.status-card--flip-media).status-card--flip-size-reading {
      --flip-type: 1.0625rem;
      --flip-leading: 1.45;
      --flip-weight: 500;
      --flip-max: 26rem;
      --flip-clamp: 14;
    }

    &:not(.status-card--flip-media).status-card--flip-size-large {
      --flip-type: 1.375rem;
      --flip-leading: 1.35;
      --flip-weight: 600;
      --flip-max: 22rem;
      --flip-clamp: 10;
    }

    &:not(.status-card--flip-media).status-card--flip-size-display {
      --flip-type: 1.75rem;
      --flip-leading: 1.25;
      --flip-weight: 700;
      --flip-max: 18rem;
      --flip-clamp: 7;
    }

    // Media Flip captions also honor alignment
    &.status-card--flip-media.status-card--flip-align-left {
      :deep(.status-header),
      .status-content-wrap,
      .status-cw {
        text-align: left;
      }

      :deep(.status-header) {
        justify-content: flex-start;
      }
    }

    &.status-card--flip-media.status-card--flip-align-right {
      :deep(.status-header),
      .status-content-wrap,
      .status-cw {
        text-align: right;
      }

      :deep(.status-header) {
        justify-content: flex-end;

        .status-author {
          justify-content: flex-end;
        }
      }
    }

    .status-actions {
      position: absolute;
      right: 0.35rem;
      bottom: 1.25rem;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      width: auto;
      padding: 0.35rem 0.2rem;
      z-index: 2;
      border-radius: 999px;
      background: color-mix(in srgb, var(--neo-bg-primary) 55%, transparent);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    :deep(.status-action) {
      margin-left: 0 !important;
      min-width: 48px;
      min-height: 48px;
      color: var(--neo-text-secondary);
    }

    :deep(.status-action__count) {
      font-size: 0.6875rem;
      font-weight: 600;
    }

    :deep(.status-media--carousel) {
      position: relative;
      overflow: hidden;

      .status-media__track {
        height: 100%;
        gap: 0;
        padding-bottom: 0;
        scrollbar-width: none;

        &::-webkit-scrollbar {
          display: none;
        }

        .status-media-hit,
        .status-media-video {
          flex: 0 0 100%;
          max-width: 100%;
          height: 100%;
          border-radius: 0;
        }

        .status-media-image,
        .status-media-video {
          height: 100%;
          max-height: none;
        }
      }

      .status-media__index {
        top: 0.75rem;
        right: 4.5rem;
      }
    }

    .status-footer-row {
      display: none;
    }

    .status-see-more {
      color: var(--neo-accent);
    }
  }
}

.status-reblog {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  margin-bottom: 0.5rem;
  padding-left: 52px;

  &-text {
    font-weight: 500;
    color: inherit;
    text-decoration: none;

    &--link {
      min-height: 28px;
      display: inline-flex;
      align-items: center;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      font: inherit;
      color: inherit;
      text-align: left;

      @media (hover: hover) {
        &:hover {
          color: var(--neo-text-primary);
          text-decoration: underline;
        }
      }
    }
  }
}

// Main layout
.status-main {
  display: flex;
  gap: 0.75rem;
  overflow: visible;
  max-width: 100%;
}

// Avatar Column
.status-avatar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 36px;
  flex-shrink: 0;

  @media (min-width: 400px) {
    width: 40px;
  }
}

.status-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.status-avatar-link {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -4px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-decoration: none;
  border-radius: 50%;
  -webkit-tap-highlight-color: transparent;
  font: inherit;
  color: inherit;

  &:focus-visible {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }
}

.status-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;

  @media (min-width: 400px) {
    width: 40px;
    height: 40px;
  }
}

.status-follow-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 2px solid var(--neo-bg-card);
  border-radius: 50%;
  background: var(--neo-accent);
  color: #fff;
  cursor: pointer;
  touch-action: manipulation;
  overflow: visible;
  transition:
    background-color var(--neo-dur-quick, 160ms) var(--neo-ease-out),
    transform var(--neo-dur-instant, 90ms) var(--neo-ease-spring);

  &::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: 50%;
    border: 2px solid var(--neo-success, #2f9e44);
    opacity: 0;
    transform: scale(0.8);
    pointer-events: none;
  }

  &:active:not(:disabled) {
    transform: scale(0.84);
  }

  &--done {
    background: var(--neo-success, #2f9e44);
    animation: follow-badge-pop var(--neo-dur-celebrate, 420ms) var(--neo-ease-bounce) both;

    &::after {
      animation: follow-badge-halo var(--neo-dur-celebrate, 420ms) var(--neo-ease-out) both;
    }

    .status-follow-badge__plus {
      opacity: 0;
      transform: rotate(45deg) scale(0.35);
    }

    .status-follow-badge__check {
      opacity: 1;
      stroke-dashoffset: 0;
      transition-delay: 55ms;
    }
  }

  &:disabled {
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }

  &__glyphs {
    position: relative;
    width: 12px;
    height: 12px;
    display: grid;
    place-items: center;
  }

  &__plus,
  &__check {
    grid-area: 1 / 1;
    display: block;
    transition:
      opacity var(--neo-dur-quick, 160ms) var(--neo-ease-out),
      transform var(--neo-dur-normal, 240ms) var(--neo-ease-spring);
  }

  &__plus {
    opacity: 1;
    transform: rotate(0deg) scale(1);
  }

  &__check {
    opacity: 0;
    stroke-dasharray: 24;
    stroke-dashoffset: 24;
    transition:
      opacity var(--neo-dur-quick, 160ms) var(--neo-ease-out),
      stroke-dashoffset var(--neo-dur-normal, 240ms) var(--neo-ease-out);
  }
}

.follow-badge-enter-active,
.follow-badge-leave-active {
  transition:
    opacity var(--neo-dur-quick, 160ms) var(--neo-ease-out),
    transform var(--neo-dur-normal, 240ms) var(--neo-ease-spring);
}

.follow-badge-enter-from,
.follow-badge-leave-to {
  opacity: 0;
  transform: scale(0.4);
}

@keyframes follow-badge-pop {
  0% { transform: scale(0.82); }
  35% { transform: scale(1.26, 1.18); }
  62% { transform: scale(0.94, 1.04); }
  100% { transform: scale(1); }
}

@keyframes follow-badge-halo {
  0% { opacity: 0.85; transform: scale(0.8); }
  100% { opacity: 0; transform: scale(1.75); }
}

.status-thread-line {
  flex: 1;
  width: 2px;
  background: var(--neo-border-color);
  margin-top: 0.35rem;
  min-height: 12px;
  border-radius: 1px;

  &--top {
    flex: 0 0 auto;
    margin-top: 0;
    margin-bottom: 0.35rem;
    min-height: 10px;
    align-self: stretch;
  }
}

// Content Column
.status-content-col {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  overflow: visible;
}

// Header layout lives in PostHeader.vue (scoped there after extract)

// ========================================
// Three-dot menu
// ========================================
.status-menu-container {
  position: relative;
  flex-shrink: 0;
  z-index: 2;

  :deep(.neo-menu__trigger) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--neo-text-muted);
    margin: -4px -4px -4px 0;
    transition: background-color 0.15s ease, color 0.15s ease;

    @media (hover: hover) {
      &:hover {
        background: var(--neo-bg-tertiary);
        color: var(--neo-text-primary);
      }
    }
  }

  :deep(.neo-menu__panel) {
    min-width: 200px;
    max-width: calc(100vw - 2rem);
    background: var(--neo-bg-secondary);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    z-index: 40;
    overflow: hidden;
    padding: 0.375rem;
  }
}

.status-more {
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}

// Content Warning
.status-cw {
  &-summary {
    cursor: pointer;
    padding: 0.5rem 0.75rem;
    background-color: var(--neo-bg-tertiary);
    border-radius: 8px;
    font-size: 0.875rem;
    color: var(--neo-text-secondary);

    @media (hover: hover) {
      &:hover {
        background-color: var(--neo-border-color);
      }
    }
  }

  &[open] .status-cw-summary {
    margin-bottom: 0.5rem;
  }
}

.status-translate {
  margin: 0 0 0.4rem;
  border: none;
  background: none;
  padding: 0;
  color: var(--neo-accent);
  font-size: 0.8125rem;
  font-weight: 650;
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }

  @media (hover: hover) {
    &:hover {
      text-decoration: underline;
    }
  }
}

.status-topics {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0 0 0.45rem;
}

.status-topic {
  border: 1px solid var(--neo-border-color);
  background: var(--neo-bg-tertiary);
  color: var(--neo-accent);
  border-radius: 6px;
  padding: 0.15rem 0.45rem;
  font-size: 0.8125rem;
  font-weight: 650;
  line-height: 1.3;
  cursor: pointer;

  @media (hover: hover) {
    &:hover {
      background: var(--neo-bg-hover);
    }
  }
}

.status-translation {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);

  &__back {
    margin-left: 0.4rem;
    border: none;
    background: none;
    padding: 0;
    color: var(--neo-accent);
    font: inherit;
    font-weight: 650;
    cursor: pointer;

    @media (hover: hover) {
      &:hover {
        text-decoration: underline;
      }
    }
  }
}

// Content
.status-content {
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--neo-text-primary);
  overflow-wrap: anywhere;
  word-break: normal;
  max-width: 100%;

  &--clickable {
    cursor: pointer;
  }

  &--clamped {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;

    @media (max-width: 1023px) {
      -webkit-line-clamp: 8;
    }
  }

  :deep(p) {
    margin-bottom: 0.5rem;
    &:last-child { margin-bottom: 0; }
  }

  :deep(a) {
    color: var(--neo-accent);
    overflow-wrap: anywhere;
    word-break: normal;
    &:hover { text-decoration: underline; }
  }

  // Mastodon link microformats — hide scheme/host noise, keep readable ellipsis
  :deep(.invisible) {
    font-size: 0;
    line-height: 0;
    display: inline-block;
    width: 0;
    height: 0;
    overflow: hidden;
  }

  :deep(.ellipsis)::after {
    content: '…';
  }

  :deep(.mention) { color: var(--neo-accent); }
  :deep(.hashtag) { color: var(--neo-accent); }

  :deep(img.emoji) {
    height: 1.2em;
    vertical-align: middle;
  }
}

.status-heart-burst {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  pointer-events: none;
  color: var(--neo-like, #ff3040);
  animation: heart-burst var(--neo-dur-celebrate, 420ms) var(--neo-ease-out) forwards;
  animation-duration: 0.78s;

  &--anchored {
    inset: auto;
    width: 72px;
    height: 72px;
    place-items: center;
  }

  .neo-icon {
    filter: drop-shadow(0 8px 18px color-mix(in srgb, var(--neo-like, #ff3040) 45%, transparent));
  }
}

.status-swipe-hint {
  position: absolute;
  top: 50%;
  z-index: 6;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  pointer-events: none;
  transform: translateY(-50%);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--neo-text-primary) 18%, transparent);

  &--like {
    left: 0.75rem;
    color: #fff;
    background: var(--neo-like, #ff3040);
  }

  &--reply {
    right: 0.75rem;
    color: #fff;
    background: var(--neo-accent);
  }
}

@keyframes heart-burst {
  0% { opacity: 0; transform: scale(0.35) rotate(-10deg); }
  22% { opacity: 1; transform: scale(1.25) rotate(5deg); }
  48% { opacity: 1; transform: scale(1.08) rotate(0deg); }
  100% { opacity: 0; transform: translateY(-16px) scale(1.12); }
}

@media (prefers-reduced-motion: reduce) {
  .status-heart-burst {
    animation: none;
    opacity: 0.85;
  }
}

.status-see-more {
  margin-top: 0.25rem;
  min-height: 24px;
  padding: 0.125rem 0;
  border: none;
  background: none;
  font-family: var(--neo-font-family-ui);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--neo-accent);
  cursor: pointer;

  @media (hover: hover) {
    &:hover {
      text-decoration: underline;
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-follow-badge--done,
  .status-follow-badge--done::after {
    animation: none !important;
  }
}

.status-card--reduce-motion {
  .status-see-more {
    transition: none !important;
    animation: none !important;
  }
}

// ========================================
// Footer Row (thread preview + original link)
// ========================================
.status-footer-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-top: 0.25rem;
}

.status-thread-preview {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0;
  background: transparent;
  border: none;
  color: var(--neo-text-muted);
  font-size: 0.875rem;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--neo-text-secondary);

    .thread-preview-arrow {
      transform: translateX(2px);
    }
  }

  .thread-preview-text {
    font-weight: 500;
  }

  .thread-preview-arrow {
    width: 14px;
    height: 14px;
    transition: transform 0.15s ease;
    opacity: 0.7;
  }
}

// Chaos mode
:global(.chaos-active .status-display-name) {
  text-shadow: 0 0 5px currentColor;
}

// Desktop
@media (min-width: 1024px) {
  .status-card {
    background: var(--neo-bg-card);
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    padding: 1rem;

    @media (hover: hover) {
      &:hover {
        background: var(--neo-bg-secondary);
      }
    }
  }

  .status-reblog {
    padding-left: 52px;
  }

  .status-avatar {
    width: 44px;
    height: 44px;
  }

  .status-avatar-col {
    width: 44px;
  }

  .status-content {
    font-size: 1rem;
  }

  // Flick on desktop (focused column): keep the full-bleed slide, not a feed card
  .status-card.status-card--flip {
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--neo-bg-primary);

    @media (hover: hover) {
      &:hover {
        background: var(--neo-bg-primary);
      }
    }

    :deep(.status-media-image) {
      max-height: none;
    }

    // Wide focused stage: media edge-to-edge, caption chrome stays readable
    &.status-card--flip-media {
      :deep(.status-header),
      .status-content-wrap,
      .status-cw {
        max-width: 40rem;
        width: 100%;
        margin-inline: auto;
        box-sizing: border-box;
      }

      :deep(.status-header) {
        padding-inline: 1.25rem 4.5rem;
      }

      .status-content-wrap,
      .status-cw {
        padding-inline: 1.25rem 4.5rem;
      }
    }
  }
}
</style>
