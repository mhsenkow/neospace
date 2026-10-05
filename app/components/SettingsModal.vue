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
import { useInstancesStore } from '~/stores/instances'
import {
  FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  THEME_OPTIONS,
  UI_OPTIONS,
  TYPE_FACES,
  type NeoFontId,
  type NeoFontSizeId,
  type NeoThemeId,
  type NeoUiId,
} from '~/utils/appearance'

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const contentEl = ref<HTMLElement | null>(null)

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
  theme: 'auto' as NeoThemeId,
  ui: 'braun' as NeoUiId,
  font: 'sans' as NeoFontId,
  fontSize: 'medium' as NeoFontSizeId,
  reduceMotion: false,
  compactMode: false,
  customProfileCss: false,
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
  // Local overrides win; fall back to Mastodon prefs when present
  postingForm.visibility = settingsStore.defaultVisibility
  postingForm.sensitive = settingsStore.defaultSensitive
  if (!prefs) return
}, { immediate: true })

watch(
  () => [
    settingsStore.localPreferences.defaultVisibility,
    settingsStore.localPreferences.defaultSensitive,
  ],
  () => {
    postingForm.visibility = settingsStore.defaultVisibility
    postingForm.sensitive = settingsStore.defaultSensitive
  },
)

watch(() => settingsStore.localPreferences, (prefs) => {
  if (prefs) {
    appearanceForm.theme = prefs.theme
    appearanceForm.ui = prefs.ui
    appearanceForm.font = prefs.font
    appearanceForm.fontSize = prefs.fontSize
    appearanceForm.reduceMotion = prefs.reduceMotion
    appearanceForm.compactMode = prefs.compactMode
    appearanceForm.customProfileCss = prefs.customProfileCss
  }
}, { immediate: true })

watch(
  () => settingsStore.activeCategory,
  () => {
    if (contentEl.value) contentEl.value.scrollTop = 0
  },
)

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
    ui: appearanceForm.ui,
    font: appearanceForm.font,
    fontSize: appearanceForm.fontSize,
    reduceMotion: appearanceForm.reduceMotion,
    compactMode: appearanceForm.compactMode,
    customProfileCss: appearanceForm.customProfileCss,
  })
  settingsStore.clearSuccess()
}

const hasProfileCss = computed(() => !!instancesStore.userCustomCSS)

// Visibility options
const visibilityOptions = [
  { value: 'public', label: 'Public', icon: '🌍', desc: 'Visible to everyone' },
  { value: 'unlisted', label: 'Unlisted', icon: '🔓', desc: 'Visible but not on public timelines' },
  { value: 'private', label: 'Followers Only', icon: '🔒', desc: 'Only your followers can see' },
  { value: 'direct', label: 'Direct', icon: '✉️', desc: 'Only mentioned users can see' },
]

const themeOptions = [
  { value: 'auto' as const, label: 'Auto', desc: 'Match system light/dark', swatch: 'linear-gradient(135deg,#f2f2f0 50%,#161616 50%)', ink: '#c45c26' },
  ...THEME_OPTIONS.map((t) => ({
    value: t.id,
    label: t.label,
    desc: t.desc,
    swatch: t.swatch,
    ink: t.ink,
  })),
]

const uiOptions = UI_OPTIONS
const fontOptions = FONT_OPTIONS
const fontSizeOptions = FONT_SIZE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))

const fontPreviewStack = (fontId: NeoFontId) => {
  const ui = appearanceForm.ui || 'braun'
  return TYPE_FACES[ui]?.[fontId] || TYPE_FACES.braun[fontId]
}</script>

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
            <main ref="contentEl" class="settings-content">
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

                  <div class="settings-actions" style="margin-top: 1rem;">
                    <button
                      class="settings-btn settings-btn--primary"
                      :disabled="settingsStore.isSaving"
                      @click="saveProfile"
                    >
                      {{ settingsStore.isSaving ? 'Saving...' : 'Save Privacy' }}
                    </button>
                  </div>

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
                    v-if="instancesStore.instanceUrl"
                    :href="`${instancesStore.instanceUrl}/settings/notifications`"
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
                  <p class="settings-hint">Color system — tap a swatch or use the sidebar cycle button.</p>
                  <div class="settings-theme-grid">
                    <label
                      v-for="option in themeOptions"
                      :key="option.value"
                      :class="['settings-theme-swatch', { active: appearanceForm.theme === option.value }]"
                      :title="option.desc"
                    >
                      <input
                        v-model="appearanceForm.theme"
                        type="radio"
                        :value="option.value"
                        class="settings-radio-hidden"
                        @change="saveAppearance"
                      />
                      <span
                        class="settings-theme-swatch__chip"
                        :style="{ background: option.swatch, color: option.ink }"
                      >
                        <span class="settings-theme-swatch__dot"></span>
                      </span>
                      <span class="settings-theme-swatch__label">{{ option.label }}</span>
                    </label>
                  </div>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Chrome</h3>
                  <p class="settings-hint">Full interface system — type, corners, borders, labels. Same set as wordcount.</p>
                  <div class="settings-chrome-grid">
                    <label
                      v-for="option in uiOptions"
                      :key="option.id"
                      :class="['settings-chrome-card', { active: appearanceForm.ui === option.id }]"
                      :data-preview-ui="option.id"
                      :title="option.desc"
                    >
                      <input
                        v-model="appearanceForm.ui"
                        type="radio"
                        :value="option.id"
                        class="settings-radio-hidden"
                        @change="saveAppearance"
                      />
                      <span class="settings-chrome-card__sample">{{ option.sample }}</span>
                      <span class="settings-chrome-card__label">{{ option.label }}</span>
                      <span class="settings-chrome-card__desc">{{ option.desc }}</span>
                    </label>
                  </div>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Typography</h3>
                  <p class="settings-hint">Reading face for posts &amp; pages — remapped through the active chrome.</p>
                  <div class="settings-font-grid">
                    <label
                      v-for="option in fontOptions"
                      :key="option.id"
                      :class="['settings-font-card', { active: appearanceForm.font === option.id }]"
                    >
                      <input
                        v-model="appearanceForm.font"
                        type="radio"
                        :value="option.id"
                        class="settings-radio-hidden"
                        @change="saveAppearance"
                      />
                      <span
                        class="settings-font-card__sample"
                        :style="{ fontFamily: fontPreviewStack(option.id) }"
                      >{{ option.sample }}</span>
                      <span class="settings-font-card__label">{{ option.label }}</span>
                      <span class="settings-font-card__desc">{{ option.desc }}</span>
                    </label>
                  </div>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Font Size</h3>
                  <div class="settings-segmented">
                    <button
                      v-for="option in fontSizeOptions"
                      :key="option.value"
                      type="button"
                      :class="['settings-segmented__btn', { active: appearanceForm.fontSize === option.value }]"
                      @click="appearanceForm.fontSize = option.value; saveAppearance()"
                    >
                      {{ option.label }}
                    </button>
                  </div>

                  <div class="settings-divider" />

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">Reduce motion</span>
                      <span class="settings-toggle__desc">Disable animations and auto-playing content</span>
                    </div>
                    <input v-model="appearanceForm.reduceMotion" type="checkbox" class="settings-checkbox" />
                  </label>

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">Compact mode</span>
                      <span class="settings-toggle__desc">Show more content with reduced spacing</span>
                    </div>
                    <input v-model="appearanceForm.compactMode" type="checkbox" class="settings-checkbox" />
                  </label>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Custom profile CSS</h3>
                  <p class="settings-hint">
                    Optional Myspace-style skins. If your Mastodon profile has a field named
                    <code>css</code>, <code>custom_css</code>, <code>theme</code>, <code>style</code>, or
                    <code>chaos_css</code>, NeoSpace can apply that CSS here. (Formerly called Chaos Mode.)
                  </p>

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">Apply my profile CSS</span>
                      <span class="settings-toggle__desc">
                        {{
                          hasProfileCss
                            ? 'Uses the CSS from your profile metadata fields'
                            : 'No custom CSS found on your profile yet — add a field named css or custom_css'
                        }}
                      </span>
                    </div>
                    <input
                      v-model="appearanceForm.customProfileCss"
                      type="checkbox"
                      class="settings-checkbox"
                      :disabled="!hasProfileCss"
                      @change="saveAppearance"
                    />
                  </label>
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
                    v-if="instancesStore.instanceUrl"
                    :href="`${instancesStore.instanceUrl}/settings/filters`"
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
                        {{ instancesStore.instanceUrl?.replace('https://', '') }}
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
                    v-if="instancesStore.instanceUrl"
                    :href="`${instancesStore.instanceUrl}/settings`"
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
                    v-if="instancesStore.instanceUrl"
                    :href="`${instancesStore.instanceUrl}/settings/export`"
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
  padding:
    max(0.75rem, env(safe-area-inset-top, 0px))
    max(0.75rem, env(safe-area-inset-right, 0px))
    max(0.75rem, env(safe-area-inset-bottom, 0px))
    max(0.75rem, env(safe-area-inset-left, 0px));
  background: color-mix(in srgb, #000 48%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

// Fixed viewport height — category switches must not resize the shell
.settings-modal {
  --settings-h: min(42rem, calc(100dvh - 1.5rem));
  width: min(56rem, calc(100vw - 1.5rem));
  height: var(--settings-h);
  max-height: var(--settings-h);
  background: var(--neo-bg-secondary);
  color: var(--neo-text-primary);
  border: var(--neo-border-width, 1px) solid var(--neo-border-color-dark);
  border-radius: var(--neo-radius-md, 6px);
  box-shadow: var(--neo-shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--neo-font-family-ui, var(--neo-font-family));
}

// Header — use secondary (face), not tertiary (hair). Hair can equal ink in
// hard themes (brutal) and makes titles vanish.
.settings-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 0 0 auto;
  padding: 0.875rem 1.25rem;
  background: var(--neo-bg-secondary);
  border-bottom: var(--neo-border-width, 1px) solid var(--neo-border-color-dark);

  &__left {
    flex: 0 1 auto;
    min-width: 0;
  }

  &__center {
    flex: 1 1 auto;
    min-width: 0;
  }

  &__right {
    flex: 0 0 auto;
    display: flex;
    justify-content: flex-end;
  }
}

.settings-title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
  color: var(--neo-text-primary);
  white-space: nowrap;
}

.settings-search {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 28rem;
  margin: 0 auto;

  &__icon {
    position: absolute;
    left: 0.75rem;
    font-size: 0.875rem;
    opacity: 0.55;
    pointer-events: none;
  }

  &__input {
    width: 100%;
    min-height: 40px;
    padding: 0.5rem 0.875rem 0.5rem 2.25rem;
    font-size: 0.9375rem;
    background: var(--neo-bg-primary);
    border: var(--neo-border-width, 1px) solid var(--neo-border-color);
    border-radius: var(--neo-radius-sm, 4px);
    color: var(--neo-text-primary);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

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
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: var(--neo-border-width, 1px) solid transparent;
  border-radius: var(--neo-radius-sm, 4px);
  color: var(--neo-text-primary);
  font-size: 1.125rem;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: var(--neo-bg-hover);
    border-color: var(--neo-border-color-dark);
  }
}

.settings-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.settings-sidebar {
  width: 11.5rem;
  flex: 0 0 auto;
  padding: 0.5rem;
  background: var(--neo-bg-secondary);
  border-right: var(--neo-border-width, 1px) solid var(--neo-border-color-dark);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  margin-bottom: 0.25rem;
  background: transparent;
  border: var(--neo-border-width, 1px) solid transparent;
  border-radius: var(--neo-radius-sm, 4px);
  color: var(--neo-text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;

  &__icon {
    font-size: 1rem;
    width: 1.25rem;
    text-align: center;
    flex-shrink: 0;
  }

  &__label {
    color: inherit;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    background: var(--neo-bg-hover);
    color: var(--neo-text-primary);
  }

  &.active {
    background: var(--neo-accent);
    border-color: var(--neo-accent);
    color: var(--neo-text-on-accent);
  }
}

.settings-content {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  padding: 1.25rem 1.5rem 1.5rem;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
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
  animation: none;
}

.settings-section__header {
  margin-bottom: 1.25rem;

  h2 {
    margin: 0 0 0.375rem;
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--neo-text-primary);
  }

  p {
    margin: 0;
    color: var(--neo-text-secondary);
    font-size: 0.875rem;
  }
}

.settings-group {
  background: var(--neo-bg-primary);
  border: var(--neo-border-width, 1px) solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  padding: 1.25rem;
}

.settings-subheading {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.settings-hint {
  margin: 0 0 0.875rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  line-height: 1.45;
  max-width: 52ch;
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

.settings-theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 0.625rem;
}

.settings-theme-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
  min-width: 0;

  &.active .settings-theme-swatch__chip {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }

  &__chip {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1.35;
    border-radius: var(--neo-radius-sm, 4px);
    border: 1px solid var(--neo-border-color-dark);
  }

  &__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: currentColor;
  }

  &__label {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    letter-spacing: 0.02em;
    text-align: center;
    line-height: 1.2;
  }

  &.active &__label {
    color: var(--neo-text-primary);
  }
}

.settings-chrome-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 0.625rem;
}

.settings-chrome-card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.75rem 0.625rem;
  background: var(--neo-bg-primary);
  border: var(--neo-border-width, 1px) solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  min-width: 0;

  &:hover {
    border-color: var(--neo-border-color-dark);
  }

  &.active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  /* Shape language preview per chrome */
  &[data-preview-ui='braun'] { border-radius: 4px; }
  &[data-preview-ui='monocle'] { border-radius: 8px; }
  &[data-preview-ui='noyes'] { border-radius: 2px; }
  &[data-preview-ui='bauhaus'],
  &[data-preview-ui='ikea'],
  &[data-preview-ui='military'],
  &[data-preview-ui='terminal'],
  &[data-preview-ui='nyt'] { border-radius: 0; }
  &[data-preview-ui='bauhaus'],
  &[data-preview-ui='ikea'],
  &[data-preview-ui='military'] { border-width: 2px; }
  &[data-preview-ui='terminal'] { border-style: dashed; }
  &[data-preview-ui='nyt'] {
    border-top-width: 2px;
    border-top-color: var(--neo-text-primary);
  }

  &__sample {
    font-size: 1.25rem;
    line-height: 1.2;
    color: var(--neo-text-primary);
    margin-bottom: 0.125rem;
  }

  &__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
    text-transform: none;
    letter-spacing: normal;
  }

  &__desc {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    line-height: 1.3;
  }

  &[data-preview-ui='braun'] .settings-chrome-card__sample {
    font-family: Helvetica, 'Helvetica Neue', Arial, sans-serif;
  }
  &[data-preview-ui='monocle'] .settings-chrome-card__sample {
    font-family: 'Source Sans 3', 'Avenir Next', 'Gill Sans', sans-serif;
  }
  &[data-preview-ui='bauhaus'] .settings-chrome-card__sample {
    font-family: 'Josefin Sans', Futura, 'Century Gothic', sans-serif;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 1.05rem;
  }
  &[data-preview-ui='noyes'] .settings-chrome-card__sample {
    font-family: 'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  }
  &[data-preview-ui='ikea'] .settings-chrome-card__sample {
    font-family: Verdana, Geneva, Tahoma, sans-serif;
    font-weight: 700;
  }
  &[data-preview-ui='military'] .settings-chrome-card__sample {
    font-family: Oswald, 'Arial Narrow', sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 1rem;
  }
  &[data-preview-ui='terminal'] .settings-chrome-card__sample {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }
  &[data-preview-ui='nyt'] .settings-chrome-card__sample {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-weight: 400;
  }
}

.settings-font-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.625rem;
}

.settings-font-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.875rem 0.75rem;
  background: var(--neo-bg-primary);
  border: var(--neo-border-width, 1px) solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  cursor: pointer;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: var(--neo-border-color-dark);
  }

  &.active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  &__sample {
    font-size: 1.5rem;
    line-height: 1;
    color: var(--neo-text-primary);
  }

  &__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
    text-transform: none;
    letter-spacing: normal;
  }

  &__desc {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    line-height: 1.3;
  }
}

// Segmented Control
.settings-segmented {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 8px);

  &__btn {
    flex: 1;
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    background: transparent;
    border: none;
    border-radius: calc(var(--neo-radius-sm, 6px) - 1px);
    color: var(--neo-text-secondary);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
    text-transform: none;
    letter-spacing: normal;

    &:hover {
      color: var(--neo-text-primary);
    }

    &.active {
      background: var(--neo-accent);
      color: var(--neo-text-on-accent);
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
  border-radius: var(--neo-radius-sm, 8px);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, filter 0.15s ease;
  text-decoration: none;
  text-transform: none;
  letter-spacing: normal;

  &--primary {
    background: var(--neo-accent);
    color: var(--neo-text-on-accent);

    &:hover:not(:disabled) {
      background: var(--neo-accent-hover);
    }
  }

  &--ghost {
    background: var(--neo-bg-primary);
    color: var(--neo-text-primary);
    border: 1px solid var(--neo-border-color);

    &:hover {
      background: var(--neo-bg-tertiary);
    }
  }

  &--danger {
    background: var(--neo-danger);
    color: var(--neo-text-on-accent, #fff);

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
  .settings-modal {
    --settings-h: calc(100dvh - 1rem);
    width: min(100%, calc(100vw - 1rem));
    border-radius: var(--neo-radius-md, 8px);
  }

  .settings-header {
    padding: 0.75rem 1rem;
    flex-wrap: wrap;
    gap: 0.625rem;

    &__left { order: 1; }
    &__center { order: 3; flex: 1 1 100%; }
    &__right { order: 2; margin-left: auto; }
  }

  .settings-search { max-width: none; }

  .settings-title { font-size: 1rem; }

  .settings-sidebar {
    width: 3.25rem;
    padding: 0.375rem;
  }

  .settings-nav-item {
    justify-content: center;
    padding: 0.625rem;

    &__label { display: none; }
    &__icon { font-size: 1.125rem; }
  }

  .settings-content { padding: 1rem 1.125rem 1.25rem; }

  .settings-section__header {
    margin-bottom: 1rem;

    h2 { font-size: 1.25rem; }
    p { font-size: 0.875rem; }
  }

  .settings-option-grid { grid-template-columns: 1fr; }

  .settings-toggle {
    flex-wrap: wrap;
    gap: 0.75rem;
  }
}

// Responsive - Mobile
@media (max-width: 480px) {
  .settings-overlay {
    padding: 0;
    align-items: stretch;
  }

  .settings-modal {
    --settings-h: 100dvh;
    width: 100%;
    border-radius: 0;
    border-left: none;
    border-right: none;
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

  .settings-sidebar { width: 3rem; }

  .settings-nav-item {
    padding: 0.5rem;
    &__icon { font-size: 1rem; }
  }

  .settings-content { padding: 0.875rem; }

  .settings-group {
    padding: 1rem;
    border-radius: var(--neo-radius-sm, 4px);
  }

  .settings-section__header {
    h2 { font-size: 1.125rem; }
    p { font-size: 0.8125rem; }
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

  .settings-segmented__btn {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
  }
}
</style>

