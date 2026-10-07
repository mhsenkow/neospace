<script setup lang="ts">
import type { mastodon } from 'masto'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useSettingsStore } from '~/stores/settings'
import { useComposeSheetStore, type ComposeContextPost } from '~/stores/composeSheet'
import { activeClient, clientFor } from '~/composables/useMasto'
import { sanitizeDisplayName, sanitizeStatusHtml } from '~/utils/sanitizeHtml'

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
const router = useRouter()

/** Profiles always open the full /profile page — not a column peek. */
const openProfile = (acct: string | undefined | null, e?: Event) => {
  if (!acct) return
  e?.preventDefault()
  e?.stopPropagation()
  router.push({ path: '/profile', query: { user: acct.replace(/^@/, '') } })
}

const displayStatus = computed(() => props.status.reblog || props.status)
const safeDisplayName = computed(() =>
  sanitizeDisplayName(displayStatus.value.account.displayName || displayStatus.value.account.username),
)
const safeContent = computed(() => sanitizeStatusHtml(displayStatus.value.content || ''))
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
const showCopiedToast = ref(false)
const showReplyToast = ref(false)
const showReplyErrorToast = ref(false)
const isOpeningReply = ref(false)
const showBoostToast = ref(false)
const likePop = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const shareOpen = ref(false)
const boostOpen = ref(false)

const lightbox = ref<{ src: string; alt: string } | null>(null)
const lightboxOpen = computed(() => !!lightbox.value)
const lightboxRef = ref<HTMLElement | null>(null)
const prefersReducedMotion = ref(false)

useFocusTrap(lightboxRef, lightboxOpen, {
  onEscape: () => {
    lightbox.value = null
  },
  initialFocus: '.status-lightbox__close',
})

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

/** Long-post collapse (Threads-style see more, without engagement bait) */
const contentExpanded = ref(false)
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
const plainLength = computed(() =>
  (displayStatus.value.content || '').replace(/<[^>]*>/g, '').length,
)
/** Tighter clamp on mobile so media starts higher in the viewport */
const isLongPost = computed(() => {
  const mobile =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  return plainLength.value > (mobile ? 220 : 320)
})

const hasReplies = computed(() => (displayStatus.value.repliesCount || 0) > 0)

const isOwnPost = computed(() => {
  const user = instancesStore.currentUser
  if (!instancesStore.isAuthenticated || !user) return false
  return displayStatus.value.account.id === user.id ||
    displayStatus.value.account.acct === user.acct
})

const statusUrl = computed(() => displayStatus.value.url || displayStatus.value.uri)

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

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const minutes = Math.floor(diff / (1000 * 60))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
  if (!canInteract.value || isFavouriting.value) return

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
      showBoostToast.value = true
      setTimeout(() => { showBoostToast.value = false }, 2200)
    } else {
      await ctx.client.v1.statuses.$select(ctx.id).unreblog()
    }
  } catch (e) {
    console.error('Boost error:', e)
    _resolvedClientCache = null
    _resolvedIdCache = null
    displayStatus.value.reblogged = !displayStatus.value.reblogged
    displayStatus.value.reblogsCount += displayStatus.value.reblogged ? 1 : -1
  } finally {
    isBoosting.value = false
  }
}

const stripStatusHtml = (html: string) =>
  (html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()

const contextFromStatus = (): ComposeContextPost => {
  const s = displayStatus.value
  return {
    id: s.id,
    name: s.account.displayName || s.account.username,
    handle: s.account.acct,
    avatar: s.account.avatar,
    text: stripStatusHtml(s.content).slice(0, 280),
    url: statusUrl.value,
  }
}

const requireAuth = () => {
  if (canInteract.value) return true
  router.push('/login')
  return false
}

/** Phone + iPad: open the thread with the floating reply bar (Threads-style) */
const preferThreadReplyDock = () => {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(max-width: 1023px), (hover: none), (pointer: coarse)').matches
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
      sourceInstanceUrl: ext._instanceUrl || null,
    })
    if (!replyId) {
      showReplyErrorToast.value = true
      setTimeout(() => { showReplyErrorToast.value = false }, 4200)
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
        showReplyToast.value = true
        setTimeout(() => { showReplyToast.value = false }, 3500)
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
    showCopiedToast.value = true
    setTimeout(() => { showCopiedToast.value = false }, 2000)
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
        text: stripStatusHtml(displayStatus.value.content).slice(0, 200),
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

const toggleMenu = (e: Event) => {
  e.stopPropagation()
  isMenuOpen.value = !isMenuOpen.value
}

const closeMenu = (event: MouseEvent) => {
  if (!isMenuOpen.value) return
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    isMenuOpen.value = false
  }
}

const handleBookmark = async () => {
  if (!canInteract.value || isBookmarking.value) return

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
  } finally {
    isBookmarking.value = false
    isMenuOpen.value = false
  }
}

const handleMute = async () => {
  if (!canInteract.value || isMuting.value) return

  const confirmed = confirm(`Mute @${displayStatus.value.account.acct}? You won't see their posts in your timelines.`)
  if (!confirmed) return

  isMuting.value = true
  try {
    await statusStore.muteAccount(displayStatus.value.account.id, {
      acct: displayStatus.value.account.acct,
    })
  } catch (e) {
    console.error('Mute error:', e)
    alert('Couldn’t mute that account. Try again from your home server.')
  } finally {
    isMuting.value = false
    isMenuOpen.value = false
  }
}

const handleBlock = async () => {
  if (!canInteract.value || isBlocking.value) return

  const confirmed = confirm(`Block @${displayStatus.value.account.acct}? They won't be able to see your posts or interact with you.`)
  if (!confirmed) return

  isBlocking.value = true
  try {
    await statusStore.blockAccount(displayStatus.value.account.id, {
      acct: displayStatus.value.account.acct,
    })
  } catch (e) {
    console.error('Block error:', e)
    alert('Couldn’t block that account. Try again from your home server.')
  } finally {
    isBlocking.value = false
    isMenuOpen.value = false
  }
}

const handleReport = async () => {
  if (!canInteract.value) return

  const reason = prompt(`Report this post by @${displayStatus.value.account.acct}?\n\nOptionally, provide a reason:`)
  if (reason === null) return

  try {
    const ctx = await getActionContext()
    await statusStore.reportStatus(
      ctx?.id || displayStatus.value.id,
      displayStatus.value.account.id,
      reason || undefined,
      {
        statusUrl: statusUrl.value || undefined,
        acct: displayStatus.value.account.acct,
      },
    )
    alert('Report submitted. Thank you for helping keep the community safe.')
  } catch (e) {
    console.error('Report error:', e)
    alert('Failed to submit report. Please try again.')
  } finally {
    isMenuOpen.value = false
  }
}

const handleCopyLink = async () => {
  const url = statusUrl.value
  if (!url) return

  try {
    await navigator.clipboard.writeText(url)
    showCopiedToast.value = true
    setTimeout(() => { showCopiedToast.value = false }, 2000)
  } catch {
    prompt('Copy this link:', url)
  } finally {
    isMenuOpen.value = false
  }
}

const handleOpenOriginal = () => {
  if (statusUrl.value) {
    window.open(statusUrl.value, '_blank')
  }
  isMenuOpen.value = false
}

const openThread = () => {
  const id = displayStatus.value.id
  if (!id) return
  const query = statusUrl.value ? { url: statusUrl.value } : undefined
  router.push({ path: `/status/${id}`, query })
}

const viewThread = () => {
  openThread()
}

const onContentClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  // Let real links inside the HTML work normally
  if (target.closest('a')) return
  openThread()
}

const openLightbox = (media: mastodon.v1.MediaAttachment) => {
  const src = media.url || media.previewUrl
  if (!src) return
  lightbox.value = { src, alt: media.description || 'Image' }
}

const closeLightbox = () => {
  lightbox.value = null
}

watch(lightbox, (val) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = val ? 'hidden' : ''
})

watch(isMenuOpen, async (open) => {
  if (open) {
    await nextTick()
    document.addEventListener('click', closeMenu)
  } else {
    document.removeEventListener('click', closeMenu)
  }
})

onUnmounted(() => {
  document.removeEventListener('click', closeMenu)
  document.body.style.overflow = ''
})
</script>

<template>
  <article
    class="status-card"
    :class="{
      'status-card--menu-open': isMenuOpen,
      'status-card--flip': isFlip,
      'status-card--flip-media': isFlip && !!flipMedia,
      [`status-card--flip-align-${flipAlign}`]: isFlip,
      [`status-card--flip-size-${flipSize}`]: isFlip,
    }"
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
          :aria-label="`Open ${displayStatus.account.displayName || displayStatus.account.username}`"
          @click="openProfile(displayStatus.account.acct, $event)"
        >
          <img
            :src="displayStatus.account.avatar"
            :alt="displayStatus.account.displayName || displayStatus.account.username"
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
        >
          <img
            :src="displayStatus.account.avatar"
            :alt="displayStatus.account.displayName || displayStatus.account.username"
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
            type="button"
            class="status-author"
            @click="openProfile(displayStatus.account.acct, $event)"
          >
            <span class="status-display-name" v-html="safeDisplayName" />
          </button>
          <a
            v-else
            :href="displayStatus.account.url"
            target="_blank"
            rel="noopener noreferrer"
            class="status-author"
          >
            <span class="status-display-name" v-html="safeDisplayName" />
          </a>
          <a :href="statusUrl || '#'" target="_blank" rel="noopener noreferrer" class="status-time">
            <time :datetime="displayStatus.createdAt">{{ formatDate(displayStatus.createdAt) }}</time>
          </a>
          <div class="status-menu-container" ref="menuRef">
            <button class="status-more" aria-label="More options" @click="toggleMenu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>

            <!-- Dropdown Menu -->
            <Transition name="menu-fade">
              <div v-if="isMenuOpen" class="status-dropdown" @click.stop>
                <!-- Save/Bookmark -->
                <button
                  v-if="canInteract"
                  class="status-dropdown-item"
                  :disabled="isBookmarking"
                  @click="handleBookmark"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" :fill="displayStatus.bookmarked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                  </svg>
                  <span>{{ displayStatus.bookmarked ? 'Unsave' : 'Save' }}</span>
                </button>

                <!-- Copy Link -->
                <button class="status-dropdown-item" @click="handleCopyLink">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                  </svg>
                  <span>Copy link</span>
                </button>

                <!-- Open Original -->
                <button class="status-dropdown-item" @click="handleOpenOriginal">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <span>Open original</span>
                </button>

                <!-- Auth-only moderation actions -->
                <template v-if="canInteract && !isOwnPost">
                  <div class="status-dropdown-divider" />

                  <button
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
              </div>
            </Transition>
          </div>
        </header>

        <!-- Content Warning / Spoiler -->
        <details
          v-if="hasSpoiler"
          class="status-cw"
          @toggle="onCwToggle"
        >
          <summary class="status-cw-summary">{{ displayStatus.spoilerText }}</summary>
          <div class="status-content status-content--clickable" v-html="safeContent" @click="onContentClick" />
        </details>

        <!-- Regular Content -->
        <div v-else class="status-content-wrap">
          <div
            class="status-content status-content--clickable"
            :class="{ 'status-content--clamped': isLongPost && !contentExpanded }"
            v-html="safeContent"
            @click="onContentClick"
          />
          <button
            v-if="isLongPost && !contentExpanded"
            type="button"
            class="status-see-more"
            @click.stop="contentExpanded = true"
          >
            See more
          </button>
        </div>

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
                @click.stop="openLightbox(media)"
              >
                <img
                  :src="media.previewUrl ?? media.url ?? undefined"
                  :alt="media.description || `Image ${mediaIdx + 1} of ${displayStatus.mediaAttachments.length}`"
                  class="status-media-image"
                  loading="lazy"
                />
              </button>
              <video
                v-else-if="media.type === 'video' || media.type === 'gifv'"
                :src="media.url ?? undefined"
                :poster="media.previewUrl ?? undefined"
                controls
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
          >
            <span class="status-poll-title">{{ option.title }}</span>
            <span class="status-poll-votes">{{ option.votesCount }} votes</span>
            <div
              class="status-poll-bar"
              :style="{ width: `${(option.votesCount || 0) / (displayStatus.poll!.votesCount || 1) * 100}%` }"
            />
          </div>
          <p class="status-poll-info">{{ displayStatus.poll.votesCount }} votes · {{ displayStatus.poll.expired ? 'Closed' : 'Open' }}</p>
        </div>

        <!-- Actions: on mobile, like sits in the right thumb zone -->
        <footer class="status-actions">
          <button
            class="status-action status-action--reply neo-tip"
            aria-label="Reply"
            title="Reply"
            :disabled="isOpeningReply"
            @click.stop="handleReply"
          >
            <NeoIcon name="message" :size="20" :stroke="1.5" />
            <span v-if="displayStatus.repliesCount" class="status-action__count">{{ formatNumber(displayStatus.repliesCount) }}</span>
          </button>

          <button
            class="status-action status-action--boost neo-tip"
            :class="{ 'status-action--boosted': displayStatus.reblogged }"
            :disabled="isBoosting"
            :aria-label="displayStatus.reblogged ? 'Undo repost' : 'Repost'"
            :title="displayStatus.reblogged ? 'Undo repost' : 'Repost'"
            :aria-pressed="!!displayStatus.reblogged"
            @click.stop="handleBoost"
          >
            <NeoIcon name="reblog" :size="20" :stroke="1.5" />
            <span v-if="displayStatus.reblogsCount" class="status-action__count">{{ formatNumber(displayStatus.reblogsCount) }}</span>
          </button>

          <button
            class="status-action status-action--share neo-tip"
            aria-label="Share"
            title="Share"
            @click.stop="handleShare"
          >
            <NeoIcon name="share" :size="20" :stroke="1.5" />
          </button>

          <button
            class="status-action status-action--like neo-tip"
            :class="{
              'status-action--liked': displayStatus.favourited,
              'status-action--pop': likePop,
            }"
            :disabled="isFavouriting"
            :aria-label="displayStatus.favourited ? 'Unlike' : 'Like'"
            :title="displayStatus.favourited ? 'Unlike' : 'Like'"
            :aria-pressed="!!displayStatus.favourited"
            @click.stop="handleFavourite"
          >
            <NeoIcon name="heart" :size="20" :stroke="1.5" :filled="!!displayStatus.favourited" />
            <span v-if="displayStatus.favouritesCount" class="status-action__count">{{ formatNumber(displayStatus.favouritesCount) }}</span>
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

    <!-- Copied Toast -->
    <Teleport to="body">
      <Transition name="toast-fade">
        <div v-if="showCopiedToast" class="status-toast" role="status" aria-live="polite">Link copied</div>
      </Transition>
      <Transition name="toast-fade">
        <div v-if="showBoostToast" class="status-toast" role="status" aria-live="polite">Reposted</div>
      </Transition>
      <Transition name="toast-fade">
        <div v-if="showReplyToast" class="status-toast status-toast--action" role="status" aria-live="polite">
          <span>Reply posted</span>
          <button type="button" class="status-toast__btn" @click="openThread(); showReplyToast = false">
            View
          </button>
        </div>
      </Transition>
      <Transition name="toast-fade">
        <div
          v-if="showReplyErrorToast"
          class="status-toast status-toast--action"
          role="alert"
          aria-live="assertive"
        >
          <span>Couldn’t find that post on your account’s server.</span>
        </div>
      </Transition>
      <PostActionSheet
        :open="shareOpen"
        title="Share"
        :actions="shareActions"
        @select="onShareSelect"
        @close="shareOpen = false"
      />
      <PostActionSheet
        :open="boostOpen"
        title="Repost"
        :actions="boostActions"
        @select="onBoostSelect"
        @close="boostOpen = false"
      />
      <Transition name="toast-fade">
        <div
          v-if="lightbox"
          ref="lightboxRef"
          class="status-lightbox"
          role="dialog"
          aria-modal="true"
          :aria-label="lightbox.alt && lightbox.alt !== 'Image' ? lightbox.alt : 'Image'"
          @click.self="closeLightbox"
        >
          <button type="button" class="status-lightbox__close" aria-label="Close" @click="closeLightbox">
            <NeoIcon name="x" :size="18" :stroke="2" />
          </button>
          <img :src="lightbox.src" :alt="lightbox.alt" class="status-lightbox__img" />
          <p v-if="lightbox.alt && lightbox.alt !== 'Image'" class="status-lightbox__caption">
            {{ lightbox.alt }}
          </p>
        </div>
      </Transition>
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
    padding: 0.65rem 0.75rem;
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

    .status-footer-row,
    .reply-composer {
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

  &-icon {
    width: 14px;
    height: 14px;
    opacity: 0.7;
  }

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
  align-items: center;
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
}

.status-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--neo-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  margin: -4px -4px -4px 0;

  &:hover {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
  }
}

.status-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 200px;
  max-width: calc(100vw - 2rem);
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  z-index: 40;
  overflow: hidden;
  padding: 0.375rem;
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
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-word;
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
    word-break: break-all;
    &:hover { text-decoration: underline; }
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
  padding: 0;
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

.status-media-image {
  width: 100%;
  max-width: 100%;
  height: auto;
  max-height: 350px;
  object-fit: cover;
  border-radius: 12px;
  display: block;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover { opacity: 0.95; }
}

.status-media-video,
.status-media-audio {
  width: 100%;
  max-width: 100%;
  border-radius: 12px;
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
  border-radius: 8px;
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

    &--external {
      display: none;
    }
  }

  // Boosted = success green (instrument, not Twitter)
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

  &--external {
    text-decoration: none;
    opacity: 0.65;

    &:hover {
      opacity: 1;
    }
  }
}

// ========================================
// Inline Reply Composer
// ========================================
.reply-composer {
  margin-top: 0.5rem;
  padding: 0.625rem;
  background: var(--neo-bg-tertiary);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &__input-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
  }

  &__avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    margin-top: 0.25rem;
  }

  &__textarea {
    flex: 1;
    resize: none;
    border: none;
    background: transparent;
    font-family: inherit;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--neo-text-primary);
    outline: none;
    min-height: 1.5em;
    max-height: 200px;

    &::placeholder {
      color: var(--neo-text-muted);
    }
  }

  &__error {
    font-size: 0.75rem;
    color: var(--neo-danger);
    padding-left: 2rem;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  &__cancel {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--neo-text-muted);
    border-radius: 999px;
    transition: all 0.12s ease;

    &:hover {
      background: var(--neo-bg-secondary);
      color: var(--neo-text-primary);
    }
  }

  &__submit {
    padding: 0.375rem 0.875rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-inverse);
    background: var(--neo-text-primary);
    border-radius: 999px;
    transition: all 0.12s ease;

    &:hover:not(:disabled) {
      opacity: 0.9;
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
}

.reply-expand-enter-active,
.reply-expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.reply-expand-enter-from,
.reply-expand-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
  padding: 0 0.625rem;
}
.reply-expand-enter-to,
.reply-expand-leave-from {
  max-height: 300px;
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
  .status-action--boosted {
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

<!-- Unscoped styles for teleported toast / lightbox -->
<style lang="scss">
.status-toast {
  position: fixed;
  bottom: 7.5rem;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: 2px;
  font-family: var(--neo-font-family-ui);
  font-size: 0.875rem;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  z-index: 9999;
  max-width: calc(100vw - 1.5rem);

  &--action {
    padding-right: 0.5rem;
  }

  &__btn {
    border: none;
    background: var(--neo-accent);
    color: var(--neo-text-inverse);
    font: inherit;
    font-weight: 600;
    font-size: 0.8125rem;
    padding: 0.35rem 0.65rem;
    border-radius: 2px;
    cursor: pointer;

    &:hover {
      background: var(--neo-accent-hover);
    }
  }

  @media (min-width: 1024px) {
    bottom: 2rem;
  }
}

.status-lightbox {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1.5rem;
  background: color-mix(in srgb, #000 78%, transparent);
  cursor: zoom-out;

  &__close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 2.5rem;
    height: 2.5rem;
    border: 1px solid color-mix(in srgb, #fff 35%, transparent);
    background: color-mix(in srgb, #000 40%, transparent);
    color: #fff;
    font-size: 1.5rem;
    line-height: 1;
    border-radius: 2px;
    cursor: pointer;

    &:hover {
      background: color-mix(in srgb, #000 60%, transparent);
    }
  }

  &__img {
    max-width: min(96vw, 1200px);
    max-height: 82vh;
    object-fit: contain;
    border-radius: 2px;
    cursor: default;
  }

  &__caption {
    margin: 0;
    max-width: 40rem;
    text-align: center;
    color: color-mix(in srgb, #fff 85%, transparent);
    font-size: 0.875rem;
  }
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>
