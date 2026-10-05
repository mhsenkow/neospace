<script setup lang="ts">
import type { mastodon } from 'masto'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { activeClient, clientFor } from '~/composables/useMasto'

interface Props {
  status: mastodon.v1.Status
  /** When true, skip per-card inline reply (thread page has sticky composer) */
  hideInlineReply?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hideInlineReply: false,
})
const emit = defineEmits<{
  replied: [status: mastodon.v1.Status]
}>()
const statusStore = useStatusStore()
const instancesStore = useInstancesStore()

const displayStatus = computed(() => props.status.reblog || props.status)
const isReblog = computed(() => !!props.status.reblog)
const reblogger = computed(() => isReblog.value ? props.status.account : null)

const isFavouriting = ref(false)
const isBoosting = ref(false)
const isMenuOpen = ref(false)
const isBookmarking = ref(false)
const isMuting = ref(false)
const isBlocking = ref(false)
const showCopiedToast = ref(false)
const showReplyToast = ref(false)
const likePop = ref(false)
const menuRef = ref<HTMLElement | null>(null)

const isReplying = ref(false)
const replyText = ref('')
const isPostingReply = ref(false)
const replyError = ref<string | null>(null)
const replyTextarea = ref<HTMLTextAreaElement | null>(null)

/** Media lightbox */
const lightbox = ref<{ src: string; alt: string } | null>(null)

/** Long-post collapse (Threads-style see more, without engagement bait) */
const contentExpanded = ref(false)
const plainLength = computed(() =>
  (displayStatus.value.content || '').replace(/<[^>]*>/g, '').length,
)
const isLongPost = computed(() => plainLength.value > 320)

const hasReplies = computed(() => (displayStatus.value.repliesCount || 0) > 0)

const isOwnPost = computed(() => {
  const user = instancesStore.currentUser
  if (!instancesStore.isAuthenticated || !user) return false
  return displayStatus.value.account.id === user.id ||
    displayStatus.value.account.acct === user.acct
})

const router = useRouter()

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

  // Foreign instance — resolve the URL to get a local ID on our instance
  if (url) {
    const localId = await statusStore.resolveStatus(url)
    if (localId) {
      _resolvedClientCache = primaryClient
      _resolvedIdCache = localId
      return { client: primaryClient, id: localId }
    }
  }

  // Last resort: try the raw ID on the primary client (might work for federated posts)
  _resolvedClientCache = primaryClient
  _resolvedIdCache = status.id
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
    displayStatus.value.favourited = !displayStatus.value.favourited
    displayStatus.value.favouritesCount += displayStatus.value.favourited ? 1 : -1
  } finally {
    isFavouriting.value = false
  }
}

const handleBoost = async () => {
  if (!canInteract.value || isBoosting.value) return

  isBoosting.value = true
  displayStatus.value.reblogged = !displayStatus.value.reblogged
  displayStatus.value.reblogsCount += displayStatus.value.reblogged ? 1 : -1

  try {
    const ctx = await getActionContext()
    if (!ctx) throw new Error('Not authenticated')

    if (displayStatus.value.reblogged) {
      await ctx.client.v1.statuses.$select(ctx.id).reblog()
    } else {
      await ctx.client.v1.statuses.$select(ctx.id).unreblog()
    }
  } catch (e) {
    console.error('Boost error:', e)
    displayStatus.value.reblogged = !displayStatus.value.reblogged
    displayStatus.value.reblogsCount += displayStatus.value.reblogged ? 1 : -1
  } finally {
    isBoosting.value = false
  }
}

const handleReply = () => {
  if (props.hideInlineReply) {
    // On thread page the sticky bar is the composer — focus it instead
    const bar = document.querySelector('.thread-reply-bar textarea') as HTMLTextAreaElement | null
    bar?.focus()
    return
  }
  if (!canInteract.value) {
    if (statusUrl.value) {
      window.open(statusUrl.value, '_blank')
    }
    return
  }
  isReplying.value = !isReplying.value
  replyError.value = null
  if (isReplying.value) {
    const acct = displayStatus.value.account.acct
    replyText.value = `@${acct} `
    nextTick(() => {
      replyTextarea.value?.focus()
      const len = replyText.value.length
      replyTextarea.value?.setSelectionRange(len, len)
    })
  }
}

const submitReply = async () => {
  const text = replyText.value.trim()
  if (!text || isPostingReply.value) return

  isPostingReply.value = true
  replyError.value = null

  try {
    const ctx = await getActionContext()
    if (!ctx) throw new Error('Not authenticated')

    await ctx.client.v1.statuses.create({
      status: text,
      inReplyToId: ctx.id,
      visibility: displayStatus.value.visibility as any,
    }).then((created) => {
      isReplying.value = false
      replyText.value = ''
      displayStatus.value.repliesCount = (displayStatus.value.repliesCount || 0) + 1
      emit('replied', created)
      showReplyToast.value = true
      setTimeout(() => { showReplyToast.value = false }, 3500)
    })
  } catch (e: any) {
    console.error('Reply error:', e)
    replyError.value = e.message || 'Failed to post reply'
  } finally {
    isPostingReply.value = false
  }
}

const cancelReply = () => {
  isReplying.value = false
  replyText.value = ''
  replyError.value = null
}

const autoResize = (e: Event) => {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

const handleShare = async () => {
  const url = statusUrl.value
  if (!url) return

  if (navigator.share) {
    try {
      await navigator.share({
        text: displayStatus.value.content?.replace(/<[^>]*>/g, '').slice(0, 200),
        url,
      })
      return
    } catch (e: any) {
      if (e.name === 'AbortError') return
    }
  }

  try {
    await navigator.clipboard.writeText(url)
    showCopiedToast.value = true
    setTimeout(() => { showCopiedToast.value = false }, 2000)
  } catch {
    // fallback: prompt
    prompt('Copy this link:', url)
  }
}

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

const onLightboxKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') closeLightbox()
}

watch(lightbox, (val) => {
  if (typeof document === 'undefined') return
  if (val) {
    document.addEventListener('keydown', onLightboxKey)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onLightboxKey)
    document.body.style.overflow = ''
  }
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
  document.removeEventListener('keydown', onLightboxKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <article class="status-card" :class="{ 'status-card--menu-open': isMenuOpen }">
    <!-- Reblog indicator -->
    <div v-if="isReblog" class="status-reblog">
      <svg class="status-reblog-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
        <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
      </svg>
      <span class="status-reblog-text">
        {{ reblogger!.displayName || reblogger!.username }} reposted
      </span>
    </div>

    <div class="status-main">
      <!-- Avatar Column -->
      <div class="status-avatar-col">
        <NuxtLink v-if="accountProfileTo" :to="accountProfileTo" class="status-avatar-link">
          <img
            :src="displayStatus.account.avatar"
            :alt="displayStatus.account.displayName || displayStatus.account.username"
            class="status-avatar"
          />
        </NuxtLink>
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
          />
        </a>
        <div v-if="hasReplies" class="status-thread-line"></div>
      </div>

      <!-- Content Column -->
      <div class="status-content-col">
        <!-- Header: username + time + menu -->
        <header class="status-header">
          <NuxtLink v-if="accountProfileTo" :to="accountProfileTo" class="status-author">
            <span class="status-display-name" v-html="displayStatus.account.displayName || displayStatus.account.username" />
          </NuxtLink>
          <a
            v-else
            :href="displayStatus.account.url"
            target="_blank"
            rel="noopener noreferrer"
            class="status-author"
          >
            <span class="status-display-name" v-html="displayStatus.account.displayName || displayStatus.account.username" />
          </a>
          <a :href="statusUrl || '#'" target="_blank" class="status-time">
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
        <details v-if="displayStatus.spoilerText" class="status-cw">
          <summary class="status-cw-summary">{{ displayStatus.spoilerText }}</summary>
          <div class="status-content status-content--clickable" v-html="displayStatus.content" @click="onContentClick" />
        </details>

        <!-- Regular Content -->
        <div v-else class="status-content-wrap">
          <div
            class="status-content status-content--clickable"
            :class="{ 'status-content--clamped': isLongPost && !contentExpanded }"
            v-html="displayStatus.content"
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

        <!-- Media Attachments -->
        <div v-if="displayStatus.mediaAttachments?.length" class="status-media">
          <template v-for="media in displayStatus.mediaAttachments" :key="media.id">
            <button
              v-if="media.type === 'image'"
              type="button"
              class="status-media-hit"
              @click.stop="openLightbox(media)"
            >
              <img
                :src="media.previewUrl ?? media.url ?? undefined"
                :alt="media.description || 'Image attachment'"
                class="status-media-image"
                loading="lazy"
              />
            </button>
            <video
              v-else-if="media.type === 'video' || media.type === 'gifv'"
              :src="media.url ?? undefined"
              :poster="media.previewUrl ?? undefined"
              controls
              :autoplay="media.type === 'gifv'"
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

        <!-- Actions -->
        <footer class="status-actions">
          <button
            class="status-action"
            :class="{
              'status-action--liked': displayStatus.favourited,
              'status-action--pop': likePop,
            }"
            :disabled="isFavouriting"
            aria-label="Like"
            @click="handleFavourite"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" :fill="displayStatus.favourited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
            <span v-if="displayStatus.favouritesCount" class="status-action__count">{{ formatNumber(displayStatus.favouritesCount) }}</span>
          </button>

          <button
            class="status-action"
            :class="{ 'status-action--replying': isReplying }"
            aria-label="Reply"
            @click="handleReply"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
            </svg>
            <span v-if="displayStatus.repliesCount" class="status-action__count">{{ formatNumber(displayStatus.repliesCount) }}</span>
          </button>

          <button
            class="status-action"
            :class="{ 'status-action--boosted': displayStatus.reblogged }"
            :disabled="isBoosting"
            aria-label="Repost"
            @click="handleBoost"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
              <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
            <span v-if="displayStatus.reblogsCount" class="status-action__count">{{ formatNumber(displayStatus.reblogsCount) }}</span>
          </button>

          <button class="status-action" aria-label="Share" @click="handleShare">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>

          <a
            v-if="statusUrl"
            :href="statusUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="status-action status-action--external"
            title="View on original instance"
            aria-label="View on original instance"
            @click.stop
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </footer>

        <!-- Inline Reply Composer -->
        <Transition name="reply-expand">
          <div v-if="isReplying && !hideInlineReply" class="reply-composer">
            <div class="reply-composer__input-row">
              <img
                v-if="instancesStore.currentUser?.avatar"
                :src="instancesStore.currentUser.avatar"
                class="reply-composer__avatar"
                alt=""
              />
              <textarea
                ref="replyTextarea"
                v-model="replyText"
                class="reply-composer__textarea"
                placeholder="Write a reply..."
                rows="1"
                @input="autoResize"
                @keydown.meta.enter="submitReply"
                @keydown.ctrl.enter="submitReply"
              />
            </div>
            <div v-if="replyError" class="reply-composer__error">{{ replyError }}</div>
            <div class="reply-composer__actions">
              <button class="reply-composer__cancel" @click="cancelReply">Cancel</button>
              <button
                class="reply-composer__submit"
                :disabled="!replyText.trim() || isPostingReply"
                @click="submitReply"
              >
                {{ isPostingReply ? 'Posting...' : 'Reply' }}
              </button>
            </div>
          </div>
        </Transition>

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
        <div v-if="showCopiedToast" class="status-toast">Link copied</div>
      </Transition>
      <Transition name="toast-fade">
        <div v-if="showReplyToast" class="status-toast status-toast--action">
          <span>Reply posted</span>
          <button type="button" class="status-toast__btn" @click="openThread(); showReplyToast = false">
            View thread
          </button>
        </div>
      </Transition>
      <Transition name="toast-fade">
        <div
          v-if="lightbox"
          class="status-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Image"
          @click.self="closeLightbox"
        >
          <button type="button" class="status-lightbox__close" aria-label="Close" @click="closeLightbox">
            ×
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
  display: block;
  text-decoration: none;
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

  &:has(> *:nth-child(2)) {
    grid-template-columns: repeat(2, 1fr);
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
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.15rem;
  margin-top: 0.5rem;
  margin-left: -0.35rem;
  max-width: 100%;
}

.status-action {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.45rem;
  min-height: 40px;
  min-width: 40px;
  justify-content: center;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1;

  svg {
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
