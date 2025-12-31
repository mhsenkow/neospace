<script setup lang="ts">
/**
 * Profile Page
 * 
 * Your digital home on the internet. A focused, beautiful
 * representation of who you are in the Fediverse.
 * Now supports multi-instance - view all your connected accounts!
 */

import { useProfileStore } from '~/stores/profile'
import { useAuthStore } from '~/stores/auth'
import { useThemeStore } from '~/stores/theme'
import { useInstancesStore } from '~/stores/instances'
import type { mastodon } from 'masto'

const profileStore = useProfileStore()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const instancesStore = useInstancesStore()
const route = useRoute()
const router = useRouter()

// Instance manager ref
const instanceManagerRef = ref<{ open: () => void } | null>(null)

// Relationship state
const relationship = ref<mastodon.v1.Relationship | null>(null)
const isFollowLoading = ref(false)

// File input refs
const avatarInput = ref<HTMLInputElement | null>(null)
const headerInput = ref<HTMLInputElement | null>(null)

// Initialize
onMounted(async () => {
  // Initialize instances store for multi-account view
  await instancesStore.initialize()
  
  // For profile viewing, we still need auth for the main profile
  const hasAnyAuth = authStore.isAuthenticated || instancesStore.hasAuthenticatedInstance
  
  if (!hasAnyAuth) {
    router.push('/login')
    return
  }

  // Check if viewing specific user or self
  const username = route.query.user as string
  
  if (username) {
    await profileStore.fetchProfileByUsername(username)
  } else {
    await profileStore.fetchProfile()
  }

  // Get relationship if viewing someone else
  if (!profileStore.isOwnProfile) {
    relationship.value = await profileStore.getRelationship()
  }

  // Apply user's custom CSS if they have one
  if (profileStore.profileCustomCSS && themeStore.isChaosMode) {
    themeStore.setUserCustomCSS(profileStore.profileCustomCSS)
  }
})

// Cleanup
onUnmounted(() => {
  profileStore.clear()
})

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

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
    <!-- Instance Manager Modal -->
    <InstanceManager ref="instanceManagerRef" />
    
    <!-- Connected Accounts Overview (when viewing own profile with multi-instance) -->
    <section 
      v-if="instancesStore.authenticatedInstances.length > 0 && !route.query.user" 
      class="connected-accounts neo-card"
    >
      <div class="connected-accounts__header">
        <h2>🌐 Your Fediverse Accounts</h2>
        <button class="connected-accounts__add" @click="instanceManagerRef?.open()">
          + Add Account
        </button>
      </div>
      
      <div class="connected-accounts__list">
        <div 
          v-for="instance in instancesStore.authenticatedInstances" 
          :key="instance.id"
          class="account-card"
          :class="{ 'account-card--active': instance.url === authStore.instanceUrl }"
        >
          <img 
            :src="instance.user?.avatar" 
            :alt="instance.user?.displayName || instance.user?.username"
            class="account-card__avatar"
          />
          <div class="account-card__info">
            <span class="account-card__name">{{ instance.user?.displayName || instance.user?.username }}</span>
            <span class="account-card__handle">@{{ instance.user?.acct }}</span>
            <span class="account-card__instance">{{ instance.name }}</span>
          </div>
          <div class="account-card__stats">
            <span>{{ instance.user?.statusesCount }} posts</span>
            <span>{{ instance.user?.followersCount }} followers</span>
          </div>
        </div>
      </div>
      
      <div v-if="instancesStore.watchingInstances.length > 0" class="watching-instances">
        <span class="watching-label">Also watching:</span>
        <span 
          v-for="instance in instancesStore.watchingInstances" 
          :key="instance.id"
          class="watching-badge"
        >
          {{ instance.name }}
        </span>
      </div>
    </section>
    
    <!-- Loading State -->
    <div v-if="profileStore.isLoading" class="profile-loading">
      <span class="profile-loading__spinner">🌀</span>
      <p>Loading profile...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="profileStore.error" class="profile-error neo-card">
      <span>⚠️</span>
      <p>{{ profileStore.error }}</p>
      <NuxtLink to="/" class="neo-btn neo-btn--primary">Go Home</NuxtLink>
    </div>

    <!-- Profile Content -->
    <template v-else-if="profileStore.viewedProfile">
      <!-- Hero Section -->
      <section class="profile-hero">
        <!-- Header Image -->
        <div class="profile-header">
          <img 
            v-if="profileStore.viewedProfile.header && !profileStore.viewedProfile.header.includes('missing')"
            :src="profileStore.viewedProfile.header"
            :alt="`${profileStore.viewedProfile.displayName}'s header`"
            class="profile-header__image"
          />
          <div v-else class="profile-header__placeholder" />
          
          <!-- Edit header button -->
          <button 
            v-if="profileStore.isOwnProfile && profileStore.isEditing"
            class="profile-header__edit"
            @click="triggerHeaderUpload"
          >
            📷 Change Header
          </button>
          <input 
            ref="headerInput"
            type="file"
            accept="image/*"
            class="hidden-input"
            @change="handleHeaderChange"
          />
        </div>

        <!-- Avatar & Basic Info -->
        <div class="profile-identity">
          <div class="profile-avatar-wrapper">
            <img 
              :src="profileStore.viewedProfile.avatar"
              :alt="profileStore.viewedProfile.displayName || profileStore.viewedProfile.username"
              class="profile-avatar"
            />
            <!-- Edit avatar button -->
            <button 
              v-if="profileStore.isOwnProfile && profileStore.isEditing"
              class="profile-avatar__edit"
              @click="triggerAvatarUpload"
            >
              📷
            </button>
            <input 
              ref="avatarInput"
              type="file"
              accept="image/*"
              class="hidden-input"
              @change="handleAvatarChange"
            />
            <!-- Badges -->
            <div class="profile-badges">
              <span v-if="profileStore.viewedProfile.bot" class="profile-badge profile-badge--bot">🤖 Bot</span>
              <span v-if="profileStore.viewedProfile.locked" class="profile-badge profile-badge--locked">🔒</span>
            </div>
          </div>

          <div class="profile-info">
            <!-- Edit Mode: Display Name -->
            <template v-if="profileStore.isEditing">
              <input 
                v-model="profileStore.editForm.displayName"
                type="text"
                class="profile-name-input neo-input"
                placeholder="Display Name"
              />
            </template>
            <template v-else>
              <h1 class="profile-name" v-html="profileStore.viewedProfile.displayName || profileStore.viewedProfile.username" />
            </template>
            
            <p class="profile-handle">
              @{{ profileStore.viewedProfile.acct }}
            </p>

            <!-- Stats Row -->
            <div class="profile-stats">
              <div class="profile-stat">
                <span class="profile-stat__value">{{ profileStore.viewedProfile.statusesCount?.toLocaleString() }}</span>
                <span class="profile-stat__label">Posts</span>
              </div>
              <div class="profile-stat">
                <span class="profile-stat__value">{{ profileStore.viewedProfile.followingCount?.toLocaleString() }}</span>
                <span class="profile-stat__label">Following</span>
              </div>
              <div class="profile-stat">
                <span class="profile-stat__value">{{ profileStore.viewedProfile.followersCount?.toLocaleString() }}</span>
                <span class="profile-stat__label">Followers</span>
              </div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="profile-actions">
            <template v-if="profileStore.isOwnProfile">
              <template v-if="profileStore.isEditing">
                <button 
                  class="neo-btn neo-btn--primary"
                  :disabled="profileStore.isUpdating"
                  @click="handleSaveProfile"
                >
                  {{ profileStore.isUpdating ? 'Saving...' : 'Save Changes' }}
                </button>
                <button 
                  class="neo-btn neo-btn--secondary"
                  @click="profileStore.cancelEdit"
                >
                  Cancel
                </button>
              </template>
              <template v-else>
                <button 
                  class="neo-btn neo-btn--primary"
                  @click="profileStore.toggleEditMode"
                >
                  ✏️ Edit Profile
                </button>
              </template>
            </template>
            <template v-else>
              <button 
                class="neo-btn"
                :class="relationship?.following ? 'neo-btn--secondary' : 'neo-btn--primary'"
                :disabled="isFollowLoading"
                @click="handleFollow"
              >
                {{ relationship?.following ? 'Following ✓' : 'Follow' }}
              </button>
              <button class="neo-btn neo-btn--ghost">💬 Message</button>
            </template>
          </div>
        </div>
      </section>

      <!-- Bio Section -->
      <section class="profile-bio neo-card">
        <h2 class="profile-section-title">About</h2>
        
        <template v-if="profileStore.isEditing">
          <textarea
            v-model="profileStore.editForm.note"
            class="profile-bio-input neo-input"
            placeholder="Tell the world about yourself..."
            rows="4"
          />
        </template>
        <template v-else>
          <div 
            v-if="profileStore.viewedProfile.note"
            class="profile-bio__content"
            v-html="profileStore.viewedProfile.note"
          />
          <p v-else class="profile-bio__empty">No bio yet.</p>
        </template>

        <!-- Join Date -->
        <p class="profile-joined">
          📅 Joined {{ profileStore.joinDate }}
        </p>
      </section>

      <!-- Profile Fields -->
      <section v-if="profileStore.viewedProfile.fields?.length || profileStore.isEditing" class="profile-fields neo-card">
        <h2 class="profile-section-title">Profile Fields</h2>
        
        <template v-if="profileStore.isEditing">
          <div class="profile-fields-editor">
            <div 
              v-for="(field, index) in profileStore.editForm.fields" 
              :key="index"
              class="profile-field-row"
            >
              <input 
                v-model="field.name"
                type="text"
                class="neo-input profile-field-name"
                placeholder="Label"
              />
              <input 
                v-model="field.value"
                type="text"
                class="neo-input profile-field-value"
                placeholder="Value"
              />
              <button 
                class="profile-field-remove"
                @click="profileStore.removeField(index)"
              >
                ✕
              </button>
            </div>
            <button 
              v-if="profileStore.editForm.fields.length < 4"
              class="neo-btn neo-btn--ghost profile-field-add"
              @click="profileStore.addField"
            >
              + Add Field
            </button>
            <p class="profile-fields-hint">
              💡 Add a field named <code>css</code> with your custom CSS to enable personalized Chaos Mode!
            </p>
          </div>
        </template>
        <template v-else>
          <dl class="profile-fields-list">
            <div 
              v-for="field in profileStore.viewedProfile.fields" 
              :key="field.name"
              class="profile-field"
            >
              <dt class="profile-field__name">{{ field.name }}</dt>
              <dd class="profile-field__value" v-html="field.value" />
              <span v-if="field.verifiedAt" class="profile-field__verified" title="Verified">✓</span>
            </div>
          </dl>
        </template>
      </section>

      <!-- Privacy Settings (Edit Mode) -->
      <section v-if="profileStore.isEditing" class="profile-privacy neo-card">
        <h2 class="profile-section-title">Privacy & Settings</h2>
        
        <label class="profile-toggle">
          <input v-model="profileStore.editForm.locked" type="checkbox" />
          <span class="profile-toggle__label">
            <span>🔒 Require follow approval</span>
            <span class="profile-toggle__desc">New followers must be approved</span>
          </span>
        </label>

        <label class="profile-toggle">
          <input v-model="profileStore.editForm.discoverable" type="checkbox" />
          <span class="profile-toggle__label">
            <span>🔍 Discoverable</span>
            <span class="profile-toggle__desc">Appear in profile directories</span>
          </span>
        </label>

        <label class="profile-toggle">
          <input v-model="profileStore.editForm.bot" type="checkbox" />
          <span class="profile-toggle__label">
            <span>🤖 This is a bot account</span>
            <span class="profile-toggle__desc">Mark as automated</span>
          </span>
        </label>
      </section>

      <!-- Pinned Posts -->
      <section v-if="profileStore.pinnedStatuses.length" class="profile-pinned">
        <h2 class="profile-section-title">📌 Pinned Posts</h2>
        <div class="profile-posts">
          <RealPostCard 
            v-for="status in profileStore.pinnedStatuses" 
            :key="status.id" 
            :status="status"
          />
        </div>
      </section>

      <!-- Posts Section -->
      <section class="profile-posts-section">
        <h2 class="profile-section-title">Posts</h2>
        
        <div v-if="profileStore.isLoadingStatuses && !profileStore.statuses.length" class="profile-posts-loading">
          <span>🌀</span> Loading posts...
        </div>

        <div v-else-if="profileStore.statuses.length" class="profile-posts">
          <RealPostCard 
            v-for="status in profileStore.statuses" 
            :key="status.id" 
            :status="status"
          />

          <button 
            v-if="profileStore.hasMoreStatuses"
            class="neo-btn neo-btn--secondary profile-load-more"
            :disabled="profileStore.isLoadingStatuses"
            @click="profileStore.fetchStatuses()"
          >
            {{ profileStore.isLoadingStatuses ? 'Loading...' : 'Load More' }}
          </button>
        </div>

        <div v-else class="profile-posts-empty neo-card">
          <span>📝</span>
          <p>No posts yet.</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.profile-page {
  max-width: 800px;
  margin: 0 auto;
}

.hidden-input {
  display: none;
}

// Connected Accounts Section
.connected-accounts {
  margin-bottom: 1.5rem;
  
  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    
    h2 {
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--neo-text-primary);
    }
  }
  
  &__add {
    background: transparent;
    border: 1px dashed var(--neo-border-color);
    color: var(--neo-accent);
    padding: 0.375rem 0.75rem;
    border-radius: 8px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    
    &:hover {
      border-color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }
  }
  
  &__list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
}

.account-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.875rem 1rem;
  background: var(--neo-bg-tertiary);
  border-radius: 12px;
  border: 1px solid var(--neo-border-color);
  transition: all 0.15s ease;
  
  &:hover {
    border-color: var(--neo-text-muted);
  }
  
  &--active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }
  
  &__avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  
  &__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  
  &__name {
    font-weight: 600;
    color: var(--neo-text-primary);
    font-size: 0.9375rem;
  }
  
  &__handle {
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }
  
  &__instance {
    font-size: 0.75rem;
    color: var(--neo-accent);
    font-weight: 500;
  }
  
  &__stats {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.125rem;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }
}

.watching-instances {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--neo-border-color);
  flex-wrap: wrap;
}

.watching-label {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.watching-badge {
  padding: 0.25rem 0.5rem;
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  font-size: 0.75rem;
  color: var(--neo-text-secondary);
}

// Loading & Error States
.profile-loading,
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
    font-size: 1.125rem;
  }
}

.profile-loading__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Hero Section
.profile-hero {
  margin-bottom: 1.5rem;
}

.profile-header {
  position: relative;
  height: 280px;
  border-radius: var(--neo-radius-xl);
  overflow: hidden;
  background: linear-gradient(135deg, var(--neo-accent), var(--neo-accent-hover));

  &__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &__placeholder {
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, 
      var(--neo-accent) 0%, 
      color-mix(in srgb, var(--neo-accent) 70%, var(--neo-bg-primary)) 50%,
      var(--neo-accent-hover) 100%
    );
  }

  &__edit {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    padding: 0.5rem 1rem;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    border: none;
    border-radius: var(--neo-radius-md);
    cursor: pointer;
    font-size: 0.875rem;
    transition: background var(--neo-transition);

    &:hover {
      background: rgba(0, 0, 0, 0.9);
    }
  }
}

.profile-identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: -80px;
  padding: 0 1.5rem;
  text-align: center;

  @media (min-width: 640px) {
    flex-direction: row;
    align-items: flex-end;
    text-align: left;
    gap: 1.5rem;
  }
}

.profile-avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.profile-avatar {
  width: 160px;
  height: 160px;
  border-radius: 50%;
  border: 5px solid var(--neo-bg-secondary);
  box-shadow: var(--neo-shadow-lg);
  object-fit: cover;
  background-color: var(--neo-bg-secondary);
}

.profile-avatar__edit {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--neo-accent);
  border: 3px solid var(--neo-bg-secondary);
  cursor: pointer;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--neo-transition);

  &:hover {
    transform: scale(1.1);
  }
}

.profile-badges {
  position: absolute;
  top: 8px;
  right: -8px;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.profile-badge {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  border-radius: var(--neo-radius-full);
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);

  &--bot {
    background: var(--neo-accent-soft);
    color: var(--neo-accent);
  }
}

.profile-info {
  flex: 1;
  min-width: 0;
  padding: 1rem 0;

  @media (min-width: 640px) {
    padding: 0.5rem 0;
  }
}

.profile-name {
  font-size: 2rem;
  font-weight: 800;
  color: var(--neo-text-primary);
  margin-bottom: 0.25rem;
  line-height: 1.2;

  :deep(img.emoji) {
    height: 1em;
    vertical-align: middle;
  }
}

.profile-name-input {
  font-size: 1.5rem;
  font-weight: 700;
  width: 100%;
  max-width: 400px;
}

.profile-handle {
  font-size: 1.125rem;
  color: var(--neo-text-muted);
  margin-bottom: 1rem;
}

.profile-stats {
  display: flex;
  gap: 2rem;
  justify-content: center;

  @media (min-width: 640px) {
    justify-content: flex-start;
  }
}

.profile-stat {
  display: flex;
  flex-direction: column;
  align-items: center;

  @media (min-width: 640px) {
    align-items: flex-start;
  }

  &__value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--neo-text-primary);
  }

  &__label {
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }
}

.profile-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
  flex-shrink: 0;

  @media (min-width: 640px) {
    margin-top: 0;
    margin-left: auto;
  }
}

// Bio Section
.profile-bio {
  margin-bottom: 1.5rem;
}

.profile-section-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--neo-text-primary);
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.profile-bio__content {
  font-size: 1rem;
  line-height: 1.7;
  color: var(--neo-text-secondary);

  :deep(a) {
    color: var(--neo-accent);
  }

  :deep(p) {
    margin-bottom: 0.75rem;

    &:last-child {
      margin-bottom: 0;
    }
  }
}

.profile-bio__empty {
  color: var(--neo-text-muted);
  font-style: italic;
}

.profile-bio-input {
  width: 100%;
  resize: vertical;
  min-height: 100px;
}

.profile-joined {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--neo-border-color);
  font-size: 0.875rem;
  color: var(--neo-text-muted);
}

// Profile Fields
.profile-fields {
  margin-bottom: 1.5rem;
}

.profile-fields-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.profile-field {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--neo-bg-tertiary);
  border-radius: var(--neo-radius-md);

  &__name {
    font-weight: 600;
    color: var(--neo-text-muted);
    min-width: 100px;
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  &__value {
    flex: 1;
    color: var(--neo-text-primary);

    :deep(a) {
      color: var(--neo-accent);
    }
  }

  &__verified {
    color: var(--neo-success);
    font-weight: bold;
  }
}

.profile-fields-editor {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.profile-field-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.profile-field-name {
  width: 120px;
  flex-shrink: 0;
}

.profile-field-value {
  flex: 1;
}

.profile-field-remove {
  width: 36px;
  height: 36px;
  border-radius: var(--neo-radius-md);
  background: var(--neo-danger);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  flex-shrink: 0;

  &:hover {
    opacity: 0.9;
  }
}

.profile-field-add {
  align-self: flex-start;
}

.profile-fields-hint {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: var(--neo-accent-soft);
  border-radius: var(--neo-radius-md);
  font-size: 0.875rem;
  color: var(--neo-text-secondary);

  code {
    font-family: var(--neo-font-mono);
    background: var(--neo-bg-tertiary);
    padding: 0.125rem 0.375rem;
    border-radius: var(--neo-radius-sm);
  }
}

// Privacy Settings
.profile-privacy {
  margin-bottom: 1.5rem;
}

.profile-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 0;
  cursor: pointer;

  & + & {
    border-top: 1px solid var(--neo-border-color);
  }

  input[type="checkbox"] {
    width: 20px;
    height: 20px;
    margin-top: 0.125rem;
    accent-color: var(--neo-accent);
  }

  &__label {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  &__desc {
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }
}

// Posts Section
.profile-pinned {
  margin-bottom: 1.5rem;
}

.profile-posts-section {
  margin-bottom: 2rem;
}

.profile-posts {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.profile-posts-loading {
  padding: 2rem;
  text-align: center;
  color: var(--neo-text-muted);

  span {
    display: inline-block;
    animation: spin 1s linear infinite;
  }
}

.profile-load-more {
  width: 100%;
  margin-top: 1rem;
}

// Chaos Mode Enhancements
:global(.chaos-active) {
  .profile-header__image,
  .profile-header__placeholder {
    filter: saturate(1.2);
  }

  .profile-avatar {
    border-color: var(--neo-accent);
    box-shadow: 0 0 20px var(--neo-accent);
  }

  .profile-name {
    text-shadow: 0 0 10px var(--neo-text-primary);
  }

  .profile-field {
    border: 1px solid var(--neo-border-color);
    box-shadow: 0 0 5px var(--neo-accent);
  }
}
</style>

