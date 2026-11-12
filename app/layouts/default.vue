<script setup lang="ts">
/**
 * Default Layout — Braun / ibm.io instrument chrome
 * Thin orchestrator: shell pieces live under components/shell/.
 */

import { useThemeStore } from '~/stores/theme'
import { useEdwardStore } from '~/stores/edward'
import { useToastStore } from '~/stores/toast'
import { bumpOsScheme } from '~/utils/osScheme'
import { useSettingsStore } from '~/stores/settings'
import { edwardActive, toggleEdward } from '~/utils/edwardShell'
import { isEdwardShortcut } from '~/composables/useSuiteGroups'
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useGroupsStore } from '~/stores/groups'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useAlgorithmsStore } from '~/stores/algorithms'
import { useAccountsManager } from '~/composables/useAccountsManager'
import { useShellAppearance } from '~/composables/useShellAppearance'
import { useLoomHandoff } from '~/composables/useLoomHandoff'
import { useDeskViewport, usePhoneLandscape, useSidebarShell } from '~/composables/useBreakpoint'
import { useStandaloneShell } from '~/composables/useStandaloneShell'
import DesktopSidebar from '~/components/shell/DesktopSidebar.vue'
import MobileHeader from '~/components/shell/MobileHeader.vue'
import MobileDrawer from '~/components/shell/MobileDrawer.vue'
import MobileTabBar from '~/components/shell/MobileTabBar.vue'
import { useBoardNav, useNavChromeHidden } from '~/composables/useBoardNav'

const LazyEdwardMode = defineAsyncComponent({
  loader: () => import('~/components/edward/EdwardMode.vue'),
  // Chunk failed (offline / stale deploy): leave Edward instead of a phantom "on" state
  onError(_err, _retry, fail) {
    useEdwardStore().exit()
    useToastStore().show({ message: 'Couldn’t load Edward — check your connection.', kind: 'error' })
    fail()
  },
})

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

/** Browser reports no network — one shell notice instead of scattered failure toasts */
const isOffline = ref(false)

/** Overlays mount on first open only (keeps their chunks + setup off the boot path). */
const composeSheet = useComposeSheetStore()
const algorithmsStore = useAlgorithmsStore()
const { openCompose, openComposePreferred } = useBoardNav()
const { preferredIcon, preferred } = useComposeModality()
const { isOpen: accountsManagerOpen, open: openAccountsManager } = useAccountsManager()
const router = useRouter()

const authNoticeExpired = computed(() =>
  instancesStore.signedInInstances.find((i) => i.sessionExpired || (!i.accessToken && i.user)) || null,
)

const manageAuthNotice = () => {
  instancesStore.dismissAuthNotice()
  openAccountsManager()
}

const reauthFromNotice = async () => {
  const expired = authNoticeExpired.value
  if (!expired) {
    manageAuthNotice()
    return
  }
  instancesStore.dismissAuthNotice()
  const returnTo = route.fullPath || '/'
  await router.push(`/login?add=1&returnTo=${encodeURIComponent(returnTo)}`)
}
const { open: feedbackOpen } = useFeedbackNotes()
const mounted = reactive({ compose: false, algorithm: false, accounts: false, settings: false, feedback: false })
watchEffect(() => {
  if (composeSheet.open) mounted.compose = true
  if (algorithmsStore.editorOpen) mounted.algorithm = true
  if (accountsManagerOpen.value) mounted.accounts = true
  if (settingsStore.isOpen) mounted.settings = true
  if (feedbackOpen.value) mounted.feedback = true
})

const { sidebarRail, loadSidebarRail, applyTheme, lookAnnounce } = useShellAppearance()
// Recipe list feeds the sidebar, drawer and board — hydrate once here, not per shell component
algorithmsStore.hydrate()
const { registerLoomListeners, bootLoomHandoff } = useLoomHandoff()
const isDesk = useDeskViewport()
/** Tablet portrait+ — DesktopSidebar rail instead of phone header/tabs */
const isSidebarShell = useSidebarShell()
const isPhoneLandscape = usePhoneLandscape()
useAppShellHeight()
// Publish --neo-keyboard-inset for any page (messages list, explore, …)
useKeyboardBottomInset()
// html.neo-standalone + --neo-safe-top floor for iPad home-screen apps
useStandaloneShell()

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
/** Nested mobile screens — own top chrome (no global header) */
const isMobileSubview = computed(
  () =>
    isThreadRoute.value ||
    isProfileRoute.value ||
    isMessagesRoute.value ||
    isNotificationsRoute.value ||
    isGroupsDetailRoute.value,
)
/**
 * Tab destinations (Profile, Messages, Activity) keep the tab bar, so you can hop
 * Messages → Activity without Back. Threads and a single group stay focused (no tabs).
 */
const isTabRoute = computed(
  () => isProfileRoute.value || isMessagesRoute.value || isNotificationsRoute.value,
)
const showMobileNav = computed(() => !isMobileSubview.value || isTabRoute.value)
const showMobileHeader = computed(() => !isMobileSubview.value)

const navChromeHidden = useNavChromeHidden()

/** Desktop dock: post from most surfaces; skip thread focus and the DM inbox. */
const showComposeFab = computed(
  () =>
    isSidebarShell.value &&
    instancesStore.hasAuthenticatedInstance &&
    !composeSheet.open &&
    !isThreadRoute.value &&
    !isMessagesRoute.value,
)

/**
 * Phone peek FAB: only while reading the home feed with the tab bar fully tucked.
 * No FAB on DMs / activity / profile / search / portals — those aren’t “new post” contexts.
 */
const showPeekCompose = computed(() => {
  if (isSidebarShell.value) return false
  if (!showMobileNav.value || !navChromeHidden.value) return false
  if (!instancesStore.hasAuthenticatedInstance || composeSheet.open) return false
  if (path.value !== '/') return false
  const portal = boardPortal.value
  if (
    portal === 'search' ||
    portal === 'inbox' ||
    portal === 'activity' ||
    portal === 'profile' ||
    portal === 'settings' ||
    portal === 'communities'
  ) {
    return false
  }
  return true
})

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}

/** Shell owns one live-refresh consumer — don't start twice from mount + auth watch. */
let shellLiveRefresh = false
const startShellLiveRefresh = () => {
  if (shellLiveRefresh) return
  conversationsStore.startLiveRefresh()
  // Activity badge: poll with backoff while the tab is visible
  notificationsStore.startBadgePolling()
  shellLiveRefresh = true
}
const stopShellLiveRefresh = () => {
  if (!shellLiveRefresh) return
  conversationsStore.stopLiveRefresh()
  notificationsStore.stopBadgePolling()
  shellLiveRefresh = false
}

watch(isSidebarShell, (sidebar) => {
  if (sidebar) closeMobileMenu()
})

// Fixed bottom UI (toasts, docks) reads this — the tab bar is gone on subviews
watchEffect(() => {
  if (typeof document === 'undefined') return
  const root = document.documentElement.style
  if (showMobileNav.value) root.removeProperty('--neo-bottom-chrome-h')
  else root.setProperty('--neo-bottom-chrome-h', '0px')
  // Body-teleported FAB / toasts can't inherit --neo-feed-tabs-h from the layout —
  // publish the board's pill dock on <html> (_structural.scss sizes it)
  document.documentElement.classList.toggle('neo-route-board', isBoardRoute.value)
  // Toasts clear the pinned reply dock on threads (--neo-bottom-chrome-h is 0 there)
  document.documentElement.classList.toggle('neo-route-thread', isThreadRoute.value)
})

onMounted(async () => {
  // Loom / bruh handoff listener MUST register before initialize() — siblings may
  // postMessage while auth/storage is still loading, and those messages are otherwise lost.
  const cleanups: Array<() => void> = []
  cleanups.push(registerLoomListeners())
  cleanups.push(settingsStore.startSuiteLookSync())

  // Register listeners + cleanups synchronously BEFORE any await
  // Both queries feed resolveTheme('auto'): dark mode at sunset, Increase Contrast
  const onScheme = () => {
    bumpOsScheme()
    if (settingsStore.localPreferences.theme === 'auto') applyTheme()
  }
  for (const query of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)']) {
    const mq = window.matchMedia(query)
    mq.addEventListener?.('change', onScheme)
    cleanups.push(() => mq.removeEventListener?.('change', onScheme))
  }

  isOffline.value = navigator.onLine === false
  const onOnline = () => {
    isOffline.value = false
    if (instancesStore.hasAuthenticatedInstance) void notificationsStore.refreshUnreadBadge()
  }
  const onOffline = () => {
    isOffline.value = true
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  cleanups.push(() => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  })

  // Alt+Shift+E — Edward has no other keyboard way in (the waffle is pointer-first)
  const onEdwardShortcut = (e: KeyboardEvent) => {
    if (!isEdwardShortcut(e)) return
    e.preventDefault()
    void toggleEdward()
  }
  window.addEventListener('keydown', onEdwardShortcut)
  cleanups.push(() => window.removeEventListener('keydown', onEdwardShortcut))

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
    document.documentElement.classList.remove('neo-route-board', 'neo-route-thread')
  })

  loadSidebarRail()

  await instancesStore.initialize()
  settingsStore.loadLocalPreferences()
  applyTheme()
  void groupsStore.initializeGroups()
  void settingsStore.loadReadingPrefs()

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

// Switching accounts: memberships and followed tags belong to the previous account
watch(
  () => instancesStore.activeAccountId,
  (id, prev) => {
    if (id === prev) return
    void settingsStore.loadReadingPrefs()
    if (prev) void groupsStore.resetForAccountSwitch()
    else void groupsStore.initializeGroups()
  },
)

// Filters load after groups init (or change later) — hide trending tags they cover
watch(
  () => settingsStore.filters,
  () => groupsStore.refilterTrending(),
)

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
      if (!shellLiveRefresh) {
        void conversationsStore.refreshUnreadBadge()
        void notificationsStore.refreshUnreadBadge()
      }
      startShellLiveRefresh()
    } else {
      stopShellLiveRefresh()
    }
  },
)

// A newly linked account's unread count belongs in the Activity badge right away
watch(
  () => instancesStore.authenticatedInstances.length,
  (n, prev) => {
    if (n > prev && instancesStore.hasAuthenticatedInstance) void notificationsStore.refreshUnreadBadge()
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
      'neo-layout--tab': isTabRoute,
      'neo-layout--subview': isMobileSubview,
      'neo-layout--rail': sidebarRail,
      'neo-layout--phone-landscape': isPhoneLandscape,
      'neo-layout--portal-settings': boardPortal === 'settings',
      'neo-layout--portal-profile': boardPortal === 'profile',
      'neo-layout--portal-search': boardPortal === 'search',
      'neo-layout--portal-inbox': boardPortal === 'inbox',
      'neo-layout--portal-activity': boardPortal === 'activity',
      'neo-layout--portal-communities': boardPortal === 'communities',
    }"
  >
    <a href="#main-content" class="skip-link">Skip to content</a>

    <!-- Tablet portrait+ gets the desk sidebar (rail by default on mid widths) -->
    <DesktopSidebar v-if="isSidebarShell" />

    <MobileHeader v-if="!isSidebarShell && showMobileHeader" v-model:open="mobileMenuOpen" />

    <MobileDrawer v-if="!isSidebarShell" v-model:open="mobileMenuOpen" />

    <!-- One shared announcer for Look / board-density changes (both shells report here) -->
    <p class="sr-only" aria-live="polite">{{ lookAnnounce }}</p>

    <!-- Live region stays mounted so the notice is announced when it appears -->
    <div class="neo-auth-notice-region" role="status">
      <div v-if="isOffline" class="neo-auth-notice neo-auth-notice--offline">
        <p>You’re offline — showing cached posts. New activity will load when you reconnect.</p>
      </div>
      <div v-if="instancesStore.authNotice" class="neo-auth-notice">
        <p>{{ instancesStore.authNotice }}</p>
        <div class="neo-auth-notice__actions">
          <button
            v-if="authNoticeExpired"
            type="button"
            class="neo-auth-notice__action"
            @click="reauthFromNotice"
          >
            Sign in again
          </button>
          <button type="button" class="neo-auth-notice__action" @click="manageAuthNotice">
            Manage accounts
          </button>
          <button type="button" class="neo-auth-notice__dismiss" @click="instancesStore.dismissAuthNotice()">
            Dismiss
          </button>
        </div>
      </div>
    </div>

    <main id="main-content" class="main-content" tabindex="-1">
      <slot />
    </main>

    <!-- After main so portrait flex stacks it at the bottom (sticky-before-main sat under the header). -->
    <MobileTabBar v-if="!isSidebarShell && showMobileNav" v-model:open="mobileMenuOpen" />

    <!-- Sticky v-if: fetch each sheet's chunk on first open, keep it for close transitions -->
    <LazyComposeSheet v-if="mounted.compose" />
    <LazyAlgorithmSheet v-if="mounted.algorithm" />
    <LazyInstanceManager v-if="mounted.accounts" />
    <AccountSwitcherSheet v-if="instancesStore.hasAuthenticatedInstance" />
    <LazyFeedbackNotes v-if="mounted.feedback && (isSidebarShell || !isMobileSubview)" />
    <LazySettingsModal v-if="mounted.settings" />
    <!-- Shared bottom-right dock: below modal / drawer z-index; stacks banner + suite -->
    <!-- Hide while compose is open so the waffle never fights the soft keyboard / Post bar -->
    <div
      v-show="!composeSheet.open"
      class="neo-bottom-dock"
      :class="{
        'neo-bottom-dock--subview': isMobileSubview && !isTabRoute,
        'neo-bottom-dock--thread': isThreadRoute,
      }"
    >
      <InstallAppBanner />
      <button
        v-if="showComposeFab"
        type="button"
        class="compose-fab"
        aria-label="New thread"
        title="New thread"
        @click="() => openCompose()"
      >
        <NeoIcon name="plus" :size="26" :stroke="2.25" />
      </button>
      <!-- Phones get the same tools inside the drawer (Menu → Tools) instead of a floating waffle -->
      <SuiteMenu v-if="isSidebarShell" />
    </div>
    <!-- Outside the dock so auto-hide translate doesn't carry it off-screen -->
    <Transition name="compose-peek">
      <button
        v-if="showPeekCompose"
        type="button"
        class="compose-fab compose-fab--peek"
        :class="`compose-fab--peek-${preferred}`"
        :aria-label="preferred === 'media' ? 'New photo' : preferred === 'voice' ? 'Voice note' : 'New thread'"
        :title="preferred === 'media' ? 'New photo' : preferred === 'voice' ? 'Voice note' : 'New thread'"
        @click="openComposePreferred"
      >
        <NeoIcon :name="preferredIcon" :size="22" :stroke="2" />
      </button>
    </Transition>
    <NeoOverlayHost />
    <LazyEdwardMode v-if="edwardActive" />
  </div>
</template>

<style lang="scss" scoped>
.neo-auth-notice-region {
  position: sticky;
  top: 0;
  z-index: 90;
  flex-shrink: 0;

  // Sidebar shell: SubviewChrome is also sticky at top:0 — a sticky notice would
  // cover the Back bar while scrolling. Let the notice scroll away instead.
  @media (min-width: 768px) {
    position: static;
  }

  // Sidebar row shell: own the full first line beside the fixed sidebar — as a
  // plain flex item it sat under the sidebar and squeezed `main` sideways
  @media (min-width: 768px) {
    &:not(:empty) {
      flex: 0 0 calc(100% - var(--neo-sidebar-width, 248px));
      margin-left: var(--neo-sidebar-width, 248px);
    }
  }
}

.neo-auth-notice {
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

.neo-auth-notice--offline {
  background: var(--neo-bg-secondary, var(--neo-bg-primary));
  border-bottom-color: var(--neo-border-color);
}

.neo-auth-notice__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.35rem;
  flex-shrink: 0;
}

.neo-auth-notice__action {
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--neo-warning, #d97706) 40%, var(--neo-border-color));
  border-radius: 999px;
  background: var(--neo-bg-primary);
  color: var(--neo-text-primary);
  padding: 0.25rem 0.65rem;
  min-height: 24px;
  font-size: 0.75rem;
  font-weight: 650;
  cursor: pointer;

  @media (max-width: 1023px) {
    min-height: 44px;
    padding-inline: 0.85rem;
  }

  &:hover {
    background: var(--neo-bg-hover);
  }
}

.neo-auth-notice__dismiss {
  flex-shrink: 0;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-primary);
  // Buttons don't inherit color — default ButtonText was black on dark themes
  color: var(--neo-text-primary);
  padding: 0.25rem 0.65rem;
  min-height: 24px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;

  // Touch target on phones/tablets — pad the hit area without growing the notice much
  @media (max-width: 1023px) {
    min-height: 44px;
    min-width: 44px;
    padding-inline: 0.9rem;
  }
}

.neo-layout {
  /* --neo-feed-tabs-h comes from html.neo-route-board (_structural.scss) */
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  max-width: 100%;
  background: var(--neo-bg-primary);
  overscroll-behavior-x: none;

  @media (min-width: 768px) {
    // Auth notice takes its own line above `main` (sidebar shell)
    flex-wrap: wrap;
    align-content: flex-start;
  }

  // Phone: column shell with in-flow header/tabs.
  // Avoid position:fixed chrome inside overflow:hidden — iOS Safari clips it
  // (Chrome device emulation does not), which hid the bottom tab bar.
  // --neo-app-height tracks visualViewport (Android URL-bar); svh/dvh as fallback.
  @media (max-width: 767px) {
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

  // Phone landscape: left rail + main row (maximizes vertical reading height)
  &--phone-landscape {
    @media (max-width: 1023px) {
      flex-direction: row;
      flex-wrap: nowrap;
      align-content: stretch;
    }
  }
}

/* Bottom-right dock for install banner + suite waffle — below modal/drawer */
.compose-fab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  padding: 0;
  border: none;
  border-radius: 16px;
  background: var(--neo-text-primary);
  color: var(--neo-bg-primary);
  box-shadow:
    0 2px 8px color-mix(in srgb, var(--neo-text-primary) 22%, transparent),
    0 10px 28px color-mix(in srgb, var(--neo-text-primary) 16%, transparent);
  cursor: pointer;
  pointer-events: auto;
  transition:
    transform var(--neo-dur-quick, 160ms) var(--neo-ease-spring),
    box-shadow var(--neo-dur-quick, 160ms) var(--neo-ease-out),
    opacity var(--neo-dur-quick, 160ms) var(--neo-ease-out);

  :deep(.neo-icon) {
    transition: transform var(--neo-dur-normal, 240ms) var(--neo-ease-spring);
  }

  &:hover {
    transform: translateY(var(--neo-hover-lift, -2px)) scale(1.03);
    box-shadow:
      0 4px 12px color-mix(in srgb, var(--neo-text-primary) 26%, transparent),
      0 14px 32px color-mix(in srgb, var(--neo-text-primary) 18%, transparent);

    :deep(.neo-icon) {
      transform: rotate(90deg) scale(1.08);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--neo-focus, var(--neo-accent));
    outline-offset: 3px;
  }

  &:active {
    transition-duration: var(--neo-dur-instant, 90ms);
    transform: translateY(var(--neo-anticipate-y, 2px))
      scale3d(var(--neo-press-squash-x, 1.08), var(--neo-press-squash-y, 0.88), 1);

    :deep(.neo-icon) {
      transform: rotate(45deg) scale(0.9);
    }
  }

  // Threads: solid create chip, lower-right, only while the tab bar is gone
  &--peek {
    position: fixed;
    z-index: var(--neo-z-shell-header, 90);
    right: max(0.85rem, env(safe-area-inset-right, 0px));
    left: auto;
    margin-left: 0;
    bottom: max(
      0.85rem,
      calc(env(safe-area-inset-bottom, 0px) + var(--neo-feed-tabs-h, 0px) + 0.55rem)
    );
    width: 3.35rem;
    height: 3.35rem;
    border-radius: 18px;
    background: var(--neo-text-primary);
    color: var(--neo-bg-primary);
    box-shadow:
      0 4px 14px color-mix(in srgb, var(--neo-text-primary) 22%, transparent),
      0 12px 32px color-mix(in srgb, var(--neo-text-primary) 16%, transparent);
  }
}

.compose-peek-enter-active {
  transition:
    opacity 220ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.compose-peek-leave-active {
  transition:
    opacity 140ms cubic-bezier(0.4, 0, 1, 1),
    transform 140ms cubic-bezier(0.4, 0, 1, 1);
}
.compose-peek-enter-from,
.compose-peek-leave-to {
  opacity: 0;
  transform: translate3d(10px, 14px, 0) scale(0.88);
}

.neo-bottom-dock {
  position: fixed;
  right: max(10px, env(safe-area-inset-right));
  // Exposed so the suite panel can cap its height to the room above the dock.
  // --neo-feed-tabs-h is the board's pill strip (0 elsewhere / on desktop).
  --neo-dock-bottom: calc(
    var(--neo-mobile-nav-h, 56px) + var(--neo-feed-tabs-h, 0px) + env(safe-area-inset-bottom, 0px) +
      0.65rem
  );
  bottom: var(--neo-dock-bottom);
  z-index: var(--neo-z-shell-header, 90);
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: 0.5rem;
  pointer-events: none;
  max-width: min(22rem, calc(100vw - 20px));
  // Rides down with the auto-hiding tab bar (_structural.scss)
  transition: translate 240ms cubic-bezier(0.22, 1, 0.36, 1);

  &--subview {
    /* Tab bar hidden on focused mobile screens */
    --neo-dock-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.65rem);
  }

  /* Threads / chats pin a reply bar to the bottom — the waffle sat on Send */
  &--thread {
    @media (max-width: 1023px) {
      display: none;
    }
  }

  @media (max-width: 767px) {
    left: max(0.75rem, env(safe-area-inset-left));
    right: max(0.75rem, env(safe-area-inset-right));
    max-width: none;

    // Waffle shares the bottom row with the note FAB (bottom-left); the full-width
    // install banner stacks above both instead of sliding under the FAB.
    :deep(.suite-menu) {
      order: -1;
    }
  }

  .neo-layout--phone-landscape & {
    left: max(0.75rem, var(--neo-landscape-rail-w));
    --neo-dock-bottom: max(0.5rem, calc(env(safe-area-inset-bottom) + 0.35rem));
  }

  @media (min-width: 768px) {
    right: max(16px, env(safe-area-inset-right));
    --neo-dock-bottom: max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem));
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

  @media (min-width: 768px) {
    // The shell is already 100dvh; don't force main taller when the auth notice sits above it
    min-height: auto;
  }
  width: 100%;
  max-width: 100%;
  padding: 0.5rem;
  box-sizing: border-box;
  background: var(--neo-bg-primary);
  overscroll-behavior-x: none;

  /* Phone: fill remaining space between in-flow header + tab bar.
     The shell is viewport-locked, so `main` is the page's scroll container
     (search, groups, threads…). Only the column board opts out below. */
  @media (max-width: 767px) {
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
    padding: var(--neo-main-pad-top) max(0.5rem, env(safe-area-inset-right, 0px)) 0
      max(0.5rem, env(safe-area-inset-left, 0px));

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

  .neo-layout--phone-landscape & {
    @media (max-width: 1023px) {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding-left: 0.5rem;
      padding-right: max(0.5rem, env(safe-area-inset-right, 0px));

      .neo-layout--board & {
        overflow: hidden;
      }
    }
  }

  @media (min-width: 600px) and (max-width: 767px) {
    padding-left: max(1rem, env(safe-area-inset-left, 0px));
    padding-right: max(1rem, env(safe-area-inset-right, 0px));
  }

  @media (min-width: 768px) {
    display: block;
    height: auto;
    max-height: none;
    overflow: visible;
    padding: 1rem 1rem;
    margin-left: var(--neo-sidebar-width, 68px);
    transition: margin-left 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }

  @media (min-width: 1024px) {
    padding: 1.25rem 1.25rem;
  }

  @media (min-width: 1200px) {
    padding: 1.5rem 2rem;
  }

  .neo-layout--thread &,
  .neo-layout--profile &,
  .neo-layout--subview & {
    /* Nested screens: own top bar, no global header — keep pad-top 0 on iPad/desk
       so SubviewChrome can sit flush (safe-area is on the chrome itself). */
    --neo-main-pad-top: 0px;
    padding-top: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);

    @media (min-width: 768px) {
      padding-top: 0;
      padding-left: 1rem;
      padding-right: 1rem;
      padding-bottom: 1rem;
    }

    @media (min-width: 1024px) {
      padding-top: 0;
      padding-left: 1.25rem;
      padding-right: 1.25rem;
      padding-bottom: 1.25rem;
    }

    @media (min-width: 1200px) {
      padding-top: 0;
      padding-left: 2rem;
      padding-right: 2rem;
      padding-bottom: 1.5rem;
    }
  }

  /* Tab destinations keep MobileTabBar — leave room so the last rows aren't under it */
  .neo-layout--tab & {
    @media (max-width: 767px) {
      padding-bottom: calc(
        var(--neo-mobile-nav-h, 56px) + env(safe-area-inset-bottom, 0px) + 0.5rem
      );
    }
  }

  .neo-layout--phone-landscape.neo-layout--tab & {
    padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));
  }
}
</style>
