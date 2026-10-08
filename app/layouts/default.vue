<script setup lang="ts">
/**
 * Default Layout — Braun / ibm.io instrument chrome
 * Thin orchestrator: shell pieces live under components/shell/.
 */

import { useThemeStore } from '~/stores/theme'
import { useSettingsStore } from '~/stores/settings'
import { edwardActive } from '~/utils/edwardShell'
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useGroupsStore } from '~/stores/groups'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useAlgorithmsStore } from '~/stores/algorithms'
import { useAccountsManager } from '~/composables/useAccountsManager'
import { useShellAppearance } from '~/composables/useShellAppearance'
import { useLoomHandoff } from '~/composables/useLoomHandoff'
import { useDeskViewport } from '~/composables/useBreakpoint'
import DesktopSidebar from '~/components/shell/DesktopSidebar.vue'
import MobileHeader from '~/components/shell/MobileHeader.vue'
import MobileDrawer from '~/components/shell/MobileDrawer.vue'
import MobileTabBar from '~/components/shell/MobileTabBar.vue'

const LazyEdwardMode = defineAsyncComponent(
  () => import('~/components/edward/EdwardMode.vue'),
)

const themeStore = useThemeStore()
const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const notificationsStore = useNotificationsStore()
const conversationsStore = useConversationsStore()
const groupsStore = useGroupsStore()
const { boardPortal } = useBoardPortal()
const route = useRoute()
/** Pages may redirect `/messages` → `/messages/`; normalize before route checks. */
const path = computed(() => route.path.replace(/\/+$/, '') || '/')

const mobileMenuOpen = ref(false)

/** Overlays mount on first open only (keeps their chunks + setup off the boot path). */
const composeSheet = useComposeSheetStore()
const algorithmsStore = useAlgorithmsStore()
const { isOpen: accountsManagerOpen } = useAccountsManager()
const mounted = reactive({ compose: false, algorithm: false, accounts: false, settings: false })
watchEffect(() => {
  if (composeSheet.open) mounted.compose = true
  if (algorithmsStore.editorOpen) mounted.algorithm = true
  if (accountsManagerOpen.value) mounted.accounts = true
  if (settingsStore.isOpen) mounted.settings = true
})

const { sidebarRail, loadSidebarRail, applyTheme } = useShellAppearance()
const { registerLoomListeners, bootLoomHandoff } = useLoomHandoff()
const isDesk = useDeskViewport()
useAppShellHeight()
// Publish --neo-keyboard-inset for any page (messages list, explore, …)
useKeyboardBottomInset()

/** Column board owns its scrollers; every other mobile page scrolls `main`. */
const isBoardRoute = computed(() => path.value === '/')
/** Conversation focus — hide bottom tabs / FAB that fight sticky reply */
const isThreadRoute = computed(() => path.value.startsWith('/status/'))
const isProfileRoute = computed(
  () => path.value === '/profile' || path.value.startsWith('/profile/'),
)
const isMessagesRoute = computed(() => path.value === '/messages')
const isNotificationsRoute = computed(() => path.value === '/notifications')
/** Single group page — not the /groups hub */
const isGroupsDetailRoute = computed(() => /^\/groups\/.+/.test(path.value))
/** Nested mobile screens — own chrome, no global header/tabs */
const isMobileSubview = computed(
  () =>
    isThreadRoute.value ||
    isProfileRoute.value ||
    isMessagesRoute.value ||
    isNotificationsRoute.value ||
    isGroupsDetailRoute.value,
)
const showMobileNav = computed(() => !isMobileSubview.value)
const showMobileHeader = computed(() => !isMobileSubview.value)

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}

/** Shell owns one live-refresh consumer — don't start twice from mount + auth watch. */
let shellLiveRefresh = false
const startShellLiveRefresh = () => {
  if (shellLiveRefresh) return
  conversationsStore.startLiveRefresh()
  shellLiveRefresh = true
}
const stopShellLiveRefresh = () => {
  if (!shellLiveRefresh) return
  conversationsStore.stopLiveRefresh()
  shellLiveRefresh = false
}

watch(isDesk, (desk) => {
  if (desk) closeMobileMenu()
})

// Fixed bottom UI (toasts, docks) reads this — the tab bar is gone on subviews
watchEffect(() => {
  if (typeof document === 'undefined') return
  const root = document.documentElement.style
  if (showMobileNav.value) root.removeProperty('--neo-bottom-chrome-h')
  else root.setProperty('--neo-bottom-chrome-h', '0px')
})

onMounted(async () => {
  // Loom handoff listener MUST register before initialize() — Loom may postMessage
  // while auth/storage is still loading, and those messages are otherwise lost.
  const cleanups: Array<() => void> = []
  cleanups.push(registerLoomListeners())

  // Register listeners + cleanups synchronously BEFORE any await
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onScheme = () => {
    if (settingsStore.localPreferences.theme === 'auto') applyTheme()
  }
  mq.addEventListener?.('change', onScheme)
  cleanups.push(() => mq.removeEventListener?.('change', onScheme))

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && instancesStore.hasAuthenticatedInstance) {
      void notificationsStore.refreshUnreadBadge()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility))

  onUnmounted(() => {
    for (const fn of cleanups) fn()
    stopShellLiveRefresh()
  })

  loadSidebarRail()

  await instancesStore.initialize()
  settingsStore.loadLocalPreferences()
  applyTheme()
  void groupsStore.initializeGroups()

  if (instancesStore.userCustomCSS) {
    themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
  }
  settingsStore.syncCustomProfileCss()

  if (instancesStore.hasAuthenticatedInstance) {
    notificationsStore.refreshUnreadBadge()
    // The isAuthenticated watcher may already have started + fetched during initialize()
    if (!shellLiveRefresh) void conversationsStore.refreshUnreadBadge()
    startShellLiveRefresh()
  }

  await bootLoomHandoff()
})

watch(
  () => instancesStore.userCustomCSS,
  (css) => {
    themeStore.setUserCustomCSS(css || '')
    settingsStore.syncCustomProfileCss()
  },
)

watch(
  () => instancesStore.isAuthenticated,
  (ok) => {
    if (ok) {
      if (!shellLiveRefresh) void conversationsStore.refreshUnreadBadge()
      startShellLiveRefresh()
    } else {
      stopShellLiveRefresh()
    }
  },
)

watch(
  () => route.fullPath,
  () => {
    closeMobileMenu()
  },
)
</script>

<template>
  <div
    class="neo-layout"
    :class="{
      'chaos-active': themeStore.isChaosMode,
      'neo-layout--board': isBoardRoute,
      'neo-layout--thread': isThreadRoute,
      'neo-layout--profile': isProfileRoute,
      'neo-layout--subview': isMobileSubview,
      'neo-layout--rail': sidebarRail,
      'neo-layout--portal-settings': boardPortal === 'settings',
      'neo-layout--portal-profile': boardPortal === 'profile',
      'neo-layout--portal-search': boardPortal === 'search',
      'neo-layout--portal-inbox': boardPortal === 'inbox',
      'neo-layout--portal-activity': boardPortal === 'activity',
      'neo-layout--portal-communities': boardPortal === 'communities',
    }"
  >
    <a href="#main-content" class="skip-link">Skip to content</a>

    <!-- Only the active breakpoint's navigation is rendered (each is large + reactive) -->
    <DesktopSidebar v-if="isDesk" />

    <MobileHeader v-if="showMobileHeader" v-model:open="mobileMenuOpen" />

    <MobileDrawer v-if="!isDesk" v-model:open="mobileMenuOpen" />

    <div
      v-if="instancesStore.authNotice"
      class="neo-auth-notice"
      role="status"
    >
      <p>{{ instancesStore.authNotice }}</p>
      <button type="button" class="neo-auth-notice__dismiss" @click="instancesStore.dismissAuthNotice()">
        Dismiss
      </button>
    </div>

    <main id="main-content" class="main-content" tabindex="-1">
      <slot />
    </main>

    <MobileTabBar v-if="showMobileNav" />

    <!-- Sticky v-if: fetch each sheet's chunk on first open, keep it for close transitions -->
    <LazyComposeSheet v-if="mounted.compose" />
    <LazyAlgorithmSheet v-if="mounted.algorithm" />
    <LazyInstanceManager v-if="mounted.accounts" />
    <AccountSwitcherSheet v-if="instancesStore.hasAuthenticatedInstance" />
    <FeedbackNotes v-if="!isMobileSubview" />
    <LazySettingsModal v-if="mounted.settings" />
    <!-- Shared bottom-right dock: below modal / drawer z-index; stacks banner + suite -->
    <div
      class="neo-bottom-dock"
      :class="{
        'neo-bottom-dock--subview': isMobileSubview,
        'neo-bottom-dock--thread': isThreadRoute,
      }"
    >
      <InstallAppBanner />
      <SuiteMenu />
    </div>
    <NeoOverlayHost />
    <LazyEdwardMode v-if="edwardActive" />
  </div>
</template>

<style lang="scss" scoped>
.neo-auth-notice {
  position: sticky;
  top: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  background: color-mix(in srgb, var(--neo-warning, #d97706) 14%, var(--neo-bg-primary));
  border-bottom: 1px solid color-mix(in srgb, var(--neo-warning, #d97706) 35%, transparent);
  color: var(--neo-text-primary);
  font-size: 0.8125rem;

  p {
    margin: 0;
    flex: 1;
  }
}

.neo-auth-notice__dismiss {
  flex-shrink: 0;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-primary);
  padding: 0.25rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.neo-layout {
  --neo-sidebar-width: 248px;
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  max-width: 100%;
  background: var(--neo-bg-primary);
  overscroll-behavior-x: none;

  // Mobile: column shell with in-flow header/tabs.
  // Avoid position:fixed chrome inside overflow:hidden — iOS Safari clips it
  // (Chrome device emulation does not), which hid the bottom tab bar.
  // --neo-app-height tracks visualViewport (Android URL-bar); svh/dvh as fallback.
  @media (max-width: 1023px) {
    flex-direction: column;
    // Override base min-height: 100dvh — min-height beats max-height when larger
    min-height: 0;
    height: 100vh;
    height: 100dvh;
    height: 100svh;
    height: var(--neo-app-height, 100svh);
    max-height: 100vh;
    max-height: 100dvh;
    max-height: 100svh;
    max-height: var(--neo-app-height, 100svh);
    overflow: hidden;
  }

  // iPad / small laptop: give the board more horizontal room
  @media (min-width: 1024px) and (max-width: 1199px) {
    --neo-sidebar-width: 200px;
  }

  &--rail,
  :global(html[data-rail]) & {
    --neo-sidebar-width: 68px;
  }
}

/* Bottom-right dock for install banner + suite waffle — below modal/drawer */
.neo-bottom-dock {
  position: fixed;
  right: max(10px, env(safe-area-inset-right));
  bottom: calc(var(--neo-mobile-nav-h, 56px) + env(safe-area-inset-bottom, 0px) + 0.65rem);
  z-index: var(--neo-z-shell-header, 90);
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: 0.5rem;
  pointer-events: none;
  max-width: min(22rem, calc(100vw - 20px));

  &--subview {
    /* Tab bar hidden on focused mobile screens */
    bottom: calc(env(safe-area-inset-bottom, 0px) + 0.65rem);
  }

  /* Threads / chats pin a reply bar to the bottom — the waffle sat on Send */
  &--thread {
    @media (max-width: 1023px) {
      display: none;
    }
  }

  @media (max-width: 1023px) {
    left: max(0.75rem, env(safe-area-inset-left));
    right: max(0.75rem, env(safe-area-inset-right));
    max-width: none;

    // Waffle shares the bottom row with the note FAB (bottom-left); the full-width
    // install banner stacks above both instead of sliding under the FAB.
    :deep(.suite-menu) {
      order: -1;
    }
  }

  @media (min-width: 1024px) {
    right: max(16px, env(safe-area-inset-right));
    bottom: max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem));
  }
}

.neo-layout--portal-settings,
.neo-layout--portal-profile,
.neo-layout--portal-search,
.neo-layout--portal-inbox,
.neo-layout--portal-activity,
.neo-layout--portal-communities {
  :deep(.mobile-feed-tabs) {
    opacity: 0.45;
    transition: opacity 0.2s ease;
  }
}

.main-content {
  flex: 1;
  min-height: 100vh;
  min-height: 100dvh;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  padding: 0.5rem;
  box-sizing: border-box;
  background: var(--neo-bg-primary);
  overscroll-behavior-x: none;

  /* Mobile: fill remaining space between in-flow header + tab bar.
     The shell is viewport-locked, so `main` is the page's scroll container
     (search, groups, threads…). Only the column board opts out below. */
  @media (max-width: 1023px) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    height: auto;
    max-height: none;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
    // Sticky bars pin to the content edge — they offset by this to sit flush
    --neo-main-pad-top: 0.5rem;
    padding: var(--neo-main-pad-top) 0.5rem 0;

    // Flex items default to min-width:auto and won't shrink below content
    // (a wide post laid group detail out at 670px inside a 375px viewport).
    > * {
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }

    .neo-layout--board & {
      overflow: hidden;
    }
  }

  @media (min-width: 600px) and (max-width: 1023px) {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  @media (min-width: 1024px) {
    display: block;
    height: auto;
    max-height: none;
    overflow: visible;
    padding: 1.25rem 1.25rem;
    margin-left: var(--neo-sidebar-width, 248px);
    transition: margin-left 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }

  @media (min-width: 1200px) {
    padding: 1.5rem 2rem;
  }

  .neo-layout--thread &,
  .neo-layout--profile &,
  .neo-layout--subview & {
    /* Nested mobile screens: own top bar, no global header/tabs */
    --neo-main-pad-top: 0px;
    padding-top: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);

    @media (min-width: 1024px) {
      padding: 1.25rem;
    }

    @media (min-width: 1200px) {
      padding: 1.5rem 2rem;
    }
  }
}
</style>
