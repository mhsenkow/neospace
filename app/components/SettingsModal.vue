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

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const overlayStore = useOverlayStore()
const contentEl = ref<HTMLElement | null>(null)
const modalRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => settingsStore.isOpen)

const postingPanelDirty = ref(false)
const profilePanelDirty = ref(false)
const privacyPanelDirty = ref(false)

const isDirty = computed(
  () => profilePanelDirty.value || privacyPanelDirty.value || postingPanelDirty.value,
)

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
// open('humans') etc. should land on that panel on phones, not the category list
const mobilePanelOpen = ref(settingsStore.openedToCategory)

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
  if (open) mobilePanelOpen.value = settingsStore.openedToCategory
})

watch(isNarrowSettings, (narrow) => {
  if (!narrow) mobilePanelOpen.value = false
})

useFocusTrap(modalRef, isOpen, {
  onEscape: () => onSettingsEscape(),
  initialFocus: '.settings-search__input, .settings-close',
})

watch(
  () => settingsStore.activeCategory,
  () => {
    if (contentEl.value) contentEl.value.scrollTop = 0
  },
)

watch(
  () => instancesStore.activeAccountId,
  async () => {
    if (!isOpen.value) return
    await settingsStore.loadSettings()
  },
)

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

              <!-- Persistent live region: a role=status node inserted with its text
                   is often not announced, and the banner may be scrolled out of view -->
              <p class="sr-only" role="status">
                {{ settingsStore.saveSuccess ? 'Settings saved' : '' }}
              </p>

              <!-- Success message -->
              <Transition name="fade">
                <div v-if="settingsStore.saveSuccess" class="settings-success">
                  <span aria-hidden="true">✓</span> Settings saved successfully
                </div>
              </Transition>

              <!-- Error message — never hide the panel behind it (guest auth and
                   a failed mute list used to blank Appearance / Profile). -->
              <div v-if="settingsStore.error" class="settings-error" role="alert">
                <span aria-hidden="true">⚠️</span> {{ settingsStore.error }}
                <button
                  v-if="instancesStore.isAuthenticated && !settingsStore.account && !settingsStore.isLoading"
                  type="button"
                  class="settings-btn settings-btn--small settings-btn--ghost settings-error__retry"
                  @click="settingsStore.loadSettings()"
                >
                  Retry
                </button>
              </div>

              <SettingsWhatsNew v-if="settingsStore.activeCategory === 'whats-new'" />

              <SettingsProfilePanel
                v-if="settingsStore.activeCategory === 'profile'"
                v-model:dirty="profilePanelDirty"
              />

              <SettingsPrivacyPanel
                v-if="settingsStore.activeCategory === 'privacy'"
                v-model:dirty="privacyPanelDirty"
              />

              <SettingsNotificationsPanel v-if="settingsStore.activeCategory === 'notifications'" />

              <SettingsAppearancePanel
                v-if="settingsStore.activeCategory === 'appearance'"
                :open="isOpen"
                :mobile-panel-open="mobilePanelOpen"
              />

              <SettingsPostingPanel
                v-if="settingsStore.activeCategory === 'posting'"
                v-model:dirty="postingPanelDirty"
              />

              <SettingsFiltersPanel v-if="settingsStore.activeCategory === 'filters'" />

              <SettingsAccountPanel v-if="settingsStore.activeCategory === 'account'" />

              <SettingsHumansPanel v-if="settingsStore.activeCategory === 'humans'" />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
@use '~/assets/css/settingsPanel' as panel;

// Shared panel primitives (section, group, hint, toggle, fieldset, buttons…)
@include panel.shared;
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

  @include hover {
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

  @include hover {
    background: var(--neo-bg-hover);
    color: var(--neo-text-primary);
  }

  &.active {
    background: color-mix(in srgb, var(--neo-accent) 14%, var(--neo-bg-primary));
    border-color: transparent;
    color: var(--neo-text-primary);
    box-shadow: inset 2px 0 0 var(--neo-accent);

    @include hover {
      background: color-mix(in srgb, var(--neo-accent) 20%, var(--neo-bg-primary));
    }
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
  // Body text uses the full ink colour — success green on its own soft tint fails
  // AA in most themes. Status stays visible via the border + the check glyph.
  color: var(--neo-text-primary);
  font-size: 0.9375rem;
  font-weight: 500;

  > span[aria-hidden='true'] {
    color: var(--neo-success);
    font-weight: 700;
  }
}

.settings-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: var(--neo-danger-soft);
  border: 1px solid var(--neo-danger);
  border-radius: 8px;
  // Full ink colour: danger text on its own soft tint misses 4.5:1 in several themes
  color: var(--neo-text-primary);
  font-size: 0.9375rem;
  overflow-wrap: anywhere;

  > span[aria-hidden='true'] {
    color: var(--neo-danger);
  }

  &__retry {
    margin-left: auto;
    flex-shrink: 0;
  }
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

.settings-textarea {
  @extend .settings-input;
  resize: vertical;
  min-height: 100px;
  font-family: inherit;
}

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
    align-self: flex-start;

    &--main {
      color: var(--neo-text-secondary);
    }

    &--expired {
      color: var(--neo-warning);
    }
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.55rem;
    margin-top: 0.35rem;
  }

  &__action {
    border: none;
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 650;
    color: var(--neo-accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;

    &:hover:not(:disabled) {
      color: var(--neo-accent-hover, var(--neo-accent));
    }

    &:disabled {
      opacity: 0.65;
      cursor: progress;
    }
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
  min-width: 0;
  overflow-wrap: anywhere;
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

// Transitions — directional asymmetry + overlapping body settle (Principles 5, 6, 9)
.modal-enter-active {
  transition: opacity var(--neo-dur-sheet-enter, 300ms) var(--neo-ease-out);

  .settings-modal {
    transition: transform var(--neo-dur-sheet-enter, 300ms) var(--neo-ease-spring, var(--neo-ease-out));
  }

  .settings-header {
    animation: settings-layer-in var(--neo-dur-normal, 240ms) var(--neo-ease-out)
      calc(var(--neo-delay-secondary, 50ms) * 0.4) both;
  }

  .settings-body {
    animation: settings-layer-in var(--neo-dur-normal, 240ms) var(--neo-ease-out)
      var(--neo-delay-secondary, 50ms) both;
  }
}

.modal-leave-active {
  transition: opacity var(--neo-dur-sheet-leave, 190ms) var(--neo-ease-in);

  .settings-modal {
    transition: transform var(--neo-dur-sheet-leave, 190ms) var(--neo-ease-in);
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .settings-modal {
    transform: scale(0.95) translateY(18px);
  }
}

@keyframes settings-layer-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-enter-active {
  transition: opacity var(--neo-dur-normal, 240ms) var(--neo-ease-out);
}

.fade-leave-active {
  transition: opacity var(--neo-dur-quick, 160ms) var(--neo-ease-in);
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

  .settings-option-grid,
  .settings-radius-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
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

  .settings-segmented__btn {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
  }

  .settings-radius-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* Phone landscape: compact floating settings card */
@media (max-height: 500px) and (orientation: landscape) and (max-width: 1023px) {
  .settings-overlay {
    padding: 0.4rem;
    align-items: center;
  }

  .settings-modal {
    --settings-h: min(94dvh, 100%);
    width: min(680px, 94vw);
    border-radius: 12px;
  }

  .settings-header {
    padding: 0.4rem 0.65rem;
    gap: 0.35rem;
  }
}

/* Tablet touch: floating centered card */
@media (min-width: 768px) and (max-width: 1366px) and (pointer: coarse) {
  .settings-overlay {
    padding: 1.25rem;
    align-items: center;
  }

  .settings-modal {
    --settings-h: min(88dvh, 42rem);
    width: min(640px, 94vw);
    border-radius: 16px;
  }
}
</style>

