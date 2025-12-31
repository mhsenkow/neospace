<script setup lang="ts">
/**
 * SettingsModal Component
 * 
 * Apple-style settings modal with:
 * - Center modal with backdrop
 * - Search bar at top
 * - Left sidebar with category tabs
 * - Right content area with settings panels
 * 
 * Connects to real Mastodon API for 1:1 settings sync.
 */

import { useSettingsStore, SETTINGS_CATEGORIES } from '~/stores/settings'
import { useAuthStore } from '~/stores/auth'
import { useThemeStore } from '~/stores/theme'

const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const themeStore = useThemeStore()

// Edit form for profile
const profileForm = reactive({
  displayName: '',
  note: '',
  locked: false,
  bot: false,
  discoverable: true,
})

// Posting defaults form
const postingForm = reactive({
  visibility: 'public' as 'public' | 'unlisted' | 'private' | 'direct',
  sensitive: false,
})

// Appearance form
const appearanceForm = reactive({
  theme: 'auto' as 'auto' | 'light' | 'dark',
  fontSize: 'medium' as 'small' | 'medium' | 'large',
  reduceMotion: false,
  compactMode: false,
})

// Watch for settings load to populate forms
watch(() => settingsStore.account, (account) => {
  if (account) {
    profileForm.displayName = account.displayName || ''
    profileForm.note = account.note?.replace(/<[^>]*>/g, '') || ''
    profileForm.locked = account.locked || false
    profileForm.bot = account.bot || false
    profileForm.discoverable = account.discoverable !== false
  }
})

watch(() => settingsStore.preferences, (prefs) => {
  if (prefs) {
    postingForm.visibility = prefs['posting:default:visibility'] || 'public'
    postingForm.sensitive = prefs['posting:default:sensitive'] || false
  }
})

watch(() => settingsStore.localPreferences, (prefs) => {
  if (prefs) {
    appearanceForm.theme = prefs.theme
    appearanceForm.fontSize = prefs.fontSize
    appearanceForm.reduceMotion = prefs.reduceMotion
    appearanceForm.compactMode = prefs.compactMode
  }
}, { immediate: true })

// Handle close on escape
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    settingsStore.close()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

// Save handlers
const saveProfile = async () => {
  await settingsStore.updateProfile({
    displayName: profileForm.displayName,
    note: profileForm.note,
    locked: profileForm.locked,
    bot: profileForm.bot,
    discoverable: profileForm.discoverable,
  })
  settingsStore.clearSuccess()
}

const savePostingDefaults = () => {
  settingsStore.updatePostingDefaults({
    visibility: postingForm.visibility,
    sensitive: postingForm.sensitive,
  })
  settingsStore.clearSuccess()
}

const saveAppearance = () => {
  settingsStore.updateAppearance({
    theme: appearanceForm.theme,
    fontSize: appearanceForm.fontSize,
    reduceMotion: appearanceForm.reduceMotion,
    compactMode: appearanceForm.compactMode,
  })
  
  // Apply theme immediately
  if (appearanceForm.theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else if (appearanceForm.theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
  
  settingsStore.clearSuccess()
}

// Visibility options
const visibilityOptions = [
  { value: 'public', label: 'Public', icon: '🌍', desc: 'Visible to everyone' },
  { value: 'unlisted', label: 'Unlisted', icon: '🔓', desc: 'Visible but not on public timelines' },
  { value: 'private', label: 'Followers Only', icon: '🔒', desc: 'Only your followers can see' },
  { value: 'direct', label: 'Direct', icon: '✉️', desc: 'Only mentioned users can see' },
]

const themeOptions = [
  { value: 'auto', label: 'Auto', icon: '🌗', desc: 'Match system preference' },
  { value: 'light', label: 'Light', icon: '☀️', desc: 'Light appearance' },
  { value: 'dark', label: 'Dark', icon: '🌙', desc: 'Dark appearance' },
]

const fontSizeOptions = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="settingsStore.isOpen" class="settings-overlay" @click.self="settingsStore.close">
        <div class="settings-modal">
          <!-- Header with search -->
          <header class="settings-header">
            <div class="settings-header__left">
              <h1 class="settings-title">Settings</h1>
            </div>
            <div class="settings-header__center">
              <div class="settings-search">
                <span class="settings-search__icon">🔍</span>
                <input
                  v-model="settingsStore.searchQuery"
                  type="text"
                  placeholder="Search settings..."
                  class="settings-search__input"
                />
              </div>
            </div>
            <div class="settings-header__right">
              <button class="settings-close" @click="settingsStore.close">
                <span>✕</span>
              </button>
            </div>
          </header>

          <div class="settings-body">
            <!-- Sidebar -->
            <nav class="settings-sidebar">
              <button
                v-for="category in settingsStore.filteredCategories"
                :key="category.id"
                :class="['settings-nav-item', { active: settingsStore.activeCategory === category.id }]"
                @click="settingsStore.setCategory(category.id)"
              >
                <span class="settings-nav-item__icon">{{ category.icon }}</span>
                <span class="settings-nav-item__label">{{ category.label }}</span>
              </button>
            </nav>

            <!-- Content -->
            <main class="settings-content">
              <!-- Loading -->
              <div v-if="settingsStore.isLoading" class="settings-loading">
                <span class="settings-loading__spinner">🌀</span>
                <p>Loading settings...</p>
              </div>

              <!-- Success message -->
              <Transition name="fade">
                <div v-if="settingsStore.saveSuccess" class="settings-success">
                  <span>✓</span> Settings saved successfully
                </div>
              </Transition>

              <!-- Error message -->
              <div v-if="settingsStore.error" class="settings-error">
                <span>⚠️</span> {{ settingsStore.error }}
              </div>

              <!-- Profile Settings -->
              <section v-if="settingsStore.activeCategory === 'profile'" class="settings-section">
                <div class="settings-section__header">
                  <h2>{{ settingsStore.currentCategory?.icon }} {{ settingsStore.currentCategory?.label }}</h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <label class="settings-label">
                    <span class="settings-label__text">Display Name</span>
                    <input
                      v-model="profileForm.displayName"
                      type="text"
                      class="settings-input"
                      placeholder="Your display name"
                    />
                  </label>

                  <label class="settings-label">
                    <span class="settings-label__text">Bio</span>
                    <textarea
                      v-model="profileForm.note"
                      class="settings-textarea"
                      placeholder="Tell the world about yourself..."
                      rows="4"
                    />
                  </label>

                  <div class="settings-divider" />

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">🔒 Require follow approval</span>
                      <span class="settings-toggle__desc">New followers must be approved before they can see your posts</span>
                    </div>
                    <input v-model="profileForm.locked" type="checkbox" class="settings-checkbox" />
                  </label>

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">🔍 Discoverable</span>
                      <span class="settings-toggle__desc">Allow your account to be found in search results and profile directories</span>
                    </div>
                    <input v-model="profileForm.discoverable" type="checkbox" class="settings-checkbox" />
                  </label>

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">🤖 This is a bot account</span>
                      <span class="settings-toggle__desc">Mark this account as automated</span>
                    </div>
                    <input v-model="profileForm.bot" type="checkbox" class="settings-checkbox" />
                  </label>
                </div>

                <div class="settings-actions">
                  <button 
                    class="settings-btn settings-btn--primary"
                    :disabled="settingsStore.isSaving"
                    @click="saveProfile"
                  >
                    {{ settingsStore.isSaving ? 'Saving...' : 'Save Changes' }}
                  </button>
                </div>
              </section>

              <!-- Privacy & Safety -->
              <section v-if="settingsStore.activeCategory === 'privacy'" class="settings-section">
                <div class="settings-section__header">
                  <h2>{{ settingsStore.currentCategory?.icon }} {{ settingsStore.currentCategory?.label }}</h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <h3 class="settings-subheading">Post Privacy</h3>
                  
                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">🔒 Require follow approval</span>
                      <span class="settings-toggle__desc">New followers must be approved</span>
                    </div>
                    <input v-model="profileForm.locked" type="checkbox" class="settings-checkbox" />
                  </label>

                  <div class="settings-divider" />
                  
                  <h3 class="settings-subheading">Muted Accounts</h3>
                  <p class="settings-hint">Accounts you've muted won't appear in your timelines.</p>
                  
                  <div v-if="settingsStore.mutedAccounts.length === 0" class="settings-empty">
                    No muted accounts
                  </div>
                  <div v-else class="settings-account-list">
                    <div 
                      v-for="account in settingsStore.mutedAccounts" 
                      :key="account.id"
                      class="settings-account-item"
                    >
                      <img :src="account.avatar" :alt="account.displayName" class="settings-account-avatar" />
                      <div class="settings-account-info">
                        <span class="settings-account-name">{{ account.displayName || account.username }}</span>
                        <span class="settings-account-handle">@{{ account.acct }}</span>
                      </div>
                      <button 
                        class="settings-btn settings-btn--small"
                        @click="settingsStore.unmuteAccount(account.id)"
                      >
                        Unmute
                      </button>
                    </div>
                  </div>

                  <button 
                    class="settings-btn settings-btn--ghost"
                    @click="settingsStore.loadMutedAccounts"
                  >
                    Load Muted Accounts
                  </button>

                  <div class="settings-divider" />
                  
                  <h3 class="settings-subheading">Blocked Accounts</h3>
                  <p class="settings-hint">Blocked accounts cannot follow you or see your posts.</p>
                  
                  <div v-if="settingsStore.blockedAccounts.length === 0" class="settings-empty">
                    No blocked accounts
                  </div>
                  <div v-else class="settings-account-list">
                    <div 
                      v-for="account in settingsStore.blockedAccounts" 
                      :key="account.id"
                      class="settings-account-item"
                    >
                      <img :src="account.avatar" :alt="account.displayName" class="settings-account-avatar" />
                      <div class="settings-account-info">
                        <span class="settings-account-name">{{ account.displayName || account.username }}</span>
                        <span class="settings-account-handle">@{{ account.acct }}</span>
                      </div>
                      <button 
                        class="settings-btn settings-btn--small"
                        @click="settingsStore.unblockAccount(account.id)"
                      >
                        Unblock
                      </button>
                    </div>
                  </div>

                  <button 
                    class="settings-btn settings-btn--ghost"
                    @click="settingsStore.loadBlockedAccounts"
                  >
                    Load Blocked Accounts
                  </button>
                </div>
              </section>

              <!-- Notifications -->
              <section v-if="settingsStore.activeCategory === 'notifications'" class="settings-section">
                <div class="settings-section__header">
                  <h2>{{ settingsStore.currentCategory?.icon }} {{ settingsStore.currentCategory?.label }}</h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <p class="settings-hint">
                    Notification preferences are managed on your instance's settings page.
                    NeoSpace will respect your instance's notification settings.
                  </p>

                  <a 
                    v-if="authStore.instanceUrl"
                    :href="`${authStore.instanceUrl}/settings/notifications`"
                    target="_blank"
                    class="settings-btn settings-btn--primary"
                  >
                    Open Instance Notification Settings →
                  </a>
                </div>
              </section>

              <!-- Appearance -->
              <section v-if="settingsStore.activeCategory === 'appearance'" class="settings-section">
                <div class="settings-section__header">
                  <h2>{{ settingsStore.currentCategory?.icon }} {{ settingsStore.currentCategory?.label }}</h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <h3 class="settings-subheading">Theme</h3>
                  <div class="settings-option-grid">
                    <label 
                      v-for="option in themeOptions"
                      :key="option.value"
                      :class="['settings-option-card', { active: appearanceForm.theme === option.value }]"
                    >
                      <input 
                        v-model="appearanceForm.theme" 
                        type="radio" 
                        :value="option.value"
                        class="settings-radio-hidden"
                      />
                      <span class="settings-option-card__icon">{{ option.icon }}</span>
                      <span class="settings-option-card__label">{{ option.label }}</span>
                      <span class="settings-option-card__desc">{{ option.desc }}</span>
                    </label>
                  </div>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Font Size</h3>
                  <div class="settings-segmented">
                    <button
                      v-for="option in fontSizeOptions"
                      :key="option.value"
                      :class="['settings-segmented__btn', { active: appearanceForm.fontSize === option.value }]"
                      @click="appearanceForm.fontSize = option.value as any"
                    >
                      {{ option.label }}
                    </button>
                  </div>

                  <div class="settings-divider" />

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">🎬 Reduce motion</span>
                      <span class="settings-toggle__desc">Disable animations and auto-playing content</span>
                    </div>
                    <input v-model="appearanceForm.reduceMotion" type="checkbox" class="settings-checkbox" />
                  </label>

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">📱 Compact mode</span>
                      <span class="settings-toggle__desc">Show more content with reduced spacing</span>
                    </div>
                    <input v-model="appearanceForm.compactMode" type="checkbox" class="settings-checkbox" />
                  </label>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Chaos Mode</h3>
                  <p class="settings-hint">
                    Enable Chaos Mode to unlock user-defined custom CSS and wild themes.
                  </p>
                  <button 
                    class="settings-btn"
                    :class="themeStore.isChaosMode ? 'settings-btn--danger' : 'settings-btn--primary'"
                    @click="themeStore.isChaosMode ? themeStore.disableChaosMode() : themeStore.enableChaosMode()"
                  >
                    {{ themeStore.isChaosMode ? '🔥 Disable Chaos Mode' : '🌀 Enable Chaos Mode' }}
                  </button>
                </div>

                <div class="settings-actions">
                  <button 
                    class="settings-btn settings-btn--primary"
                    @click="saveAppearance"
                  >
                    Save Appearance
                  </button>
                </div>
              </section>

              <!-- Posting Defaults -->
              <section v-if="settingsStore.activeCategory === 'posting'" class="settings-section">
                <div class="settings-section__header">
                  <h2>{{ settingsStore.currentCategory?.icon }} {{ settingsStore.currentCategory?.label }}</h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <h3 class="settings-subheading">Default Visibility</h3>
                  <p class="settings-hint">Choose who can see your posts by default.</p>
                  
                  <div class="settings-option-list">
                    <label 
                      v-for="option in visibilityOptions"
                      :key="option.value"
                      :class="['settings-option-row', { active: postingForm.visibility === option.value }]"
                    >
                      <input 
                        v-model="postingForm.visibility" 
                        type="radio" 
                        :value="option.value"
                        class="settings-radio-hidden"
                      />
                      <span class="settings-option-row__icon">{{ option.icon }}</span>
                      <div class="settings-option-row__text">
                        <span class="settings-option-row__label">{{ option.label }}</span>
                        <span class="settings-option-row__desc">{{ option.desc }}</span>
                      </div>
                      <span v-if="postingForm.visibility === option.value" class="settings-option-row__check">✓</span>
                    </label>
                  </div>

                  <div class="settings-divider" />

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">🔞 Mark media as sensitive by default</span>
                      <span class="settings-toggle__desc">Media will be hidden behind a warning</span>
                    </div>
                    <input v-model="postingForm.sensitive" type="checkbox" class="settings-checkbox" />
                  </label>
                </div>

                <div class="settings-actions">
                  <button 
                    class="settings-btn settings-btn--primary"
                    @click="savePostingDefaults"
                  >
                    Save Posting Defaults
                  </button>
                </div>
              </section>

              <!-- Filters -->
              <section v-if="settingsStore.activeCategory === 'filters'" class="settings-section">
                <div class="settings-section__header">
                  <h2>{{ settingsStore.currentCategory?.icon }} {{ settingsStore.currentCategory?.label }}</h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <h3 class="settings-subheading">Active Filters</h3>
                  <p class="settings-hint">Filters hide or warn about posts containing specific words.</p>
                  
                  <div v-if="settingsStore.filters.length === 0" class="settings-empty">
                    No filters configured
                  </div>
                  <div v-else class="settings-filter-list">
                    <div 
                      v-for="filter in settingsStore.filters" 
                      :key="filter.id"
                      class="settings-filter-item"
                    >
                      <div class="settings-filter-info">
                        <span class="settings-filter-title">{{ filter.title }}</span>
                        <span class="settings-filter-keywords">
                          {{ filter.keywords?.map(k => k.keyword).join(', ') }}
                        </span>
                        <span class="settings-filter-action">
                          {{ filter.filterAction === 'hide' ? '🚫 Hidden' : '⚠️ Warning' }}
                        </span>
                      </div>
                      <button 
                        class="settings-btn settings-btn--small settings-btn--danger"
                        @click="settingsStore.deleteFilter(filter.id)"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <p class="settings-hint" style="margin-top: 1rem;">
                    To create new filters, use your instance's settings page.
                  </p>
                  <a 
                    v-if="authStore.instanceUrl"
                    :href="`${authStore.instanceUrl}/settings/filters`"
                    target="_blank"
                    class="settings-btn settings-btn--ghost"
                  >
                    Manage Filters on Instance →
                  </a>
                </div>
              </section>

              <!-- Account -->
              <section v-if="settingsStore.activeCategory === 'account'" class="settings-section">
                <div class="settings-section__header">
                  <h2>{{ settingsStore.currentCategory?.icon }} {{ settingsStore.currentCategory?.label }}</h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <h3 class="settings-subheading">Connected Account</h3>
                  
                  <div v-if="settingsStore.account" class="settings-account-card">
                    <img :src="settingsStore.account.avatar" class="settings-account-card__avatar" />
                    <div class="settings-account-card__info">
                      <span class="settings-account-card__name">
                        {{ settingsStore.account.displayName || settingsStore.account.username }}
                      </span>
                      <span class="settings-account-card__handle">
                        @{{ settingsStore.account.acct }}
                      </span>
                      <span class="settings-account-card__instance">
                        {{ authStore.instanceUrl?.replace('https://', '') }}
                      </span>
                    </div>
                  </div>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Instance Settings</h3>
                  <p class="settings-hint">
                    Advanced account settings like email, password, and two-factor authentication 
                    are managed on your instance.
                  </p>
                  
                  <a 
                    v-if="authStore.instanceUrl"
                    :href="`${authStore.instanceUrl}/settings`"
                    target="_blank"
                    class="settings-btn settings-btn--primary"
                  >
                    Open Instance Settings →
                  </a>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Data Export</h3>
                  <p class="settings-hint">
                    Download your data including posts, followers, and account information.
                  </p>
                  
                  <a 
                    v-if="authStore.instanceUrl"
                    :href="`${authStore.instanceUrl}/settings/export`"
                    target="_blank"
                    class="settings-btn settings-btn--ghost"
                  >
                    Export Data →
                  </a>
                </div>
              </section>
            </main>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
// Modal Overlay
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

// Modal Container
.settings-modal {
  width: 100%;
  max-width: 900px;
  max-height: calc(100vh - 4rem);
  background: var(--neo-bg-secondary);
  border-radius: 16px;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

// Header
.settings-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: var(--neo-bg-tertiary);
  border-bottom: 1px solid var(--neo-border-color);

  &__left {
    flex: 1;
  }

  &__center {
    flex: 2;
  }

  &__right {
    flex: 1;
    display: flex;
    justify-content: flex-end;
  }
}

.settings-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--neo-text-primary);
}

.settings-search {
  position: relative;
  display: flex;
  align-items: center;

  &__icon {
    position: absolute;
    left: 0.875rem;
    font-size: 0.875rem;
    opacity: 0.5;
  }

  &__input {
    width: 100%;
    padding: 0.625rem 1rem 0.625rem 2.5rem;
    font-size: 0.9375rem;
    background: var(--neo-bg-primary);
    border: 1px solid var(--neo-border-color);
    border-radius: 8px;
    color: var(--neo-text-primary);
    transition: all 0.15s ease;

    &:focus {
      outline: none;
      border-color: var(--neo-accent);
      box-shadow: 0 0 0 3px var(--neo-accent-soft);
    }

    &::placeholder {
      color: var(--neo-text-muted);
    }
  }
}

.settings-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--neo-text-muted);
  font-size: 1.125rem;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--neo-bg-primary);
    color: var(--neo-text-primary);
  }
}

// Body
.settings-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

// Sidebar
.settings-sidebar {
  width: 200px;
  flex-shrink: 0;
  padding: 0.5rem;
  background: var(--neo-bg-tertiary);
  border-right: 1px solid var(--neo-border-color);
  overflow-y: auto;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.625rem 0.875rem;
  margin-bottom: 0.25rem;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--neo-text-secondary);
  font-size: 0.9375rem;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;

  &__icon {
    font-size: 1rem;
    width: 1.25rem;
    text-align: center;
  }

  &:hover {
    background: var(--neo-bg-primary);
    color: var(--neo-text-primary);
  }

  &.active {
    background: var(--neo-accent);
    color: white;
  }
}

// Content
.settings-content {
  flex: 1;
  padding: 1.5rem 2rem;
  overflow-y: auto;
}

.settings-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 4rem 2rem;
  color: var(--neo-text-muted);

  &__spinner {
    font-size: 2rem;
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.settings-success {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #10b98120;
  border: 1px solid #10b981;
  border-radius: 8px;
  color: #10b981;
  font-size: 0.9375rem;
  font-weight: 500;
}

.settings-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #ef444420;
  border: 1px solid #ef4444;
  border-radius: 8px;
  color: #ef4444;
  font-size: 0.9375rem;
}

// Section
.settings-section {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.settings-section__header {
  margin-bottom: 1.5rem;

  h2 {
    margin: 0 0 0.375rem;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--neo-text-primary);
  }

  p {
    margin: 0;
    color: var(--neo-text-muted);
    font-size: 0.9375rem;
  }
}

.settings-group {
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  padding: 1.25rem;
}

.settings-subheading {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.settings-hint {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: var(--neo-text-muted);
  line-height: 1.5;
}

.settings-divider {
  height: 1px;
  background: var(--neo-border-color);
  margin: 1.25rem 0;
}

.settings-empty {
  padding: 1.5rem;
  text-align: center;
  color: var(--neo-text-muted);
  font-size: 0.9375rem;
  background: var(--neo-bg-tertiary);
  border-radius: 8px;
}

// Form Elements
.settings-label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;

  &__text {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }
}

.settings-input {
  width: 100%;
  padding: 0.75rem 1rem;
  font-size: 1rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 8px;
  color: var(--neo-text-primary);
  transition: all 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
    box-shadow: 0 0 0 3px var(--neo-accent-soft);
  }
}

.settings-textarea {
  @extend .settings-input;
  resize: vertical;
  min-height: 100px;
  font-family: inherit;
}

.settings-toggle {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0;
  cursor: pointer;

  & + & {
    border-top: 1px solid var(--neo-border-color);
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  &__label {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--neo-text-primary);
  }

  &__desc {
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }
}

.settings-checkbox {
  width: 20px;
  height: 20px;
  accent-color: var(--neo-accent);
  cursor: pointer;
}

.settings-radio-hidden {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

// Option Cards (for themes)
.settings-option-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.settings-option-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.25rem 1rem;
  background: var(--neo-bg-secondary);
  border: 2px solid var(--neo-border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--neo-accent);
  }

  &.active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  &__icon {
    font-size: 1.75rem;
  }

  &__label {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  &__desc {
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    text-align: center;
  }
}

// Segmented Control
.settings-segmented {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: var(--neo-bg-secondary);
  border-radius: 8px;

  &__btn {
    flex: 1;
    padding: 0.625rem 1rem;
    font-size: 0.9375rem;
    font-weight: 500;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--neo-text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      color: var(--neo-text-primary);
    }

    &.active {
      background: var(--neo-accent);
      color: white;
    }
  }
}

// Option List (for visibility)
.settings-option-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.settings-option-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--neo-bg-secondary);
  border: 2px solid var(--neo-border-color);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--neo-accent);
  }

  &.active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  &__icon {
    font-size: 1.25rem;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  &__label {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  &__desc {
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }

  &__check {
    font-size: 1rem;
    color: var(--neo-accent);
    font-weight: bold;
  }
}

// Account Items
.settings-account-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.settings-account-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--neo-bg-secondary);
  border-radius: 8px;
}

.settings-account-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.settings-account-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.settings-account-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-account-handle {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

// Account Card
.settings-account-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--neo-bg-secondary);
  border-radius: 12px;
  margin-bottom: 1rem;

  &__avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  &__name {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--neo-text-primary);
  }

  &__handle {
    font-size: 0.9375rem;
    color: var(--neo-text-secondary);
  }

  &__instance {
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }
}

// Filter Items
.settings-filter-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.settings-filter-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--neo-bg-secondary);
  border-radius: 8px;
}

.settings-filter-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.settings-filter-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
}

.settings-filter-keywords {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  font-family: 'JetBrains Mono', monospace;
}

.settings-filter-action {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

// Buttons
.settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  font-size: 0.9375rem;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;

  &--primary {
    background: var(--neo-accent);
    color: white;

    &:hover:not(:disabled) {
      filter: brightness(1.1);
    }
  }

  &--ghost {
    background: var(--neo-bg-secondary);
    color: var(--neo-text-primary);
    border: 1px solid var(--neo-border-color);

    &:hover {
      background: var(--neo-bg-tertiary);
    }
  }

  &--danger {
    background: #ef4444;
    color: white;

    &:hover:not(:disabled) {
      background: #dc2626;
    }
  }

  &--small {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.settings-actions {
  margin-top: 1.5rem;
  display: flex;
  gap: 0.75rem;
}

// Transitions
.modal-enter-active,
.modal-leave-active {
  transition: all 0.25s ease;

  .settings-modal {
    transition: all 0.25s ease;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .settings-modal {
    transform: scale(0.95) translateY(20px);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

// Responsive - Tablet
@media (max-width: 768px) {
  .settings-overlay {
    padding: 1rem;
  }

  .settings-modal {
    max-width: 100%;
    max-height: calc(100vh - 2rem);
    border-radius: 12px;
  }

  .settings-header {
    padding: 0.875rem 1rem;
    flex-wrap: wrap;
    gap: 0.75rem;

    &__left {
      order: 1;
    }

    &__center {
      order: 3;
      flex: 100%;
    }

    &__right {
      order: 2;
    }
  }

  .settings-title {
    font-size: 1rem;
  }

  .settings-sidebar {
    width: 56px;
    padding: 0.25rem;
  }

  .settings-nav-item {
    justify-content: center;
    padding: 0.625rem;

    &__label {
      display: none;
    }

    &__icon {
      font-size: 1.125rem;
    }
  }

  .settings-content {
    padding: 1rem 1.25rem;
  }

  .settings-section__header {
    margin-bottom: 1rem;

    h2 {
      font-size: 1.25rem;
    }

    p {
      font-size: 0.875rem;
    }
  }

  .settings-option-grid {
    grid-template-columns: 1fr;
  }

  .settings-toggle {
    flex-wrap: wrap;
    gap: 0.75rem;
  }
}

// Responsive - Mobile
@media (max-width: 480px) {
  .settings-overlay {
    padding: 0;
  }

  .settings-modal {
    max-height: 100%;
    border-radius: 0;
  }

  .settings-header {
    padding: 0.75rem;
    gap: 0.5rem;
  }

  .settings-search__input {
    padding: 0.5rem 0.875rem 0.5rem 2.25rem;
    font-size: 0.875rem;
  }

  .settings-search__icon {
    left: 0.75rem;
    font-size: 0.75rem;
  }

  .settings-sidebar {
    width: 48px;
  }

  .settings-nav-item {
    padding: 0.5rem;

    &__icon {
      font-size: 1rem;
    }
  }

  .settings-content {
    padding: 0.875rem;
  }

  .settings-group {
    padding: 1rem;
    border-radius: 10px;
  }

  .settings-section__header {
    h2 {
      font-size: 1.125rem;
    }

    p {
      font-size: 0.8125rem;
    }
  }

  .settings-label__text {
    font-size: 0.875rem;
  }

  .settings-input,
  .settings-textarea {
    padding: 0.625rem 0.875rem;
    font-size: 0.9375rem;
  }

  .settings-toggle__label {
    font-size: 0.875rem;
  }

  .settings-toggle__desc {
    font-size: 0.75rem;
  }

  .settings-btn {
    padding: 0.625rem 1rem;
    font-size: 0.875rem;
    width: 100%;
  }

  .settings-actions {
    flex-direction: column;
    margin-top: 1.25rem;
  }

  .settings-option-card {
    padding: 1rem 0.875rem;

    &__icon {
      font-size: 1.5rem;
    }

    &__label {
      font-size: 0.875rem;
    }

    &__desc {
      font-size: 0.6875rem;
    }
  }

  .settings-option-row {
    padding: 0.875rem;
    gap: 0.75rem;

    &__icon {
      font-size: 1.125rem;
    }

    &__label {
      font-size: 0.875rem;
    }

    &__desc {
      font-size: 0.75rem;
    }
  }

  .settings-segmented {
    &__btn {
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
    }
  }

  .settings-account-card {
    padding: 0.875rem;
    gap: 0.75rem;

    &__avatar {
      width: 48px;
      height: 48px;
    }

    &__name {
      font-size: 1rem;
    }

    &__handle {
      font-size: 0.875rem;
    }

    &__instance {
      font-size: 0.75rem;
    }
  }

  .settings-account-item {
    padding: 0.625rem;
    gap: 0.625rem;
  }

  .settings-account-avatar {
    width: 36px;
    height: 36px;
  }

  .settings-account-name {
    font-size: 0.875rem;
  }

  .settings-account-handle {
    font-size: 0.75rem;
  }

  .settings-subheading {
    font-size: 0.75rem;
    margin-bottom: 0.625rem;
  }

  .settings-hint {
    font-size: 0.8125rem;
    margin-bottom: 0.875rem;
  }

  .settings-divider {
    margin: 1rem 0;
  }

  .settings-empty {
    padding: 1.25rem;
    font-size: 0.875rem;
  }
}
</style>

