<script setup lang="ts">
/**
 * Default Layout
 * 
 * The master container that orchestrates the dual-mode experience.
 * Now with real authentication support!
 */

import { useThemeStore } from '~/stores/theme'
import { useAuthStore } from '~/stores/auth'

const themeStore = useThemeStore()
const authStore = useAuthStore()
const router = useRouter()

// Initialize auth on mount
onMounted(async () => {
  await authStore.initialize()
  
  // Load user's custom CSS if available
  if (authStore.userCustomCSS) {
    themeStore.setUserCustomCSS(authStore.userCustomCSS)
  }
})

const handleLogout = async () => {
  await authStore.logout()
  themeStore.setUserCustomCSS('')
  themeStore.disableChaosMode()
  router.push('/login')
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

    <!-- Navigation Header -->
    <header class="neo-header">
      <div class="neo-header__container neo-container">
        <div class="neo-header__brand">
          <NuxtLink to="/" class="neo-header__logo">
            <span class="neo-header__logo-icon">🌌</span>
            <span class="neo-header__logo-text">NeoSpace</span>
          </NuxtLink>
          <span class="neo-header__tagline">
            {{ themeStore.isChaosMode ? 'CHAOS UNLEASHED' : 'Social, Your Way' }}
          </span>
        </div>

        <nav class="neo-header__nav">
          <NuxtLink to="/" class="neo-header__link">
            <span>🏠</span>
            <span>Home</span>
          </NuxtLink>
          <NuxtLink to="/explore" class="neo-header__link">
            <span>🔍</span>
            <span>Explore</span>
          </NuxtLink>
          <NuxtLink v-if="authStore.isAuthenticated" to="/notifications" class="neo-header__link">
            <span>🔔</span>
            <span>Notifications</span>
          </NuxtLink>
        </nav>

        <div class="neo-header__actions">
          <ThemeToggle />
          
          <!-- User Menu or Login Button -->
          <div v-if="authStore.isAuthenticated" class="neo-header__user">
            <NuxtLink to="/profile" class="neo-header__avatar-link">
              <img 
                v-if="authStore.userAvatar"
                :src="authStore.userAvatar" 
                :alt="authStore.userDisplayName"
                class="neo-header__avatar neo-avatar neo-avatar--sm"
              />
            </NuxtLink>
            <div class="neo-header__dropdown">
              <button class="neo-header__dropdown-trigger">
                <span>{{ authStore.userDisplayName }}</span>
                <span>▼</span>
              </button>
              <div class="neo-header__dropdown-menu">
                <NuxtLink to="/profile" class="neo-header__dropdown-item">👤 Profile</NuxtLink>
                <NuxtLink to="/settings" class="neo-header__dropdown-item">⚙️ Settings</NuxtLink>
                <button class="neo-header__dropdown-item" @click="handleLogout">
                  🚪 Logout
                </button>
              </div>
            </div>
          </div>
          <NuxtLink v-else to="/login" class="neo-btn neo-btn--primary neo-btn--sm">
            Log In
          </NuxtLink>
        </div>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="neo-main">
      <div class="neo-main__container neo-container">
        <slot />
      </div>
    </main>

    <!-- Footer -->
    <footer class="neo-footer">
      <div class="neo-footer__container neo-container">
        <p class="neo-footer__text">
          NeoSpace &mdash; Built with 💜 and questionable CSS decisions
        </p>
        <p class="neo-footer__mode">
          Currently in: <strong>{{ themeStore.currentModeName }}</strong>
          <span v-if="authStore.instanceUrl"> · {{ authStore.instanceUrl.replace('https://', '') }}</span>
        </p>
      </div>
    </footer>
  </div>
</template>

<style lang="scss" scoped>
.neo-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

// Header
.neo-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background-color: var(--neo-bg-secondary);
  border-bottom: 1px solid var(--neo-border-color);
  backdrop-filter: blur(10px);

  &__container {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 0.75rem 1rem;
    max-width: 1400px;
  }

  &__brand {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  &__logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--neo-text-primary);
    transition: transform var(--neo-transition);

    &:hover {
      transform: scale(1.02);
    }

    &-icon {
      font-size: 1.75rem;
      line-height: 1;
    }

    &-text {
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, var(--neo-accent), var(--neo-text-primary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
  }

  &__tagline {
    display: none;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;

    @media (min-width: 768px) {
      display: block;
    }
  }

  &__nav {
    display: flex;
    gap: 0.25rem;
  }

  &__link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--neo-text-secondary);
    text-decoration: none;
    border-radius: var(--neo-radius-lg);
    transition: all var(--neo-transition);

    span:first-child {
      font-size: 1.125rem;
    }

    span:last-child {
      display: none;

      @media (min-width: 768px) {
        display: block;
      }
    }

    &:hover,
    &.router-link-active {
      background-color: var(--neo-accent-soft);
      color: var(--neo-accent);
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  &__user {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  &__avatar {
    cursor: pointer;
  }

  &__avatar-link {
    display: block;
    border-radius: var(--neo-radius-full);
    transition: transform var(--neo-transition), box-shadow var(--neo-transition);

    &:hover {
      transform: scale(1.05);
      
      .neo-header__avatar {
        box-shadow: 0 0 0 3px var(--neo-accent-soft);
      }
    }
  }

  &__dropdown {
    position: relative;

    &-trigger {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.5rem;
      background: transparent;
      border: none;
      color: var(--neo-text-secondary);
      font-size: 0.875rem;
      cursor: pointer;

      &:hover {
        color: var(--neo-text-primary);
      }

      span:last-child {
        font-size: 0.625rem;
      }
    }

    &-menu {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 0.5rem;
      min-width: 160px;
      background-color: var(--neo-bg-secondary);
      border: 1px solid var(--neo-border-color);
      border-radius: var(--neo-radius-lg);
      box-shadow: var(--neo-shadow-lg);
      overflow: hidden;
      z-index: 1000;
    }

    &:hover &-menu,
    &:focus-within &-menu {
      display: block;
    }

    &-item {
      display: block;
      width: 100%;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      color: var(--neo-text-primary);
      text-align: left;
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background-color var(--neo-transition);

      &:hover {
        background-color: var(--neo-accent-soft);
      }
    }
  }
}

.neo-btn--sm {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
}

// Main
.neo-main {
  flex: 1;
  padding: 2rem 0;

  &__container {
    max-width: 1400px;
  }
}

// Footer
.neo-footer {
  margin-top: auto;
  padding: 1.5rem 0;
  background-color: var(--neo-bg-tertiary);
  border-top: 1px solid var(--neo-border-color);

  &__container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-align: center;
  }

  &__text {
    font-size: 0.875rem;
    color: var(--neo-text-muted);
  }

  &__mode {
    font-size: 0.75rem;
    color: var(--neo-text-muted);

    strong {
      color: var(--neo-accent);
    }
  }
}

// Chaos Mode
.chaos-active {
  .neo-header {
    border-bottom-color: var(--neo-border-color);
    box-shadow: 0 0 20px rgba(0, 255, 65, 0.2);

    &__logo-text {
      animation: logo-glitch 3s ease-in-out infinite;
    }

    &__tagline {
      color: var(--neo-accent);
      animation: blink 1s step-end infinite;
    }
  }

  .neo-footer {
    border-top-color: var(--neo-border-color);
    box-shadow: 0 0 20px rgba(255, 0, 255, 0.2);
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

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
