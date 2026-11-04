<script setup lang="ts">
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useColumnsStore, isTimelineFeed } from '~/stores/columns'
import { usePhoneLandscape, useSidebarShell } from '~/composables/useBreakpoint'
import { useActiveBoardColumnId } from '~/composables/useBoardNav'
import { useMobileDiscoverTab } from '~/composables/useMobileDiscoverTab'

const open = defineModel<boolean>('open', { default: false })

const instancesStore = useInstancesStore()
const notificationsStore = useNotificationsStore()
const conversationsStore = useConversationsStore()
const columnsStore = useColumnsStore()
const { boardPortal } = useBoardPortal()
const { openFeedOrRoute, boardColumnIs, goHome, openCompose } = useBoardNav()
const activeBoardColumnId = useActiveBoardColumnId()
const { discoverTab, preferDiscoverTab } = useMobileDiscoverTab()
const route = useRoute()
const { isActivity } = useActivityNav()
const isPhoneLandscape = usePhoneLandscape()
const isSidebarShell = useSidebarShell()

/** Slides away while reading, back on scroll up — portrait bottom bar only */
const navEl = ref<HTMLElement | null>(null)
useAutoHideNav(navEl)

const notifBadge = computed(() => notificationsStore.badgeLabel)
const messagesBadge = computed(() => conversationsStore.badgeLabel)

const activityActive = computed(
  () => isActivity.value || boardColumnIs('notifications') || boardPortal.value === 'activity',
)

const searchActive = computed(
  () =>
    route.path === '/explore' ||
    boardColumnIs('search') ||
    boardPortal.value === 'search',
)

const messagesActive = computed(
  () =>
    route.path === '/messages' ||
    boardColumnIs('messages') ||
    boardPortal.value === 'inbox',
)

const activeBoardColumn = computed(() => {
  const id = activeBoardColumnId.value || columnsStore.focusedColumnId
  if (id) {
    const match = columnsStore.columns.find((c) => c.id === id)
    if (match) return match
  }
  return columnsStore.columns[0] || null
})

/**
 * Home is focused only while you're actually in a timeline feed —
 * not Search / Messages / Activity / Profile / other board portals.
 */
const homeActive = computed(() => {
  if (route.path !== '/') return false
  if (boardPortal.value) return false
  if (
    boardColumnIs('messages') ||
    boardColumnIs('notifications') ||
    boardColumnIs('profile') ||
    boardColumnIs('search')
  ) {
    return false
  }
  const col = activeBoardColumn.value
  return !col || isTimelineFeed(col.feedType)
})

/** Prefer Messages in the tab when signed in and that was the last drawer pick. */
const showMessagesTab = computed(
  () =>
    instancesStore.hasAuthenticatedInstance && discoverTab.value === 'messages',
)

const openHome = () => {
  void goHome()
}

const openActivity = () => {
  void openFeedOrRoute('notifications', '/notifications')
}

const openSearch = () => {
  preferDiscoverTab('search')
  void openFeedOrRoute('search', '/explore')
}

const openMessages = () => {
  preferDiscoverTab('messages')
  void openFeedOrRoute('messages', '/messages')
}

const toggleMenu = () => {
  open.value = !open.value
}

watch(
  isPhoneLandscape,
  (on) => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('neo-phone-landscape', on)
  },
  { immediate: true },
)

onUnmounted(() => {
  document.documentElement.classList.remove('neo-phone-landscape')
})
</script>

<template>
<nav
  v-if="!isSidebarShell"
  ref="navEl"
  class="mobile-nav"
  :class="{ 'mobile-nav--landscape': isPhoneLandscape }"
  aria-label="Tabs"
>
  <template v-if="isPhoneLandscape">
    <button
      type="button"
      class="mobile-nav__item"
      :class="{ 'chrome-hint': boardPortal === 'settings' || boardPortal === 'communities' }"
      aria-label="Menu"
      :aria-expanded="open"
      aria-controls="mobile-sidebar"
      @click="toggleMenu"
    >
      <NeoIcon name="menu" :size="20" :stroke="1.75" />
    </button>
    <button
      v-if="showMessagesTab"
      type="button"
      class="mobile-nav__item mobile-nav__item--badge"
      :class="{
        active: messagesActive,
        'chrome-hint': boardPortal === 'inbox',
      }"
      :aria-label="messagesBadge ? `Messages, ${messagesBadge} unread` : 'Messages'"
      :aria-current="messagesActive ? 'page' : undefined"
      @click="openMessages"
    >
      <NeoIcon name="message" :size="20" :stroke="messagesActive || boardPortal === 'inbox' ? 2 : 1.75" />
      <span v-if="messagesBadge" class="nav-badge" aria-hidden="true">{{ messagesBadge }}</span>
    </button>
    <button
      v-else
      type="button"
      class="mobile-nav__item"
      :class="{
        active: searchActive,
        'chrome-hint': boardPortal === 'search',
      }"
      aria-label="Search"
      :aria-current="searchActive ? 'page' : undefined"
      @click="openSearch"
    >
      <NeoIcon name="search" :size="20" :stroke="searchActive || boardPortal === 'search' ? 2 : 1.75" />
    </button>
    <span class="mobile-nav__sep" aria-hidden="true" />
  </template>

  <!-- Home · Search|Messages · Compose · Activity · Profile -->
  <button
    type="button"
    class="mobile-nav__item"
    :class="{ active: homeActive }"
    aria-label="Home"
    :aria-current="homeActive ? 'page' : undefined"
    @click="openHome"
  >
    <NeoIcon name="home" :size="22" :stroke="homeActive ? 2 : 1.5" :filled="homeActive" />
  </button>

  <button
    v-if="showMessagesTab"
    type="button"
    class="mobile-nav__item mobile-nav__item--badge"
    :class="{
      active: messagesActive,
      'chrome-hint': boardPortal === 'inbox',
    }"
    :aria-label="messagesBadge ? `Messages, ${messagesBadge} unread` : 'Messages'"
    :aria-current="messagesActive ? 'page' : undefined"
    @click="openMessages"
  >
    <NeoIcon name="message" :size="22" :stroke="messagesActive || boardPortal === 'inbox' ? 2 : 1.5" />
    <span v-if="messagesBadge" class="nav-badge" aria-hidden="true">{{ messagesBadge }}</span>
  </button>
  <button
    v-else
    type="button"
    class="mobile-nav__item"
    :class="{
      active: searchActive,
      'chrome-hint': boardPortal === 'search',
    }"
    aria-label="Search"
    :aria-current="searchActive ? 'page' : undefined"
    @click="openSearch"
  >
    <NeoIcon name="search" :size="22" :stroke="searchActive || boardPortal === 'search' ? 2 : 1.5" />
  </button>

  <button
    v-if="instancesStore.hasAuthenticatedInstance"
    type="button"
    class="mobile-nav__item mobile-nav__compose"
    aria-label="New post"
    @click="openCompose()"
  >
    <span class="mobile-nav__compose-mark" aria-hidden="true">
      <NeoIcon name="edit" :size="20" :stroke="1.85" />
    </span>
  </button>
  <NuxtLink
    v-else
    to="/login"
    class="mobile-nav__item mobile-nav__compose"
    aria-label="New post — sign in"
  >
    <span class="mobile-nav__compose-mark" aria-hidden="true">
      <NeoIcon name="edit" :size="20" :stroke="1.85" />
    </span>
  </NuxtLink>

  <button
    v-if="instancesStore.hasAuthenticatedInstance"
    type="button"
    class="mobile-nav__item mobile-nav__item--badge"
    :class="{
      active: activityActive,
      'chrome-hint': boardPortal === 'activity',
    }"
    :aria-label="notifBadge ? `Activity, ${notifBadge} unread` : 'Activity'"
    :aria-current="activityActive ? 'page' : undefined"
    @click="openActivity"
  >
    <NeoIcon
      name="bell"
      :size="22"
      :stroke="activityActive || boardPortal === 'activity' ? 2 : 1.5"
    />
    <span v-if="notifBadge" class="nav-badge" aria-hidden="true">{{ notifBadge }}</span>
  </button>
  <NuxtLink
    v-else
    to="/groups"
    class="mobile-nav__item"
    :class="{
      active: route.path.startsWith('/groups'),
      'chrome-hint': boardPortal === 'communities',
    }"
    aria-label="Groups"
    :aria-current="route.path.startsWith('/groups') ? 'page' : undefined"
  >
    <NeoIcon name="users" :size="22" :stroke="route.path.startsWith('/groups') ? 2 : 1.5" />
  </NuxtLink>

  <AccountSwitcher
    v-if="instancesStore.hasAuthenticatedInstance"
    placement="nav"
    compact
    :class="{ 'chrome-hint': boardPortal === 'profile' }"
  />
  <NuxtLink
    v-else
    to="/login"
    class="mobile-nav__item"
    :class="{
      active: route.path === '/login',
      'chrome-hint': boardPortal === 'profile',
    }"
    aria-label="Sign in"
    :aria-current="route.path === '/login' ? 'page' : undefined"
  >
    <NeoIcon name="user" :size="22" :stroke="1.5" />
  </NuxtLink>
</nav>
</template>

<style lang="scss" scoped>
/* Nav is the last flex child — negative top margin frees space for main above it */
:global(html.neo-nav-collapsed .mobile-nav:not(.mobile-nav--landscape)) {
  position: relative;
  margin-top: calc(-1 * var(--neo-nav-live-h, 56px));
}

.mobile-nav {
  position: relative;
  flex-shrink: 0;
  width: 100%;
  min-height: var(--neo-mobile-nav-h, 56px);
  height: auto;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0.2rem 0.35rem;
  padding-bottom: max(0.35rem, env(safe-area-inset-bottom, 0px));
  background: var(--neo-bg-primary);
  border-top: 1px solid var(--neo-border-color);
  z-index: var(--neo-z-shell-header, 90);
  box-sizing: border-box;
  padding-left: max(0.35rem, env(safe-area-inset-left, 0px));
  padding-right: max(0.35rem, env(safe-area-inset-right, 0px));

  @media (min-width: 768px) {
    display: none;
  }

  &--landscape {
    order: -1;
    align-self: stretch;
    width: var(--neo-landscape-rail-w, 52px);
    min-width: var(--neo-landscape-rail-w, 52px);
    max-width: var(--neo-landscape-rail-w, 52px);
    min-height: 0;
    height: auto;
    flex-direction: column;
    justify-content: flex-start;
    gap: 0.15rem;
    padding: max(0.35rem, env(safe-area-inset-top, 0px)) 0.2rem
      max(0.35rem, env(safe-area-inset-bottom, 0px));
    padding-left: max(0.2rem, env(safe-area-inset-left, 0px));
    border-top: none;
    border-right: 1px solid var(--neo-border-color);

    .mobile-nav__item {
      width: 44px;
      height: 40px;
    }

    .mobile-nav__compose-mark {
      width: 36px;
      height: 28px;
    }
  }

  &__sep {
    display: block;
    width: 28px;
    height: 1px;
    margin: 0.25rem 0;
    background: var(--neo-border-color);
    flex-shrink: 0;
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 44px;
    color: var(--neo-text-secondary);
    text-decoration: none;
    background: transparent;
    border: none;
    border-radius: var(--neo-radius-sm, 4px);
    transition:
      color var(--neo-transition-fast),
      background-color var(--neo-transition-fast),
      transform var(--neo-dur-quick, 160ms) var(--neo-ease-spring);
    position: relative;
    cursor: pointer;
    flex-shrink: 0;

    :deep(.neo-icon) {
      transition: transform var(--neo-dur-normal, 240ms) var(--neo-ease-spring);
    }

    &:active {
      background: var(--neo-bg-hover);
      transition-duration: var(--neo-dur-instant, 90ms);
      transform: scale3d(var(--neo-press-squash-x, 1.07), var(--neo-press-squash-y, 0.9), 1);

      :deep(.neo-icon) {
        transform: scale(0.88) translateY(1px);
      }
    }

    &.active {
      color: var(--neo-accent);
      background: var(--neo-accent-soft);

      :deep(.neo-icon) {
        transform: translateY(-1px) scale(1.06);
      }
    }
  }

  &__compose {
    color: var(--neo-text-primary);

    &:focus-visible .mobile-nav__compose-mark {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
    }

    &:active .mobile-nav__compose-mark {
      transform: scale3d(var(--neo-press-squash-x, 1.08), var(--neo-press-squash-y, 0.88), 1);
      background: var(--neo-bg-hover);
    }
  }

  &__compose-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 34px;
    border-radius: 12px;
    border: 1.5px solid var(--neo-border-strong, var(--neo-border-color));
    background: var(--neo-bg-secondary);
    color: var(--neo-text-primary);
    transition:
      transform var(--neo-dur-quick, 160ms) var(--neo-ease-spring),
      background-color var(--neo-dur-quick, 160ms) var(--neo-ease-out),
      border-color var(--neo-dur-quick, 160ms) var(--neo-ease-out);
  }
}
</style>
