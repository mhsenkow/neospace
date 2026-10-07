<script setup lang="ts">
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useColumnsStore } from '~/stores/columns'

const instancesStore = useInstancesStore()
const notificationsStore = useNotificationsStore()
const conversationsStore = useConversationsStore()
const composeSheet = useComposeSheetStore()
const columnsStore = useColumnsStore()
const { boardPortal } = useBoardPortal()
const router = useRouter()
const route = useRoute()
const { path, isActivity } = useActivityNav()

const notifBadge = computed(() => notificationsStore.badgeLabel)
const messagesBadge = computed(() => conversationsStore.badgeLabel)

const openCompose = () => {
  if (!instancesStore.isAuthenticated) {
    router.push('/login')
    return
  }
  const routeTag =
    route.path.startsWith('/groups/') && route.params.tag
      ? String(route.params.tag)
      : null
  const focused = columnsStore.focusedColumn
  const columnTag =
    focused?.feedType === 'group' && focused.groupTag ? focused.groupTag : null
  composeSheet.show({
    groupTag: routeTag || columnTag || undefined,
  })
}
</script>

<template>
<nav class="mobile-nav" aria-label="Tabs">
  <NuxtLink
    to="/"
    class="mobile-nav__item"
    :class="{ active: route.path === '/' }"
    aria-label="Home"
    :aria-current="route.path === '/' ? 'page' : undefined"
  >
    <NeoIcon name="home" :size="22" :stroke="route.path === '/' ? 2 : 1.5" :filled="route.path === '/'" />
    <span class="mobile-nav__label">Home</span>
  </NuxtLink>

  <NuxtLink
    v-if="instancesStore.hasAuthenticatedInstance"
    to="/messages"
    class="mobile-nav__item mobile-nav__item--badge"
    :class="{
      active: path === '/messages',
      'chrome-hint': boardPortal === 'inbox',
    }"
    :aria-label="messagesBadge ? `Messages, ${messagesBadge} unread` : 'Messages'"
    :aria-current="path === '/messages' ? 'page' : undefined"
  >
    <NeoIcon
      name="message"
      :size="22"
      :stroke="path === '/messages' || boardPortal === 'inbox' ? 2 : 1.5"
      :filled="path === '/messages'"
    />
    <span class="mobile-nav__label">Inbox</span>
    <span v-if="messagesBadge" class="nav-badge" aria-hidden="true">{{ messagesBadge }}</span>
  </NuxtLink>
  <NuxtLink
    v-else
    to="/login"
    class="mobile-nav__item"
    :class="{
      active: path === '/login',
      'chrome-hint': boardPortal === 'inbox',
    }"
    aria-label="Messages — sign in"
  >
    <NeoIcon name="message" :size="22" :stroke="boardPortal === 'inbox' ? 2 : 1.5" />
    <span class="mobile-nav__label">Inbox</span>
  </NuxtLink>

  <button
    type="button"
    class="mobile-nav__item mobile-nav__compose"
    aria-label="New post"
    @click="openCompose"
  >
    <span class="mobile-nav__compose-mark">
      <NeoIcon name="plus" :size="22" :stroke="2" />
    </span>
    <span class="mobile-nav__label">Post</span>
  </button>

  <NuxtLink
    v-if="instancesStore.hasAuthenticatedInstance"
    to="/notifications"
    class="mobile-nav__item mobile-nav__item--badge"
    :class="{
      active: isActivity,
      'chrome-hint': boardPortal === 'activity',
    }"
    :aria-label="notifBadge ? `Activity, ${notifBadge} unread` : 'Activity'"
    :aria-current="isActivity ? 'page' : undefined"
  >
    <NeoIcon
      name="heart"
      :size="22"
      :stroke="isActivity || boardPortal === 'activity' ? 2 : 1.5"
      :filled="isActivity"
    />
    <span class="mobile-nav__label">Activity</span>
    <span v-if="notifBadge" class="nav-badge" aria-hidden="true">{{ notifBadge }}</span>
  </NuxtLink>
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
    <span class="mobile-nav__label">Groups</span>
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
  >
    <NeoIcon name="user" :size="22" :stroke="1.5" />
    <span class="mobile-nav__label">You</span>
  </NuxtLink>
</nav>
</template>

<style lang="scss" scoped>
.mobile-nav {
  // In-flow flex child of .neo-layout — fixed chrome was clipped by iOS Safari
  // when the parent used overflow:hidden (DevTools emulation did not reproduce it).
  position: relative;
  flex-shrink: 0;
  width: 100%;
  height: calc(var(--neo-mobile-nav-h, 64px) + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: flex-start;
  justify-content: space-around;
  padding: 4px 0.35rem 0;
  padding-bottom: env(safe-area-inset-bottom, 0);
  background: var(--neo-bg-primary);
  border-top: 1px solid var(--neo-border-color);
  z-index: var(--neo-z-shell-header, 90);
  box-sizing: border-box;

  @media (min-width: 1024px) {
    display: none;
  }

  &__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
    width: 52px;
    min-height: 52px;
    padding-top: 4px;
    color: var(--neo-text-secondary);
    text-decoration: none;
    background: transparent;
    border: none;
    border-radius: var(--neo-radius-sm, 4px);
    transition: color var(--neo-transition-fast), background-color var(--neo-transition-fast);
    position: relative;
    cursor: pointer;

    &.active {
      color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }

    &--avatar {
      padding: 4px;

      &.active .mobile-nav__avatar {
        border-color: var(--neo-accent);
        box-shadow: 0 0 0 1.5px var(--neo-accent);
      }
    }
  }

  &__label {
    font-size: max(0.6875rem, 11px);
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }

  &__compose {
    color: var(--neo-text-secondary);

    &.active,
    &:focus-visible {
      color: var(--neo-accent);
    }

    &:active .mobile-nav__compose-mark {
      transform: scale(0.94);
    }
  }

  &__compose-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 28px;
    border-radius: var(--neo-radius-xl, 10px);
    background: var(--neo-accent);
    color: var(--neo-text-on-accent, var(--neo-text-inverse));
    transition: transform 0.12s ease, background 0.12s ease;
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

.nav-badge {
  position: absolute;
  top: 4px;
  right: 2px;
  min-width: 1.15rem;
  height: 1.15rem;
  padding: 0 0.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--neo-font-family-ui);
  font-size: max(0.6875rem, 11px);
  font-weight: 700;
  line-height: 1;
  color: var(--neo-text-on-accent, var(--neo-text-inverse));
  background: var(--neo-accent);
  border-radius: var(--neo-radius-sm, 2px);
  pointer-events: none;

  &--inline {
    position: static;
    margin-left: 0.4rem;
    min-width: 1.15rem;
    height: 1.15rem;
    font-size: max(0.6875rem, 11px);
  }
}

/* Edge-portal cue: pulse the matching chrome control */
.chrome-hint {
  color: var(--neo-accent) !important;
  background: var(--neo-accent-soft) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--neo-accent) 45%, transparent);
  animation: chrome-hint-pulse 1.6s ease-in-out infinite;
}

:deep(.acct-switch.chrome-hint .acct-switch__trigger) {
  color: var(--neo-accent);
  background: var(--neo-accent-soft);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--neo-accent) 45%, transparent);
  animation: chrome-hint-pulse 1.6s ease-in-out infinite;
  border-radius: var(--neo-radius-sm, 4px);
}

@keyframes chrome-hint-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--neo-accent) 35%, transparent);
  }
  50% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--neo-accent) 22%, transparent);
  }
}
</style>
