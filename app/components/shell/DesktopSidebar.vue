<script setup lang="ts">
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useColumnsStore } from '~/stores/columns'
import { useGroupsStore } from '~/stores/groups'
import { useSettingsStore } from '~/stores/settings'
import { useAccountsManager } from '~/composables/useAccountsManager'
import {
  useShellAppearance,
  categoryTint,
} from '~/composables/useShellAppearance'

const instancesStore = useInstancesStore()
const notificationsStore = useNotificationsStore()
const conversationsStore = useConversationsStore()
const composeSheet = useComposeSheetStore()
const columnsStore = useColumnsStore()
const groupsStore = useGroupsStore()
const settingsStore = useSettingsStore()
const { open: openAccounts } = useAccountsManager()
const { show: openFeedback } = useFeedbackNotes()
const router = useRouter()
const route = useRoute()
const path = computed(() => route.path.replace(/\/+$/, '') || '/')
const isHome = computed(() => path.value === '/' && !columnsStore.focusedColumnId)
const isActivity = computed(
  () => path.value === '/notifications' && route.query.filter !== 'mention',
)
const isMentions = computed(
  () => path.value === '/notifications' && route.query.filter === 'mention',
)

const notifBadge = computed(() => notificationsStore.badgeLabel)
const messagesBadge = computed(() => conversationsStore.badgeLabel)

const {
  sidebarRail,
  lookOpen,
  lookAnnounce,
  toggleSidebarRail: toggleRailCore,
  currentThemeLabel,
  currentUiLabel,
  currentRadiusLabel,
  currentDensityLabel,
  currentLineLabel,
  cycleTheme,
  cycleUi,
  cycleRadius,
  cycleDensity,
  cycleLine,
  densityTitle,
  densityLabel,
} = useShellAppearance()

const groupsShowAll = ref(false)
const inboxMenuOpen = ref(false)

const sidebarJoinedGroups = computed(() => groupsStore.joinedGroups.slice(0, 12))
const sidebarSuggestedGroups = computed(() => groupsStore.suggestedFeaturedGroups.slice(0, 6))
const visibleJoinedGroups = computed(() =>
  groupsShowAll.value ? sidebarJoinedGroups.value : sidebarJoinedGroups.value.slice(0, 5),
)
const visibleSuggestedGroups = computed(() =>
  groupsShowAll.value ? sidebarSuggestedGroups.value : sidebarSuggestedGroups.value.slice(0, 4),
)
const showSidebarSuggested = computed(
  () => sidebarSuggestedGroups.value.length > 0 && sidebarJoinedGroups.value.length < 4,
)
const groupsCanToggle = computed(
  () =>
    sidebarJoinedGroups.value.length > 5 ||
    (showSidebarSuggested.value && sidebarSuggestedGroups.value.length > 4),
)
const inboxActive = computed(
  () => path.value === '/messages' || path.value === '/notifications',
)
const inboxBadge = computed(() => messagesBadge.value || notifBadge.value || '')

const toggleSidebarRail = () => {
  inboxMenuOpen.value = false
  toggleRailCore()
}

const closeInboxMenu = () => {
  inboxMenuOpen.value = false
}

const openDirectMessages = () => {
  closeInboxMenu()
  router.push('/messages')
}

const openMentions = () => {
  closeInboxMenu()
  notificationsStore.setFilter('mention')
  router.push({ path: '/notifications', query: { filter: 'mention' } })
}

const openDesktopGroup = (tag: string) => {
  router.push(`/groups/${tag}`)
}

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

const onHomeClick = () => {
  columnsStore.clearColumnFocus()
}

watch(
  () => route.fullPath,
  () => {
    closeInboxMenu()
  },
)
</script>

<template>
<div
  class="sidebar"
  :class="{ 'sidebar--rail': sidebarRail }"
>
  <div class="sidebar__top">
    <NuxtLink
      to="/"
      class="sidebar__logo"
      :class="{ 'sidebar__logo--on': isHome }"
      aria-label="neospace home"
      @click="onHomeClick"
    >
      <NeoMark :active="isHome" />
    </NuxtLink>
    <div class="sidebar__top-actions">
      <NuxtLink
        v-if="instancesStore.hasAuthenticatedInstance"
        to="/notifications"
        class="sidebar__icon-btn"
        :class="{ 'sidebar__icon-btn--active': isActivity }"
        :aria-label="notifBadge ? `Activity, ${notifBadge} unread` : 'Activity'"
        :aria-current="isActivity ? 'page' : undefined"
      >
        <NeoIcon
          name="heart"
          :size="20"
          :stroke="isActivity ? 2 : 1.75"
          :filled="isActivity"
        />
        <span v-if="notifBadge" class="nav-badge nav-badge--corner" aria-hidden="true">{{ notifBadge }}</span>
      </NuxtLink>
      <button
        type="button"
        class="sidebar__icon-btn"
        :title="sidebarRail ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-label="sidebarRail ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-pressed="sidebarRail"
        @click="toggleSidebarRail"
      >
        <NeoIcon name="menu" :size="18" :stroke="1.75" />
      </button>
    </div>
  </div>

  <div class="sidebar__scroll">
    <nav class="sidebar__nav" aria-label="Main menu">
      <div class="sidebar__home">
        <NuxtLink
          v-if="!sidebarRail"
          to="/"
          class="sidebar__link sidebar__link--home"
          :class="{ active: isHome }"
          :aria-current="isHome ? 'page' : undefined"
          @click="onHomeClick"
        >
          <NeoIcon
            name="home"
            :size="22"
            :stroke="isHome ? 2 : 1.5"
            :filled="isHome"
          />
          <span class="sidebar__label">Home</span>
        </NuxtLink>
        <button
          v-if="instancesStore.hasAuthenticatedInstance"
          type="button"
          class="sidebar__home-plus"
          title="New post"
          aria-label="New post"
          @click="openCompose"
        >
          <NeoIcon name="plus" :size="sidebarRail ? 20 : 16" :stroke="2.25" />
        </button>
      </div>

      <NuxtLink
        to="/explore"
        class="sidebar__link"
        :class="{ active: route.path === '/explore' }"
        title="Search servers and people"
        :aria-current="route.path === '/explore' ? 'page' : undefined"
      >
        <NeoIcon name="search" :size="22" :stroke="route.path === '/explore' ? 2 : 1.5" />
        <span class="sidebar__label">Search</span>
      </NuxtLink>

      <NeoMenu
        v-if="instancesStore.hasAuthenticatedInstance"
        v-model:open="inboxMenuOpen"
        class="sidebar__inbox"
        :class="{ 'sidebar__inbox--active': inboxActive }"
        :label="inboxBadge ? `Inbox, ${inboxBadge} unread` : 'Inbox — messages and mentions'"
        teleport
        :placement="sidebarRail ? 'end' : 'bottom'"
        align="start"
      >
        <span
          class="sidebar__link sidebar__link--badge"
          :class="{ active: inboxActive }"
          :title="inboxBadge ? `Inbox (${inboxBadge} unread)` : 'Inbox'"
        >
          <NeoIcon
            name="send"
            :size="22"
            :stroke="inboxActive ? 2 : 1.5"
            :filled="route.path === '/messages'"
          />
          <span class="sidebar__label">Inbox</span>
          <span v-if="inboxBadge" class="nav-badge" aria-hidden="true">{{ inboxBadge }}</span>
        </span>
        <template #items>
          <button
            type="button"
            role="menuitem"
            :aria-current="route.path === '/messages' ? 'page' : undefined"
            @click="openDirectMessages"
          >
            <NeoIcon name="message" :size="16" :stroke="1.75" />
            <span>Direct messages</span>
          </button>
          <button
            type="button"
            role="menuitem"
            :aria-current="isMentions ? 'page' : undefined"
            @click="openMentions"
          >
            <NeoIcon name="mention" :size="16" :stroke="1.75" />
            <span>Mentions</span>
          </button>
        </template>
      </NeoMenu>

      <NuxtLink
        to="/profile"
        class="sidebar__link"
        :class="{ active: route.path === '/profile' }"
        title="Profile"
        :aria-current="route.path === '/profile' ? 'page' : undefined"
      >
        <NeoIcon name="user" :size="22" :stroke="route.path === '/profile' ? 2 : 1.5" />
        <span class="sidebar__label">Profile</span>
      </NuxtLink>
    </nav>

    <section
      v-if="visibleJoinedGroups.length || showSidebarSuggested"
      class="sidebar__section"
      aria-label="Groups"
    >
      <div class="sidebar__section-head">
        <h2 class="sidebar__section-title">Groups</h2>
        <NuxtLink to="/groups" class="sidebar__section-action" title="All groups">All</NuxtLink>
      </div>

      <ul v-if="visibleJoinedGroups.length" class="sidebar__section-list">
        <li v-for="group in visibleJoinedGroups" :key="`joined-${group.tag}`">
          <button
            type="button"
            class="sidebar__row"
            :title="group.name"
            @click="openDesktopGroup(group.tag)"
          >
            <span
              class="sidebar__row-icon"
              :style="{ background: categoryTint(group.category) }"
              aria-hidden="true"
            >{{ group.icon }}</span>
            <span class="sidebar__label">{{ group.name }}</span>
          </button>
        </li>
      </ul>

      <ul v-if="showSidebarSuggested" class="sidebar__section-list">
        <li v-if="!visibleJoinedGroups.length" class="sidebar__section-hint-li">
          <p class="sidebar__section-hint">Suggested</p>
        </li>
        <li v-for="group in visibleSuggestedGroups" :key="`suggest-${group.tag}`">
          <button
            type="button"
            class="sidebar__row"
            :title="group.name"
            @click="openDesktopGroup(group.tag)"
          >
            <span
              class="sidebar__row-icon"
              :style="{ background: categoryTint(group.category) }"
              aria-hidden="true"
            >{{ group.icon }}</span>
            <span class="sidebar__label">{{ group.name }}</span>
          </button>
        </li>
      </ul>

      <button
        v-if="groupsCanToggle"
        type="button"
        class="sidebar__more"
        :aria-expanded="groupsShowAll"
        @click="groupsShowAll = !groupsShowAll"
      >
        {{ groupsShowAll ? 'Show less' : 'Show more' }}
      </button>
    </section>

    <section class="sidebar__section" aria-label="Board">
      <div class="sidebar__section-head">
        <h2 class="sidebar__section-title">Board</h2>
      </div>
      <button
        type="button"
        class="sidebar__row"
        :class="{
          'sidebar__row--on': columnsStore.deskDensity !== 'packed',
          'sidebar__density--roomy': columnsStore.deskDensity === 'roomy',
          'sidebar__density--tabs': columnsStore.deskDensity === 'tabs',
        }"
        :title="densityTitle"
        :aria-label="`Board density: ${densityLabel}. Click to cycle.`"
        :aria-describedby="'sidebar-density-desc'"
        @click="columnsStore.toggleDeskDensity()"
      >
        <span class="sidebar__row-glyph density-glyph" aria-hidden="true">
          <span class="density-glyph__packed"><i /><i /><i /><i /><i /><i /><i /><i /></span>
          <span class="density-glyph__roomy"><i /><i /><i /><i /></span>
          <span class="density-glyph__tabs"><i /></span>
        </span>
        <span class="sidebar__label">{{ densityLabel }}</span>
      </button>
      <p id="sidebar-density-desc" class="sr-only">{{ densityTitle }}</p>
    </section>

    <section class="sidebar__section sidebar__section--look" aria-label="Look">
      <div class="sidebar__section-head">
        <h2 class="sidebar__section-title">Look</h2>
        <button
          type="button"
          class="sidebar__section-action"
          :aria-expanded="lookOpen"
          aria-controls="sidebar-look-controls"
          :aria-label="lookOpen ? 'Hide look controls' : 'Show look controls'"
          @click="lookOpen = !lookOpen"
        >
          {{ lookOpen ? 'Hide' : 'Try' }}
        </button>
      </div>
      <p v-if="!lookOpen" class="sidebar__look-desc">
        Theme, chrome, corners, density, lines.
      </p>
      <p class="sr-only" aria-live="polite">{{ lookAnnounce }}</p>

      <div v-show="lookOpen" id="sidebar-look-controls" class="sidebar__section-list">
        <button
          type="button"
          class="sidebar__row"
          :aria-label="`Theme: ${currentThemeLabel}. Click to cycle.`"
          @click="cycleTheme"
        >
          <ThemeSwatch :label="`Theme: ${currentThemeLabel}`" />
          <span class="sidebar__label">{{ currentThemeLabel }}</span>
        </button>
        <button
          type="button"
          class="sidebar__row"
          :title="`Chrome: ${currentUiLabel}`"
          aria-label="Chrome"
          @click="cycleUi"
        >
          <span class="sidebar__chrome-mark" aria-hidden="true">Aa</span>
          <span class="sidebar__label">{{ currentUiLabel }}</span>
        </button>
        <button
          type="button"
          class="sidebar__row"
          :title="`Corners: ${currentRadiusLabel}`"
          aria-label="Corners"
          @click="cycleRadius"
        >
          <span class="sidebar__radius-mark" aria-hidden="true" />
          <span class="sidebar__label">{{ currentRadiusLabel }}</span>
        </button>
        <button
          type="button"
          class="sidebar__row"
          :title="`Density: ${currentDensityLabel}`"
          aria-label="Density"
          @click="cycleDensity"
        >
          <span class="sidebar__spacing-mark" aria-hidden="true"><i /><i /><i /></span>
          <span class="sidebar__label">{{ currentDensityLabel }}</span>
        </button>
        <button
          type="button"
          class="sidebar__row"
          :title="`Lines: ${currentLineLabel}`"
          aria-label="Lines"
          @click="cycleLine"
        >
          <span class="sidebar__line-mark" aria-hidden="true" />
          <span class="sidebar__label">{{ currentLineLabel }}</span>
        </button>
      </div>
    </section>
  </div>

  <div class="sidebar__bottom">
    <button
      class="sidebar__foot-btn"
      type="button"
      title="Settings"
      aria-label="Settings"
      @click="settingsStore.open()"
    >
      <NeoIcon name="settings" :size="20" :stroke="1.5" />
    </button>

    <button
      class="sidebar__foot-btn"
      type="button"
      title="Leave a note"
      aria-label="Leave a note"
      @click="openFeedback"
    >
      <NeoIcon name="message" :size="20" :stroke="1.5" />
    </button>

    <button
      class="sidebar__foot-btn"
      type="button"
      title="Accounts & servers"
      aria-label="Accounts and servers"
      @click="openAccounts"
    >
      <NeoIcon name="servers" :size="20" :stroke="1.5" />
    </button>

    <AccountSwitcher v-if="instancesStore.isAuthenticated" />
    <NuxtLink
      v-else
      to="/login"
      class="sidebar__foot-btn"
      :class="{ 'sidebar__foot-btn--on': route.path === '/login' }"
      title="Sign in"
      aria-label="Sign in"
    >
      <NeoIcon name="log-in" :size="20" :stroke="1.5" />
    </NuxtLink>
  </div>
</div>
</template>

<style lang="scss" scoped>
.sidebar {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--neo-sidebar-w);
  display: none;
  flex-direction: column;
  align-items: stretch;
  padding: 0.85rem 0.65rem 0.85rem;
  background: var(--neo-bg-secondary);
  border-right: 1px solid var(--neo-border-color);
  z-index: var(--neo-z-shell-nav, 100);
  transition: width 0.22s cubic-bezier(0.22, 1, 0.36, 1);

  @media (min-width: 1024px) {
    display: flex;
  }

  &--rail {
    padding-left: 0.45rem;
    padding-right: 0.45rem;
    align-items: center;

    .sidebar__brand,
    .sidebar__label,
    .sidebar__section-title,
    .sidebar__section-action,
    .sidebar__section-hint,
    .sidebar__look-desc,
    .sidebar__more {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }

    .sidebar__top {
      justify-content: center;
      flex-direction: column;
      gap: 0.35rem;
    }

    .sidebar__top-actions {
      flex-direction: column;
    }

    .sidebar__logo {
      margin: 0;
    }

    .sidebar__logo--on .sidebar__mark {
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--neo-accent) 70%, transparent);
    }

    .sidebar__home {
      flex-direction: column;
      width: 44px;
      margin-inline: auto;
    }

    .sidebar__link,
    .sidebar__row {
      justify-content: center;
      width: 44px;
      padding: 0;
      margin-inline: auto;
    }

    .sidebar__section-head {
      justify-content: center;
      min-height: 0;
      margin-bottom: 0.2rem;
    }

    .sidebar__scroll {
      align-items: center;
    }

    .sidebar__bottom {
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
    }

    .sidebar__foot-btn {
      flex: 0 0 auto;
      width: 44px;
      max-width: none;
    }

    .sidebar__bottom .acct-switch {
      flex: 0 0 auto;
      max-width: none;
    }

    .nav-badge {
      right: 2px;
      top: 2px;
    }
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    margin-bottom: 0.85rem;
    padding: 0 0.15rem;
    flex-shrink: 0;
  }

  &__top-actions {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
  }

  &__logo {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    text-decoration: none;
    min-width: 0;
    transition: opacity var(--neo-transition-fast);

    &:hover {
      opacity: 0.8;
    }
  }

  &__mark {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--neo-text-inverse);
    background: var(--neo-accent);
    border-radius: var(--neo-radius-sm, 4px);
  }

  &__brand {
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--neo-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__icon-btn,
  &__rail-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border: none;
    border-radius: var(--neo-radius-full, 999px);
    background: transparent;
    color: var(--neo-text-muted);
    cursor: pointer;
    text-decoration: none;

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }

    &--active {
      color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }
  }

  .nav-badge--corner {
    position: absolute;
    top: 0;
    right: 0;
    transform: translate(20%, -15%);
  }

  &__scroll {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: thin;
    padding-bottom: 0.5rem;

    :focus-visible {
      outline-offset: -2px;
    }
  }

  &__nav {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  &__inbox {
    display: block;
    width: 100%;

    :deep(.neo-menu__trigger) {
      display: flex;
      width: 100%;
      border-radius: var(--neo-radius-full, 999px);
    }

    .sidebar__link {
      pointer-events: none;
    }
  }

  &__home {
    position: relative;
    display: flex;
    align-items: center;
  }

  &__link--home {
    flex: 1;
    min-width: 0;
    padding-right: 2.4rem;
  }

  &__home-plus {
    position: absolute;
    right: 0.45rem;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--neo-border-color);
    border-radius: var(--neo-radius-full, 999px);
    background: var(--neo-bg-primary);
    color: var(--neo-text-primary);
    cursor: pointer;
    z-index: 1;

    &:hover {
      border-color: var(--neo-accent);
      color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }
  }

  .sidebar--rail &__home-plus {
    position: static;
    transform: none;
    width: 44px;
    height: 44px;
    margin: 0;
    border-radius: var(--neo-radius-full, 999px);
    border-color: transparent;
    background: transparent;
    color: var(--neo-text-secondary);

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
      border-color: transparent;
    }
  }

  .sidebar--rail &__link--home {
    padding-right: 0;
  }

  &__inbox {
    position: relative;
  }

  &__look-desc {
    margin: 0 0.7rem 0.35rem;
    font-size: 0.6875rem;
    line-height: 1.35;
    color: var(--neo-text-secondary);
  }

  &__micro {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.35rem;
    border-radius: var(--neo-radius-2xl, 14px);
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    border: 1px solid var(--neo-border-color);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--neo-text-primary) 12%, transparent);

    &--portal {
      position: fixed;
      z-index: var(--neo-z-shell-popover, 200);
    }
  }

  &__micro-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: none;
    border-radius: var(--neo-radius-xl, 10px);
    background: transparent;
    color: var(--neo-text-secondary);
    font: inherit;
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }

    &--on {
      color: var(--neo-text-primary);
      background: color-mix(in srgb, var(--neo-bg-hover) 80%, var(--neo-accent) 20%);
      font-weight: 600;
    }
  }

  &__link,
  &__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 42px;
    padding: 0.45rem 0.7rem;
    color: var(--neo-text-secondary);
    text-decoration: none;
    border-radius: var(--neo-radius-full, 999px);
    background: transparent;
    border: none;
    cursor: pointer;
    position: relative;
    text-align: left;
    font: inherit;
    transition:
      background-color var(--neo-transition-fast),
      color var(--neo-transition-fast);

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }

    &.active,
    &--on {
      color: var(--neo-text-primary);
      background: color-mix(in srgb, var(--neo-bg-hover) 85%, var(--neo-accent) 15%);
      font-weight: 600;
    }
  }

  &__link--badge .nav-badge {
    position: absolute;
    right: 0.65rem;
    top: 50%;
    transform: translateY(-50%);
  }

  &__label {
    flex: 1;
    min-width: 0;
    font-size: 0.9375rem;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__section {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding-top: 0.35rem;
  }

  &__section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 1.5rem;
    padding: 0 0.75rem 0.2rem;
  }

  &__section-title {
    margin: 0;
    font-size: max(0.6875rem, 11px);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: none;
    color: var(--neo-text-secondary);
  }

  &__section-action {
    border: none;
    background: transparent;
    color: var(--neo-text-secondary);
    font: inherit;
    font-size: max(0.6875rem, 11px);
    font-weight: 500;
    cursor: pointer;
    padding: 0.2rem 0.35rem;
    min-height: 24px;
    text-decoration: none;
    border-radius: var(--neo-radius-sm, 4px);

    &:hover {
      color: var(--neo-text-primary);
    }
  }

  &__section-hint {
    margin: 0 0.75rem 0.15rem;
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
  }

  &__section-list {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    list-style: none;
    margin: 0;
    padding: 0;

    > li {
      list-style: none;
      margin: 0;
      padding: 0;
    }
  }

  &__row-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: var(--neo-radius-xl, 8px);
    font-size: 0.95rem;
    line-height: 1;
  }

  &__row-glyph {
    flex-shrink: 0;
  }

  &__more {
    align-self: flex-start;
    margin: 0.15rem 0.75rem 0;
    padding: 0.2rem 0.35rem;
    min-height: 24px;
    border: none;
    border-radius: var(--neo-radius-sm, 4px);
    background: transparent;
    color: var(--neo-text-secondary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;

    &:hover {
      color: var(--neo-text-primary);
    }
  }

  .density-glyph {
    position: relative;
    display: block;
    width: 18px;
    height: 14px;
  }

  .density-glyph__packed,
  .density-glyph__roomy,
  .density-glyph__tabs {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    transition: opacity 0.18s ease, transform 0.18s ease;

    i {
      display: block;
      border-radius: 1px;
      background: currentColor;
    }
  }

  .density-glyph__packed i {
    width: 1.25px;
  }

  .density-glyph__roomy {
    opacity: 0;
    transform: scale(0.86);

    i {
      width: 3px;
    }
  }

  .density-glyph__tabs {
    opacity: 0;
    transform: scale(0.86);
    justify-content: center;
    align-items: center;

    i {
      width: 14px;
      height: 10px;
      border-radius: 2px;
    }
  }

  &__density--roomy .density-glyph {
    .density-glyph__packed,
    .density-glyph__tabs {
      opacity: 0;
      transform: scale(0.86);
    }

    .density-glyph__roomy {
      opacity: 1;
      transform: scale(1);
    }
  }

  &__density--tabs .density-glyph {
    .density-glyph__packed,
    .density-glyph__roomy {
      opacity: 0;
      transform: scale(0.86);
    }

    .density-glyph__tabs {
      opacity: 1;
      transform: scale(1);
    }
  }

  &__bottom {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 0.2rem;
    flex-shrink: 0;
    padding-top: 0.55rem;
    overflow: visible;
    border-top: 1px solid color-mix(in srgb, var(--neo-border-color) 70%, transparent);
  }

  &__foot-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex: 1 1 0;
    max-width: 48px;
    border: none;
    border-radius: var(--neo-radius-xl, 10px);
    background: transparent;
    color: var(--neo-text-secondary);
    cursor: pointer;
    text-decoration: none;
    transition:
      background-color var(--neo-transition-fast),
      color var(--neo-transition-fast);

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }

    &--on {
      color: var(--neo-text-primary);
      background: color-mix(in srgb, var(--neo-bg-hover) 85%, var(--neo-accent) 15%);
    }
  }

  .sidebar__bottom .acct-switch {
    flex: 1 1 0;
    max-width: 48px;
    display: flex;
    justify-content: center;
  }

  &__theme-swatch {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 30%, var(--neo-accent) 0 35%, transparent 36%),
      linear-gradient(135deg, var(--neo-bg-card) 45%, var(--neo-text-primary) 46%);
    border: 1.5px solid var(--neo-border-color-dark);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--neo-accent) 35%, transparent);
  }

  &__chrome-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    flex-shrink: 0;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--neo-text-primary);
    font-family: var(--neo-font-family-ui, var(--neo-font-family));
  }

  &__radius-mark {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border: 2px solid var(--neo-text-primary);
    background: color-mix(in srgb, var(--neo-accent) 55%, transparent);
    border-radius: var(--neo-radius-md, 4px);
  }

  &__spacing-mark {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    width: 16px;
    height: 16px;
    flex-shrink: 0;

    i {
      display: block;
      height: 3px;
      border-radius: 1px;
      background: var(--neo-text-primary);
    }

    html[data-density='roomy'] & {
      gap: 3px;
      i { height: 2px; }
    }

    html[data-density='dense'] & {
      gap: 1px;
      i { height: 4px; }
    }
  }

  &__line-mark {
    width: 18px;
    height: 12px;
    flex-shrink: 0;
    border: 1.5px solid var(--neo-text-primary);
    border-radius: 3px;
    background: color-mix(in srgb, var(--neo-accent) 20%, transparent);

    html[data-line='ink'] & {
      border-width: 2.5px;
      box-shadow: 1px 1px 0 color-mix(in srgb, var(--neo-text-primary) 30%, transparent);
    }

    html[data-line='crayon'] & {
      border-width: 2.5px;
      box-shadow:
        1px 0.5px 0 color-mix(in srgb, var(--neo-text-primary) 40%, transparent),
        -0.6px 0.8px 0 color-mix(in srgb, var(--neo-accent) 40%, transparent);
    }

    html[data-line='dashed'] & {
      border-style: dashed;
    }
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

.sidebar {
  :global(.chaos-active) & {
    border-right-color: var(--neo-accent);
  }
}
</style>
