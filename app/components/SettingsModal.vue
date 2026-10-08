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

import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useOverlayStore } from '~/stores/overlay'
import { useToastStore } from '~/stores/toast'
import {
  applyAppearance,
  DENSITY_OPTIONS,
  FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  LINE_OPTIONS,
  RADIUS_OPTIONS,
  THEME_OPTIONS,
  UI_OPTIONS,
  TYPE_FACES,
  type NeoDensityId,
  type NeoFontId,
  type NeoFontSizeId,
  type NeoLineId,
  type NeoRadiusId,
  type NeoThemeId,
  type NeoUiId,
} from '~/utils/appearance'
import { stripHtml } from '~/utils/sanitizeHtml'

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const overlayStore = useOverlayStore()
const toastStore = useToastStore()
const router = useRouter()
const contentEl = ref<HTMLElement | null>(null)
const modalRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => settingsStore.isOpen)
const linkedAccounts = computed(() => instancesStore.authenticatedInstances)
const {
  isAndroid,
  isIos,
  alreadyInstalled,
  canNativeInstall,
  installNative,
} = useInstallApp()

const signOutAll = async () => {
  const ok = await overlayStore.openConfirm({
    title: 'Sign out of all accounts?',
    body: 'You will need to sign in again on each instance.',
    confirmLabel: 'Sign out all',
    danger: true,
  })
  if (!ok) return
  await instancesStore.logoutAll()
  settingsStore.close()
  toastStore.show({ message: 'Signed out of all accounts', duration: 2500 })
  router.push('/login')
}

const clearDeviceData = async () => {
  const ok = await overlayStore.openConfirm({
    title: 'Clear data on this device?',
    body: 'Removes local drafts, settings, columns, and cached accounts from this browser. Remote posts are not deleted.',
    confirmLabel: 'Clear data',
    danger: true,
  })
  if (!ok) return
  await instancesStore.logoutAll()
  instancesStore.clearLocalDeviceData()
  settingsStore.close()
  toastStore.show({ message: 'Local data cleared', duration: 2500 })
  router.push('/login')
}

const DISPLAY_NAME_MAX = 30
const NOTE_MAX = 500

const profileBaseline = reactive({
  displayName: '',
  note: '',
  locked: false,
  bot: false,
  discoverable: true,
})

const postingBaseline = reactive({
  visibility: 'public' as 'public' | 'unlisted' | 'private' | 'direct',
  sensitive: false,
})

const syncProfileBaseline = () => {
  profileBaseline.displayName = profileForm.displayName
  profileBaseline.note = profileForm.note
  profileBaseline.locked = profileForm.locked
  profileBaseline.bot = profileForm.bot
  profileBaseline.discoverable = profileForm.discoverable
}

const syncPostingBaseline = () => {
  postingBaseline.visibility = postingForm.visibility
  postingBaseline.sensitive = postingForm.sensitive
}

const profileDirty = computed(
  () =>
    profileForm.displayName !== profileBaseline.displayName ||
    profileForm.note !== profileBaseline.note ||
    profileForm.bot !== profileBaseline.bot ||
    profileForm.discoverable !== profileBaseline.discoverable,
)

const privacyDirty = computed(() => profileForm.locked !== profileBaseline.locked)

const postingDirty = computed(
  () =>
    postingForm.visibility !== postingBaseline.visibility ||
    postingForm.sensitive !== postingBaseline.sensitive,
)

const isDirty = computed(() => profileDirty.value || privacyDirty.value || postingDirty.value)

const displayNameInvalid = computed(() => profileForm.displayName.length > DISPLAY_NAME_MAX)
const noteInvalid = computed(() => profileForm.note.length > NOTE_MAX)
const profileFormInvalid = computed(() => displayNameInvalid.value || noteInvalid.value)

const confirmDiscard = async () => {
  if (!isDirty.value) return true
  return overlayStore.openConfirm({
    title: 'Discard unsaved changes?',
    body: 'You have settings that have not been saved yet.',
    confirmLabel: 'Discard',
    danger: true,
  })
}

/** Phone/tablet: category list → panel drill-down (replaces icon rail). */
const isNarrowSettings = useMediaQuery('(max-width: 768px)')
const mobilePanelOpen = ref(false)

const headerTitle = computed(() => {
  if (isNarrowSettings.value && mobilePanelOpen.value) {
    return settingsStore.currentCategory?.label || 'Settings'
  }
  return 'Settings'
})

const tryClose = async () => {
  if (!(await confirmDiscard())) return
  mobilePanelOpen.value = false
  settingsStore.close()
}

const mobileBack = async () => {
  if (!(await confirmDiscard())) return
  mobilePanelOpen.value = false
}

const onSettingsEscape = () => {
  if (isNarrowSettings.value && mobilePanelOpen.value) {
    void mobileBack()
    return
  }
  void tryClose()
}

const trySetCategory = async (categoryId: string) => {
  if (categoryId !== settingsStore.activeCategory) {
    if (!(await confirmDiscard())) return
    settingsStore.setCategory(categoryId)
  }
  if (isNarrowSettings.value) mobilePanelOpen.value = true
}

watch(isOpen, (open) => {
  if (open) mobilePanelOpen.value = false
})

watch(isNarrowSettings, (narrow) => {
  if (!narrow) mobilePanelOpen.value = false
})

useFocusTrap(modalRef, isOpen, {
  onEscape: () => onSettingsEscape(),
  initialFocus: '.settings-search__input, .settings-close',
})

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
  radius: 'match' as NeoRadiusId,
  density: 'cozy' as NeoDensityId,
  line: 'clean' as NeoLineId,
  reduceMotion: false,
  customProfileCss: false,
  flipTextAlign: 'center' as 'left' | 'center' | 'right',
  flipTextSize: 'large' as 'reading' | 'large' | 'display',
})

const flipAlignOptions = [
  { value: 'left' as const, label: 'Left' },
  { value: 'center' as const, label: 'Center' },
  { value: 'right' as const, label: 'Right' },
]

const flipSizeOptions = [
  { value: 'reading' as const, label: 'Reading' },
  { value: 'large' as const, label: 'Large' },
  { value: 'display' as const, label: 'Display' },
]

// Watch for settings load to populate forms
watch(() => settingsStore.account, (account) => {
  if (account) {
    profileForm.displayName = account.displayName || ''
    const sourceNote = (account as { source?: { note?: string } }).source?.note
    profileForm.note =
      typeof sourceNote === 'string' ? sourceNote : stripHtml(account.note || '')
    profileForm.locked = account.locked || false
    profileForm.bot = account.bot || false
    profileForm.discoverable = account.discoverable !== false
    syncProfileBaseline()
  }
}, { immediate: true })

watch(
  () => [
    settingsStore.preferences,
    settingsStore.localPreferences.defaultVisibility,
    settingsStore.localPreferences.defaultSensitive,
    settingsStore.localPreferences.postingDefaultsTouched,
  ],
  () => {
    postingForm.visibility = settingsStore.defaultVisibility
    postingForm.sensitive = settingsStore.defaultSensitive
    syncPostingBaseline()
  },
  { immediate: true },
)

watch(() => settingsStore.localPreferences, (prefs) => {
  if (prefs) {
    appearanceForm.theme = prefs.theme
    appearanceForm.ui = prefs.ui
    appearanceForm.font = prefs.font
    appearanceForm.fontSize = prefs.fontSize
    appearanceForm.radius = prefs.radius
    appearanceForm.density = prefs.density
    appearanceForm.line = prefs.line
    appearanceForm.reduceMotion = prefs.reduceMotion
    appearanceForm.customProfileCss = prefs.customProfileCss
    appearanceForm.flipTextAlign = prefs.flipTextAlign
    appearanceForm.flipTextSize = prefs.flipTextSize
  }
}, { immediate: true })

const privacyListsLoaded = ref(false)

watch(
  () => settingsStore.activeCategory,
  async (cat) => {
    if (contentEl.value) contentEl.value.scrollTop = 0
    if (cat !== 'privacy' || privacyListsLoaded.value) return
    privacyListsLoaded.value = true
    await Promise.all([
      settingsStore.loadMutedAccounts(),
      settingsStore.loadBlockedAccounts(),
      settingsStore.loadBlockedDomains(),
    ])
  },
  // Mounted on first open (layout gates it) — may open straight onto Privacy
  { immediate: true },
)

watch(
  () => instancesStore.activeAccountId,
  () => {
    settingsStore.clearModerationLists()
    privacyListsLoaded.value = false
  },
)

// Save handlers
const saveProfile = async () => {
  if (profileFormInvalid.value) return
  await settingsStore.updateProfile({
    displayName: profileForm.displayName,
    note: profileForm.note,
    bot: profileForm.bot,
    discoverable: profileForm.discoverable,
  })
  syncProfileBaseline()
  settingsStore.clearSuccess()
}

const savePrivacy = async () => {
  await settingsStore.updateProfile({ locked: profileForm.locked })
  syncProfileBaseline()
  settingsStore.clearSuccess()
}

const confirmDeleteFilter = async (filterId: string, title: string) => {
  const ok = await overlayStore.openConfirm({
    title: 'Delete this filter?',
    body: `"${title}" will be removed from your account.`,
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  await settingsStore.deleteFilter(filterId)
}

const savePostingDefaults = () => {
  settingsStore.updatePostingDefaults({
    visibility: postingForm.visibility,
    sensitive: postingForm.sensitive,
  })
  syncPostingBaseline()
  settingsStore.clearSuccess()
}

const saveAppearance = () => {
  settingsStore.updateAppearance({
    theme: appearanceForm.theme,
    ui: appearanceForm.ui,
    font: appearanceForm.font,
    fontSize: appearanceForm.fontSize,
    radius: appearanceForm.radius,
    density: appearanceForm.density,
    line: appearanceForm.line,
    reduceMotion: appearanceForm.reduceMotion,
    customProfileCss: appearanceForm.customProfileCss,
    flipTextAlign: appearanceForm.flipTextAlign,
    flipTextSize: appearanceForm.flipTextSize,
  })
  settingsStore.clearSuccess()
}

const onThemeApply = () => {
  const previous = settingsStore.localPreferences.theme
  saveAppearance()
  toastStore.show({
    message: 'Theme updated',
    actionLabel: 'Revert',
    duration: 5000,
    onAction: () => {
      appearanceForm.theme = previous
      saveAppearance()
    },
  })
}

const hoveredTheme = ref<NeoThemeId | null>(null)

const previewTheme = (themeId: NeoThemeId) => {
  hoveredTheme.value = themeId
  applyAppearance({
    theme: themeId,
    ui: appearanceForm.ui,
    font: appearanceForm.font,
    fontSize: appearanceForm.fontSize,
    radius: appearanceForm.radius,
    density: appearanceForm.density,
    line: appearanceForm.line,
  })
}

const clearThemePreview = () => {
  hoveredTheme.value = null
  settingsStore.applyLocalAppearance()
}

const resetAppearance = () => {
  settingsStore.resetAppearance()
  Object.assign(appearanceForm, settingsStore.localPreferences)
}

const exportAppearance = () => {
  const json = settingsStore.exportAppearanceJson()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'neospace-appearance.json'
  a.click()
  URL.revokeObjectURL(url)
}

const importAppearanceInput = ref<HTMLInputElement | null>(null)

const importAppearance = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    settingsStore.importAppearanceJson(text)
    Object.assign(appearanceForm, settingsStore.localPreferences)
    toastStore.show({ message: 'Appearance imported', duration: 2500 })
  } catch (e) {
    toastStore.show({
      message: e instanceof Error ? e.message : 'Could not import appearance',
      duration: 3500,
    })
  } finally {
    input.value = ''
  }
}

const newFilterTitle = ref('')
const newFilterKeywords = ref('')
const newFilterAction = ref<'warn' | 'hide'>('warn')
const isCreatingFilter = ref(false)

const createNewFilter = async () => {
  const title = newFilterTitle.value.trim()
  const keywords = newFilterKeywords.value
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  if (!title || !keywords.length) {
    toastStore.show({ message: 'Enter a title and at least one keyword', duration: 3000 })
    return
  }
  isCreatingFilter.value = true
  try {
    await settingsStore.createFilter({
      title,
      keywords,
      context: ['home', 'notifications', 'public', 'thread'],
      filterAction: newFilterAction.value,
    })
    newFilterTitle.value = ''
    newFilterKeywords.value = ''
    toastStore.show({ message: 'Filter created', duration: 2500 })
  } catch {
    /* store sets error */
  } finally {
    isCreatingFilter.value = false
  }
}

const newBlockDomain = ref('')
const isBlockingDomain = ref(false)

const submitBlockDomain = async () => {
  const domain = newBlockDomain.value.trim()
  if (!domain) return
  isBlockingDomain.value = true
  try {
    await settingsStore.blockDomain(domain)
    newBlockDomain.value = ''
    toastStore.show({ message: `Blocked ${domain}`, duration: 2500 })
  } catch {
    /* store sets error */
  } finally {
    isBlockingDomain.value = false
  }
}

const onFontSizeChange = (value: string) => {
  appearanceForm.fontSize = value as typeof appearanceForm.fontSize
  saveAppearance()
}

const onRadiusChange = (value: string) => {
  appearanceForm.radius = value as typeof appearanceForm.radius
  saveAppearance()
}

const onFlipAlignChange = (value: string) => {
  appearanceForm.flipTextAlign = value as typeof appearanceForm.flipTextAlign
  saveAppearance()
}

const onFlipSizeChange = (value: string) => {
  appearanceForm.flipTextSize = value as typeof appearanceForm.flipTextSize
  saveAppearance()
}

const onDensityChange = (value: string) => {
  appearanceForm.density = value as typeof appearanceForm.density
  saveAppearance()
}

const onLineChange = (value: string) => {
  appearanceForm.line = value as typeof appearanceForm.line
  saveAppearance()
}

const hasProfileCss = computed(() => !!instancesStore.userCustomCSS)

// Visibility options
const visibilityOptions = [
  { value: 'public', label: 'Public', icon: 'globe' as const, desc: 'Visible to everyone' },
  { value: 'unlisted', label: 'Unlisted', icon: 'unlisted' as const, desc: 'Visible but not on public timelines' },
  { value: 'private', label: 'Followers Only', icon: 'lock' as const, desc: 'Only your followers can see' },
  { value: 'direct', label: 'Direct', icon: 'message' as const, desc: 'Only mentioned users can see' },
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
const radiusOptions = RADIUS_OPTIONS
const radiusRadioOptions = RADIUS_OPTIONS.map((o) => ({ value: o.id, label: o.label }))
const densityOptions = DENSITY_OPTIONS
const densityRadioOptions = DENSITY_OPTIONS.map((o) => ({ value: o.id, label: o.label }))
const lineOptions = LINE_OPTIONS
const lineRadioOptions = LINE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))

const fontPreviewStack = (fontId: NeoFontId) => {
  const ui = appearanceForm.ui || 'braun'
  return TYPE_FACES[ui]?.[fontId] || TYPE_FACES.braun[fontId]
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="settingsStore.isOpen"
        ref="modalRef"
        class="settings-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        @click.self="tryClose"
      >
        <div
          class="settings-modal"
          :class="{
            'settings-modal--mobile-list': isNarrowSettings && !mobilePanelOpen,
            'settings-modal--mobile-panel': isNarrowSettings && mobilePanelOpen,
          }"
        >
          <!-- Header with search -->
          <header class="settings-header">
            <div class="settings-header__left">
              <button
                v-if="isNarrowSettings && mobilePanelOpen"
                type="button"
                class="settings-back"
                aria-label="Back to settings categories"
                @click="mobileBack"
              >
                <NeoIcon name="chevron-left" :size="20" :stroke="2" />
              </button>
              <h1 id="settings-title" class="settings-title">{{ headerTitle }}</h1>
            </div>
            <div v-if="!(isNarrowSettings && mobilePanelOpen)" class="settings-header__center">
              <div class="settings-search">
                <label class="sr-only" for="settings-search-input">Search settings</label>
                <span class="settings-search__icon" aria-hidden="true">
                  <NeoIcon name="search" :size="16" :stroke="1.75" />
                </span>
                <input
                  id="settings-search-input"
                  v-model="settingsStore.searchQuery"
                  type="search"
                  placeholder="Search settings..."
                  class="settings-search__input"
                  autocomplete="off"
                />
              </div>
            </div>
            <div class="settings-header__right">
              <button class="settings-close" @click="tryClose" aria-label="Close settings">
                <NeoIcon name="x" :size="18" :stroke="2" />
              </button>
            </div>
          </header>

          <div class="settings-body">
            <!-- Sidebar / mobile category list -->
            <nav class="settings-sidebar" aria-label="Settings categories">
              <button
                v-for="category in settingsStore.filteredCategories"
                :key="category.id"
                type="button"
                :class="[
                  'settings-nav-item',
                  {
                    active:
                      !isNarrowSettings && settingsStore.activeCategory === category.id,
                  },
                ]"
                :aria-label="category.label"
                :aria-current="
                  !isNarrowSettings && settingsStore.activeCategory === category.id
                    ? 'page'
                    : undefined
                "
                @click="trySetCategory(category.id)"
              >
                <span class="settings-nav-item__icon" aria-hidden="true"><NeoIcon :name="(category.icon as any)" :size="18" :stroke="1.75" /></span>
                <span class="settings-nav-item__label">{{ category.label }}</span>
                <span
                  v-if="isNarrowSettings"
                  class="settings-nav-item__chevron"
                  aria-hidden="true"
                >
                  <NeoIcon name="chevron-left" :size="16" :stroke="2" />
                </span>
              </button>
              <p
                v-if="settingsStore.searchQuery.trim() && !settingsStore.filteredCategories.length"
                class="settings-search-empty"
                role="status"
              >
                No settings match “{{ settingsStore.searchQuery.trim() }}”.
              </p>
            </nav>

            <!-- Content -->
            <div ref="contentEl" class="settings-content">
              <!-- Loading -->
              <div v-if="settingsStore.isLoading" class="settings-loading" aria-busy="true">
                <FunLoader fill label="Loading settings" />
              </div>

              <!-- Success message -->
              <Transition name="fade">
                <div v-if="settingsStore.saveSuccess" class="settings-success" role="status">
                  <span aria-hidden="true">✓</span> Settings saved successfully
                </div>
              </Transition>

              <!-- Error message -->
              <div v-if="settingsStore.error" class="settings-error" role="alert">
                <span aria-hidden="true">⚠️</span> {{ settingsStore.error }}
              </div>

              <template v-else>
              <!-- Profile Settings -->
              <section v-if="settingsStore.activeCategory === 'profile'" class="settings-section">
                <div class="settings-section__header">
                  <h2>
                    <NeoIcon
                      v-if="settingsStore.currentCategory?.icon"
                      :name="(settingsStore.currentCategory.icon as any)"
                      :size="18"
                      :stroke="1.75"
                    />
                    {{ settingsStore.currentCategory?.label }}
                  </h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Profile details</legend>
                    <label class="settings-label">
                      <span class="settings-label__text">Display Name</span>
                      <input
                        v-model="profileForm.displayName"
                        type="text"
                        class="settings-input"
                        placeholder="Your display name"
                        :maxlength="DISPLAY_NAME_MAX"
                        :aria-invalid="displayNameInvalid || undefined"
                        aria-describedby="settings-display-name-hint settings-display-name-error"
                      />
                      <span id="settings-display-name-hint" class="settings-field-hint">
                        {{ profileForm.displayName.length }}/{{ DISPLAY_NAME_MAX }}
                      </span>
                      <span
                        v-if="displayNameInvalid"
                        id="settings-display-name-error"
                        class="settings-field-error"
                        role="alert"
                      >Display name must be {{ DISPLAY_NAME_MAX }} characters or fewer.</span>
                    </label>

                    <label class="settings-label">
                      <span class="settings-label__text">Bio</span>
                      <textarea
                        v-model="profileForm.note"
                        class="settings-textarea"
                        placeholder="Tell the world about yourself..."
                        rows="4"
                        :maxlength="NOTE_MAX"
                        :aria-invalid="noteInvalid || undefined"
                        aria-describedby="settings-note-hint settings-note-error"
                      />
                      <span id="settings-note-hint" class="settings-field-hint">
                        {{ profileForm.note.length }}/{{ NOTE_MAX }}
                      </span>
                      <span
                        v-if="noteInvalid"
                        id="settings-note-error"
                        class="settings-field-error"
                        role="alert"
                      >Bio must be {{ NOTE_MAX }} characters or fewer.</span>
                    </label>
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Account flags</legend>
                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">Discoverable</span>
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
                  </fieldset>
                </div>

                <div class="settings-actions">
                  <button 
                    class="settings-btn settings-btn--primary"
                    :disabled="settingsStore.isSaving || profileFormInvalid || !profileDirty"
                    @click="saveProfile"
                  >
                    {{ settingsStore.isSaving ? 'Saving...' : 'Save Changes' }}
                  </button>
                </div>
              </section>

              <!-- Privacy & Safety -->
              <section v-if="settingsStore.activeCategory === 'privacy'" class="settings-section">
                <div class="settings-section__header">
                  <h2>
                    <NeoIcon
                      v-if="settingsStore.currentCategory?.icon"
                      :name="(settingsStore.currentCategory.icon as any)"
                      :size="18"
                      :stroke="1.75"
                    />
                    {{ settingsStore.currentCategory?.label }}
                  </h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Post Privacy</legend>
                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">Require follow approval</span>
                      <span class="settings-toggle__desc">New followers must be approved</span>
                    </div>
                    <input v-model="profileForm.locked" type="checkbox" class="settings-checkbox" />
                  </label>

                  <div class="settings-actions" style="margin-top: 1rem;">
                    <button
                      class="settings-btn settings-btn--primary"
                      :disabled="settingsStore.isSaving || !privacyDirty"
                      @click="savePrivacy"
                    >
                      {{ settingsStore.isSaving ? 'Saving...' : 'Save Privacy' }}
                    </button>
                  </div>
                  </fieldset>

                  <div class="settings-divider" />
                  
                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Muted Accounts</legend>
                  <p class="settings-hint">Accounts you've muted won't appear in your timelines.</p>
                  
                  <div v-if="settingsStore.isLoadingMuted && !settingsStore.mutedAccounts.length" class="settings-empty" aria-busy="true">
                    Loading muted accounts…
                  </div>
                  <div v-else-if="settingsStore.mutedAccounts.length === 0" class="settings-empty">
                    No muted accounts
                  </div>
                  <div v-else class="settings-account-list">
                    <div 
                      v-for="account in settingsStore.mutedAccounts" 
                      :key="account.id"
                      class="settings-account-item"
                    >
                      <img :src="account.avatar" alt="" class="settings-account-avatar" />
                      <div class="settings-account-info">
                        <span class="settings-account-name">{{ account.displayName || account.username }}</span>
                        <span class="settings-account-handle">@{{ account.acct }}</span>
                      </div>
                      <button 
                        class="settings-btn settings-btn--small"
                        :disabled="settingsStore.isModerationPending('unmute', account.id)"
                        @click="settingsStore.unmuteAccount(account.id)"
                      >
                        {{ settingsStore.isModerationPending('unmute', account.id) ? 'Unmuting…' : 'Unmute' }}
                      </button>
                    </div>
                  </div>

                  <button
                    v-if="settingsStore.hasMoreMuted"
                    class="settings-btn settings-btn--ghost"
                    :disabled="settingsStore.isLoadingMuted"
                    @click="settingsStore.loadMutedAccounts({ more: true })"
                  >
                    {{ settingsStore.isLoadingMuted ? 'Loading…' : 'Load more muted accounts' }}
                  </button>

                  </fieldset>

                  <div class="settings-divider" />
                  
                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Blocked Accounts</legend>
                  <p class="settings-hint">Blocked accounts cannot follow you or see your posts.</p>
                  
                  <div v-if="settingsStore.isLoadingBlocked && !settingsStore.blockedAccounts.length" class="settings-empty" aria-busy="true">
                    Loading blocked accounts…
                  </div>
                  <div v-else-if="settingsStore.blockedAccounts.length === 0" class="settings-empty">
                    No blocked accounts
                  </div>
                  <div v-else class="settings-account-list">
                    <div 
                      v-for="account in settingsStore.blockedAccounts" 
                      :key="account.id"
                      class="settings-account-item"
                    >
                      <img :src="account.avatar" alt="" class="settings-account-avatar" />
                      <div class="settings-account-info">
                        <span class="settings-account-name">{{ account.displayName || account.username }}</span>
                        <span class="settings-account-handle">@{{ account.acct }}</span>
                      </div>
                      <button 
                        class="settings-btn settings-btn--small"
                        :disabled="settingsStore.isModerationPending('unblock', account.id)"
                        @click="settingsStore.unblockAccount(account.id)"
                      >
                        {{ settingsStore.isModerationPending('unblock', account.id) ? 'Unblocking…' : 'Unblock' }}
                      </button>
                    </div>
                  </div>

                  <button
                    v-if="settingsStore.hasMoreBlocked"
                    class="settings-btn settings-btn--ghost"
                    :disabled="settingsStore.isLoadingBlocked"
                    @click="settingsStore.loadBlockedAccounts({ more: true })"
                  >
                    {{ settingsStore.isLoadingBlocked ? 'Loading…' : 'Load more blocked accounts' }}
                  </button>
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Blocked Domains</legend>
                    <p class="settings-hint">Block every account from a server domain.</p>
                    <form class="settings-inline-form" @submit.prevent="submitBlockDomain">
                      <label class="sr-only" for="settings-block-domain">Domain to block</label>
                      <input
                        id="settings-block-domain"
                        v-model="newBlockDomain"
                        type="text"
                        class="settings-input"
                        placeholder="example.social"
                        :disabled="isBlockingDomain"
                      />
                      <button
                        type="submit"
                        class="settings-btn settings-btn--primary"
                        :disabled="isBlockingDomain || !newBlockDomain.trim()"
                      >
                        {{ isBlockingDomain ? 'Blocking…' : 'Block domain' }}
                      </button>
                    </form>
                    <div v-if="settingsStore.blockedDomains.length === 0" class="settings-empty">
                      No blocked domains
                    </div>
                    <div v-else class="settings-account-list">
                      <div
                        v-for="domain in settingsStore.blockedDomains"
                        :key="domain"
                        class="settings-account-item"
                      >
                        <div class="settings-account-info">
                          <span class="settings-account-name">{{ domain }}</span>
                        </div>
                        <button
                          class="settings-btn settings-btn--small"
                          :disabled="settingsStore.isModerationPending('unblock-domain', domain)"
                          @click="settingsStore.unblockDomain(domain)"
                        >
                          {{ settingsStore.isModerationPending('unblock-domain', domain) ? 'Unblocking…' : 'Unblock' }}
                        </button>
                      </div>
                    </div>
                  </fieldset>
                </div>
              </section>

              <!-- Notifications -->
              <section v-if="settingsStore.activeCategory === 'notifications'" class="settings-section">
                <div class="settings-section__header">
                  <h2>
                    <NeoIcon
                      v-if="settingsStore.currentCategory?.icon"
                      :name="(settingsStore.currentCategory.icon as any)"
                      :size="18"
                      :stroke="1.75"
                    />
                    {{ settingsStore.currentCategory?.label }}
                  </h2>
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
                    target="_blank" rel="noopener noreferrer"
                    class="settings-btn settings-btn--primary"
                  >
                    Open Instance Notification Settings →
                  </a>
                </div>
              </section>

              <!-- Appearance -->
              <section v-if="settingsStore.activeCategory === 'appearance'" class="settings-section">
                <div class="settings-section__header">
                  <h2>
                    <NeoIcon
                      v-if="settingsStore.currentCategory?.icon"
                      :name="(settingsStore.currentCategory.icon as any)"
                      :size="18"
                      :stroke="1.75"
                    />
                    {{ settingsStore.currentCategory?.label }}
                  </h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Theme</legend>
                  <p class="settings-hint">Color system — tap a swatch or use the sidebar cycle button.</p>
                  <div class="settings-theme-grid">
                    <label
                      v-for="option in themeOptions"
                      :key="option.value"
                      :class="['settings-theme-swatch', { active: appearanceForm.theme === option.value, 'is-previewing': hoveredTheme === option.value }]"
                      @mouseenter="previewTheme(option.value)"
                      @mouseleave="clearThemePreview"
                      @focusin="previewTheme(option.value)"
                      @focusout="clearThemePreview"
                    >
                      <input
                        v-model="appearanceForm.theme"
                        type="radio"
                        name="settings-theme"
                        :value="option.value"
                        class="settings-radio-hidden"
                        @change="onThemeApply"
                      />
                      <span
                        class="settings-theme-swatch__chip"
                        :style="{ background: option.swatch, color: option.ink }"
                      >
                        <span class="settings-theme-swatch__dot"></span>
                        <span class="settings-theme-swatch__ring" aria-hidden="true"></span>
                        <span v-if="hoveredTheme === option.value" class="settings-theme-swatch__preview" aria-hidden="true">
                          <span class="settings-theme-swatch__preview-bar"></span>
                          <span class="settings-theme-swatch__preview-line"></span>
                          <span class="settings-theme-swatch__preview-line settings-theme-swatch__preview-line--short"></span>
                        </span>
                      </span>
                      <span class="settings-theme-swatch__label">{{ option.label }}</span>
                      <span class="settings-theme-swatch__desc">{{ option.desc }}</span>
                    </label>
                  </div>
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Chrome</legend>
                  <p class="settings-hint">Full interface system — type, borders, labels. Corners follow Radius unless set to Match.</p>
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
                        name="settings-chrome"
                        :value="option.id"
                        class="settings-radio-hidden"
                        @change="saveAppearance"
                      />
                      <span class="settings-chrome-card__sample">{{ option.sample }}</span>
                      <span class="settings-chrome-card__label">{{ option.label }}</span>
                      <span class="settings-chrome-card__desc">{{ option.desc }}</span>
                    </label>
                  </div>
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Typography</legend>
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
                        name="settings-font"
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
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Font Size</legend>
                  <NeoRadioGroup
                    :options="fontSizeOptions"
                    :model-value="appearanceForm.fontSize"
                    ariaLabel="Font size"
                    @update:model-value="onFontSizeChange"
                  />
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Corners</legend>
                  <p class="settings-hint">
                    Border-radius set across cards, inputs, and chrome. Match keeps the active chrome’s corners
                    (Brutal / NES stay sharp when Match).
                  </p>
                  <NeoRadioGroup
                    :options="radiusRadioOptions"
                    :model-value="appearanceForm.radius"
                    ariaLabel="Corners"
                    @update:model-value="onRadiusChange"
                  />
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Flip text</legend>
                  <p class="settings-hint">
                    How posts look in Flip mode (full-bleed swipe). Applies especially to text-only slides.
                  </p>

                  <p class="settings-hint settings-subheading--tight">Alignment</p>
                  <NeoRadioGroup
                    :options="flipAlignOptions"
                    :model-value="appearanceForm.flipTextAlign"
                    ariaLabel="Flip text alignment"
                    @update:model-value="onFlipAlignChange"
                  />

                  <p class="settings-hint settings-subheading--tight">Size</p>
                  <NeoRadioGroup
                    :options="flipSizeOptions"
                    :model-value="appearanceForm.flipTextSize"
                    ariaLabel="Flip text size"
                    @update:model-value="onFlipSizeChange"
                  />
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Density</legend>
                  <p class="settings-hint">How tightly cards and chrome pack the screen.</p>
                  <NeoRadioGroup
                    :options="densityRadioOptions"
                    :model-value="appearanceForm.density"
                    ariaLabel="Density"
                    @update:model-value="onDensityChange"
                  />
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Lines</legend>
                  <p class="settings-hint">Outline character — clean hairlines through crayon wiggles.</p>
                  <NeoRadioGroup
                    :options="lineRadioOptions"
                    :model-value="appearanceForm.line"
                    ariaLabel="Lines"
                    @update:model-value="onLineChange"
                  />
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Motion &amp; accessibility</legend>
                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">Reduce motion</span>
                      <span class="settings-toggle__desc">Disable animations and auto-playing content</span>
                    </div>
                    <input
                      v-model="appearanceForm.reduceMotion"
                      type="checkbox"
                      class="settings-checkbox"
                      @change="saveAppearance"
                    />
                  </label>
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Custom profile CSS</legend>
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
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Backup &amp; reset</legend>
                    <p class="settings-hint">Reset appearance to defaults or move settings between devices.</p>
                    <div class="settings-actions settings-actions--inline">
                      <button type="button" class="settings-btn settings-btn--ghost" @click="resetAppearance">
                        Reset appearance
                      </button>
                      <button type="button" class="settings-btn settings-btn--ghost" @click="exportAppearance">
                        Export JSON
                      </button>
                      <button type="button" class="settings-btn settings-btn--ghost" @click="importAppearanceInput?.click()">
                        Import JSON
                      </button>
                      <input
                        ref="importAppearanceInput"
                        type="file"
                        accept="application/json,.json"
                        class="settings-file-input"
                        @change="importAppearance"
                      />
                    </div>
                  </fieldset>
                </div>
              </section>

              <!-- Posting Defaults -->
              <section v-if="settingsStore.activeCategory === 'posting'" class="settings-section">
                <div class="settings-section__header">
                  <h2>
                    <NeoIcon
                      v-if="settingsStore.currentCategory?.icon"
                      :name="(settingsStore.currentCategory.icon as any)"
                      :size="18"
                      :stroke="1.75"
                    />
                    {{ settingsStore.currentCategory?.label }}
                  </h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Default Visibility</legend>
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
                        name="settings-visibility"
                        :value="option.value"
                        class="settings-radio-hidden"
                      />
                      <span class="settings-option-row__icon">
                        <NeoIcon :name="option.icon" :size="20" :stroke="1.75" />
                      </span>
                      <div class="settings-option-row__text">
                        <span class="settings-option-row__label">{{ option.label }}</span>
                        <span class="settings-option-row__desc">{{ option.desc }}</span>
                      </div>
                      <span v-if="postingForm.visibility === option.value" class="settings-option-row__check">
                        <NeoIcon name="check" :size="16" :stroke="2.5" />
                      </span>
                    </label>
                  </div>

                  <div class="settings-divider" />

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">Collapse duplicate reposts</span>
                      <span class="settings-toggle__desc">In Home, show “Alice and 2 others reposted” instead of separate cards</span>
                    </div>
                    <input
                      :checked="settingsStore.localPreferences.collapseReblogs"
                      type="checkbox"
                      class="settings-checkbox"
                      @change="settingsStore.updateAppearance({ collapseReblogs: ($event.target as HTMLInputElement).checked })"
                    />
                  </label>

                  <div class="settings-divider" />

                  <label class="settings-toggle">
                    <div class="settings-toggle__info">
                      <span class="settings-toggle__label">Mark media as sensitive by default</span>
                      <span class="settings-toggle__desc">Media will be hidden behind a warning</span>
                    </div>
                    <input v-model="postingForm.sensitive" type="checkbox" class="settings-checkbox" />
                  </label>
                  </fieldset>
                </div>

                <div class="settings-actions">
                  <button 
                    class="settings-btn settings-btn--primary"
                    :disabled="!postingDirty"
                    @click="savePostingDefaults"
                  >
                    Save Posting Defaults
                  </button>
                </div>
              </section>

              <!-- Filters -->
              <section v-if="settingsStore.activeCategory === 'filters'" class="settings-section">
                <div class="settings-section__header">
                  <h2>
                    <NeoIcon
                      v-if="settingsStore.currentCategory?.icon"
                      :name="(settingsStore.currentCategory.icon as any)"
                      :size="18"
                      :stroke="1.75"
                    />
                    {{ settingsStore.currentCategory?.label }}
                  </h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Create filter</legend>
                    <form class="settings-filter-form" @submit.prevent="createNewFilter">
                      <label class="settings-label">
                        <span class="settings-label__text">Title</span>
                        <input v-model="newFilterTitle" type="text" class="settings-input" placeholder="Politics" />
                      </label>
                      <label class="settings-label">
                        <span class="settings-label__text">Keywords</span>
                        <input
                          v-model="newFilterKeywords"
                          type="text"
                          class="settings-input"
                          placeholder="keyword1, keyword2"
                        />
                      </label>
                      <label class="settings-label">
                        <span class="settings-label__text">Action</span>
                        <select v-model="newFilterAction" class="settings-input">
                          <option value="warn">Warn</option>
                          <option value="hide">Hide</option>
                        </select>
                      </label>
                      <button
                        type="submit"
                        class="settings-btn settings-btn--primary"
                        :disabled="isCreatingFilter"
                      >
                        {{ isCreatingFilter ? 'Creating…' : 'Create filter' }}
                      </button>
                    </form>
                  </fieldset>

                  <div class="settings-divider" />

                  <fieldset class="settings-fieldset">
                    <legend class="settings-subheading">Active Filters</legend>
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
                        :disabled="settingsStore.isModerationPending('delete-filter', filter.id)"
                        @click="confirmDeleteFilter(filter.id, filter.title)"
                      >
                        {{ settingsStore.isModerationPending('delete-filter', filter.id) ? 'Deleting…' : 'Delete' }}
                      </button>
                    </div>
                  </div>

                  <a 
                    v-if="instancesStore.instanceUrl"
                    :href="`${instancesStore.instanceUrl}/settings/filters`"
                    target="_blank" rel="noopener noreferrer"
                    class="settings-btn settings-btn--ghost"
                  >
                    Manage Filters on Instance →
                  </a>
                  </fieldset>
                </div>
              </section>

              <!-- Account -->
              <section v-if="settingsStore.activeCategory === 'account'" class="settings-section">
                <div class="settings-section__header">
                  <h2>
                    <NeoIcon
                      v-if="settingsStore.currentCategory?.icon"
                      :name="(settingsStore.currentCategory.icon as any)"
                      :size="18"
                      :stroke="1.75"
                    />
                    {{ settingsStore.currentCategory?.label }}
                  </h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-group">
                  <h3 class="settings-subheading">Connected Account</h3>
                  
                  <div v-if="settingsStore.account" class="settings-account-card">
                    <img :src="settingsStore.account.avatar" alt="" class="settings-account-card__avatar" />
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

                  <h3 class="settings-subheading">Linked accounts</h3>
                  <ul v-if="linkedAccounts.length" class="settings-linked-list">
                    <li
                      v-for="acct in linkedAccounts"
                      :key="acct.id"
                      class="settings-linked-item"
                    >
                      <img
                        v-if="acct.user?.avatar"
                        :src="acct.user.avatar"
                        alt=""
                        class="settings-linked-item__avatar"
                      />
                      <div class="settings-linked-item__info">
                        <span class="settings-linked-item__name">
                          {{ acct.user?.displayName || acct.user?.username || 'Account' }}
                        </span>
                        <span class="settings-linked-item__handle">
                          @{{ acct.user?.acct || acct.url.replace(/^https?:\/\//, '') }}
                        </span>
                      </div>
                      <span
                        v-if="acct.id === instancesStore.activeAccountId"
                        class="settings-linked-item__badge"
                      >Active</span>
                    </li>
                  </ul>
                  <p v-else class="settings-hint">No signed-in accounts.</p>
                  <NuxtLink
                    to="/login"
                    class="settings-btn settings-btn--ghost"
                    @click="settingsStore.close()"
                  >
                    Add account
                  </NuxtLink>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Install app</h3>
                  <p v-if="alreadyInstalled" class="settings-hint">
                    NeoSpace is already installed on this device.
                  </p>
                  <template v-else>
                    <p class="settings-hint">
                      {{
                        canNativeInstall
                          ? 'Install for a full-screen home-screen app.'
                          : isAndroid
                            ? 'Chrome often hides Install in ⋮ — use Add to Home screen, or tap below if Chrome offers a prompt.'
                            : isIos
                              ? 'In Safari: Share → Add to Home Screen.'
                              : 'Install NeoSpace on a phone for the app experience.'
                      }}
                    </p>
                    <button
                      v-if="canNativeInstall"
                      type="button"
                      class="settings-btn settings-btn--primary"
                      @click="installNative"
                    >
                      Install NeoSpace
                    </button>
                    <ol v-if="isAndroid && !canNativeInstall" class="settings-install-steps">
                      <li>Open neospace.ibm.io in the <strong>Chrome</strong> app.</li>
                      <li>Tap <strong>⋮</strong> → <strong>Add to Home screen</strong> (or Install app / Add to…).</li>
                      <li>Confirm to pin the icon.</li>
                    </ol>
                    <ol v-else-if="isIos" class="settings-install-steps">
                      <li>Open in <strong>Safari</strong>.</li>
                      <li><strong>Share</strong> → <strong>Add to Home Screen</strong>.</li>
                    </ol>
                  </template>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Sign out</h3>
                  <p class="settings-hint">Revoke tokens and leave NeoSpace on this device.</p>
                  <button
                    type="button"
                    class="settings-btn settings-btn--ghost"
                    @click="signOutAll"
                  >
                    Sign out all accounts
                  </button>
                  <button
                    type="button"
                    class="settings-btn settings-btn--danger"
                    @click="clearDeviceData"
                  >
                    Clear data on this device
                  </button>

                  <div class="settings-divider" />

                  <h3 class="settings-subheading">Instance Settings</h3>
                  <p class="settings-hint">
                    Advanced account settings like email, password, and two-factor authentication 
                    are managed on your instance.
                  </p>
                  
                  <a 
                    v-if="instancesStore.instanceUrl"
                    :href="`${instancesStore.instanceUrl}/settings`"
                    target="_blank" rel="noopener noreferrer"
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
                    target="_blank" rel="noopener noreferrer"
                    class="settings-btn settings-btn--ghost"
                  >
                    Export Data →
                  </a>
                </div>
              </section>

              <!-- Humans first — product north star (not a monetization page) -->
              <section v-if="settingsStore.activeCategory === 'humans'" class="settings-section">
                <div class="settings-section__header">
                  <h2>
                    <NeoIcon
                      v-if="settingsStore.currentCategory?.icon"
                      :name="(settingsStore.currentCategory.icon as any)"
                      :size="18"
                      :stroke="1.75"
                    />
                    {{ settingsStore.currentCategory?.label }}
                  </h2>
                  <p>{{ settingsStore.currentCategory?.description }}</p>
                </div>

                <div class="settings-form">
                  <div class="settings-humans">
                    <p class="settings-humans__lede">
                      NeoSpace is here so <strong>humans</strong> can find each other, understand
                      each other, and stay in control of their attention. Not to farm engagement.
                      Not to capitalize the commons.
                    </p>

                    <h3 class="settings-subheading">Keep in the frame</h3>
                    <ul class="settings-humans__list">
                      <li>Tools that help people connect and be better to each other</li>
                      <li>Affinity toward people you know — not anonymous scoreboards</li>
                      <li>
                        AI only as an optional helper for clarity, discovery, and accessibility —
                        never a stand-in for the person on the other end
                      </li>
                      <li>Edward Mode as a human radar, not an engagement funnel</li>
                    </ul>

                    <h3 class="settings-subheading">Keep out of the frame</h3>
                    <ul class="settings-humans__list">
                      <li>Ads, pay-to-boost, or selling your attention</li>
                      <li>Dark patterns that rack up dopamine for metrics</li>
                      <li>Ranking who “deserves” to be seen</li>
                    </ul>

                    <div class="settings-divider" />

                    <h3 class="settings-subheading">Already in motion</h3>
                    <p class="settings-hint">
                      Edward’s <strong>no bots</strong> chip hides accounts marked as bots (and
                      obvious self-marks). That’s a start — not a finished proof of humanity.
                    </p>

                    <div class="settings-divider" />

                    <h3 class="settings-subheading">Where this is headed</h3>
                    <p class="settings-hint">
                      Someday: optional <strong>proofs of reality</strong> — short, weird,
                      real-world photo challenges that are easy for a person and expensive for a
                      farm. Think “hand doing something odd in front of a mushroom,” not a
                      passport scan. Fresh prompts, hard to script at scale, always voluntary.
                    </p>
                    <p class="settings-hint">
                      Those proofs (and other hard-for-bots goods — real yaps, neighbor care,
                      teaching newcomers) land as <strong>Verified human</strong> badges on your
                      profile’s <strong>Human</strong> tab. A shelf of good things a farm can’t
                      cheaply fake — not a blue check for sale.
                    </p>
                    <p class="settings-hint">
                      The point isn’t surveillance. It’s raising the cost of pretending to be
                      human when you’re a warehouse of scripts — so the timeline stays a place
                      for people.
                    </p>
                    <p class="settings-humans__soon" role="status">
                      Not built yet — the Human tab is the empty shelf, written so the intent
                      stays honest.
                    </p>
                  </div>
                </div>
              </section>
              </template>
            </div>
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
  // 100% = overlay content box (already inset by its safe-area padding)
  --settings-h: min(42rem, 100%);
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
    display: flex;
    align-items: center;
    gap: 0.25rem;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--neo-text-muted);
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

.settings-close,
.settings-back {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
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

.settings-nav-item__chevron {
  display: none;
  margin-left: auto;
  color: var(--neo-text-muted);
  transform: rotate(180deg);
  line-height: 0;
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
    width: 1.25rem;
    height: 1.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: inherit;
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
  align-items: stretch;
  justify-content: center;
  flex: 1;
  min-height: 100%;
  width: 100%;
  padding: 1.25rem;
  box-sizing: border-box;
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
  background: var(--neo-success-soft);
  border: 1px solid var(--neo-success);
  border-radius: 8px;
  color: var(--neo-success);
  font-size: 0.9375rem;
  font-weight: 500;
}

.settings-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: var(--neo-danger-soft);
  border: 1px solid var(--neo-danger);
  border-radius: 8px;
  color: var(--neo-danger);
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
    display: flex;
    align-items: center;
    gap: 0.5rem;
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

  &--tight {
    margin-top: 0.85rem;
  }
}

.settings-hint {
  margin: 0 0 0.875rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  line-height: 1.45;
  max-width: 52ch;
}

.settings-humans {
  max-width: 54ch;
}

.settings-humans__lede {
  margin: 0 0 1.15rem;
  font-size: 0.9375rem;
  line-height: 1.55;
  color: var(--neo-text-primary);

  strong {
    font-weight: 650;
  }
}

.settings-humans__list {
  margin: 0 0 1rem;
  padding: 0 0 0 1.15rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--neo-text-secondary);
  max-width: 52ch;

  li + li {
    margin-top: 0.35rem;
  }
}

.settings-humans__soon {
  margin: 0.75rem 0 0;
  padding: 0.65rem 0.85rem;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  line-height: 1.4;
  color: var(--neo-text-muted);
  border: 1px dashed var(--neo-border-color);
  border-radius: 6px;
  background: var(--neo-bg-tertiary);
}

.settings-install-steps {
  margin: 0 0 0.875rem;
  padding: 0 0 0 1.15rem;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
  max-width: 52ch;

  li + li {
    margin-top: 0.3rem;
  }

  strong {
    color: var(--neo-text-primary);
    font-weight: 650;
  }
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

// The real radio is invisible — show keyboard focus on its card instead
label:has(> .settings-radio-hidden:focus-visible) {
  outline: 2px solid var(--neo-focus, var(--neo-accent));
  outline-offset: 2px;
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

.settings-fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
  /* Contain children — floated <legend> hacks make Name/Bio wrap beside the heading */
  display: flex;
  flex-direction: column;
  gap: 0;

  > .settings-subheading {
    float: none;
    display: block;
    width: 100%;
    max-width: 100%;
    padding: 0;
    margin: 0 0 0.75rem;
  }
}

.settings-field-hint {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.settings-field-error {
  font-size: 0.75rem;
  color: var(--neo-danger);
}

.settings-input[aria-invalid='true'],
.settings-textarea[aria-invalid='true'] {
  border-color: var(--neo-danger);
}

.settings-inline-form,
.settings-filter-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;

  .settings-input {
    flex: 1 1 12rem;
    min-width: 0;
  }
}

.settings-filter-form {
  flex-direction: column;
  align-items: stretch;
}

.settings-actions--inline {
  flex-wrap: wrap;
  gap: 0.5rem;
}

.settings-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.settings-theme-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
  min-width: 0;

  &.active .settings-theme-swatch__chip,
  &.is-previewing .settings-theme-swatch__chip {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }

  &__chip {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1.35;
    border-radius: var(--neo-radius-sm, 4px);
    border: 1px solid var(--neo-border-color-dark);
    overflow: hidden;
  }

  &__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: currentColor;
    z-index: 1;
  }

  &__ring {
    position: absolute;
    inset: 4px;
    border-radius: calc(var(--neo-radius-sm, 4px) - 2px);
    border: 1px solid color-mix(in srgb, currentColor 55%, transparent);
    pointer-events: none;
  }

  &__preview {
    position: absolute;
    inset: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px;
    background: color-mix(in srgb, var(--neo-bg-secondary, #fff) 82%, transparent);
    border-radius: 3px;
    z-index: 2;
  }

  &__preview-bar {
    height: 4px;
    border-radius: 2px;
    background: currentColor;
    opacity: 0.85;
  }

  &__preview-line {
    height: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, currentColor 35%, transparent);

    &--short {
      width: 65%;
    }
  }

  &__label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-secondary);
    letter-spacing: 0.02em;
    text-align: center;
    line-height: 1.2;
  }

  &__desc {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    text-align: center;
    line-height: 1.25;
    max-width: 9rem;
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

.settings-radius-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.625rem;
}

.settings-radius-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.875rem 0.75rem;
  background: var(--neo-bg-primary);
  border: var(--neo-border-width, 1px) solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: var(--neo-border-color-dark);
  }

  &.active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  &__preview {
    display: block;
    width: 2.5rem;
    height: 2.5rem;
    background: var(--neo-accent);
    border: 2px solid var(--neo-text-primary);

    &[data-radius-preview='match'] {
      border-radius: var(--neo-radius-md, 4px);
      background: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-bg-tertiary));
    }

    &[data-radius-preview='sharp'] {
      border-radius: 0;
    }

    &[data-radius-preview='business'] {
      border-radius: 6px;
    }

    &[data-radius-preview='soft'] {
      border-radius: 14px;
    }

    &[data-radius-preview='bubble'] {
      border-radius: 999px;
    }

    &[data-radius-preview='jagged'] {
      border-radius: 2px 14px 4px 12px / 12px 4px 14px 2px;
      clip-path: polygon(
        0% 12%,
        8% 0%,
        28% 10%,
        48% 0%,
        72% 12%,
        100% 0%,
        100% 30%,
        90% 50%,
        100% 72%,
        88% 100%,
        60% 90%,
        32% 100%,
        0% 86%,
        10% 58%,
        0% 32%
      );
    }
  }

  &__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  &__desc {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    line-height: 1.3;
  }
}

.settings-density-grid,
.settings-line-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.625rem;
}

.settings-density-card,
.settings-line-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.875rem 0.75rem;
  background: var(--neo-bg-primary);
  border: var(--neo-border-width, 1px) solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: var(--neo-border-color-dark);
  }

  &.active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  &__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  &__desc {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    line-height: 1.3;
  }
}

.settings-density-card__preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 2.75rem;

  i {
    display: block;
    height: 5px;
    border-radius: 2px;
    background: var(--neo-accent);
  }

  &[data-density-preview='roomy'] {
    gap: 7px;
    i { height: 4px; }
  }

  &[data-density-preview='cozy'] {
    gap: 4px;
  }

  &[data-density-preview='dense'] {
    gap: 2px;
    i { height: 6px; }
  }
}

.settings-line-card__preview {
  display: block;
  width: 2.75rem;
  height: 1.75rem;
  background: color-mix(in srgb, var(--neo-accent) 18%, var(--neo-bg-tertiary));
  border: 1.5px solid var(--neo-text-primary);
  border-radius: 4px;

  &[data-line-preview='clean'] {
    border-width: 1px;
    border-style: solid;
  }

  &[data-line-preview='ink'] {
    border-width: 2.5px;
    border-style: solid;
    box-shadow: 1.5px 1.5px 0 color-mix(in srgb, var(--neo-text-primary) 25%, transparent);
  }

  &[data-line-preview='crayon'] {
    border-width: 2.5px;
    border-style: solid;
    border-color: color-mix(in srgb, var(--neo-text-primary) 80%, var(--neo-accent));
    box-shadow:
      1px 0.5px 0 color-mix(in srgb, var(--neo-text-primary) 40%, transparent),
      -0.8px 1px 0 color-mix(in srgb, var(--neo-accent) 35%, transparent);
  }

  &[data-line-preview='dashed'] {
    border-width: 1.5px;
    border-style: dashed;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    color: var(--neo-text-secondary);
    flex-shrink: 0;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--neo-accent);
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.settings-search-empty {
  margin: 0.75rem 0.5rem;
  padding: 0.5rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  line-height: 1.35;
}

.settings-linked-list {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.settings-linked-item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  background: var(--neo-bg-secondary);

  &__avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  &__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  &__name {
    font-weight: 600;
    color: var(--neo-text-primary);
    font-size: 0.875rem;
  }

  &__handle {
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__badge {
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--neo-accent);
    text-transform: uppercase;
    letter-spacing: 0.03em;
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
      background: color-mix(in srgb, var(--neo-danger) 85%, var(--neo-text-primary));
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

// Responsive - Tablet / phone drill-down
@media (max-width: 768px) {
  .settings-modal {
    --settings-h: 100%;
    width: min(100%, calc(100vw - 1rem));
    border-radius: var(--neo-radius-md, 8px);
  }

  .settings-header {
    padding: 0.65rem 0.85rem;
    gap: 0.5rem;
    flex-wrap: nowrap;

    &__left {
      flex: 1 1 auto;
      min-width: 0;
    }

    &__center {
      flex: 1 1 12rem;
      min-width: 0;
    }

    &__right {
      margin-left: 0;
    }
  }

  .settings-search {
    max-width: none;
  }

  .settings-title {
    font-size: 1rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-body {
    flex-direction: column;
  }

  /* List view: full-width labelled categories */
  .settings-modal--mobile-list {
    .settings-sidebar {
      // Shrink so overflow-y kicks in on short (landscape) screens
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      border-right: none;
      border-bottom: none;
      padding: 0.5rem 0.65rem 1rem;
    }

    .settings-content {
      display: none;
    }

    .settings-nav-item {
      justify-content: flex-start;
      padding: 0.85rem 0.75rem;
      margin-bottom: 0.35rem;
      font-size: 0.9375rem;

      &__chevron {
        display: inline-flex;
      }

      &__icon {
        width: 1.5rem;
        height: 1.5rem;
      }
    }
  }

  /* Panel view: full-width content + back chrome */
  .settings-modal--mobile-panel {
    .settings-sidebar {
      display: none;
    }

    .settings-content {
      display: block;
      width: 100%;
      padding: 1rem 1.125rem 1.5rem;
    }

    .settings-header__center {
      display: none;
    }
  }

  .settings-section__header {
    margin-bottom: 1rem;

    h2 { font-size: 1.25rem; }
    p { font-size: 0.875rem; }
  }

  .settings-option-grid,
  .settings-theme-grid,
  .settings-chrome-grid,
  .settings-font-grid,
  .settings-radius-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  }

  .settings-toggle {
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .settings-account-item {
    flex-wrap: wrap;
  }

  :deep(.neo-radio-group) {
    width: 100%;
    flex-wrap: wrap;
  }
}

// Responsive - Phone full-bleed
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
    padding:
      max(0.65rem, env(safe-area-inset-top, 0px))
      0.75rem
      0.65rem;
    gap: 0.4rem;
  }

  .settings-search__input {
    padding: 0.5rem 0.875rem 0.5rem 2.25rem;
    font-size: 0.875rem;
  }

  .settings-search__icon {
    left: 0.75rem;
  }

  .settings-modal--mobile-list .settings-sidebar {
    padding: 0.35rem 0.5rem calc(1rem + env(safe-area-inset-bottom, 0px));
  }

  .settings-modal--mobile-panel .settings-content {
    padding: 0.875rem 0.875rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
  }

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

  .settings-theme-grid,
  .settings-chrome-grid,
  .settings-font-grid,
  .settings-radius-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

