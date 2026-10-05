<script setup lang="ts">
/**
 * Default Layout — Braun / ibm.io instrument chrome
 */

import { useThemeStore } from '~/stores/theme'
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useAccountsManager } from '~/composables/useAccountsManager'

const themeStore = useThemeStore()
const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const { open: openAccounts } = useAccountsManager()
const router = useRouter()
const route = useRoute()

const mobileMenuOpen = ref(false)

const applyTheme = () => {
  settingsStore.applyLocalAppearance()
}

const cycleTheme = () => {
  settingsStore.cycleTheme()
}

const cycleUi = () => {
  settingsStore.cycleUi()
}

const currentThemeLabel = computed(() => settingsStore.localPreferences.theme)
const currentUiLabel = computed(() => settingsStore.localPreferences.ui)

onMounted(async () => {
  await instancesStore.initialize()
  settingsStore.loadLocalPreferences()
  applyTheme()

  if (instancesStore.userCustomCSS) {
    themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
  }

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onScheme = () => {
    if (settingsStore.localPreferences.theme === 'auto') applyTheme()
  }
  mq.addEventListener?.('change', onScheme)
  onUnmounted(() => mq.removeEventListener?.('change', onScheme))
})

watch(
  () => [
    settingsStore.localPreferences.theme,
    settingsStore.localPreferences.ui,
    settingsStore.localPreferences.font,
    settingsStore.localPreferences.fontSize,
  ],
  () => applyTheme(),
)

const handleLogout = async () => {
  await instancesStore.logout()
  themeStore.setUserCustomCSS('')
  themeStore.disableChaosMode()
  router.push('/login')
}

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}
</script>

<template>
  <div class="neo-layout" :class="{ 'chaos-active': themeStore.isChaosMode }">
    <Teleport to="head" v-if="themeStore.isChaosMode && themeStore.userCustomCSS">
      <component :is="'style'" id="neospace-chaos-dynamic">
        {{ themeStore.userCustomCSS }}
      </component>
    </Teleport>

    <aside class="sidebar">
      <NuxtLink to="/" class="sidebar__logo" title="NeoSpace" aria-label="NeoSpace home">
        <span class="sidebar__mark">NS</span>
      </NuxtLink>

      <nav class="sidebar__nav" aria-label="Primary">
        <NuxtLink to="/" class="sidebar__link" :class="{ active: route.path === '/' }" title="Home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/' ? 2 : 1.5">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" :fill="route.path === '/' ? 'currentColor' : 'none'" />
          </svg>
        </NuxtLink>
        <NuxtLink to="/explore" class="sidebar__link" :class="{ active: route.path === '/explore' }" title="Explore">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/explore' ? 2 : 1.5">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </NuxtLink>
        <NuxtLink to="/groups" class="sidebar__link" :class="{ active: route.path.startsWith('/groups') }" title="Groups">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path.startsWith('/groups') ? 2 : 1.5">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        </NuxtLink>
        <NuxtLink
          v-if="instancesStore.hasAuthenticatedInstance"
          to="/notifications"
          class="sidebar__link"
          :class="{ active: route.path === '/notifications' }"
          title="Notifications"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/notifications' ? 2 : 1.5">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </NuxtLink>
      </nav>

      <div class="sidebar__spacer"></div>

      <div class="sidebar__bottom">
        <button
          class="sidebar__link sidebar__theme"
          type="button"
          :title="`Theme: ${currentThemeLabel} (click to cycle)`"
          :aria-label="`Theme ${currentThemeLabel}. Click to cycle.`"
          @click="cycleTheme"
        >
          <span class="sidebar__theme-swatch" aria-hidden="true"></span>
        </button>
        <button
          class="sidebar__link sidebar__chrome"
          type="button"
          :title="`Chrome: ${currentUiLabel} (click to cycle)`"
          :aria-label="`Chrome ${currentUiLabel}. Click to cycle.`"
          @click="cycleUi"
        >
          <span class="sidebar__chrome-mark" aria-hidden="true">Aa</span>
        </button>
        <button class="sidebar__link" @click="settingsStore.open()" title="Settings" type="button">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>

        <button
          class="sidebar__link"
          type="button"
          title="Accounts & servers"
          aria-label="Accounts and servers"
          @click="openAccounts"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
        </button>

        <AccountSwitcher v-if="instancesStore.isAuthenticated" />
        <NuxtLink v-else to="/login" class="sidebar__link" :class="{ active: route.path === '/login' }" title="Sign in">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
        </NuxtLink>
      </div>
    </aside>

    <header class="mobile-header">
      <button class="mobile-header__btn" @click="mobileMenuOpen = !mobileMenuOpen" aria-label="Menu" type="button">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <div class="mobile-header__logo">NeoSpace</div>
      <button class="mobile-header__btn" @click="cycleTheme" :aria-label="`Theme ${currentThemeLabel}`" type="button" :title="`Theme: ${currentThemeLabel}`">
        <span class="mobile-header__theme-swatch" aria-hidden="true"></span>
      </button>
    </header>

    <Transition name="fade">
      <div v-if="mobileMenuOpen" class="mobile-overlay" @click="closeMobileMenu"></div>
    </Transition>

    <Transition name="slide">
      <aside v-if="mobileMenuOpen" class="mobile-sidebar">
        <div class="mobile-sidebar__header">
          <NuxtLink to="/" class="mobile-sidebar__logo" @click="closeMobileMenu">
            <span class="mobile-sidebar__mark">NS</span>
            NeoSpace
          </NuxtLink>
          <button class="mobile-sidebar__close" @click="closeMobileMenu" type="button" aria-label="Close menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav class="mobile-sidebar__nav">
          <NuxtLink to="/" class="mobile-sidebar__link" @click="closeMobileMenu">Home</NuxtLink>
          <NuxtLink to="/groups" class="mobile-sidebar__link" @click="closeMobileMenu">Groups</NuxtLink>
          <NuxtLink to="/explore" class="mobile-sidebar__link" @click="closeMobileMenu">Explore</NuxtLink>
          <NuxtLink
            v-if="instancesStore.hasAuthenticatedInstance"
            to="/notifications"
            class="mobile-sidebar__link"
            @click="closeMobileMenu"
          >
            Notifications
          </NuxtLink>
        </nav>

        <div class="mobile-sidebar__spacer"></div>

        <div class="mobile-sidebar__footer">
          <button class="mobile-sidebar__action" @click="settingsStore.open(); closeMobileMenu()" type="button">
            Settings
          </button>
          <button
            class="mobile-sidebar__action"
            type="button"
            @click="openAccounts(); closeMobileMenu()"
          >
            Accounts &amp; servers
          </button>

          <template v-if="instancesStore.isAuthenticated">
            <div class="mobile-sidebar__divider"></div>
            <div class="mobile-sidebar__user">
              <img v-if="instancesStore.userAvatar" :src="instancesStore.userAvatar" class="mobile-sidebar__avatar" alt="" />
              <div class="mobile-sidebar__user-info">
                <span class="mobile-sidebar__user-name">{{ instancesStore.userDisplayName }}</span>
                <span class="mobile-sidebar__user-instance">
                  Posting as · {{ instancesStore.instanceUrl?.replace('https://', '') }}
                </span>
              </div>
            </div>
            <button class="mobile-sidebar__action mobile-sidebar__action--danger" @click="handleLogout" type="button">
              Sign out
            </button>
          </template>
          <template v-else>
            <div class="mobile-sidebar__divider"></div>
            <NuxtLink to="/login" class="mobile-sidebar__login" @click="closeMobileMenu">
              Sign in
            </NuxtLink>
          </template>
        </div>
      </aside>
    </Transition>

    <main class="main-content">
      <slot />
    </main>

    <nav class="mobile-nav" aria-label="Mobile">
      <NuxtLink to="/" class="mobile-nav__item" :class="{ active: route.path === '/' }">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/' ? 2 : 1.5">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" :fill="route.path === '/' ? 'currentColor' : 'none'" />
        </svg>
      </NuxtLink>
      <NuxtLink to="/explore" class="mobile-nav__item" :class="{ active: route.path === '/explore' }">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/explore' ? 2 : 1.5">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </NuxtLink>
      <NuxtLink to="/groups" class="mobile-nav__item" :class="{ active: route.path.startsWith('/groups') }">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path.startsWith('/groups') ? 2 : 1.5">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
      </NuxtLink>
      <div v-if="instancesStore.isAuthenticated" class="mobile-nav__item mobile-nav__item--avatar">
        <AccountSwitcher compact />
      </div>
      <NuxtLink v-else to="/login" class="mobile-nav__item" :class="{ active: route.path === '/login' }">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </NuxtLink>
    </nav>

    <InstanceManager />
    <FeedbackNotes />
    <SettingsModal />
  </div>
</template>

<style lang="scss" scoped>
.neo-layout {
  display: flex;
  min-height: 100vh;
  background: var(--neo-bg-primary);
}

.sidebar {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 64px;
  display: none;
  flex-direction: column;
  align-items: center;
  padding: 1.25rem 0 1rem;
  background: var(--neo-bg-secondary);
  border-right: 1px solid var(--neo-border-color);
  z-index: 100;

  @media (min-width: 1024px) {
    display: flex;
  }

  &__logo {
    text-decoration: none;
    margin-bottom: 2rem;
    transition: opacity var(--neo-transition-fast);

    &:hover {
      opacity: 0.7;
    }
  }

  &__mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--neo-text-inverse);
    background: var(--neo-accent);
    border-radius: 2px;
  }

  &__nav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  &__link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    color: var(--neo-text-muted);
    text-decoration: none;
    border-radius: 4px;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background-color var(--neo-transition-fast), color var(--neo-transition-fast);

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }

    &.active {
      color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }
  }

  &__spacer {
    flex: 1;
  }

  &__bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  &__theme-swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 30%, var(--neo-accent) 0 35%, transparent 36%),
      linear-gradient(135deg, var(--neo-bg-card) 45%, var(--neo-text-primary) 46%);
    border: 1.5px solid var(--neo-border-color-dark);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--neo-accent) 35%, transparent);
  }

  &__chrome-mark {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--neo-text-primary);
    font-family: var(--neo-font-family-ui, var(--neo-font-family));
  }

  &__avatar-link {
    display: block;
    padding: 4px;
    border-radius: 50%;
    transition: background-color var(--neo-transition-fast);

    &:hover {
      background: var(--neo-bg-hover);
    }

    &.active .sidebar__avatar {
      border-color: var(--neo-accent);
    }
  }

  &__avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 1.5px solid transparent;
    transition: border-color var(--neo-transition-fast);

    &--placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-muted);
    }
  }
}

.mobile-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.5rem;
  background: color-mix(in srgb, var(--neo-bg-primary) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--neo-border-color);
  z-index: 90;

  @media (min-width: 1024px) {
    display: none;
  }

  &__btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--neo-text-primary);
    cursor: pointer;
    border-radius: 4px;
    transition: background-color var(--neo-transition-fast);

    &:hover {
      background: var(--neo-bg-hover);
    }
  }

  &__logo {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    letter-spacing: -0.02em;
  }

  &__theme-swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 30%, var(--neo-accent) 0 35%, transparent 36%),
      linear-gradient(135deg, var(--neo-bg-card) 45%, var(--neo-text-primary) 46%);
    border: 1.5px solid var(--neo-border-color-dark);
  }
}

.mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0 0.75rem;
  padding-bottom: env(safe-area-inset-bottom, 0);
  background: color-mix(in srgb, var(--neo-bg-primary) 92%, transparent);
  backdrop-filter: blur(8px);
  border-top: 1px solid var(--neo-border-color);
  z-index: 90;

  @media (min-width: 1024px) {
    display: none;
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    color: var(--neo-text-muted);
    text-decoration: none;
    border-radius: 4px;
    transition: color var(--neo-transition-fast), background-color var(--neo-transition-fast);

    &.active {
      color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }

    &--avatar {
      padding: 4px;
    }
  }

  &__avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    object-fit: cover;
    border: 1.5px solid transparent;

    .mobile-nav__item.active & {
      border-color: var(--neo-accent);
    }

    &--placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-muted);
    }
  }
}

.mobile-overlay {
  position: fixed;
  inset: 0;
  background: var(--neo-bg-overlay);
  z-index: 95;

  @media (min-width: 1024px) {
    display: none;
  }
}

.mobile-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 280px;
  max-width: calc(100vw - 56px);
  display: flex;
  flex-direction: column;
  background: var(--neo-bg-secondary);
  border-right: 1px solid var(--neo-border-color);
  z-index: 100;
  overflow-y: auto;

  @media (min-width: 1024px) {
    display: none;
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid var(--neo-border-color);
  }

  &__logo {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    text-decoration: none;
    color: var(--neo-text-primary);
    font-weight: 700;
    font-size: 1rem;
    letter-spacing: -0.02em;
  }

  &__mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--neo-text-inverse);
    background: var(--neo-accent);
    border-radius: 2px;
  }

  &__close {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--neo-text-muted);
    cursor: pointer;
    border-radius: 4px;

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }
  }

  &__nav {
    display: flex;
    flex-direction: column;
    padding: 0.5rem;
  }

  &__link {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    color: var(--neo-text-secondary);
    text-decoration: none;
    border-radius: 4px;
    font-size: 0.9375rem;
    font-weight: 500;
    transition: background-color var(--neo-transition-fast), color var(--neo-transition-fast);

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }

    &.router-link-active {
      background: var(--neo-accent-soft);
      color: var(--neo-accent);
    }
  }

  &__spacer {
    flex: 1;
  }

  &__footer {
    padding: 0.75rem;
    border-top: 1px solid var(--neo-border-color);
  }

  &__action {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    color: var(--neo-text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color var(--neo-transition-fast), color var(--neo-transition-fast);

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }

    &--danger:hover {
      background: var(--neo-danger-soft);
      color: var(--neo-danger);
    }
  }

  &__user {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    margin-bottom: 0.25rem;
  }

  &__avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
  }

  &__user-info {
    flex: 1;
    min-width: 0;
  }

  &__user-name {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  &__user-instance {
    display: block;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }

  &__login {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 0.75rem;
    background: var(--neo-accent);
    color: var(--neo-text-inverse);
    text-decoration: none;
    border-radius: 2px;
    font-size: 0.875rem;
    font-weight: 600;
    letter-spacing: 0.01em;

    &:hover {
      background: var(--neo-accent-hover);
    }
  }

  &__divider {
    height: 1px;
    background: var(--neo-border-color);
    margin: 0.5rem 0;
  }
}

.main-content {
  flex: 1;
  min-height: 100vh;
  padding: 52px 0.5rem calc(52px + env(safe-area-inset-bottom, 0));

  @media (min-width: 600px) {
    padding: 52px 1rem calc(52px + env(safe-area-inset-bottom, 0));
  }

  @media (min-width: 1024px) {
    padding: 1.5rem 2rem;
    margin-left: 64px;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(-100%);
}

.chaos-active {
  .sidebar {
    border-right-color: var(--neo-accent);
  }

  .mobile-header {
    border-bottom-color: var(--neo-accent);
  }
}
</style>
