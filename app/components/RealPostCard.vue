<script setup lang="ts">
import type { mastodon } from 'masto'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useSettingsStore } from '~/stores/settings'
import { useComposeSheetStore, type ComposeContextPost } from '~/stores/composeSheet'
import { useToastStore } from '~/stores/toast'
import { useOverlayStore } from '~/stores/overlay'
import { activeClient, clientFor } from '~/composables/useMasto'
import { sanitizeDisplayName, sanitizeStatusHtml, stripHtml } from '~/utils/sanitizeHtml'
import { emojiUrlSet, emojify } from '~/utils/emojify'
import { useMobileViewport } from '~/composables/useBreakpoint'

interface Props {
  status: mastodon.v1.Status
  /** When true, skip per-card inline reply (thread page has sticky composer) */
  hideInlineReply?: boolean
  /** flow = list card, flip = full-bleed snap slide */
  variant?: 'flow' | 'flip'
}

const props = withDefaults(defineProps<Props>(), {
  hideInlineReply: false,
  variant: 'flow',
})
const emit = defineEmits<{
  replied: [status: mastodon.v1.Status]
}>()

const statusStore = useStatusStore()
const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()
const composeSheet = useComposeSheetStore()
const toastStore = useToastStore()
const overlayStore = useOverlayStore()
const router = useRouter()
const { formatRelativeTime, formatAbsoluteTime } = useRelativeTime()

/** Profiles always open the full /profile page — not a column peek. */
const openProfile = (acct: string | undefined | null, e?: Event) => {
  if (!acct) return
  e?.preventDefault()
  e?.stopPropagation()
  router.push({ path: '/profile', query: { user: acct.replace(/^@/, '') } })
}

const displayStatus = computed(() => props.status.reblog || props.status)
const accountEmojis = computed(() => displayStatus.value.account?.emojis || [])
const statusEmojis = computed(() => displayStatus.value.emojis || [])
const nameEmojiUrls = computed(() => emojiUrlSet(accountEmojis.value))
const safeDisplayName = computed(() => {
  const raw = displayStatus.value.account.displayName || displayStatus.value.account.username || ''
  return sanitizeDisplayName(emojify(raw, accountEmojis.value), nameEmojiUrls.value)
})
const safeContent = computed(() =>
  emojify(sanitizeStatusHtml(displayStatus.value.content || ''), statusEmojis.value, {
    escape: false,
  }),
)
const linkCard = computed(() => {
  const card = displayStatus.value.card
  if (!card?.url) return null
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
const cardLabelId = computed(() => `status-author-${displayStatus.value.id}`)
const isReblog = computed(() => !!props.status.reblog)
const reblogger = computed(() => isReblog.value ? props.status.account : null)
const isFlip = computed(() => props.variant === 'flip')
const flipMedia = computed(() => {
  const media = displayStatus.value.mediaAttachments || []
  return media.find((m) => m.type === 'image' || m.type === 'gifv' || m.type === 'video') || null
})
const flipAlign = computed(() => settingsStore.localPreferences.flipTextAlign || 'center')
const flipSize = computed(() => settingsStore.localPreferences.flipTextSize || 'large')

const isFavouriting = ref(false)
const isBoosting = ref(false)
const isMenuOpen = ref(false)
const isBookmarking = ref(false)
const isMuting = ref(false)
const isBlocking = ref(false)
const isOpeningReply = ref(false)
const likePop = ref(false)
const shareOpen = ref(false)
const boostOpen = ref(false)

function readReducedMotion() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.classList.contains('reduce-motion')
  )
}
const prefersReducedMotion = ref(readReducedMotion())
const isMobileViewport = useMobileViewport()

onMounted(() => {
  if (typeof window === 'undefined') return
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  const sync = () => {
    prefersReducedMotion.value =
      mq.matches || document.documentElement.classList.contains('reduce-motion')
  }
  sync()
  mq.addEventListener?.('change', sync)
  onUnmounted(() => mq.removeEventListener?.('change', sync))
})

/** Long-post collapse — overflow-based toggle (not char-count only) */
const contentExpanded = ref(false)
const contentEl = ref<HTMLElement | null>(null)
const contentOverflows = ref(false)
/** CW / sensitive media revealed by the reader */
const mediaRevealed = ref(false)
const cwOpen = ref(false)

const hasSpoiler = computed(() => !!displayStatus.value.spoilerText?.trim())
const isSensitive = computed(() => !!displayStatus.value.sensitive)
const mediaHidden = computed(
  () =>
    !!displayStatus.value.mediaAttachments?.length &&
    ((hasSpoiler.value && !cwOpen.value) ||
      (isSensitive.value && !mediaRevealed.value && !cwOpen.value)),
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
    _resolvedIdCache = null
    _resolvedClientCache = null
    mediaRevealed.value = false
    cwOpen.value = false
    contentExpanded.value = false
    contentOverflows.value = false
  },
)

const measureContentOverflow = () => {
  const el = contentEl.value
  if (!el) {
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

const showSeeMore = computed(() => contentOverflows.value || contentExpanded.value)

let contentResizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    contentResizeObserver = new ResizeObserver(() => measureContentOverflow())
    if (contentEl.value) contentResizeObserver.observe(contentEl.value)
  }
  nextTick(measureContentOverflow)
})

watch(contentEl, (el, prev) => {
  if (prev) contentResizeObserver?.unobserve(prev)
  if (el) contentResizeObserver?.observe(el)
  nextTick(measureContentOverflow)
})

watch(
  [safeContent, () => isMobileViewport.value, contentExpanded],
  () => nextTick(measureContentOverflow),
)

onUnmounted(() => {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
})

const pollDenominator = computed(() => {
  const poll = displayStatus.value.poll
  if (!poll) return 0
  const voters = poll.votersCount ?? poll.votesCount
  if (voters != null && voters > 0) return voters
  return poll.options.reduce((sum, o) => sum + (o.votesCount || 0), 0)
})

const pollOptionPercent = (votes: number | null | undefined) => {
  const total = pollDenominator.value
  if (!total) return 0
  return Math.round(((votes || 0) / total) * 100)
}

const mediaAspectRatio = (media: mastodon.v1.MediaAttachment) => {
  const meta = media.meta as { original?: { width?: number; height?: number } } | undefined
  const w = meta?.original?.width
  const h = meta?.original?.height
  if (w && h && w > 0 && h > 0) return `${w} / ${h}`
  return undefined
}

const hasReplies = computed(() => (displayStatus.value.repliesCount || 0) > 0)

const isOwnPost = computed(() => {
  const user = instancesStore.currentUser
  if (!instancesStore.isAuthenticated || !user) return false
  return displayStatus.value.account.id === user.id ||
    displayStatus.value.account.acct === user.acct
})

const statusUrl = computed(() => displayStatus.value.url || displayStatus.value.uri)

const threadTo = computed(() => {
  const id = displayStatus.value.id
  if (!id) return null
  return {
    path: `/status/${id}`,
    query: statusUrl.value ? { url: statusUrl.value } : undefined,
  }
})

const canInteract = computed(() =>
  instancesStore.hasAuthenticatedInstance
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

let _resolvedIdCache: string | null = null
let _resolvedClientCache: mastodon.rest.Client | null = null

/**
 * Determines the correct API client and status ID for performing actions.
 * Posts from foreign instances need either the source instance's client
 * (if we're authenticated there) or ID resolution through the primary instance.
 */
const getActionContext = async (): Promise<{ client: mastodon.rest.Client; id: string } | null> => {
  if (_resolvedClientCache && _resolvedIdCache) {
    return { client: _resolvedClientCache, id: _resolvedIdCache }
  }

  const status = displayStatus.value
  const ext = status as ExtendedStatus

  // If we have auth on the source instance, use it directly — IDs match there
  if (ext._instanceUrl) {
    const source = instancesStore.getInstanceByUrl(ext._instanceUrl)
    if (source?.accessToken) {
      const client = clientFor(source.id)
      _resolvedClientCache = client
      _resolvedIdCache = status.id
      return { client, id: status.id }
    }
  }

  // Fall back to active account
  if (!instancesStore.instanceUrl || !instancesStore.accessToken) return null

  const primaryClient = activeClient()

  // Check if the post is from the same domain as our primary instance
  const url = statusUrl.value
  if (url) {
    try {
      const statusDomain = new URL(url).hostname
      const primaryDomain = new URL(instancesStore.instanceUrl).hostname
      if (statusDomain === primaryDomain) {
        _resolvedClientCache = primaryClient
        _resolvedIdCache = status.id
        return { client: primaryClient, id: status.id }
      }
    } catch { /* bad URL, fall through to resolve */ }
  }

  // Foreign / remapped feed — resolve the URL to a local ID on our instance
  if (url) {
    const localId = await statusStore.resolveStatus(url)
    if (localId) {
      _resolvedClientCache = primaryClient
      _resolvedIdCache = localId
      return { client: primaryClient, id: localId }
    }
  }

  // Don't cache last-resort raw ids — they often 404 across instances
  return { client: primaryClient, id: status.id }
}

const formatNumber = (num: number) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

// ========================================
// Action Handlers
// ========================================

const handleFavourite = async () => {
  if (!requireAuth() || isFavouriting.value) return

  isFavouriting.value = true
  displayStatus.value.favourited = !displayStatus.value.favourited
  displayStatus.value.favouritesCount += displayStatus.value.favourited ? 1 : -1
  if (displayStatus.value.favourited) {
    likePop.value = true
    setTimeout(() => { likePop.value = false }, 320)
  }

  try {
    const ctx = await getActionContext()
    if (!ctx) throw new Error('Not authenticated')

    if (displayStatus.value.favourited) {
      await ctx.client.v1.statuses.$select(ctx.id).favourite()
    } else {
      await ctx.client.v1.statuses.$select(ctx.id).unfavourite()
    }
  } catch (e) {
    console.error('Favourite error:', e)
    // Drop cached client/id — last-resort foreign ids often fail once
    _resolvedClientCache = null
    _resolvedIdCache = null
    displayStatus.value.favourited = !displayStatus.value.favourited
    displayStatus.value.favouritesCount += displayStatus.value.favourited ? 1 : -1
    toastStore.show({
      message: 'Couldn’t update like',
      actionLabel: 'Retry',
      onAction: () => void handleFavourite(),
      duration: 5000,
    })
  } finally {
    isFavouriting.value = false
  }
}

const handleBoost = async () => {
  if (!canInteract.value) {
    router.push('/login')
    return
  }
  // Already boosted — tap un-reposts. Otherwise open Threads-style Repost / Quote sheet.
  if (displayStatus.value.reblogged) {
    await toggleBoost(false)
    return
  }
  boostOpen.value = true
}

const toggleBoost = async (wantBoost: boolean) => {
  if (!canInteract.value || isBoosting.value) return
  if (displayStatus.value.reblogged === wantBoost) return

  isBoosting.value = true
  displayStatus.value.reblogged = wantBoost
  displayStatus.value.reblogsCount += wantBoost ? 1 : -1

  try {
    const ctx = await getActionContext()
    if (!ctx) throw new Error('Not authenticated')

    if (wantBoost) {
      await ctx.client.v1.statuses.$select(ctx.id).reblog()
      toastStore.show({ message: 'Reposted', duration: 2200 })
    } else {
      await ctx.client.v1.statuses.$select(ctx.id).unreblog()
    }
  } catch (e) {
    console.error('Boost error:', e)
    _resolvedClientCache = null
    _resolvedIdCache = null
    displayStatus.value.reblogged = !displayStatus.value.reblogged
    displayStatus.value.reblogsCount += displayStatus.value.reblogged ? 1 : -1
    toastStore.show({
      message: 'Couldn’t update repost',
      actionLabel: 'Retry',
      onAction: () => void toggleBoost(wantBoost),
      duration: 5000,
    })
  } finally {
    isBoosting.value = false
  }
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

const requireAuth = () => {
  if (canInteract.value) return true
  router.push('/login')
  return false
}

/** Phone + iPad: open the thread with the floating reply bar (Threads-style) */
const preferThreadReplyDock = () =>
  isMobileViewport.value ||
  (typeof window !== 'undefined' &&
    window.matchMedia('(hover: none), (pointer: coarse)').matches)

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
      sourceInstanceUrl: ext._instanceUrl || null,
    })
    if (!replyId) {
      toastStore.show({
        message: 'Couldn’t find that post on your account’s server.',
        duration: 4200,
      })
      return
    }
    const handle = displayStatus.value.account.acct
    const isDm = displayStatus.value.visibility === 'direct'
    // Touch: land on the thread dock so you type above the keyboard
    if (!isDm && preferThreadReplyDock()) {
      await router.push({
        path: `/status/${replyId}`,
        query: statusUrl.value ? { url: statusUrl.value } : undefined,
      })
      return
    }
    composeSheet.show({
      title: isDm ? 'Message' : 'Reply',
      placeholder: isDm ? `Message @${handle}…` : `Reply to @${handle}…`,
      initialText: `@${handle} `,
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
  composeSheet.show({
    title: 'Quote',
    placeholder: 'Add a comment…',
    initialText: '',
    quoteUrl: url,
    contextPost: contextFromStatus(),
  })
}

const handleReply = () => {
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

const handleShare = () => {
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
    } catch (e: any) {
      if (e?.name !== 'AbortError') await copyLink()
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

const handleBookmark = async () => {
  if (!requireAuth() || isBookmarking.value) return

  isBookmarking.value = true
  displayStatus.value.bookmarked = !displayStatus.value.bookmarked

  try {
    const ctx = await getActionContext()
    if (!ctx) throw new Error('Not authenticated')

    if (displayStatus.value.bookmarked) {
      await ctx.client.v1.statuses.$select(ctx.id).bookmark()
    } else {
      await ctx.client.v1.statuses.$select(ctx.id).unbookmark()
    }
  } catch (e) {
    console.error('Bookmark error:', e)
    displayStatus.value.bookmarked = !displayStatus.value.bookmarked
    toastStore.show({
      message: 'Couldn’t update bookmark',
      actionLabel: 'Retry',
      onAction: () => void handleBookmark(),
      duration: 5000,
    })
  } finally {
    isBookmarking.value = false
    isMenuOpen.value = false
  }
}

const handleMute = async () => {
  if (!canInteract.value || isMuting.value) return

  const confirmed = await overlayStore.openConfirm({
    title: `Mute @${displayStatus.value.account.acct}?`,
    body: "You won't see their posts in your timelines.",
    confirmLabel: 'Mute',
    danger: true,
  })
  if (!confirmed) return

  isMuting.value = true
  try {
    await statusStore.muteAccount(displayStatus.value.account.id, {
      acct: displayStatus.value.account.acct,
    })
  } catch (e) {
    console.error('Mute error:', e)
    toastStore.show({ message: 'Couldn’t mute that account. Try again from your home server.' })
  } finally {
    isMuting.value = false
    isMenuOpen.value = false
  }
}

const handleBlock = async () => {
  if (!canInteract.value || isBlocking.value) return

  const confirmed = await overlayStore.openConfirm({
    title: `Block @${displayStatus.value.account.acct}?`,
    body: "They won't be able to see your posts or interact with you.",
    confirmLabel: 'Block',
    danger: true,
  })
  if (!confirmed) return

  isBlocking.value = true
  try {
    await statusStore.blockAccount(displayStatus.value.account.id, {
      acct: displayStatus.value.account.acct,
    })
  } catch (e) {
    console.error('Block error:', e)
    toastStore.show({ message: 'Couldn’t block that account. Try again from your home server.' })
  } finally {
    isBlocking.value = false
    isMenuOpen.value = false
  }
}

const handleReport = async () => {
  if (!canInteract.value) return

  const payload = await overlayStore.openReport({
    accountAcct: displayStatus.value.account.acct,
  })
  if (!payload) return

  try {
    const ctx = await getActionContext()
    await statusStore.reportStatus(
      ctx?.id || displayStatus.value.id,
      displayStatus.value.account.id,
      payload.comment || undefined,
      {
        statusUrl: statusUrl.value || undefined,
        acct: displayStatus.value.account.acct,
        category: payload.category,
        forward: payload.forward,
      },
    )
    toastStore.show({ message: 'Report submitted. Thank you for helping keep the community safe.' })
  } catch (e) {
    console.error('Report error:', e)
    toastStore.show({ message: 'Failed to submit report. Please try again.' })
  } finally {
    isMenuOpen.value = false
  }
}

const handleCopyLink = async () => {
  const url = statusUrl.value
  if (!url) return

  try {
    await navigator.clipboard.writeText(url)
    toastStore.show({ message: 'Link copied', duration: 2000 })
  } catch {
    prompt('Copy this link:', url)
  } finally {
    isMenuOpen.value = false
  }
}

const handleOpenOriginal = () => {
  if (statusUrl.value) {
    window.open(statusUrl.value, '_blank', 'noopener,noreferrer')
  }
  isMenuOpen.value = false
}

const openThread = () => {
  const to = threadTo.value
  if (!to) return
  router.push(to)
}

const viewThread = () => {
  openThread()
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
  openThread()
}

const openLightbox = (media: mastodon.v1.MediaAttachment, index: number) => {
  const images = (displayStatus.value.mediaAttachments || []).filter((m) => m.type === 'image')
  const items = images
    .map((m, i) => {
      const src = m.url || m.previewUrl
      if (!src) return null
      return {
        src,
        alt: m.description || `Image ${i + 1} of ${images.length}`,
      }
    })
    .filter((item): item is { src: string; alt: string } => !!item)
  const current = items[index]
  if (!current) return
  overlayStore.openLightbox({ ...current, items, index })
}

</script>

<template>
  <article
    class="status-card"
    :class="{
      'status-card--menu-open': isMenuOpen,
      'status-card--flip': isFlip,
      'status-card--flip-media': isFlip && !!flipMedia,
      'status-card--reduce-motion': prefersReducedMotion,
      [`status-card--flip-align-${flipAlign}`]: isFlip,
      [`status-card--flip-size-${flipSize}`]: isFlip,
    }"
    :aria-labelledby="cardLabelId"
    tabindex="0"
    @keydown="onCardKeydown"
  >
    <!-- Reblog indicator -->
    <div v-if="isReblog && !isFlip" class="status-reblog">
      <NeoIcon name="reblog" :size="14" :stroke="2" />
      <button
        v-if="rebloggerProfileTo || reblogger?.acct"
        type="button"
        class="status-reblog-text status-reblog-text--link"
        @click="openProfile(reblogger?.acct, $event)"
      >
        {{ reblogger!.displayName || reblogger!.username }} reposted
      </button>
      <span v-else class="status-reblog-text">
        {{ reblogger!.displayName || reblogger!.username }} reposted
      </span>
    </div>

    <div class="status-main">
      <!-- Avatar Column -->
      <div class="status-avatar-col">
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
        <div v-if="hasReplies" class="status-thread-line"></div>
      </div>

      <!-- Content Column -->
      <div class="status-content-col">
        <!-- Header: username + time + menu -->
        <header class="status-header">
          <button
            v-if="accountProfileTo || displayStatus.account?.acct"
            :id="cardLabelId"
            type="button"
            class="status-author"
            @click="openProfile(displayStatus.account.acct, $event)"
          >
            <span class="status-display-name" v-html="safeDisplayName" />
            <span class="status-handle">{{ accountHandle }}</span>
          </button>
          <a
            v-else
            :id="cardLabelId"
            :href="displayStatus.account.url"
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
              :datetime="displayStatus.createdAt"
              :title="formatAbsoluteTime(displayStatus.createdAt)"
            >{{ formatRelativeTime(displayStatus.createdAt) }}</time>
          </NuxtLink>
          <time
            v-else
            class="status-time"
            :datetime="displayStatus.createdAt"
            :title="formatAbsoluteTime(displayStatus.createdAt)"
          >{{ formatRelativeTime(displayStatus.createdAt) }}</time>
          <NeoMenu
            v-model:open="isMenuOpen"
            class="status-menu-container"
            label="More options"
          >
            <span class="status-more" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </span>
            <template #items>
              <button
                v-if="canInteract"
                type="button"
                role="menuitem"
                class="status-dropdown-item"
                :disabled="isBookmarking"
                @click="handleBookmark"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" :fill="displayStatus.bookmarked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                </svg>
                <span>{{ displayStatus.bookmarked ? 'Unsave' : 'Save' }}</span>
              </button>
              <button type="button" role="menuitem" class="status-dropdown-item" @click="handleCopyLink">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
                <span>Copy link</span>
              </button>
              <button type="button" role="menuitem" class="status-dropdown-item" @click="handleOpenOriginal">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span>Open original</span>
              </button>
              <template v-if="canInteract && !isOwnPost">
                <div class="status-dropdown-divider" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  class="status-dropdown-item"
                  :disabled="isMuting"
                  @click="handleMute"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                  <span>Mute @{{ displayStatus.account.username }}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="status-dropdown-item status-dropdown-item--danger"
                  :disabled="isBlocking"
                  @click="handleBlock"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  <span>Block @{{ displayStatus.account.username }}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="status-dropdown-item status-dropdown-item--danger"
                  @click="handleReport"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Report</span>
                </button>
              </template>
            </template>
          </NeoMenu>
        </header>

        <!-- Content Warning / Spoiler -->
        <details
          v-if="hasSpoiler"
          class="status-cw"
          @toggle="onCwToggle"
        >
          <summary class="status-cw-summary">{{ displayStatus.spoilerText }}</summary>
          <div
            class="status-content status-content--clickable"
            :lang="displayStatus.language || undefined"
            v-html="safeContent"
            @click="onContentClick"
          />
        </details>

        <!-- Regular Content -->
        <div v-else class="status-content-wrap">
          <div
            ref="contentEl"
            class="status-content status-content--clickable"
            :class="{ 'status-content--clamped': !contentExpanded }"
            :lang="displayStatus.language || undefined"
            v-html="safeContent"
            @click="onContentClick"
          />
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

        <!-- Link preview -->
        <PreviewCard v-if="linkCard && !isFlip" :card="linkCard" />

        <!-- Media: gated behind CW / sensitive -->
        <div v-if="displayStatus.mediaAttachments?.length" class="status-media">
          <button
            v-if="mediaHidden"
            type="button"
            class="status-media-cw"
            @click.stop="revealMedia"
          >
            <span>{{ hasSpoiler ? displayStatus.spoilerText : 'Sensitive media' }}</span>
            <span class="status-media-cw__hint">Tap to reveal</span>
          </button>
          <template v-else>
            <template v-for="(media, mediaIdx) in displayStatus.mediaAttachments" :key="media.id">
              <button
                v-if="media.type === 'image'"
                type="button"
                class="status-media-hit"
                :aria-label="media.description || `View image ${mediaIdx + 1} of ${displayStatus.mediaAttachments.length}`"
                @click.stop="openLightbox(media, mediaIdx)"
              >
                <img
                  :src="media.previewUrl ?? media.url ?? undefined"
                  :alt="media.description || ''"
                  class="status-media-image"
                  :style="mediaAspectRatio(media) ? { aspectRatio: mediaAspectRatio(media) } : undefined"
                  loading="lazy"
                />
                <span
                  v-if="media.description?.trim()"
                  class="status-media-alt-badge"
                  title="Has alt text"
                >ALT</span>
                <span
                  v-else
                  class="status-media-alt-badge status-media-alt-badge--missing"
                  title="No description"
                >No description</span>
              </button>
              <video
                v-else-if="media.type === 'video' || media.type === 'gifv'"
                :src="media.url ?? undefined"
                :poster="media.previewUrl ?? undefined"
                controls
                preload="none"
                :autoplay="media.type === 'gifv' && !prefersReducedMotion"
                :loop="media.type === 'gifv'"
                :muted="media.type === 'gifv'"
                class="status-media-video"
              />
              <audio
                v-else-if="media.type === 'audio'"
                :src="media.url ?? undefined"
                controls
                class="status-media-audio"
              />
            </template>
          </template>
        </div>

        <!-- Poll -->
        <div v-if="displayStatus.poll" class="status-poll">
          <div
            v-for="option in displayStatus.poll.options"
            :key="option.title"
            class="status-poll-option"
            role="meter"
            :aria-valuenow="pollOptionPercent(option.votesCount)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${option.title}: ${pollOptionPercent(option.votesCount)}%`"
          >
            <span class="status-poll-title">{{ option.title }}</span>
            <span class="status-poll-votes">
              {{ pollOptionPercent(option.votesCount) }}%
              <span class="status-poll-votes__count">({{ option.votesCount ?? 0 }})</span>
            </span>
            <div
              class="status-poll-bar"
              :style="{ width: `${pollOptionPercent(option.votesCount)}%` }"
            />
          </div>
          <p class="status-poll-info">
            {{ pollDenominator }} {{ pollDenominator === 1 ? 'vote' : 'votes' }}
            · {{ displayStatus.poll.expired ? 'Closed' : 'Open' }}
          </p>
        </div>

        <!-- Actions: on mobile, like sits in the right thumb zone -->
        <footer class="status-actions">
          <button
            class="status-action status-action--reply neo-tip"
            aria-label="Reply"
            :disabled="isOpeningReply"
            @click.stop="handleReply"
          >
            <NeoIcon name="message" :size="20" :stroke="1.5" />
            <span v-if="(displayStatus.repliesCount ?? 0) > 0" class="status-action__count">{{ formatNumber(displayStatus.repliesCount) }}</span>
          </button>

          <button
            class="status-action status-action--boost neo-tip"
            :class="{ 'status-action--boosted': displayStatus.reblogged }"
            :aria-disabled="isBoosting || undefined"
            aria-label="Repost"
            :aria-pressed="!!displayStatus.reblogged"
            @click.stop="!isBoosting && handleBoost()"
          >
            <NeoIcon name="reblog" :size="20" :stroke="1.5" />
            <span v-if="(displayStatus.reblogsCount ?? 0) > 0" class="status-action__count">{{ formatNumber(displayStatus.reblogsCount) }}</span>
          </button>

          <button
            class="status-action status-action--share neo-tip"
            aria-label="Share"
            @click.stop="handleShare"
          >
            <NeoIcon name="share" :size="20" :stroke="1.5" />
          </button>

          <button
            class="status-action status-action--bookmark neo-tip"
            :class="{ 'status-action--bookmarked': displayStatus.bookmarked }"
            :aria-disabled="isBookmarking || undefined"
            aria-label="Bookmark"
            :aria-pressed="!!displayStatus.bookmarked"
            @click.stop="!isBookmarking && handleBookmark()"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" :fill="displayStatus.bookmarked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
            </svg>
          </button>

          <button
            class="status-action status-action--like neo-tip"
            :class="{
              'status-action--liked': displayStatus.favourited,
              'status-action--pop': likePop,
            }"
            :aria-disabled="isFavouriting || undefined"
            aria-label="Like"
            :aria-pressed="!!displayStatus.favourited"
            @click.stop="!isFavouriting && handleFavourite()"
          >
            <NeoIcon name="heart" :size="20" :stroke="1.5" :filled="!!displayStatus.favourited" />
            <span v-if="(displayStatus.favouritesCount ?? 0) > 0" class="status-action__count">{{ formatNumber(displayStatus.favouritesCount) }}</span>
          </button>
        </footer>

        <!-- Thread teaser -->
        <div v-if="hasReplies && !hideInlineReply" class="status-footer-row">
          <button
            class="status-thread-preview"
            @click="viewThread"
          >
            <span class="thread-preview-text">
              View {{ displayStatus.repliesCount === 1 ? 'reply' : `${formatNumber(displayStatus.repliesCount)} replies` }}
            </span>
            <svg class="thread-preview-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <Teleport v-if="shareOpen || boostOpen" to="body">
      <PostActionSheet
        v-if="shareOpen"
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

  // Full-bleed Flip slide (TikTok-ish, still NeoSpace)
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

    .status-header {
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

    .status-media {
      order: 1;
      flex: 1 1 auto;
      min-height: 48%;
      margin: 0;
      border-radius: 0;
      max-width: none;
      background: var(--neo-bg-secondary);
    }

    .status-media-hit {
      width: 100%;
      height: 100%;
      cursor: zoom-in;
    }

    .status-media-image,
    .status-media-video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      max-height: none;
      border-radius: 0;
    }

    &.status-card--flip-media .status-content-wrap,
    &.status-card--flip-media .status-header {
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

      .status-media {
        display: none;
      }

      .status-content-col {
        justify-content: center;
        padding: 2.5rem var(--flip-pad-inline) 5.5rem;
      }

      .status-header {
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

        .status-menu-container {
          position: absolute;
          right: 0.5rem;
          top: 0.65rem;
        }
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

      .status-poll {
        order: 3;
        margin: 1rem 0 0;
        width: 100%;
        max-width: var(--flip-max);
        text-align: left;
      }

      .status-actions {
        bottom: 4.5rem;
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
      .status-header,
      .status-content-wrap,
      .status-cw {
        text-align: left;
      }

      .status-header {
        justify-content: flex-start;
      }
    }

    &.status-card--flip-media.status-card--flip-align-right {
      .status-header,
      .status-content-wrap,
      .status-cw {
        text-align: right;
      }

      .status-header {
        justify-content: flex-end;

        .status-author {
          justify-content: flex-end;
        }
      }
    }

    .status-poll {
      order: 3;
      margin: 0 4.25rem 0.5rem 1rem;
    }

    .status-actions {
      position: absolute;
      right: 0.35rem;
      bottom: 5.5rem;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
      width: auto;
      padding: 0;
      z-index: 2;
    }

    .status-action {
      margin-left: 0 !important;
      min-width: 48px;
      color: var(--neo-text-secondary);

      &__count {
        font-size: 0.6875rem;
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

// Reblog indicator
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

      &:hover {
        color: var(--neo-text-primary);
        text-decoration: underline;
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

.status-thread-line {
  flex: 1;
  width: 2px;
  background: var(--neo-border-color);
  margin-top: 0.5rem;
  min-height: 12px;
  border-radius: 1px;
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

// Header
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
  max-width: 100%;

  :deep(img.emoji) {
    height: 1em;
    vertical-align: middle;
  }
}

.status-handle {
  flex-shrink: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 400;
  color: var(--neo-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 10rem;
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

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
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

.status-dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  color: var(--neo-text-primary);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.12s ease;

  svg {
    flex-shrink: 0;
    color: var(--neo-text-secondary);
  }

  span {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &:hover:not(:disabled) {
    background: var(--neo-bg-tertiary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--danger {
    color: var(--neo-danger);

    svg {
      color: var(--neo-danger);
    }

    &:hover:not(:disabled) {
      background: var(--neo-danger-soft);
    }
  }
}

.status-dropdown-divider {
  height: 1px;
  background: var(--neo-border-color);
  margin: 0.25rem 0.5rem;
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

    &:hover {
      background-color: var(--neo-border-color);
    }
  }

  &[open] .status-cw-summary {
    margin-bottom: 0.5rem;
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
      -webkit-line-clamp: 4;
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

// Media
.status-media {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.375rem;
  margin-top: 0.5rem;
  border-radius: 4px;
  overflow: hidden;
  max-width: 100%;

  &:has(> *:nth-child(2):not(.status-media-cw)) {
    grid-template-columns: repeat(2, 1fr);
  }
}

.status-media-cw {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 140px;
  padding: 1rem;
  border: 1px dashed var(--neo-border-color);
  border-radius: 12px;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-secondary);
  font: inherit;
  cursor: pointer;
  text-align: center;

  &__hint {
    font-size: 0.8em;
    color: var(--neo-text-muted);
  }
}

.status-media-hit {
  display: block;
  padding: 0;
  margin: 0;
  border: none;
  background: none;
  cursor: zoom-in;
  overflow: hidden;
  max-width: 100%;
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

  &:hover {
    text-decoration: underline;
  }
}

@keyframes like-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.28); }
  100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .status-action--pop .neo-icon,
  .status-action--pop svg {
    animation: none;
  }
}

.status-card--reduce-motion {
  .status-action,
  .status-see-more,
  .status-media-image,
  .status-dropdown-item {
    transition: none !important;
    animation: none !important;
  }

  .status-action--pop .neo-icon,
  .status-action--pop svg {
    animation: none !important;
  }
}

.status-media-hit {
  position: relative;
}

.status-media-alt-badge {
  position: absolute;
  left: 0.5rem;
  bottom: 0.5rem;
  padding: 0.125rem 0.375rem;
  border-radius: var(--neo-radius-xs, 2px);
  background: color-mix(in srgb, var(--neo-bg-primary) 82%, transparent);
  color: var(--neo-text-secondary);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  pointer-events: none;

  &--missing {
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: var(--neo-text-muted);
  }
}

.status-media-image {
  width: 100%;
  max-width: 100%;
  height: auto;
  max-height: 350px;
  object-fit: cover;
  border-radius: var(--neo-radius-md, 8px);
  display: block;
  cursor: pointer;
  transition: opacity var(--neo-transition-fast, 0.15s ease);
  background: var(--neo-bg-tertiary);

  &:hover { opacity: 0.95; }
}

.status-media-video,
.status-media-audio {
  width: 100%;
  max-width: 100%;
  border-radius: var(--neo-radius-md, 8px);
  display: block;
}

.status-media-video {
  max-height: 500px;
  object-fit: contain;
  background: #000;
}

// Poll
.status-poll {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.status-poll-option {
  position: relative;
  padding: 0.5rem 0.75rem;
  background-color: var(--neo-bg-tertiary);
  border-radius: var(--neo-radius-md, 8px);
  display: flex;
  justify-content: space-between;
  overflow: hidden;
  font-size: 0.875rem;
}

.status-poll-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background-color: var(--neo-accent-soft);
  z-index: 0;
}

.status-poll-title,
.status-poll-votes {
  position: relative;
  z-index: 1;
}

.status-poll-votes {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.status-poll-info {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

// ========================================
// Actions - pill-shaped buttons with proper sizing
// ========================================
.status-actions {
  overflow: visible;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 0.15rem;
  margin-top: 0.5rem;
  margin-left: -0.35rem;
  max-width: 100%;
}

.status-action {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.5rem;
  min-height: 44px;
  min-width: 44px;
  justify-content: center;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;

  svg,
  .neo-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  &:hover:not(:disabled) {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
  }

  &:active:not(:disabled) {
    transform: scale(0.92);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  // Liked = Braun accent (not X pink)
  &--liked {
    color: var(--neo-accent);

    svg {
      stroke: var(--neo-accent);
      fill: var(--neo-accent);
    }

    &:hover:not(:disabled) {
      background: var(--neo-accent-soft);
      color: var(--neo-accent);
    }
  }

  &--pop svg {
    animation: like-pop 0.32s ease;
  }

  // One-handed mobile: heart in the right thumb zone, bigger targets
  @media (max-width: 1023px) {
    min-height: 48px;
    min-width: 48px;
    padding: 0.55rem 0.6rem;

    svg {
      width: 22px;
      height: 22px;
    }

    &--like {
      margin-left: auto;
      min-width: 56px;
      padding-left: 0.85rem;
      padding-right: 0.7rem;
      color: var(--neo-text-tertiary);

      svg {
        width: 26px;
        height: 26px;
      }

      &.status-action--liked {
        color: var(--neo-accent);
      }
    }

    &--boost .status-action__count,
    &--reply .status-action__count {
      // Quieter chrome — icon first; count only when meaningful
      font-size: 0.6875rem;
      opacity: 0.75;
    }
  }

  // Boosted = success green (instrument, not Twitter)
  &--bookmarked {
    color: var(--neo-accent);

    svg {
      stroke: var(--neo-accent);
      fill: var(--neo-accent);
    }
  }

  &--boosted {
    color: var(--neo-success);

    svg {
      stroke: var(--neo-success);
    }

    &:hover:not(:disabled) {
      background: var(--neo-success-soft);
      color: var(--neo-success);
    }
  }

  // Reply active = accent blue
  &--replying {
    color: var(--neo-accent);

    svg {
      stroke: var(--neo-accent);
    }

    &:hover:not(:disabled) {
      background: var(--neo-accent-soft);
      color: var(--neo-accent);
    }
  }

  &__count {
    font-size: 0.8125rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: inherit;
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
:global(.chaos-active) {
  .status-display-name {
    text-shadow: 0 0 5px currentColor;
  }

  .status-action--liked,
  .status-action--boosted,
  .status-action--bookmarked {
    text-shadow: 0 0 10px currentColor;
  }
}

// Desktop
@media (min-width: 1024px) {
  .status-card {
    background: var(--neo-bg-card);
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    padding: 1rem;

    &:hover {
      background: var(--neo-bg-secondary);
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

  .status-media-image {
    max-height: 400px;
  }
}
</style>
