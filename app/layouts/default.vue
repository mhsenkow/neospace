<script setup lang="ts">
/**
 * Default Layout - Threads-inspired Mobile + Minimal Sidebar Desktop
 * 
 * Clean, focused design with:
 * - Threads-style bottom navigation on mobile
 * - Minimal sidebar on desktop
 */

import { useThemeStore } from '~/stores/theme'
import { useAuthStore } from '~/stores/auth'
import { useSettingsStore } from '~/stores/settings'

const themeStore = useThemeStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const router = useRouter()
const route = useRoute()

const sidebarCollapsed = ref(true) // Default collapsed for minimal look
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
  
  // Load user's custom CSS if available
  if (authStore.userCustomCSS) {
    themeStore.setUserCustomCSS(authStore.userCustomCSS)
  }
})

// Watch for theme changes
watch(() => settingsStore.localPreferences.theme, () => {
  applyTheme()
})

const handleLogout = async () => {
  await authStore.logout()
  themeStore.setUserCustomCSS('')
  themeStore.disableChaosMode()
  router.push('/login')
}

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
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

    <!-- Left Sidebar -->
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <!-- Toggle Button -->
      <button class="sidebar__toggle" @click="toggleSidebar" :title="sidebarCollapsed ? 'Expand' : 'Collapse'">
        <span v-if="sidebarCollapsed">›</span>
        <span v-else>‹</span>
      </button>

      <!-- Logo -->
      <div class="sidebar__header">
        <NuxtLink to="/" class="sidebar__logo">
          <span class="sidebar__logo-icon">🌌</span>
          <span v-if="!sidebarCollapsed" class="sidebar__logo-text">NeoSpace</span>
        </NuxtLink>
      </div>

      <!-- Navigation -->
      <nav class="sidebar__nav">
        <NuxtLink to="/" class="sidebar__link" :title="sidebarCollapsed ? 'Home' : undefined">
          <span class="sidebar__link-icon">🏠</span>
          <span v-if="!sidebarCollapsed" class="sidebar__link-text">Home</span>
        </NuxtLink>
        <NuxtLink to="/groups" class="sidebar__link" :title="sidebarCollapsed ? 'Groups' : undefined">
          <span class="sidebar__link-icon">👥</span>
          <span v-if="!sidebarCollapsed" class="sidebar__link-text">Groups</span>
        </NuxtLink>
        <NuxtLink to="/explore" class="sidebar__link" :title="sidebarCollapsed ? 'Explore' : undefined">
          <span class="sidebar__link-icon">🔍</span>
          <span v-if="!sidebarCollapsed" class="sidebar__link-text">Explore</span>
        </NuxtLink>
        <NuxtLink v-if="authStore.isAuthenticated" to="/notifications" class="sidebar__link" :title="sidebarCollapsed ? 'Notifications' : undefined">
          <span class="sidebar__link-icon">🔔</span>
          <span v-if="!sidebarCollapsed" class="sidebar__link-text">Notifications</span>
        </NuxtLink>
      </nav>

      <!-- Spacer -->
      <div class="sidebar__spacer"></div>

      <!-- Bottom Actions -->
      <div class="sidebar__actions">
        <!-- Settings - Always visible -->
        <button 
          class="sidebar__action-btn" 
          @click="settingsStore.open()" 
          title="Settings"
        >
          <span class="sidebar__link-icon">⚙️</span>
          <span v-if="!sidebarCollapsed" class="sidebar__link-text">Settings</span>
        </button>
        
        <!-- Theme Toggle -->
        <button 
          class="sidebar__action-btn" 
          @click="themeStore.toggleMode()" 
          :title="themeStore.isChaosMode ? 'Disable Chaos' : 'Chaos Mode'"
        >
          <span class="sidebar__link-icon">{{ themeStore.isChaosMode ? '✨' : '🌀' }}</span>
          <span v-if="!sidebarCollapsed" class="sidebar__link-text">
            {{ themeStore.isChaosMode ? 'Calm Down' : 'Chaos Mode' }}
          </span>
        </button>
      </div>

      <!-- User Section -->
      <div class="sidebar__user">
        <template v-if="authStore.isAuthenticated">
          <div class="sidebar__user-info">
            <img 
              v-if="authStore.userAvatar"
              :src="authStore.userAvatar" 
              :alt="authStore.userDisplayName"
              class="sidebar__avatar"
            />
            <div v-else class="sidebar__avatar sidebar__avatar--placeholder">
              {{ authStore.userDisplayName?.charAt(0) || '?' }}
            </div>
            <div v-if="!sidebarCollapsed" class="sidebar__user-details">
              <span class="sidebar__user-name">{{ authStore.userDisplayName }}</span>
              <span class="sidebar__user-handle">{{ authStore.instanceUrl?.replace('https://', '') }}</span>
            </div>
          </div>
          <div v-if="!sidebarCollapsed" class="sidebar__user-actions">
            <button class="sidebar__user-btn" @click="handleLogout" title="Logout">
              🚪
            </button>
          </div>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="sidebar__login-btn">
            <span class="sidebar__link-icon">🔑</span>
            <span v-if="!sidebarCollapsed" class="sidebar__link-text">Log In</span>
          </NuxtLink>
        </template>
      </div>
    </aside>

    <!-- Mobile Header - Threads style (minimal) -->
    <header class="mobile-header">
      <button class="mobile-header__menu-btn" @click="mobileMenuOpen = !mobileMenuOpen" aria-label="Menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <div class="mobile-header__logo">NeoSpace</div>
      <button class="mobile-header__action-btn" @click="settingsStore.open()" aria-label="Settings">
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
            <span>🌌</span>
            <span>NeoSpace</span>
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
          <NuxtLink v-if="authStore.isAuthenticated" to="/notifications" class="mobile-sidebar__link" @click="closeMobileMenu">
            <span>🔔</span> Notifications
          </NuxtLink>
        </nav>

        <div class="mobile-sidebar__spacer"></div>

        <div class="mobile-sidebar__footer">
          <!-- Always visible actions -->
          <button class="mobile-sidebar__action" @click="settingsStore.open(); closeMobileMenu()">
            <span>⚙️</span> Settings
          </button>
          <button class="mobile-sidebar__action" @click="themeStore.toggleMode()">
            <span>{{ themeStore.isChaosMode ? '✨' : '🌀' }}</span>
            {{ themeStore.isChaosMode ? 'Calm Down' : 'Chaos Mode' }}
          </button>
          
          <!-- User section -->
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

    <!-- Main Content Area -->
    <main class="main-content">
      <div class="main-content__inner">
        <slot />
      </div>
    </main>

    <!-- Mobile Bottom Navigation - Threads Style -->
    <nav class="mobile-nav">
      <NuxtLink to="/" class="mobile-nav__item" :class="{ active: route.path === '/' }">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" :stroke="route.path === '/' ? 'currentColor' : 'currentColor'" :stroke-width="route.path === '/' ? 2.5 : 1.5">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" :fill="route.path === '/' ? 'currentColor' : 'none'" />
        </svg>
      </NuxtLink>
      <NuxtLink to="/explore" class="mobile-nav__item" :class="{ active: route.path === '/explore' }">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="route.path === '/explore' ? 2.5 : 1.5">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </NuxtLink>
      <button class="mobile-nav__compose" @click="router.push('/')" aria-label="Compose">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <NuxtLink to="/groups" class="mobile-nav__item" :class="{ active: route.path.startsWith('/groups') }">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" :stroke="route.path.startsWith('/groups') ? 'currentColor' : 'currentColor'" :stroke-width="route.path.startsWith('/groups') ? 2.5 : 1.5">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" :fill="route.path.startsWith('/groups') ? 'currentColor' : 'none'" />
        </svg>
      </NuxtLink>
      <NuxtLink v-if="authStore.isAuthenticated" to="/profile" class="mobile-nav__item mobile-nav__item--avatar" :class="{ active: route.path === '/profile' }">
        <img 
          v-if="authStore.userAvatar"
          :src="authStore.userAvatar" 
          :alt="authStore.userDisplayName || 'Profile'"
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
// SIDEBAR (Desktop) - Slim & Minimal
// ========================================
.sidebar {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 200px;
  display: none;
  flex-direction: column;
  background: var(--neo-bg-secondary);
  border-right: 1px solid var(--neo-border-color);
  padding: 0.5rem;
  z-index: 100;
  transition: width 0.2s ease;
  overflow-y: auto;
  overflow-x: hidden;

  @media (min-width: 1024px) {
    display: flex;
  }

  &.collapsed {
    width: 52px;
  }

  &__toggle {
    position: absolute;
    right: -12px;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--neo-bg-secondary);
    border: 1px solid var(--neo-border-color);
    border-radius: 50%;
    color: var(--neo-text-muted);
    font-size: 0.875rem;
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s ease;
    z-index: 10;

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }
  }

  &:hover &__toggle {
    opacity: 1;
  }

  &__header {
    padding: 0.375rem;
    margin-bottom: 0.5rem;
  }

  &__logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--neo-text-primary);

    &-icon {
      font-size: 1.375rem;
      line-height: 1;
    }

    &-text {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
  }

  &__nav {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  &__link {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem;
    color: var(--neo-text-secondary);
    text-decoration: none;
    border-radius: 6px;
    transition: all 0.15s ease;
    font-size: 0.875rem;

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }

    &.router-link-active {
      background: var(--neo-accent-soft);
      color: var(--neo-accent);
    }

    &-icon {
      font-size: 1.125rem;
      width: 1.25rem;
      text-align: center;
      flex-shrink: 0;
    }

    &-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  &__spacer {
    flex: 1;
    min-height: 1rem;
  }

  &__actions {
    margin-bottom: 0.25rem;
    flex-shrink: 0;
  }

  &__action-btn {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.625rem;
    background: transparent;
    border: none;
    color: var(--neo-text-secondary);
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.15s ease;

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }
  }

  &__user {
    padding: 0.5rem;
    border-top: 1px solid var(--neo-border-color);
    margin: 0 -0.5rem -0.5rem;
    background: var(--neo-bg-tertiary);
    flex-shrink: 0;

    .collapsed & {
      padding: 0.375rem;
      display: flex;
      justify-content: center;
    }
  }

  &__user-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    .collapsed & {
      gap: 0;
    }
  }

  &__avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;

    &--placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--neo-accent);
      color: white;
      font-weight: 600;
      font-size: 0.75rem;
    }
  }

  &__user-details {
    flex: 1;
    min-width: 0;
  }

  &__user-name {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__user-handle {
    display: block;
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__user-actions {
    display: flex;
    gap: 0.125rem;
    margin-top: 0.375rem;
    padding-left: 40px;
  }

  &__user-btn {
    padding: 0.25rem 0.375rem;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.15s ease;
    opacity: 0.7;

    &:hover {
      background: var(--neo-bg-secondary);
      opacity: 1;
    }
  }

  &__login-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem;
    background: var(--neo-accent);
    color: white;
    text-decoration: none;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    transition: all 0.15s ease;

    &:hover {
      filter: brightness(1.1);
    }

    .collapsed & {
      padding: 0.5rem;
    }
  }
}

// ========================================
// MOBILE HEADER - Threads Style
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
  padding: 0 1rem;
  background: var(--neo-bg-primary);
  z-index: 90;

  @media (min-width: 1024px) {
    display: none;
  }

  &__menu-btn,
  &__action-btn {
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
    flex-shrink: 0;

    svg {
      width: 24px;
      height: 24px;
    }

    &:hover {
      background: var(--neo-accent-soft);
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
// MOBILE BOTTOM NAVIGATION - Threads Style
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
  padding: 0 0.5rem;
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

    &:hover {
      background: var(--neo-accent-soft);
    }

    &:active {
      transform: scale(0.9);
    }

    &.active {
      color: var(--neo-text-primary);
    }

    svg {
      width: 26px;
      height: 26px;
    }

    &--avatar {
      padding: 4px;
    }
  }

  &__compose {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: var(--neo-bg-tertiary);
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    color: var(--neo-text-primary);
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: var(--neo-accent-soft);
      border-color: var(--neo-text-muted);
    }

    &:active {
      transform: scale(0.92);
    }

    svg {
      width: 24px;
      height: 24px;
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

      svg {
        width: 18px;
        height: 18px;
      }
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
  width: 300px;
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

    span:first-child {
      font-size: 1.5rem;
    }
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
// MAIN CONTENT - Wide & Spacious
// ========================================
.main-content {
  flex: 1;
  min-height: 100vh;
  padding-top: 56px; // Mobile header height
  padding-bottom: calc(56px + env(safe-area-inset-bottom, 0)); // Mobile nav height

  @media (min-width: 1024px) {
    padding-top: 0;
    padding-bottom: 0;
    margin-left: 52px; // Default to collapsed sidebar width
    transition: margin-left 0.2s ease;
  }

  // When sidebar is expanded
  .sidebar:not(.collapsed) ~ & {
    @media (min-width: 1024px) {
      margin-left: 200px;
    }
  }

  &__inner {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0.5rem;

    @media (min-width: 600px) {
      padding: 1rem;
    }

    @media (min-width: 1024px) {
      padding: 1.5rem 2rem;
    }

    @media (min-width: 1200px) {
      padding: 2rem 3rem;
    }
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
    box-shadow: 2px 0 20px rgba(0, 255, 65, 0.1);

    &__logo-text {
      animation: logo-glitch 3s ease-in-out infinite;
    }
  }

  .mobile-header {
    border-bottom-color: var(--neo-accent);
    box-shadow: 0 2px 20px rgba(0, 255, 65, 0.1);
  }
}

@keyframes logo-glitch {
  0%, 90%, 100% {
    transform: translateX(0);
    filter: hue-rotate(0deg);
  }
  92% {
    transform: translateX(-2px);
    filter: hue-rotate(90deg);
  }
  94% {
    transform: translateX(2px);
    filter: hue-rotate(-90deg);
  }
  96% {
    transform: translateX(-1px);
    filter: hue-rotate(45deg);
  }
}
</style>
