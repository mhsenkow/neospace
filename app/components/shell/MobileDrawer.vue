<script setup lang="ts">
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useGroupsStore } from '~/stores/groups'
import { useSettingsStore } from '~/stores/settings'
import { useThemeStore } from '~/stores/theme'
import { useOverlayStore } from '~/stores/overlay'
import { useAccountsManager } from '~/composables/useAccountsManager'
import { categoryTint, useShellAppearance } from '~/composables/useShellAppearance'

const open = defineModel<boolean>('open', { default: false })

const instancesStore = useInstancesStore()
const notificationsStore = useNotificationsStore()
const conversationsStore = useConversationsStore()
const groupsStore = useGroupsStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const overlayStore = useOverlayStore()
const { open: openAccounts } = useAccountsManager()
const { boardPortal } = useBoardPortal()
const { currentThemeLabel, cycleTheme } = useShellAppearance()
const router = useRouter()

const notifBadge = computed(() => notificationsStore.badgeLabel)
const messagesBadge = computed(() => conversationsStore.badgeLabel)

const sidebarJoinedGroups = computed(() => groupsStore.joinedGroups.slice(0, 12))
const sidebarSuggestedGroups = computed(() => groupsStore.suggestedFeaturedGroups.slice(0, 6))

const instanceHost = computed(() => {
  const url = instancesStore.instanceUrl
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '')
  }
})

const closeMobileMenu = () => {
  open.value = false
}

const openGroupFromMenu = (tag: string) => {
  closeMobileMenu()
  router.push(`/groups/${tag}`)
}

const openSettingsFromDrawer = async () => {
  closeMobileMenu()
  await nextTick()
  settingsStore.open()
}

const handleLogout = async () => {
  const ok = await overlayStore.openConfirm({
    title: 'Sign out?',
    body: 'Sign out of this account? You can keep browsing public posts.',
    confirmLabel: 'Sign out',
    danger: true,
  })
  if (!ok) return
  closeMobileMenu()
  await instancesStore.logout()
  themeStore.setUserCustomCSS('')
  themeStore.disableChaosMode()
  router.push('/login')
}

watch(open, async (isOpen) => {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('neo-dialog-open', isOpen)
  }
  if (!isOpen) return
  if (groupsStore.groups.length === 0) {
    await groupsStore.initializeGroups()
  }
})

const mobileSidebarRef = ref<HTMLElement | null>(null)
useFocusTrap(mobileSidebarRef, open, {
  onEscape: closeMobileMenu,
  initialFocus: '.mobile-sidebar__close',
})
</script>

<template>
<Transition name="fade">
  <div v-show="open" class="mobile-overlay" @click="closeMobileMenu"></div>
</Transition>

<Transition name="slide">
  <div
    v-show="open"
    id="mobile-sidebar"
    ref="mobileSidebarRef"
    class="mobile-sidebar"
    role="dialog"
    aria-modal="true"
    aria-label="Menu"
  >
    <div class="mobile-sidebar__header">
      <NuxtLink to="/" class="mobile-sidebar__logo" @click="closeMobileMenu">
        <span class="mobile-sidebar__mark">ns</span>
        neospace
      </NuxtLink>
      <button class="mobile-sidebar__close" @click="closeMobileMenu" type="button" aria-label="Close menu">
        <NeoIcon name="x" :size="18" :stroke="2" />
      </button>
    </div>

    <nav class="mobile-sidebar__nav" aria-label="Main menu">
      <NuxtLink to="/" class="mobile-sidebar__link" @click="closeMobileMenu">Home</NuxtLink>
      <NuxtLink
        to="/explore"
        class="mobile-sidebar__link"
        :class="{ 'chrome-hint': boardPortal === 'search' }"
        @click="closeMobileMenu"
      >Search</NuxtLink>
      <NuxtLink
        to="/groups"
        class="mobile-sidebar__link"
        :class="{ 'chrome-hint': boardPortal === 'communities' }"
        @click="closeMobileMenu"
      >Groups</NuxtLink>
      <NuxtLink
        v-if="instancesStore.hasAuthenticatedInstance"
        to="/messages"
        class="mobile-sidebar__link"
        :class="{ 'chrome-hint': boardPortal === 'inbox' }"
        @click="closeMobileMenu"
      >
        Messages
        <span v-if="messagesBadge" class="nav-badge nav-badge--inline">
          {{ messagesBadge }}<span class="sr-only"> unread</span>
        </span>
      </NuxtLink>
      <NuxtLink
        v-if="instancesStore.hasAuthenticatedInstance"
        to="/notifications"
        class="mobile-sidebar__link"
        :class="{ 'chrome-hint': boardPortal === 'activity' }"
        @click="closeMobileMenu"
      >
        Activity
        <span v-if="notifBadge" class="nav-badge nav-badge--inline">
          {{ notifBadge }}<span class="sr-only"> unread</span>
        </span>
      </NuxtLink>
    </nav>

    <div
      v-if="!instancesStore.hasAuthenticatedInstance"
      class="mobile-sidebar__guest"
    >
      <p class="mobile-sidebar__guest-title">Browsing as a guest</p>
      <p class="mobile-sidebar__guest-body">
        Public posts work without an account. Sign in to post, follow people, and join groups.
      </p>
      <NuxtLink
        to="/login"
        class="mobile-sidebar__guest-cta"
        @click="closeMobileMenu"
      >
        Sign in
      </NuxtLink>
    </div>

    <!-- Threads-style communities hub in the side panel -->
    <section
      v-if="sidebarJoinedGroups.length || sidebarSuggestedGroups.length"
      class="mobile-sidebar__groups"
    >
      <div v-if="sidebarJoinedGroups.length" class="mobile-sidebar__groups-block">
        <div class="mobile-sidebar__groups-head">
          <h2 class="mobile-sidebar__groups-title">Your groups</h2>
          <NuxtLink to="/groups" class="mobile-sidebar__groups-all" @click="closeMobileMenu">
            See all
          </NuxtLink>
        </div>
        <ul class="mobile-sidebar__group-chips">
          <li v-for="group in sidebarJoinedGroups" :key="group.tag">
            <button
              type="button"
              class="mobile-sidebar__group-chip"
              @click="openGroupFromMenu(group.tag)"
            >
              <span
                class="mobile-sidebar__group-icon"
                :style="{ backgroundColor: categoryTint(group.category) }"
              >
                {{ group.icon }}
              </span>
              <span class="mobile-sidebar__group-name">{{ group.name }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="sidebarSuggestedGroups.length" class="mobile-sidebar__groups-block">
        <div class="mobile-sidebar__groups-head">
          <h2 class="mobile-sidebar__groups-title">Suggested</h2>
        </div>
        <ul class="mobile-sidebar__suggest-list">
          <li v-for="group in sidebarSuggestedGroups" :key="`s-${group.tag}`">
            <button
              type="button"
              class="mobile-sidebar__suggest"
              @click="openGroupFromMenu(group.tag)"
            >
              <span
                class="mobile-sidebar__suggest-icon"
                :style="{ backgroundColor: categoryTint(group.category) }"
              >
                {{ group.icon }}
              </span>
              <span class="mobile-sidebar__suggest-text">
                <span class="mobile-sidebar__suggest-name">{{ group.name }}</span>
                <span class="mobile-sidebar__suggest-tag">#{{ group.tag }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <div class="mobile-sidebar__spacer"></div>

    <div class="mobile-sidebar__footer">
      <button
        class="mobile-sidebar__action mobile-sidebar__action--theme"
        :class="{ 'chrome-hint': boardPortal === 'settings' }"
        type="button"
        :aria-label="`Theme: ${currentThemeLabel}`"
        @click="cycleTheme"
      >
        <ThemeSwatch :label="`Theme: ${currentThemeLabel}`" />
        <span>Theme · {{ currentThemeLabel }}</span>
      </button>
      <button
        class="mobile-sidebar__action"
        :class="{ 'chrome-hint': boardPortal === 'settings' }"
        @click="openSettingsFromDrawer"
        type="button"
      >
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
              Posting as · {{ instanceHost }}
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
  </div>
</Transition>
</template>

<style lang="scss" scoped>
.mobile-overlay {
  position: fixed;
  inset: 0;
  background: var(--neo-bg-overlay);
  z-index: var(--neo-z-shell-overlay, 95);

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
  z-index: var(--neo-z-shell-nav, 100);
  overflow-y: auto;

  :focus-visible {
    outline-offset: -2px;
  }

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
    border-radius: var(--neo-radius-sm, 2px);
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
    border-radius: var(--neo-radius-sm, 4px);

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
    border-radius: var(--neo-radius-sm, 4px);
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

  &__guest {
    margin: 0.35rem 0.75rem 0.75rem;
    padding: 0.85rem 0.9rem;
    border-radius: var(--neo-radius-xl, 10px);
    background: var(--neo-accent-soft);
    border: 1px solid color-mix(in srgb, var(--neo-accent) 28%, transparent);
  }

  &__guest-title {
    margin: 0 0 0.25rem;
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--neo-text-primary);
  }

  &__guest-body {
    margin: 0 0 0.75rem;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--neo-text-secondary);
  }

  &__guest-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    padding: 0.4rem 0.9rem;
    border-radius: var(--neo-radius-full, 999px);
    background: var(--neo-accent);
    color: var(--neo-text-inverse);
    font-size: 0.8125rem;
    font-weight: 600;
    text-decoration: none;
  }

  &__groups {
    padding: 0.25rem 0.75rem 0.75rem;
    border-top: 1px solid var(--neo-border-color);
    margin-top: 0.25rem;
  }

  &__groups-block + &__groups-block {
    margin-top: 1rem;
  }

  &__groups-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.25rem 0.55rem;
  }

  &__groups-title {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--neo-text-muted);
  }

  &__groups-all {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-link);
    text-decoration: none;

    &:hover {
      color: var(--neo-text-link-hover);
    }
  }

  &__group-chips {
    display: flex;
    gap: 0.55rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 0.1rem 0.15rem 0.35rem;
    list-style: none;
    margin: 0;

    > li {
      list-style: none;
      margin: 0;
      padding: 0;
      flex: 0 0 auto;
    }

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__group-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    width: 4.25rem;
    flex: 0 0 auto;
    padding: 0.25rem;
    border: none;
    border-radius: var(--neo-radius-sm, 4px);
    background: transparent;
    cursor: pointer;
    color: inherit;
    -webkit-tap-highlight-color: transparent;

    &:active {
      background: var(--neo-bg-hover);
    }
  }

  &__group-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    border: 1.5px solid var(--neo-border-color);
    background: var(--neo-bg-secondary);
  }

  &__group-name {
    font-size: max(0.6875rem, 11px);
    font-weight: 600;
    color: var(--neo-text-primary);
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.2;
  }

  &__suggest-list {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    list-style: none;
    margin: 0;
    padding: 0;

    > li {
      list-style: none;
      margin: 0;
      padding: 0;
    }
  }

  &__suggest {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.45rem 0.35rem;
    border: none;
    border-radius: var(--neo-radius-xl, 8px);
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: inherit;

    &:hover,
    &:active {
      background: var(--neo-bg-hover);
    }
  }

  &__suggest-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--neo-radius-xl, 10px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.05rem;
    flex-shrink: 0;
  }

  &__suggest-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
  }

  &__suggest-name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__suggest-tag {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
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
    border-radius: var(--neo-radius-sm, 4px);
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

    &--theme {
      gap: 0.65rem;
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
    border-radius: var(--neo-radius-sm, 2px);
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
</style>
