<script setup lang="ts">
/**
 * Profile Page
 * 
 * Your digital home on the internet. A focused, beautiful
 * representation of who you are in the Fediverse.
 * Now supports multi-instance - view all your connected accounts!
 */

import { useProfileStore } from '~/stores/profile'
import { useInstancesStore } from '~/stores/instances'
import { useThemeStore } from '~/stores/theme'
import { useComposeSheetStore } from '~/stores/composeSheet'
import type { mastodon } from 'masto'
import {
  sanitizeDisplayName,
  sanitizeFieldHtml,
  sanitizeStatusHtml,
} from '~/utils/sanitizeHtml'
import { emojiUrlSet, emojify } from '~/utils/emojify'
import {
  buildPresenceLinks,
  extractHttpUrl,
  isPresenceField,
  mergePresenceIntoFields,
  normalizeFieldKey,
  profileFieldLimit,
  readPresenceDraft,
} from '~/utils/profileSources'
import { createRaceGuard } from '~/composables/useRace'
import { mapErrorToMessage } from '~/utils/friendlyError'
import { formatCompact } from '~/utils/insights'
import { useToastStore } from '~/stores/toast'
import { setReadAccountOverride } from '~/composables/useMasto'

const INTERNAL_FIELD_NAMES = new Set([
  'neospace_columns',
  'css',
  'custom_css',
  'theme',
  'style',
  'chaos_css',
])

const profileStore = useProfileStore()
const instancesStore = useInstancesStore()
const themeStore = useThemeStore()
const composeSheet = useComposeSheetStore()
const toastStore = useToastStore()
const { open: openAccountSwitcher } = useAccountSwitcher()
const route = useRoute()
const router = useRouter()
const profileRace = createRaceGuard()
const statusesRace = createRaceGuard()

const syncReadAccountOverride = () => {
  const account = route.query.account
  setReadAccountOverride(typeof account === 'string' ? account : null)
}
syncReadAccountOverride()
watch(() => route.query.account, syncReadAccountOverride)
onBeforeUnmount(() => setReadAccountOverride(null))

const canSwitchAccounts = computed(
  () =>
    profileStore.isOwnProfile &&
    !route.query.user &&
    instancesStore.hasAuthenticatedInstance,
)

const safeProfileName = computed(() => {
  const profile = profileStore.viewedProfile
  const raw = profile?.displayName || profile?.username || ''
  const emojis = profile?.emojis || []
  return sanitizeDisplayName(emojify(raw, emojis), emojiUrlSet(emojis))
})
const safeProfileNote = computed(() => {
  const profile = profileStore.viewedProfile
  const emojis = profile?.emojis || []
  return emojify(sanitizeStatusHtml(profile?.note || ''), emojis, { escape: false })
})

type ProfileFieldToken = {
  name: string
  plainValue: string
  safeValue: string
  href: string | null
  verifiedAt: string | null
}

const fieldTokens = computed((): ProfileFieldToken[] =>
  (profileStore.viewedProfile?.fields || [])
    .filter((f) => !INTERNAL_FIELD_NAMES.has(normalizeFieldKey(f.name || '')))
    .filter((f) => !isPresenceField(f))
    .map((f) => {
      const plainValue = (f.value || '').replace(/<[^>]*>/g, '').trim()
      return {
        name: f.name || '',
        plainValue,
        safeValue: sanitizeFieldHtml(f.value || ''),
        href: extractHttpUrl(f.value || ''),
        verifiedAt: f.verifiedAt || null,
      }
    })
    .filter((f) => f.name.trim() || f.plainValue.trim()),
)

const presenceLinks = computed(() =>
  buildPresenceLinks({
    mastodonUrl: profileStore.viewedProfile?.url,
    fields: profileStore.viewedProfile?.fields,
  }),
)

const websiteFieldUrl = computed(
  () => presenceLinks.value.find((l) => l.kind === 'website')?.href || null,
)

const instanceProfileUrl = computed(() => profileStore.viewedProfile?.url || null)

/** Dedicated cross-network inputs while editing (saved as Mastodon fields). */
const presenceDraft = ref({ bluesky: '', seenu: '', website: '' })

const syncPresenceDraft = () => {
  presenceDraft.value = readPresenceDraft(profileStore.editForm.fields)
}

const startEdit = () => {
  profileStore.toggleEditMode()
  if (profileStore.isEditing) {
    syncPresenceDraft()
    // Presence lives in dedicated inputs; keep other fields editable
    profileStore.editForm.fields = profileStore.editForm.fields.filter((f) => !isPresenceField(f))
  }
}

const cancelEdit = () => {
  profileStore.cancelEdit()
  presenceDraft.value = { bluesky: '', seenu: '', website: '' }
}

const presenceSlotsUsed = computed(
  () =>
    [presenceDraft.value.bluesky, presenceDraft.value.seenu, presenceDraft.value.website].filter(
      (v) => v.trim(),
    ).length,
)

const maxProfileFields = computed(() =>
  profileFieldLimit(instancesStore.activeAccount?.instanceInfo?.maxProfileFields),
)

const canAddCustomField = computed(
  () => profileStore.editForm.fields.length + presenceSlotsUsed.value < maxProfileFields.value,
)

const fieldLimitMessage = computed(() => {
  const cap = maxProfileFields.value
  const used = profileStore.editForm.fields.length + presenceSlotsUsed.value
  if (used <= cap) return ''
  return `Your server allows ${cap} profile fields — remove ${used - cap} to save.`
})

const headerPreviewUrl = ref<string | null>(null)
const headerObjectUrl = ref<string | null>(null)

const profileHeaderUrl = computed(() => {
  if (headerPreviewUrl.value) return headerPreviewUrl.value
  return profileStore.viewedProfile?.header || profileStore.viewedProfile?.headerStatic || null
})

const softwareLabel = computed(() => {
  const url = profileStore.viewedProfile?.url || instancesStore.activeAccount?.url || ''
  if (/gotosocial|gts\./i.test(url)) return 'GoToSocial'
  if (/akkoma|pleroma|misskey|pixelfed|friendica|peertube/i.test(url)) return 'Fediverse'
  return 'Mastodon'
})

const fullHandle = computed(() => {
  const p = profileStore.viewedProfile
  if (!p) return ''
  if (p.acct.includes('@')) return `@${p.acct}`
  try {
    const host = new URL(p.url || instancesStore.activeAccount?.url || '').hostname
    return `@${p.username}@${host}`
  } catch {
    return `@${p.acct || p.username}`
  }
})

const postsJoinLine = computed(() => {
  const p = profileStore.viewedProfile
  if (!p) return ''
  const posts = `${formatCount(p.statusesCount ?? 0)} ${(p.statusesCount ?? 0) === 1 ? 'post' : 'posts'}`
  const joined = profileStore.joinDate ? `Joined ${profileStore.joinDate}` : ''
  return joined ? `${posts} · ${joined}` : posts
})

const relationshipChips = computed(() => {
  const r = relationship.value
  if (!r) return [] as string[]
  const chips: string[] = []
  if (r.followedBy) chips.push('Follows you')
  if (r.muting) chips.push('Muted')
  if (r.blocking) chips.push('Blocked')
  if (r.domainBlocking) chips.push('Domain blocked')
  return chips
})

const copyHandle = async () => {
  try {
    await navigator.clipboard.writeText(fullHandle.value)
    toastStore.show({ message: 'Handle copied' })
  } catch {
    toastStore.show({ message: 'Couldn’t copy handle' })
  }
}

const chromeTitle = computed(() => {
  const p = profileStore.viewedProfile
  if (!p) return 'Profile'
  return p.displayName || p.username || 'Profile'
})

// Followers modal ref
const followersModalRef = ref<{ open: (tab?: 'followers' | 'following') => void } | null>(null)

// Relationship state
const relationship = ref<mastodon.v1.Relationship | null>(null)
const isFollowLoading = ref(false)
const profileTab = ref<'posts' | 'replies' | 'media' | 'reposts' | 'insights'>('posts')
const profileTabDefs = [
  { id: 'posts', label: 'Posts' },
  { id: 'replies', label: 'Replies' },
  { id: 'media', label: 'Media' },
  { id: 'reposts', label: 'Reposts' },
]

// File input refs
const avatarInput = ref<HTMLInputElement | null>(null)
const headerInput = ref<HTMLInputElement | null>(null)

const formatCount = (n: number) => formatCompact(n)

const followerCountLabel = computed(() => {
  const n = profileStore.viewedProfile?.followersCount ?? 0
  return `${formatCount(n)} follower${n === 1 ? '' : 's'}`
})

const followingCountLabel = computed(() => {
  const n = profileStore.viewedProfile?.followingCount ?? 0
  return `${formatCount(n)} following`
})

const openCompose = () => {
  composeSheet.show({
    placeholder: "What's new?",
    title: 'New post',
    onPosted: async () => {
      await profileStore.fetchStatuses(true, tabFetchOpts.value)
    },
  })
}

const tabFetchOpts = computed(() => {
  if (profileTab.value === 'media') return { onlyMedia: true, excludeReplies: true }
  if (profileTab.value === 'replies') return { excludeReplies: false, onlyMedia: false }
  // posts + reposts: include boosts so the Reposts tab can filter them
  return { excludeReplies: true, onlyMedia: false }
})

const visibleStatuses = computed(() => {
  const list = profileStore.statuses
  if (profileTab.value === 'replies') {
    return list.filter((s) => !!s.inReplyToId)
  }
  if (profileTab.value === 'reposts') {
    return list.filter((s) => !!s.reblog)
  }
  if (profileTab.value === 'posts') {
    return list.filter((s) => !s.inReplyToId && !s.reblog)
  }
  return list.filter((s) => !s.reblog)
})

const optsForTab = (tab: typeof profileTab.value) => {
  if (tab === 'media') return { onlyMedia: true, excludeReplies: true }
  if (tab === 'replies') return { excludeReplies: false, onlyMedia: false }
  return { excludeReplies: true, onlyMedia: false }
}

const fetchStatusesGuarded = async (refresh: boolean, opts: { excludeReplies?: boolean; onlyMedia?: boolean }) => {
  const ticket = statusesRace.next()
  await profileStore.fetchStatuses(refresh, opts)
  return ticket.isCurrent()
}

const setProfileTab = async (
  tab: 'posts' | 'replies' | 'media' | 'reposts' | 'insights',
) => {
  if (profileTab.value === tab) return
  profileTab.value = tab
  if (tab === 'insights') return
  await fetchStatusesGuarded(true, optsForTab(tab))
}

const shareProfile = async () => {
  const p = profileStore.viewedProfile
  if (!p) return
  const url = p.url || `${window.location.origin}/profile?user=${encodeURIComponent(p.acct)}`
  const title = p.displayName || p.username
  try {
    if (navigator.share) {
      await navigator.share({ title, url, text: `@${p.acct}` })
      return
    }
  } catch {
    /* cancelled */
  }
  try {
    await navigator.clipboard.writeText(url)
    const { useToastStore } = await import('~/stores/toast')
    useToastStore().show({ message: 'Profile link copied' })
  } catch {
    const { useToastStore } = await import('~/stores/toast')
    useToastStore().show({ message: 'Couldn’t copy link' })
  }
}

const messageUser = async () => {
  const account = profileStore.viewedProfile
  if (!account?.acct) return
  if (!instancesStore.hasAuthenticatedInstance) {
    router.push('/login')
    return
  }
  const { openOrComposeDirect } = await import('~/utils/dmHelpers')
  await openOrComposeDirect(account, router, {
    onPosted: async (status) => {
      const { useConversationsStore } = await import('~/stores/conversations')
      await useConversationsStore().fetchConversations(true)
      await router.push(`/status/${status.id}`)
    },
  })
}

async function loadProfileFromRoute() {
  const ticket = profileRace.next()
  relationship.value = null
  const userParam = route.query.user
  const username = typeof userParam === 'string' ? userParam : undefined

  if (username) {
    await profileStore.fetchProfileByUsername(username)
  } else {
    await profileStore.fetchProfile()
  }
  if (!ticket.isCurrent()) return

  profileTab.value = 'posts'

  if (!profileStore.isOwnProfile) {
    const rel = await profileStore.getRelationship()
    if (!ticket.isCurrent()) return
    relationship.value = rel
  } else {
    relationship.value = null
  }

  if (profileStore.profileCustomCSS && themeStore.isChaosMode && !themeStore.isSafeMode()) {
    themeStore.setUserCustomCSS(profileStore.profileCustomCSS)
  } else if (profileStore.isOwnProfile && themeStore.isChaosMode) {
    // Restore viewer CSS when leaving someone else's profile
    themeStore.setUserCustomCSS(profileStore.profileCustomCSS || themeStore.userCustomCSS)
  }
}

const profileRouteReady = ref(false)

// Initialize
onMounted(async () => {
  await instancesStore.initialize()

  const hasAnyAuth = instancesStore.hasAuthenticatedInstance

  if (!hasAnyAuth) {
    router.push('/login')
    return
  }

  await loadProfileFromRoute()
  profileRouteReady.value = true
})

watch(
  () => route.query.user,
  async () => {
    if (!profileRouteReady.value || route.path !== '/profile') return

    const hasAnyAuth = instancesStore.hasAuthenticatedInstance
    if (!hasAnyAuth) return

    await loadProfileFromRoute()
  },
)

// Cleanup
onUnmounted(() => {
  profileRace.abort()
  statusesRace.abort()
  if (headerObjectUrl.value) URL.revokeObjectURL(headerObjectUrl.value)
  if (!profileStore.isOwnProfile && themeStore.isChaosMode) {
    themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
  }
  profileStore.clear()
})

const followLabel = computed(() => {
  if (relationship.value?.following) return 'Following'
  if (relationship.value?.requested) return 'Requested'
  return 'Follow'
})

const handleFollow = async () => {
  if (relationship.value?.following) {
    const name = profileStore.viewedProfile?.displayName || profileStore.viewedProfile?.username || 'this account'
    const ok = await useOverlayStore().openConfirm({
      title: `Unfollow ${name}?`,
      body: 'Their posts will stop appearing in your home feed.',
      confirmLabel: 'Unfollow',
      danger: true,
    })
    if (!ok) return
  }

  isFollowLoading.value = true
  const prev = relationship.value
  try {
    if (relationship.value?.following || relationship.value?.requested) {
      relationship.value = await profileStore.unfollowUser() || null
    } else {
      // Optimistic “Following” / “Requested” until the server answers
      relationship.value = {
        ...(relationship.value || ({} as mastodon.v1.Relationship)),
        following: true,
        requested: false,
      } as mastodon.v1.Relationship
      relationship.value = await profileStore.followUser() || null
    }
  } catch (e) {
    relationship.value = prev
    const friendly = mapErrorToMessage(e)
    toastStore.show({ message: friendly.detail || friendly.title, duration: 4200 })
  } finally {
    isFollowLoading.value = false
  }
}

const handleAvatarChange = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    profileStore.editForm.avatar = file
  }
}

const handleHeaderChange = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toastStore.show({ message: 'Header must be an image file' })
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    toastStore.show({ message: 'Header image must be under 8 MB' })
    return
  }
  if (headerObjectUrl.value) URL.revokeObjectURL(headerObjectUrl.value)
  headerObjectUrl.value = URL.createObjectURL(file)
  headerPreviewUrl.value = headerObjectUrl.value
  profileStore.editForm.header = file
}

const handleSaveProfile = async () => {
  const prevFields = profileStore.editForm.fields.map((f) => ({ ...f }))
  try {
    profileStore.editForm.fields = mergePresenceIntoFields(
      prevFields,
      presenceDraft.value,
      maxProfileFields.value,
    )
    await profileStore.updateProfile()
  } catch {
    profileStore.editForm.fields = prevFields
    // saveError is set in the store — keep the form open
  }
}

const profileErrorFriendly = computed(() => {
  if (!profileStore.error) return null
  return mapErrorToMessage(new Error(profileStore.error))
})

const triggerAvatarUpload = () => {
  avatarInput.value?.click()
}

const triggerHeaderUpload = () => {
  headerInput.value?.click()
}

useHead({
  title: computed(() => 
    profileStore.viewedProfile 
      ? `${profileStore.viewedProfile.displayName || profileStore.viewedProfile.username} | NeoSpace`
      : 'Profile | NeoSpace'
  ),
})
</script>

<template>
  <div class="profile-page">
    <SubviewChrome :title="chromeTitle">
      <template #actions>
        <a
          v-if="websiteFieldUrl"
          class="subview-chrome__btn neo-tip"
          :href="websiteFieldUrl"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Website"
        >
          <NeoIcon name="globe" :size="18" :stroke="1.75" />
        </a>
        <a
          v-if="instanceProfileUrl"
          class="subview-chrome__btn neo-tip"
          :href="instanceProfileUrl"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open on instance"
        >
          <NeoIcon name="servers" :size="18" :stroke="1.75" />
        </a>
        <button
          v-if="profileStore.viewedProfile"
          type="button"
          class="subview-chrome__btn neo-tip"
          aria-label="Share profile"
          @click="shareProfile"
        >
          <NeoIcon name="share" :size="18" :stroke="1.75" />
        </button>
      </template>
    </SubviewChrome>

    <!-- Followers/Following Modal -->
    <FollowersModal 
      ref="followersModalRef" 
      :account-id="profileStore.viewedProfile?.id"
    />
    
    <p v-if="route.query.linked === '1' && !route.query.user" class="profile-linked-banner" role="status">
      Linked. Tap your name to switch.
    </p>

    <!-- Loading State -->
    <div v-if="profileStore.isLoading" class="profile-loading" aria-busy="true">
      <FunLoader fill label="Loading profile" />
    </div>

    <!-- Error State -->
    <div v-else-if="profileStore.error" class="profile-error neo-card" role="alert">
      <p class="profile-error__title">{{ profileErrorFriendly?.title || 'Couldn’t load profile' }}</p>
      <p>{{ profileErrorFriendly?.detail || profileStore.error }}</p>
      <div class="profile-error__actions">
        <button
          v-if="profileErrorFriendly?.retryable !== false"
          type="button"
          class="neo-btn neo-btn--primary"
          @click="loadProfileFromRoute"
        >
          Retry
        </button>
        <NuxtLink to="/" class="neo-btn neo-btn--secondary">Go Home</NuxtLink>
      </div>
    </div>

    <!-- Profile Content -->
    <template v-else-if="profileStore.viewedProfile">
      <section class="profile-hero">
        <div
          v-if="profileHeaderUrl"
          class="profile-header-banner"
          :style="{ backgroundImage: `url(${profileHeaderUrl})` }"
          role="img"
          :aria-label="profileStore.isEditing ? 'Profile header preview' : 'Profile header'"
        />

        <div class="profile-head">
          <div class="profile-head__text">
            <template v-if="profileStore.isEditing">
              <label class="sr-only" for="profile-display-name">Display name</label>
              <input
                id="profile-display-name"
                v-model="profileStore.editForm.displayName"
                type="text"
                class="profile-name-input neo-input"
                placeholder="Display name"
              />
            </template>
            <h1 v-if="canSwitchAccounts" class="profile-name profile-name--heading">
              <button
                type="button"
                class="profile-name profile-name--switch"
                aria-haspopup="dialog"
                @click="openAccountSwitcher"
              >
                <span class="profile-name__text" v-html="safeProfileName" />
                <svg
                  class="profile-name__chevron"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span class="sr-only">Switch account</span>
              </button>
            </h1>
            <h1 v-else class="profile-name" v-html="safeProfileName" />

            <p class="profile-handle">
              <button type="button" class="profile-handle__acct" :title="fullHandle" @click="copyHandle">
                {{ fullHandle }}
              </button>
              <span class="profile-handle__badge" :title="softwareLabel">{{ softwareLabel }}</span>
              <span v-for="chip in relationshipChips" :key="chip" class="profile-chip profile-chip--rel">{{ chip }}</span>
              <span v-if="profileStore.viewedProfile.bot" class="profile-chip">bot</span>
              <span
                v-if="profileStore.viewedProfile.locked"
                class="profile-chip profile-chip--lock"
                title="Private"
              >
                <NeoIcon name="lock" :size="12" :stroke="2" aria-hidden="true" />
                <span class="sr-only">Private account</span>
              </span>
            </p>
          </div>

          <div class="profile-avatar-wrapper">
            <img
              :src="profileStore.viewedProfile.avatar"
              alt=""
              class="profile-avatar"
            />
            <button
              v-if="profileStore.isOwnProfile && profileStore.isEditing"
              type="button"
              class="profile-avatar__edit"
              aria-label="Change avatar"
              @click="triggerAvatarUpload"
            >
              <NeoIcon name="camera" :size="14" :stroke="2" />
            </button>
            <input
              ref="avatarInput"
              type="file"
              accept="image/*"
              class="hidden-input"
              @change="handleAvatarChange"
            />
          </div>
        </div>

        <template v-if="profileStore.isEditing">
          <label class="sr-only" for="profile-bio">Bio</label>
          <textarea
            id="profile-bio"
            v-model="profileStore.editForm.note"
            class="profile-bio-input neo-input"
            placeholder="Write a bio…"
            rows="4"
          />
        </template>
        <div
          v-else-if="profileStore.viewedProfile.note"
          class="profile-bio"
          v-html="safeProfileNote"
        />

        <div v-if="!profileStore.isEditing && fieldTokens.length" class="profile-tokens">
          <component
            :is="field.href ? 'a' : 'span'"
            v-for="field in fieldTokens"
            :key="field.name + field.plainValue"
            class="profile-token"
            :class="{ 'profile-token--link': !!field.href }"
            v-bind="
              field.href
                ? { href: field.href, target: '_blank', rel: 'noopener noreferrer' }
                : {}
            "
            :title="field.plainValue || field.name"
          >
            <span v-if="field.name" class="profile-token__label">{{ field.name }}</span>
            <span class="profile-token__value">{{ field.plainValue || '—' }}</span>
            <span v-if="field.verifiedAt" class="profile-token__verified" title="Verified">
              ✓
              <span class="sr-only">Verified</span>
            </span>
          </component>
        </div>

        <!-- Stats + open-web presence (Mastodon / Bluesky / SeenU / site) -->
        <div v-if="!profileStore.isEditing" class="profile-social">
          <p class="profile-social__posts">{{ postsJoinLine }}</p>
          <div class="profile-social__stats-row">
            <button
              type="button"
              class="profile-social__stat"
              @click="followersModalRef?.open('followers')"
            >
              {{ followerCountLabel }}
            </button>
            <button
              type="button"
              class="profile-social__stat"
              @click="followersModalRef?.open('following')"
            >
              {{ followingCountLabel }}
            </button>
          </div>
          <div v-if="presenceLinks.length" class="profile-social__links">
            <a
              v-for="link in presenceLinks"
              :key="link.kind"
              class="profile-social__link neo-tip"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="`${link.label}: ${link.hint}`"
            >
              <NeoIcon v-if="link.kind === 'mastodon'" name="servers" :size="18" :stroke="1.75" />
              <NeoIcon v-else-if="link.kind === 'website'" name="globe" :size="18" :stroke="1.75" />
              <!-- Bluesky butterfly -->
              <svg
                v-else-if="link.kind === 'bluesky'"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 11.4c-.9-1.75-3.35-5-5.62-6.6C4.7 3.5 3.5 4.05 3.5 5.7c0 .55.3 4.55.5 5.25.6 2.15 2.7 2.85 4.6 2.5-.1.9-.15 1.75-.15 2.35 0 2.1 1.35 3.45 3.55 3.45s3.55-1.35 3.55-3.45c0-.6-.05-1.45-.15-2.35 1.9.35 4-.35 4.6-2.5.2-.7.5-4.7.5-5.25 0-1.65-1.2-2.2-2.88-.9C15.35 6.4 12.9 9.65 12 11.4z" />
              </svg>
              <!-- SeenU mark -->
              <svg
                v-else
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="8.25" />
                <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
                <path d="M12 3.75v2.5M12 17.75v2.5M3.75 12h2.5M17.75 12h2.5" />
              </svg>
            </a>
          </div>
        </div>

        <div class="profile-cta">
          <template v-if="profileStore.isOwnProfile">
            <template v-if="profileStore.isEditing">
              <p v-if="profileStore.saveError" class="profile-save-error" role="alert">
                {{ profileStore.saveError }}
              </p>
              <button
                type="button"
                class="neo-btn neo-btn--primary profile-cta__btn"
                :disabled="profileStore.isUpdating"
                @click="handleSaveProfile"
              >
                {{ profileStore.isUpdating ? 'Saving…' : 'Done' }}
              </button>
              <button
                type="button"
                class="neo-btn neo-btn--secondary profile-cta__btn"
                @click="cancelEdit"
              >
                Cancel
              </button>
            </template>
            <template v-else>
              <button
                type="button"
                class="neo-btn neo-btn--secondary profile-cta__btn"
                @click="startEdit"
              >
                Edit profile
              </button>
              <button
                type="button"
                class="neo-btn neo-btn--secondary profile-cta__btn"
                @click="setProfileTab('insights')"
              >
                View insights
              </button>
            </template>
          </template>
          <template v-else>
            <button
              type="button"
              class="neo-btn profile-cta__btn"
              :class="relationship?.following || relationship?.requested ? 'neo-btn--secondary' : 'neo-btn--primary'"
              :disabled="isFollowLoading"
              :aria-pressed="!!(relationship?.following || relationship?.requested)"
              @click="handleFollow"
            >
              {{ followLabel }}
            </button>
            <button
              type="button"
              class="neo-btn neo-btn--secondary profile-cta__btn"
              @click="messageUser"
            >
              Message
            </button>
          </template>
        </div>

        <div v-if="profileStore.isEditing" class="profile-edit-extras">
          <div class="profile-sources-editor">
            <p class="profile-sources-editor__label">Also on the open web</p>
            <label class="profile-source-field">
              <span>Bluesky</span>
              <input
                v-model="presenceDraft.bluesky"
                type="text"
                class="neo-input"
                placeholder="@you.bsky.social or profile URL"
                autocomplete="off"
              />
            </label>
            <label class="profile-source-field">
              <span>SeenU</span>
              <input
                v-model="presenceDraft.seenu"
                type="text"
                class="neo-input"
                placeholder="handle or seenu.io/…"
                autocomplete="off"
              />
            </label>
            <label class="profile-source-field">
              <span>Website</span>
              <input
                v-model="presenceDraft.website"
                type="text"
                class="neo-input"
                placeholder="yoursite.com"
                autocomplete="off"
              />
            </label>
            <p class="profile-sources-editor__hint">
              Saved as Mastodon profile fields so anyone can find you. Mastodon is always linked from this account.
            </p>
            <p v-if="fieldLimitMessage" class="profile-save-error" role="alert">{{ fieldLimitMessage }}</p>
          </div>

          <button type="button" class="neo-btn neo-btn--ghost" @click="triggerHeaderUpload">
            Change header image
          </button>
          <input
            ref="headerInput"
            type="file"
            accept="image/*"
            class="hidden-input"
            @change="handleHeaderChange"
          />

          <div class="profile-fields-editor">
            <p class="profile-sources-editor__label">Other fields</p>
            <div
              v-for="(field, index) in profileStore.editForm.fields"
              :key="index"
              class="profile-field-row"
            >
              <label class="sr-only" :for="`profile-field-name-${index}`">Field {{ index + 1 }} label</label>
              <input
                :id="`profile-field-name-${index}`"
                v-model="field.name"
                type="text"
                class="neo-input"
                placeholder="Label"
              />
              <label class="sr-only" :for="`profile-field-value-${index}`">Field {{ index + 1 }} value</label>
              <input
                :id="`profile-field-value-${index}`"
                v-model="field.value"
                type="text"
                class="neo-input"
                placeholder="Link or value"
              />
              <button
                type="button"
                class="profile-field-remove"
                :aria-label="`Remove field ${index + 1}`"
                @click="profileStore.removeField(index)"
              >
                ✕
              </button>
            </div>
            <button
              v-if="canAddCustomField"
              type="button"
              class="neo-btn neo-btn--ghost"
              @click="profileStore.addField"
            >
              + Add field
            </button>
          </div>

          <label class="profile-toggle">
            <input v-model="profileStore.editForm.locked" type="checkbox" />
            <span>Require follow approval</span>
          </label>
          <label class="profile-toggle">
            <input v-model="profileStore.editForm.discoverable" type="checkbox" />
            <span>Discoverable in search</span>
          </label>
          <label class="profile-toggle">
            <input v-model="profileStore.editForm.bot" type="checkbox" />
            <span>This is a bot account</span>
          </label>
        </div>
      </section>

      <NeoTabs
        class="profile-tabs"
        :tabs="profileTabDefs"
        :model-value="profileTab === 'insights' ? 'posts' : profileTab"
        :panels="false"
        controls-id="profile-tab-panel"
        @update:model-value="setProfileTab($event as 'posts' | 'replies' | 'media' | 'reposts')"
      />

      <div id="profile-tab-panel">
        <ProfileInsights
          v-if="profileTab === 'insights' && profileStore.isOwnProfile && profileStore.viewedProfile"
          :account="profileStore.viewedProfile"
        />

        <template v-else>
          <button
            v-if="profileStore.isOwnProfile && profileTab === 'posts'"
            type="button"
            class="profile-compose"
            @click="openCompose"
          >
            <img
              :src="profileStore.viewedProfile.avatar"
              alt=""
              class="profile-compose__avatar"
              width="36"
              height="36"
            />
            <span class="profile-compose__placeholder">What's new?</span>
            <span class="profile-compose__post">Post</span>
          </button>

          <section v-if="profileStore.pinnedStatuses.length && profileTab === 'posts'" class="profile-pinned">
            <RealPostCard
              v-for="status in profileStore.pinnedStatuses"
              :key="'pin-' + status.id"
              :status="status"
            />
          </section>

          <section class="profile-posts-section">
            <div v-if="profileStore.isLoadingStatuses && !visibleStatuses.length" class="profile-posts-loading" aria-busy="true">
              <FunLoader fill label="Loading posts" />
            </div>

            <div v-else-if="visibleStatuses.length" class="profile-posts">
              <RealPostCard
                v-for="status in visibleStatuses"
                :key="status.id"
                :status="status"
              />
            </div>

            <div v-else class="profile-posts-empty">
              <p>
                {{
                  profileTab === 'media'
                    ? 'No media yet.'
                    : profileTab === 'replies'
                      ? 'No replies yet.'
                      : profileTab === 'reposts'
                        ? 'No reposts yet.'
                        : 'No posts yet.'
                }}
              </p>
            </div>

            <button
              v-if="profileStore.hasMoreStatuses && !profileStore.isLoadingStatuses"
              type="button"
              class="neo-btn neo-btn--secondary profile-load-more"
              @click="profileStore.fetchStatuses(false, tabFetchOpts)"
            >
              Load more
            </button>
            <p
              v-else-if="profileStore.hasMoreStatuses && profileStore.isLoadingStatuses"
              class="profile-load-more profile-load-more--busy"
              aria-live="polite"
            >
              Loading…
            </p>
          </section>
        </template>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.profile-page {
  width: 100%;
  max-width: 640px;
  min-width: 0;
  margin: 0 auto;
  padding: 0 0 2rem;
  box-sizing: border-box;
}

.profile-header-banner {
  width: 100%;
  height: 140px;
  margin: 0 0 0.75rem;
  border-radius: 12px;
  background: var(--neo-bg-secondary) center / cover no-repeat;
  border: 1px solid var(--neo-border-color);
}

.profile-handle__acct {
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  color: var(--neo-text-muted);
  cursor: pointer;

  &:hover {
    color: var(--neo-text-primary);
    text-decoration: underline;
  }
}

.profile-handle__badge {
  font-size: 0.6875rem;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
  background: var(--neo-bg-tertiary);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
}

.profile-chip--rel {
  background: var(--neo-accent-soft);
  color: var(--neo-text-secondary);
}

.profile-social__posts {
  margin: 0 0 0.35rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.profile-social__stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem 1rem;
}

.profile-social__stat {
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.hidden-input {
  display: none;
}

.profile-linked-banner {
  margin: 0.75rem 1rem 0;
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  background: var(--neo-accent-soft);
  color: var(--neo-text-primary);
  font-size: 0.8125rem;
  line-height: 1.4;

  @media (min-width: 1024px) {
    margin-left: 0;
    margin-right: 0;
  }
}

// Loading & Error States
.profile-loading {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  width: 100%;
  min-height: min(70dvh, 36rem);
  padding: 1.5rem;
  box-sizing: border-box;
}

.profile-error,
.profile-posts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 4rem 2rem;
  text-align: center;

  span {
    font-size: 3rem;
  }

  p {
    color: var(--neo-text-muted);
    font-size: 1rem;
  }
}

.profile-error__title {
  font-weight: 600;
  color: var(--neo-text-primary);
  margin: 0;
}

.profile-error__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.profile-save-error {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--neo-danger) 12%, transparent);
  color: var(--neo-danger);
  font-size: 0.875rem;
}

.profile-loading__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Threads-style hero — name left, avatar right, presence row
.profile-hero {
  padding: 0.85rem 1rem 0.35rem;
}

.profile-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.65rem;
}

.profile-head__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding-top: 0.15rem;
}

.profile-avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.profile-avatar {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);

  @media (min-width: 480px) {
    width: 96px;
    height: 96px;
  }
}

.profile-avatar__edit {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  color: var(--neo-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-name {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--neo-text-primary);
  line-height: 1.15;
  letter-spacing: -0.03em;

  :deep(img.emoji) {
    height: 1em;
    vertical-align: middle;
  }

  &--switch {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    &:hover .profile-name__chevron,
    &:focus-visible .profile-name__chevron {
      color: var(--neo-text-primary);
    }
  }
}

.profile-name__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-name__chevron {
  flex-shrink: 0;
  color: var(--neo-text-muted);
  transition: color 0.15s ease, transform 0.15s ease;
}

.profile-name-input {
  font-size: 1.25rem;
  font-weight: 700;
  width: 100%;
}

.profile-handle {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--neo-text-muted);
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.profile-handle__acct {
  color: var(--neo-text-secondary);
}

.profile-handle__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-tertiary);
}

.profile-chip {
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-tertiary);
  text-transform: lowercase;

  &--lock {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.15rem 0.35rem;
    text-transform: none;
  }
}

.profile-bio {
  margin: 0.35rem 0 0;
  font-size: 0.9375rem;
  line-height: 1.45;
  color: var(--neo-text-primary);
  width: 100%;

  :deep(p) {
    margin: 0 0 0.35rem;
  }

  :deep(a) {
    color: var(--neo-accent);
  }
}

.profile-bio-input {
  width: 100%;
  margin-top: 0.35rem;
  resize: vertical;
}

.profile-tokens {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.55rem;
  width: 100%;
  max-width: 100%;
}

.profile-token {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 100%;
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--neo-border-color);
  background: var(--neo-bg-secondary, var(--neo-bg-tertiary));
  color: var(--neo-text-secondary);
  font-size: 0.75rem;
  font-weight: 550;
  line-height: 1.25;
  text-decoration: none;
  box-sizing: border-box;

  &--link {
    color: var(--neo-accent);
    border-color: color-mix(in srgb, var(--neo-accent) 35%, var(--neo-border-color));

    &:hover {
      background: color-mix(in srgb, var(--neo-accent) 10%, var(--neo-bg-secondary, var(--neo-bg-tertiary)));
    }
  }

  &__label {
    color: var(--neo-text-quaternary);
    font-weight: 600;
    flex-shrink: 0;
  }

  &__value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__verified {
    color: var(--neo-accent);
    font-size: 0.6875rem;
    flex-shrink: 0;
  }
}

.profile-social {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  margin-top: 0.75rem;
}

.profile-social__stats {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--neo-text-muted);
  cursor: pointer;
  text-align: left;
  min-width: 0;

  &:hover {
    text-decoration: underline;
    color: var(--neo-text-primary);
  }
}

.profile-social__links {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

.profile-social__link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: var(--neo-text-secondary);
  text-decoration: none;

  &:hover {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
  }
}

.profile-cta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  width: 100%;
  margin-top: 0.9rem;
}

.profile-cta__btn {
  width: 100%;
  justify-content: center;
  font-weight: 600;
  border-radius: 10px;
}

.profile-edit-extras {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  width: 100%;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--neo-border-color);
}

.profile-sources-editor {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;

  &__label {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--neo-text-quaternary);
  }

  &__hint {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--neo-text-muted);
  }
}

.profile-source-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-secondary);

  .neo-input {
    font-weight: 500;
  }
}

.profile-compose {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  margin: 0;
  padding: 0.75rem 1rem;
  border: none;
  border-bottom: 1px solid var(--neo-border-color);
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;

  &:hover {
    background: color-mix(in srgb, var(--neo-text-primary) 3%, transparent);
  }

  &__avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  &__placeholder {
    flex: 1;
    min-width: 0;
    font-size: 0.9375rem;
    color: var(--neo-text-muted);
  }

  &__post {
    flex-shrink: 0;
    padding: 0.35rem 0.85rem;
    border-radius: 999px;
    border: 1px solid var(--neo-border-color);
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--neo-text-secondary);
  }
}

.profile-fields-editor {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.profile-field-row {
  display: grid;
  grid-template-columns: 1fr 1.4fr auto;
  gap: 0.35rem;
}

.profile-field-remove {
  border: none;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;
  padding: 0 0.35rem;
}

.profile-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--neo-text-secondary);
  cursor: pointer;
}

.profile-tabs {
  margin: 0.75rem 0 0;
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--neo-bg-primary);

  @media (max-width: 1023px) {
    top: var(--neo-subview-chrome-height, 52px);
  }

  :deep(.neo-tabs__list) {
    display: flex;
    border-bottom: 1px solid var(--neo-border-color);
    gap: 0;
  }

  :deep(.neo-tabs__tab) {
    flex: 1;
    height: 48px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--neo-text-muted);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 600;
    box-shadow: none;
    position: relative;

    &[aria-selected='true'] {
      color: var(--neo-text-primary);
      box-shadow: none;

      &::after {
        content: '';
        position: absolute;
        left: 20%;
        right: 20%;
        bottom: 0;
        height: 2px;
        border-radius: 2px 2px 0 0;
        background: var(--neo-text-primary);
      }
    }

    &:hover:not([aria-selected='true']) {
      color: var(--neo-text-secondary);
      background: transparent;
    }
  }
}

.profile-pinned,
.profile-posts-section {
  margin-top: 0;
}

.profile-posts-loading {
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: 100%;
  min-height: min(48dvh, 22rem);
  padding: 1.25rem;
  box-sizing: border-box;
}

.profile-load-more {
  display: block;
  margin: 1rem auto 2rem;
}

@media (max-width: 1023px) {
  .profile-hero {
    padding-left: 1rem;
    padding-right: 1rem;
  }
}

.profile-pinned,
.profile-posts {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0 0.5rem 0.5rem;
}

// Chaos Mode Enhancements
:global(.chaos-active) {
  .profile-avatar {
    border-color: var(--neo-accent);
    box-shadow: 0 0 20px var(--neo-accent);
  }

  .profile-name {
    text-shadow: 0 0 10px var(--neo-text-primary);
  }
}

</style>

