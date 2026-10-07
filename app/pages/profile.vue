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
  stripHtml,
} from '~/utils/sanitizeHtml'

const INTERNAL_FIELD_NAMES = new Set([
  'neospace_columns',
  'css',
  'custom_css',
  'theme',
  'style',
  'chaos_css',
])

const normalizeFieldKey = (name: string) =>
  name.toLowerCase().replace(/[^a-z_]/g, '')

const extractHttpUrl = (raw: string): string | null => {
  const plain = stripHtml(raw || '')
  const hrefMatch = raw?.match(/href=["'](https?:\/\/[^"']+)["']/i)
  if (hrefMatch?.[1]) return hrefMatch[1]
  const bare = plain.match(/https?:\/\/[^\s<>"']+/i)
  return bare?.[0] || null
}

const profileStore = useProfileStore()
const instancesStore = useInstancesStore()
const themeStore = useThemeStore()
const composeSheet = useComposeSheetStore()
const { open: openAccountSwitcher } = useAccountSwitcher()
const route = useRoute()
const router = useRouter()

const canSwitchAccounts = computed(
  () =>
    profileStore.isOwnProfile &&
    !route.query.user &&
    instancesStore.hasAuthenticatedInstance,
)

const safeProfileName = computed(() =>
  sanitizeDisplayName(
    profileStore.viewedProfile?.displayName || profileStore.viewedProfile?.username || '',
  ),
)
const safeProfileNote = computed(() => sanitizeStatusHtml(profileStore.viewedProfile?.note || ''))

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
    .map((f) => {
      const plainValue = stripHtml(f.value || '')
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

const websiteFieldUrl = computed(() => {
  const withUrl = fieldTokens.value.find((f) => f.href)
  return withUrl?.href || null
})

const instanceProfileUrl = computed(() => profileStore.viewedProfile?.url || null)

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
const profileTab = ref<'posts' | 'replies' | 'media' | 'insights'>('posts')

// File input refs
const avatarInput = ref<HTMLInputElement | null>(null)
const headerInput = ref<HTMLInputElement | null>(null)

const followerLabel = computed(() => {
  const n = profileStore.viewedProfile?.followersCount ?? 0
  const formatted = n >= 10000
    ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}K`
    : n.toLocaleString()
  return `${formatted} follower${n === 1 ? '' : 's'}`
})

const tabFetchOpts = computed(() => {
  if (profileTab.value === 'media') return { onlyMedia: true, excludeReplies: true }
  if (profileTab.value === 'replies') return { excludeReplies: false, onlyMedia: false }
  return { excludeReplies: true, onlyMedia: false }
})

const visibleStatuses = computed(() => {
  const list = profileStore.statuses
  if (profileTab.value === 'replies') {
    // Prefer posts that are replies; fall back to full list if API didn't filter
    const replies = list.filter((s) => !!s.inReplyToId)
    return replies.length ? replies : list
  }
  if (profileTab.value === 'posts') {
    return list.filter((s) => !s.inReplyToId)
  }
  return list
})

const setProfileTab = async (tab: 'posts' | 'replies' | 'media' | 'insights') => {
  if (profileTab.value === tab) return
  profileTab.value = tab
  if (tab === 'insights') return
  const opts =
    tab === 'media'
      ? { onlyMedia: true, excludeReplies: true }
      : tab === 'replies'
        ? { excludeReplies: false, onlyMedia: false }
        : { excludeReplies: true, onlyMedia: false }
  await profileStore.fetchStatuses(true, opts)
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
  } catch {
    /* ignore */
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
  const userParam = route.query.user
  const username = typeof userParam === 'string' ? userParam : undefined

  if (username) {
    await profileStore.fetchProfileByUsername(username)
  } else {
    await profileStore.fetchProfile()
  }

  profileTab.value = 'posts'

  if (!profileStore.isOwnProfile) {
    relationship.value = await profileStore.getRelationship()
  } else {
    relationship.value = null
  }

  if (profileStore.profileCustomCSS && themeStore.isChaosMode) {
    themeStore.setUserCustomCSS(profileStore.profileCustomCSS)
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
  () => route.fullPath,
  async () => {
    if (!profileRouteReady.value || route.path !== '/profile') return

    const hasAnyAuth = instancesStore.hasAuthenticatedInstance
    if (!hasAnyAuth) return

    await loadProfileFromRoute()
  },
)

// Cleanup
onUnmounted(() => {
  profileStore.clear()
})

const handleFollow = async () => {
  isFollowLoading.value = true
  try {
    if (relationship.value?.following) {
      relationship.value = await profileStore.unfollowUser() || null
    } else {
      relationship.value = await profileStore.followUser() || null
    }
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
  if (file) {
    profileStore.editForm.header = file
  }
}

const handleSaveProfile = async () => {
  try {
    await profileStore.updateProfile()
  } catch (e) {
    // Error is handled in store
  }
}

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
          title="Website"
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
          title="Open on instance"
          aria-label="Open on instance"
        >
          <NeoIcon name="servers" :size="18" :stroke="1.75" />
        </a>
        <button
          v-if="profileStore.viewedProfile"
          type="button"
          class="subview-chrome__btn neo-tip"
          title="Share profile"
          aria-label="Share profile"
          @click="shareProfile"
        >
          <NeoIcon name="share" :size="18" :stroke="1.75" />
        </button>
        <button
          v-if="!profileStore.isOwnProfile && profileStore.viewedProfile && instancesStore.hasAuthenticatedInstance"
          type="button"
          class="subview-chrome__btn neo-tip"
          title="Message"
          aria-label="Message"
          @click="messageUser"
        >
          <NeoIcon name="message" :size="18" :stroke="1.75" />
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
    <div v-else-if="profileStore.error" class="profile-error neo-card">
      <span>⚠️</span>
      <p>{{ profileStore.error }}</p>
      <NuxtLink to="/" class="neo-btn neo-btn--primary">Go Home</NuxtLink>
    </div>

    <!-- Profile Content -->
    <template v-else-if="profileStore.viewedProfile">
      <section class="profile-hero">
        <!-- Threads-style top: avatar left, actions right -->
        <div class="profile-top">
          <div class="profile-avatar-wrapper">
            <img
              :src="profileStore.viewedProfile.avatar"
              :alt="profileStore.viewedProfile.displayName || profileStore.viewedProfile.username"
              class="profile-avatar"
            />
            <button
              v-if="profileStore.isOwnProfile && profileStore.isEditing"
              type="button"
              class="profile-avatar__edit"
              aria-label="Change avatar"
              @click="triggerAvatarUpload"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
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

        <div class="profile-identity">
          <template v-if="profileStore.isEditing">
            <input
              v-model="profileStore.editForm.displayName"
              type="text"
              class="profile-name-input neo-input"
              placeholder="Display name"
            />
          </template>
          <button
            v-else-if="canSwitchAccounts"
            type="button"
            class="profile-name profile-name--switch"
            aria-haspopup="dialog"
            aria-label="Switch account"
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
          </button>
          <h1 v-else class="profile-name" v-html="safeProfileName" />

          <p class="profile-handle">
            @{{ profileStore.viewedProfile.acct }}
            <span v-if="profileStore.viewedProfile.bot" class="profile-chip">bot</span>
            <span v-if="profileStore.viewedProfile.locked" class="profile-chip profile-chip--lock" title="Private">
              <NeoIcon name="lock" :size="12" :stroke="2" />
            </span>
          </p>

          <template v-if="profileStore.isEditing">
            <textarea
              v-model="profileStore.editForm.note"
              class="profile-bio-input neo-input"
              placeholder="Write a bio…"
              rows="3"
            />
          </template>
          <div
            v-else-if="profileStore.viewedProfile.note"
            class="profile-bio"
            v-html="safeProfileNote"
          />

          <!-- Profile fields as wrapping token chips (internal sync fields hidden) -->
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
              <span v-if="field.verifiedAt" class="profile-token__verified" title="Verified">✓</span>
            </component>
          </div>

          <button
            type="button"
            class="profile-followers"
            @click="followersModalRef?.open('followers')"
          >
            {{ followerLabel }}
          </button>

          <div class="profile-cta">
            <template v-if="profileStore.isOwnProfile">
              <template v-if="profileStore.isEditing">
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
                  @click="profileStore.cancelEdit"
                >
                  Cancel
                </button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="neo-btn neo-btn--secondary profile-cta__btn"
                  @click="profileStore.toggleEditMode"
                >
                  Edit profile
                </button>
                <button
                  type="button"
                  class="neo-btn neo-btn--secondary profile-cta__btn"
                  @click="shareProfile"
                >
                  Share profile
                </button>
              </template>
            </template>
            <template v-else>
              <button
                type="button"
                class="neo-btn profile-cta__btn"
                :class="relationship?.following ? 'neo-btn--secondary' : 'neo-btn--primary'"
                :disabled="isFollowLoading"
                @click="handleFollow"
              >
                {{ relationship?.following ? 'Following' : 'Follow' }}
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

          <!-- Edit-only extras (fields, header, privacy) stay tucked away -->
          <div v-if="profileStore.isEditing" class="profile-edit-extras">
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
              <div
                v-for="(field, index) in profileStore.editForm.fields"
                :key="index"
                class="profile-field-row"
              >
                <input v-model="field.name" type="text" class="neo-input" placeholder="Label" />
                <input v-model="field.value" type="text" class="neo-input" placeholder="Link or value" />
                <button type="button" class="profile-field-remove" @click="profileStore.removeField(index)">✕</button>
              </div>
              <button
                v-if="profileStore.editForm.fields.length < 4"
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
        </div>
      </section>

      <!-- Threads-style tabs -->
      <nav class="profile-tabs" aria-label="Profile sections" role="tablist">
        <button
          type="button"
          role="tab"
          class="profile-tabs__tab"
          :class="{ 'profile-tabs__tab--active': profileTab === 'posts' }"
          :aria-selected="profileTab === 'posts'"
          @click="setProfileTab('posts')"
        >
          Posts
        </button>
        <button
          type="button"
          role="tab"
          class="profile-tabs__tab"
          :class="{ 'profile-tabs__tab--active': profileTab === 'replies' }"
          :aria-selected="profileTab === 'replies'"
          @click="setProfileTab('replies')"
        >
          Replies
        </button>
        <button
          type="button"
          role="tab"
          class="profile-tabs__tab"
          :class="{ 'profile-tabs__tab--active': profileTab === 'media' }"
          :aria-selected="profileTab === 'media'"
          @click="setProfileTab('media')"
        >
          Media
        </button>
        <button
          v-if="profileStore.isOwnProfile"
          type="button"
          role="tab"
          class="profile-tabs__tab"
          :class="{ 'profile-tabs__tab--active': profileTab === 'insights' }"
          :aria-selected="profileTab === 'insights'"
          @click="setProfileTab('insights')"
        >
          Insights
        </button>
      </nav>

      <ProfileInsights
        v-if="profileTab === 'insights' && profileStore.isOwnProfile && profileStore.viewedProfile"
        :account="profileStore.viewedProfile"
      />

      <template v-else>
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

            <button
              v-if="profileStore.hasMoreStatuses"
              type="button"
              class="neo-btn neo-btn--secondary profile-load-more"
              :disabled="profileStore.isLoadingStatuses"
              @click="profileStore.fetchStatuses(false, tabFetchOpts)"
            >
              {{ profileStore.isLoadingStatuses ? 'Loading…' : 'Load more' }}
            </button>
          </div>

          <div v-else class="profile-posts-empty">
            <p>
              {{
                profileTab === 'media'
                  ? 'No media yet.'
                  : profileTab === 'replies'
                    ? 'No replies yet.'
                    : 'No posts yet.'
              }}
            </p>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.profile-page {
  max-width: 640px;
  margin: 0 auto;
  padding: 0 0 2rem;
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

.profile-loading__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Threads-style hero — no banner, left avatar, compact CTAs
.profile-hero {
  padding: 1rem 1rem 0.25rem;
}

.profile-top {
  display: flex;
  align-items: flex-start;
  margin-bottom: 0.75rem;
}

.profile-avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.profile-avatar {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);
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

.profile-identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 0.35rem;
}

.profile-name {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--neo-text-primary);
  line-height: 1.2;
  letter-spacing: -0.02em;

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
  gap: 0.4rem;
  flex-wrap: wrap;
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

.profile-followers {
  margin: 0.5rem 0 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--neo-text-muted);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
    color: var(--neo-text-primary);
  }
}

.profile-cta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  width: 100%;
  margin-top: 0.85rem;
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
  display: flex;
  border-bottom: 1px solid var(--neo-border-color);
  margin: 0.75rem 0 0;
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--neo-bg-primary);

  @media (max-width: 1023px) {
    top: 52px;
  }
}

.profile-tabs__tab {
  flex: 1;
  height: 48px;
  border: none;
  background: transparent;
  color: var(--neo-text-muted);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  position: relative;

  &--active {
    color: var(--neo-text-primary);

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

  &:hover:not(.profile-tabs__tab--active) {
    color: var(--neo-text-secondary);
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

