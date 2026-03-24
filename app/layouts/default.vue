<script setup lang="ts">
/**
 * Default Layout - Ultra-minimal Threads-inspired design
 * 
 * Clean, focused with minimal chrome
 */

import { useThemeStore } from '~/stores/theme'
import { useAuthStore } from '~/stores/auth'
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'

const themeStore = useThemeStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const router = useRouter()
const route = useRoute()

const mobileMenuOpen = ref(false)

// Apply theme from settings
const applyTheme = () => {
  if (typeof document === 'undefined') return
  
  const theme = settingsStore.localPreferences.theme
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

// Initialize auth and theme on mount
onMounted(async () => {
  await authStore.initialize()
  settingsStore.loadLocalPreferences()
  applyTheme()
  
  if (authStore.userCustomCSS) {
    themeStore.setUserCustomCSS(authStore.userCustomCSS)
  }
})

watch(() => settingsStore.localPreferences.theme, () => {
  applyTheme()
})

const handleLogout = async () => {
  await authStore.logout()
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
    <!-- Dynamic chaos styles injection -->
    <Teleport to="head" v-if="themeStore.isChaosMode && themeStore.userCustomCSS">
      <component :is="'style'" id="neospace-chaos-dynamic">
        {{ themeStore.userCustomCSS }}
      </component>
    </Teleport>

    <!-- Left Sidebar - Ultra minimal, icon-only -->
    <aside class="sidebar">
      <!-- Logo -->
      <NuxtLink to="/" class="sidebar__logo" title="NeoSpace">
        <span>🌌</span>
      </NuxtLink>

      <!-- Navigation -->
      <nav class="sidebar__nav">
        <NuxtLink to="/" class="sidebar__link" :class="{ active: route.path === '/' }" title="Home">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" :stroke="route.path === '/' ? 'currentColor' : 'currentColor'" :stroke-width="route.path === '/' ? 2.5 : 1.5">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" :fill="route.path === '/' ? 'currentColor' : 'none'" />
          </svg>
        </NuxtLink>
        <NuxtLink to="/explore" class="sidebar__link" :class="{ active: route.path === '/explore' }" title="Explore">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/explore' ? 2.5 : 1.5">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </NuxtLink>
        <NuxtLink to="/groups" class="sidebar__link" :class="{ active: route.path.startsWith('/groups') }" title="Groups">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" :stroke="route.path.startsWith('/groups') ? 'currentColor' : 'currentColor'" :stroke-width="route.path.startsWith('/groups') ? 2.5 : 1.5">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        </NuxtLink>
        <NuxtLink v-if="authStore.isAuthenticated || instancesStore.hasAuthenticatedInstance" to="/notifications" class="sidebar__link" :class="{ active: route.path === '/notifications' }" title="Notifications">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/notifications' ? 2.5 : 1.5">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" :fill="route.path === '/notifications' ? 'currentColor' : 'none'" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </NuxtLink>
      </nav>

      <!-- Spacer -->
      <div class="sidebar__spacer"></div>

      <!-- Bottom Actions -->
      <div class="sidebar__bottom">
        <button class="sidebar__link" @click="settingsStore.open()" title="Settings">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
        
        <!-- User Avatar / Login -->
        <NuxtLink v-if="authStore.isAuthenticated" to="/profile" class="sidebar__avatar-link" :class="{ active: route.path === '/profile' }" title="Profile">
          <img 
            v-if="authStore.userAvatar"
            :src="authStore.userAvatar" 
            :alt="authStore.userDisplayName"
            class="sidebar__avatar"
          />
          <div v-else class="sidebar__avatar sidebar__avatar--placeholder">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        </NuxtLink>
        <NuxtLink v-else to="/login" class="sidebar__link" :class="{ active: route.path === '/login' }" title="Log In">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
        </NuxtLink>
      </div>
    </aside>

    <!-- Mobile Header -->
    <header class="mobile-header">
      <button class="mobile-header__btn" @click="mobileMenuOpen = !mobileMenuOpen" aria-label="Menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <div class="mobile-header__logo">NeoSpace</div>
      <button class="mobile-header__btn" @click="settingsStore.open()" aria-label="Settings">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </button>
    </header>

    <!-- Mobile Menu Overlay -->
    <Transition name="fade">
      <div v-if="mobileMenuOpen" class="mobile-overlay" @click="closeMobileMenu"></div>
    </Transition>

    <!-- Mobile Sidebar -->
    <Transition name="slide">
      <aside v-if="mobileMenuOpen" class="mobile-sidebar">
        <div class="mobile-sidebar__header">
          <NuxtLink to="/" class="mobile-sidebar__logo" @click="closeMobileMenu">
            <span>🌌</span> NeoSpace
          </NuxtLink>
          <button class="mobile-sidebar__close" @click="closeMobileMenu">✕</button>
        </div>

        <nav class="mobile-sidebar__nav">
          <NuxtLink to="/" class="mobile-sidebar__link" @click="closeMobileMenu">
            <span>🏠</span> Home
          </NuxtLink>
          <NuxtLink to="/groups" class="mobile-sidebar__link" @click="closeMobileMenu">
            <span>👥</span> Groups
          </NuxtLink>
          <NuxtLink to="/explore" class="mobile-sidebar__link" @click="closeMobileMenu">
            <span>🔍</span> Explore
          </NuxtLink>
        </nav>

        <div class="mobile-sidebar__spacer"></div>

        <div class="mobile-sidebar__footer">
          <button class="mobile-sidebar__action" @click="settingsStore.open(); closeMobileMenu()">
            <span>⚙️</span> Settings
          </button>
          <button class="mobile-sidebar__action" @click="themeStore.toggleMode()">
            <span>{{ themeStore.isChaosMode ? '✨' : '🌀' }}</span>
            {{ themeStore.isChaosMode ? 'Calm Down' : 'Chaos Mode' }}
          </button>
          
          <template v-if="authStore.isAuthenticated">
            <div class="mobile-sidebar__divider"></div>
            <div class="mobile-sidebar__user">
              <img v-if="authStore.userAvatar" :src="authStore.userAvatar" class="mobile-sidebar__avatar" />
              <div class="mobile-sidebar__user-info">
                <span class="mobile-sidebar__user-name">{{ authStore.userDisplayName }}</span>
                <span class="mobile-sidebar__user-instance">{{ authStore.instanceUrl?.replace('https://', '') }}</span>
              </div>
            </div>
            <button class="mobile-sidebar__action mobile-sidebar__action--danger" @click="handleLogout">
              <span>🚪</span> Logout
            </button>
          </template>
          <template v-else>
            <div class="mobile-sidebar__divider"></div>
            <NuxtLink to="/login" class="mobile-sidebar__login" @click="closeMobileMenu">
              <span>🔑</span> Log In
            </NuxtLink>
          </template>
        </div>
      </aside>
    </Transition>

    <!-- Main Content -->
    <main class="main-content">
      <slot />
    </main>

    <!-- Mobile Bottom Navigation -->
    <nav class="mobile-nav">
      <NuxtLink to="/" class="mobile-nav__item" :class="{ active: route.path === '/' }">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/' ? 2.5 : 1.5">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" :fill="route.path === '/' ? 'currentColor' : 'none'" />
        </svg>
      </NuxtLink>
      <NuxtLink to="/explore" class="mobile-nav__item" :class="{ active: route.path === '/explore' }">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/explore' ? 2.5 : 1.5">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </NuxtLink>
      <NuxtLink to="/groups" class="mobile-nav__item" :class="{ active: route.path.startsWith('/groups') }">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path.startsWith('/groups') ? 2.5 : 1.5">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" :fill="route.path.startsWith('/groups') ? 'currentColor' : 'none'" />
        </svg>
      </NuxtLink>
      <NuxtLink v-if="authStore.isAuthenticated" to="/profile" class="mobile-nav__item mobile-nav__item--avatar" :class="{ active: route.path === '/profile' }">
        <img 
          v-if="authStore.userAvatar"
          :src="authStore.userAvatar" 
          :alt="authStore.userDisplayName"
          class="mobile-nav__avatar"
        />
        <div v-else class="mobile-nav__avatar mobile-nav__avatar--placeholder">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      </NuxtLink>
      <NuxtLink v-else to="/login" class="mobile-nav__item" :class="{ active: route.path === '/login' }">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </NuxtLink>
    </nav>

    <!-- Settings Modal -->
    <SettingsModal />
  </div>
</template>

<style lang="scss" scoped>
.neo-layout {
  display: flex;
  min-height: 100vh;
  background: var(--neo-bg-primary);
}

// ========================================
// SIDEBAR - Ultra minimal, icon-only
// ========================================
.sidebar {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 68px;
  display: none;
  flex-direction: column;
  align-items: center;
  padding: 1rem 0;
  background: var(--neo-bg-primary);
  border-right: 1px solid var(--neo-border-color);
  z-index: 100;

  @media (min-width: 1024px) {
    display: flex;
  }

  &__logo {
    font-size: 1.75rem;
    text-decoration: none;
    margin-bottom: 2rem;
    transition: transform 0.15s ease;
    
    &:hover {
      transform: scale(1.1);
    }
  }

  &__nav {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  &__link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    color: var(--neo-text-muted);
    text-decoration: none;
    border-radius: 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }

    &.active {
      color: var(--neo-text-primary);
    }
  }

  &__spacer {
    flex: 1;
  }

  &__bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  &__avatar-link {
    display: block;
    padding: 4px;
    border-radius: 50%;
    transition: all 0.15s ease;
    
    &:hover {
      background: var(--neo-bg-tertiary);
    }
    
    &.active {
      .sidebar__avatar {
        border-color: var(--neo-text-primary);
      }
    }
  }

  &__avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid transparent;
    transition: border-color 0.15s ease;

    &--placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-muted);
    }
  }
}

// ========================================
// MOBILE HEADER
// ========================================
.mobile-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.75rem;
  background: var(--neo-bg-primary);
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
    border-radius: 50%;
    transition: all 0.15s ease;

    &:hover {
      background: var(--neo-bg-tertiary);
    }

    &:active {
      transform: scale(0.92);
    }
  }

  &__logo {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    letter-spacing: -0.02em;
  }
}

// ========================================
// MOBILE BOTTOM NAV
// ========================================
.mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0 1rem;
  padding-bottom: env(safe-area-inset-bottom, 0);
  background: var(--neo-bg-primary);
  border-top: 1px solid var(--neo-border-color);
  z-index: 90;

  @media (min-width: 1024px) {
    display: none;
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    color: var(--neo-text-muted);
    text-decoration: none;
    border-radius: 12px;
    transition: all 0.15s ease;

    &:active {
      transform: scale(0.9);
    }

    &.active {
      color: var(--neo-text-primary);
    }

    &--avatar {
      padding: 4px;
    }
  }

  &__avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid transparent;
    transition: border-color 0.15s ease;

    .mobile-nav__item.active & {
      border-color: var(--neo-text-primary);
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

// ========================================
// MOBILE OVERLAY & SIDEBAR
// ========================================
.mobile-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
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
  max-width: calc(100vw - 60px);
  display: flex;
  flex-direction: column;
  background: var(--neo-bg-secondary);
  z-index: 100;
  overflow-y: auto;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15);

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
    gap: 0.5rem;
    text-decoration: none;
    color: var(--neo-text-primary);
    font-weight: 700;
    font-size: 1.125rem;
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
    font-size: 1.25rem;
    cursor: pointer;
    border-radius: 8px;

    &:hover {
      background: var(--neo-bg-tertiary);
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
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    color: var(--neo-text-secondary);
    text-decoration: none;
    border-radius: 8px;
    font-size: 1rem;
    transition: all 0.15s ease;

    span:first-child {
      font-size: 1.25rem;
    }

    &:hover {
      background: var(--neo-bg-tertiary);
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
    background: var(--neo-bg-tertiary);
  }

  &__action {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    color: var(--neo-text-secondary);
    font-size: 0.9375rem;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;

    span:first-child {
      font-size: 1.125rem;
    }

    &:hover {
      background: var(--neo-bg-secondary);
      color: var(--neo-text-primary);
    }

    &--danger:hover {
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
    }
  }

  &__user {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    margin-bottom: 0.5rem;
  }

  &__avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
  }

  &__user-info {
    flex: 1;
    min-width: 0;
  }

  &__user-name {
    display: block;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  &__user-instance {
    display: block;
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }

  &__login {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.875rem;
    background: var(--neo-accent);
    color: white;
    text-decoration: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;

    &:hover {
      filter: brightness(1.1);
    }
  }

  &__divider {
    height: 1px;
    background: var(--neo-border-color);
    margin: 0.75rem 0;
  }
}

// ========================================
// MAIN CONTENT
// ========================================
.main-content {
  flex: 1;
  min-height: 100vh;
  padding: 56px 0.5rem calc(56px + env(safe-area-inset-bottom, 0));

  @media (min-width: 600px) {
    padding: 56px 1rem calc(56px + env(safe-area-inset-bottom, 0));
  }

  @media (min-width: 1024px) {
    padding: 1.5rem 2rem;
    margin-left: 68px;
  }
}

// ========================================
// TRANSITIONS
// ========================================
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(-100%);
}

// ========================================
// CHAOS MODE
// ========================================
.chaos-active {
  .sidebar {
    border-right-color: var(--neo-accent);
  }

  .mobile-header {
    border-bottom-color: var(--neo-accent);
  }
}
</style>
