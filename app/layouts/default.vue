<script setup lang="ts">
/**
 * Default Layout — Braun / ibm.io instrument chrome
 * Thin orchestrator: shell pieces live under components/shell/.
 */

import { useThemeStore } from '~/stores/theme'
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useGroupsStore } from '~/stores/groups'
import { useShellAppearance } from '~/composables/useShellAppearance'
import { useLoomHandoff } from '~/composables/useLoomHandoff'
import DesktopSidebar from '~/components/shell/DesktopSidebar.vue'
import MobileHeader from '~/components/shell/MobileHeader.vue'
import MobileDrawer from '~/components/shell/MobileDrawer.vue'
import MobileTabBar from '~/components/shell/MobileTabBar.vue'

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

const { sidebarRail, loadSidebarRail, applyTheme } = useShellAppearance()
const { registerLoomListeners, bootLoomHandoff } = useLoomHandoff()

/** Conversation focus — hide bottom tabs / FAB that fight sticky reply */
const isThreadRoute = computed(() => path.value.startsWith('/status/'))
const isProfileRoute = computed(
  () => path.value === '/profile' || path.value.startsWith('/profile/'),
)
const isMessagesRoute = computed(() => path.value === '/messages')
/** Nested mobile screens — own chrome, no global header/tabs */
const isMobileSubview = computed(
  () => isThreadRoute.value || isProfileRoute.value || isMessagesRoute.value,
)
const showMobileNav = computed(() => !isMobileSubview.value)
const showMobileHeader = computed(() => !isMobileSubview.value)

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}

onMounted(async () => {
  // Mobile chrome is in-flow (flex), so main no longer reserves fixed offsets.
  // Keep --neo-mobile-nav-h for FABs that sit above the tab bar.
  document.documentElement.style.setProperty('--neo-mobile-chrome-top', '0px')
  document.documentElement.style.setProperty('--neo-mobile-nav-h', '64px')

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

  const deskMq = window.matchMedia('(min-width: 1024px)')
  const onDeskBreakpoint = () => {
    if (deskMq.matches) closeMobileMenu()
  }
  deskMq.addEventListener?.('change', onDeskBreakpoint)
  cleanups.push(() => deskMq.removeEventListener?.('change', onDeskBreakpoint))

  onUnmounted(() => {
    for (const fn of cleanups) fn()
    conversationsStore.stopLiveRefresh()
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
    conversationsStore.refreshUnreadBadge()
    conversationsStore.startLiveRefresh()
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
      conversationsStore.startLiveRefresh()
      void conversationsStore.refreshUnreadBadge()
    } else {
      conversationsStore.stopLiveRefresh()
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

    <DesktopSidebar />

    <MobileHeader v-if="showMobileHeader" v-model:open="mobileMenuOpen" />

    <SuiteMenu />

    <MobileDrawer v-model:open="mobileMenuOpen" />

    <main id="main-content" class="main-content" tabindex="-1">
      <slot />
    </main>

    <MobileTabBar v-if="showMobileNav" />

    <LazyComposeSheet />
    <LazyInstanceManager />
    <AccountSwitcherSheet v-if="instancesStore.hasAuthenticatedInstance" />
    <FeedbackNotes v-if="!isMobileSubview" />
    <LazySettingsModal />
    <InstallAppBanner />
    <NeoOverlayHost />
  </div>
</template>

<style lang="scss" scoped>
.neo-layout {
  --neo-sidebar-w: 248px;
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  max-width: 100%;
  background: var(--neo-bg-primary);
  overscroll-behavior-x: none;

  // Mobile: column shell with in-flow header/tabs.
  // Avoid position:fixed chrome inside overflow:hidden — iOS Safari clips it
  // (Chrome device emulation does not), which hid the bottom tab bar.
  // Prefer svh so the URL-bar show/hide doesn't resize-jitter the shell.
  @media (max-width: 1023px) {
    flex-direction: column;
    // Override base min-height: 100dvh — min-height beats max-height when larger
    min-height: 0;
    height: 100vh;
    height: 100dvh;
    height: 100svh;
    max-height: 100vh;
    max-height: 100dvh;
    max-height: 100svh;
    overflow: hidden;
  }

  // iPad / small laptop: give the board more horizontal room
  @media (min-width: 1024px) and (max-width: 1199px) {
    --neo-sidebar-w: 200px;
  }

  &--rail,
  :global(html[data-rail]) & {
    --neo-sidebar-w: 68px;
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

  /* Mobile: fill remaining space between in-flow header + tab bar */
  @media (max-width: 1023px) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    height: auto;
    max-height: none;
    overflow: hidden;
    padding: 0.5rem 0.5rem 0;
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
    margin-left: var(--neo-sidebar-w, 248px);
    transition: margin-left 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }

  @media (min-width: 1200px) {
    padding: 1.5rem 2rem;
  }

  .neo-layout--thread &,
  .neo-layout--profile &,
  .neo-layout--subview & {
    /* Nested mobile screens: own top bar, no global header/tabs */
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
