<script setup lang="ts">
/**
 * Default Layout — Braun / ibm.io instrument chrome
 */

import { useThemeStore } from '~/stores/theme'
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useComposeSheetStore } from '~/stores/composeSheet'
import {
  useComposeHandoffStore,
  LOOM_ORIGINS,
  persistLoomShare,
  readPersistedLoomShare,
} from '~/stores/composeHandoff'
import { useAccountsManager } from '~/composables/useAccountsManager'
import { useColumnsStore } from '~/stores/columns'
import { useGroupsStore } from '~/stores/groups'
import {
  THEME_OPTIONS,
  UI_OPTIONS,
  RADIUS_OPTIONS,
  DENSITY_OPTIONS,
  LINE_OPTIONS,
  resolveTheme,
} from '~/utils/appearance'

const themeStore = useThemeStore()
const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const notificationsStore = useNotificationsStore()
const conversationsStore = useConversationsStore()
const composeSheet = useComposeSheetStore()
const composeHandoff = useComposeHandoffStore()
const columnsStore = useColumnsStore()
const groupsStore = useGroupsStore()
const { open: openAccounts } = useAccountsManager()
const { show: openFeedback } = useFeedbackNotes()
const router = useRouter()
const route = useRoute()

const mobileMenuOpen = ref(false)

const notifBadge = computed(() => notificationsStore.badgeLabel)
const messagesBadge = computed(() => conversationsStore.badgeLabel)

const SIDEBAR_RAIL_KEY = 'neospace_sidebar_rail'
const sidebarRail = ref(false)
const groupsShowAll = ref(false)
const lookOpen = ref(false)
const inboxMenuOpen = ref(false)
const inboxMenuRef = ref<HTMLElement | null>(null)

const sidebarJoinedGroups = computed(() => groupsStore.joinedGroups.slice(0, 12))
// Curated picks only — raw server trends live on /groups (Trending tab), not the home rail
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
  () => route.path === '/messages' || route.path === '/notifications',
)
const inboxBadge = computed(() => messagesBadge.value || notifBadge.value || '')

const loadSidebarRail = () => {
  if (typeof window === 'undefined') return
  try {
    sidebarRail.value = localStorage.getItem(SIDEBAR_RAIL_KEY) === '1'
    if (sidebarRail.value) lookOpen.value = true
  } catch {
    sidebarRail.value = false
  }
}

const toggleSidebarRail = () => {
  sidebarRail.value = !sidebarRail.value
  inboxMenuOpen.value = false
  // Rail hides text labels — keep Look cycles reachable as icon buttons
  if (sidebarRail.value) lookOpen.value = true
  try {
    localStorage.setItem(SIDEBAR_RAIL_KEY, sidebarRail.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const toggleInboxMenu = () => {
  inboxMenuOpen.value = !inboxMenuOpen.value
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

const onDocPointerDown = (e: PointerEvent) => {
  const el = inboxMenuRef.value
  if (!inboxMenuOpen.value || !el) return
  if (e.target instanceof Node && !el.contains(e.target)) {
    closeInboxMenu()
  }
}

const categoryColor = (category: string) => {
  const colors: Record<string, string> = {
    tech: '#c45c26',
    creative: '#b8860b',
    gaming: '#2f7d4a',
    social: '#a84c1e',
    news: '#3a6ea5',
    trending: '#c45c26',
    local: '#757575',
    other: '#757575',
  }
  return colors[category] || colors.other
}

const openGroupFromMenu = (tag: string) => {
  closeMobileMenu()
  router.push(`/groups/${tag}`)
}

const openCompose = () => {
  if (!instancesStore.isAuthenticated) {
    router.push('/login')
    return
  }
  // Prefer group context: /groups/:tag, or focused group column
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

/**
 * Loom → compose: open the mobile sheet once.
 * Never call show() again while open — that remounts RealComposeBox after take()
 * and the draft vanishes (looks filled for a beat, then empty).
 */
const openLoomCompose = async () => {
  const isMobile = window.matchMedia('(max-width: 1023px)').matches
  if (isMobile) {
    if (!composeSheet.open) {
      composeSheet.show({
        title: 'New post',
        // Survive layout/nav remounts after take() cleared pending
        initialText: composeHandoff.pending?.text || undefined,
      })
      await nextTick()
    }
    if (route.path !== '/') await router.replace('/')
  } else if (route.path !== '/') {
    await router.replace('/')
  }
}

/** Conversation focus — hide bottom tabs / FAB that fight sticky reply */
const isThreadRoute = computed(() => route.path.startsWith('/status/'))
const isProfileRoute = computed(() => route.path === '/profile' || route.path.startsWith('/profile/'))
/** Nested mobile screens — own chrome, no global header/tabs */
const isMobileSubview = computed(() => isThreadRoute.value || isProfileRoute.value)
const showMobileNav = computed(() => !isMobileSubview.value)
const showMobileHeader = computed(() => !isMobileSubview.value)

const applyTheme = () => {
  settingsStore.applyLocalAppearance()
}

const cycleTheme = () => {
  settingsStore.cycleTheme()
}

const cycleUi = () => {
  settingsStore.cycleUi()
}

const cycleRadius = () => {
  settingsStore.cycleRadius()
}

const cycleDensity = () => {
  settingsStore.cycleDensity()
}

const cycleLine = () => {
  settingsStore.cycleLine()
}

const densityTitle = computed(() =>
  columnsStore.deskDensity === 'packed'
    ? 'Packed — up to six across (four on smaller desks), then scroll. Click for roomy.'
    : 'Roomy — about three to four views, scroll for the rest. Click to pack.',
)

const onHomeClick = () => {
  columnsStore.clearColumnFocus()
}

const currentThemeLabel = computed(() => {
  const theme = settingsStore.localPreferences.theme
  if (theme === 'auto') {
    const resolved = resolveTheme('auto')
    const name = THEME_OPTIONS.find((t) => t.id === resolved)?.label || resolved
    return `Auto · ${name}`
  }
  return THEME_OPTIONS.find((t) => t.id === theme)?.label || theme
})
const currentUiLabel = computed(
  () => UI_OPTIONS.find((u) => u.id === settingsStore.localPreferences.ui)?.label
    || settingsStore.localPreferences.ui,
)
const currentRadiusLabel = computed(
  () => RADIUS_OPTIONS.find((r) => r.id === settingsStore.localPreferences.radius)?.label
    || settingsStore.localPreferences.radius,
)
const currentDensityLabel = computed(
  () => DENSITY_OPTIONS.find((d) => d.id === settingsStore.localPreferences.density)?.label
    || settingsStore.localPreferences.density,
)
const currentLineLabel = computed(
  () => LINE_OPTIONS.find((l) => l.id === settingsStore.localPreferences.line)?.label
    || settingsStore.localPreferences.line,
)

onMounted(async () => {
  // Mobile chrome metrics — header collapse toggles --neo-mobile-chrome-top
  document.documentElement.style.setProperty(
    '--neo-mobile-chrome-top',
    'calc(52px + env(safe-area-inset-top, 0px))',
  )
  document.documentElement.style.setProperty('--neo-mobile-nav-h', '56px')

  // Loom handoff listener MUST register before initialize() — Loom may postMessage
  // while auth/storage is still loading, and those messages are otherwise lost.
  let loomShareAccepted = false
  const LOOM_READY_ORIGINS = [...LOOM_ORIGINS]

  const bufferFromMessage = (raw: unknown): ArrayBuffer | null => {
    if (!raw) return null
    if (raw instanceof ArrayBuffer && raw.byteLength > 0) return raw
    if (ArrayBuffer.isView(raw) && raw.byteLength > 0) {
      const view = raw as ArrayBufferView
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    }
    return null
  }

  const ackLoom = (origin: string) => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'neospace-loom-ack', v: 1 }, origin)
      }
    } catch {
      /* opener may be gone */
    }
  }

  const pingLoomReady = () => {
    try {
      if (!window.opener || window.opener.closed) return
      for (const origin of LOOM_READY_ORIGINS) {
        window.opener.postMessage({ type: 'neospace-loom-ready', v: 1 }, origin)
      }
    } catch {
      /* cross-origin opener may throw */
    }
  }

  const onLoomMessage = (e: MessageEvent) => {
    if (!LOOM_ORIGINS.has(e.origin)) return
    if (e.data?.type !== 'loom-neospace-share' || e.data?.v !== 1) return
    const buffer = bufferFromMessage(e.data.image?.buffer)
    // Always ACK so Loom stops retrying — even for duplicate deliveries
    ackLoom(e.origin)
    // Already opened from query / earlier message — still ingest image upgrades,
    // but never remount the sheet (that wipes a draft already taken into the box).
    if (loomShareAccepted && !buffer) return
    void (async () => {
      await composeHandoff.ingestFromMessage({
        text: typeof e.data.text === 'string' ? e.data.text : '',
        story: typeof e.data.story === 'string' ? e.data.story : '',
        image: buffer
          ? {
              name: typeof e.data.image?.name === 'string' ? e.data.image.name : undefined,
              type: typeof e.data.image?.type === 'string' ? e.data.image.type : undefined,
              buffer,
            }
          : undefined,
      })
      if (buffer) loomShareAccepted = true
      if (!instancesStore.isAuthenticated) {
        await router.replace('/login')
      } else {
        await openLoomCompose()
      }
    })()
  }
  window.addEventListener('message', onLoomMessage)
  pingLoomReady()
  const readyInterval = window.setInterval(pingLoomReady, 400)
  window.setTimeout(() => window.clearInterval(readyInterval), 10000)
  onUnmounted(() => {
    window.removeEventListener('message', onLoomMessage)
    window.clearInterval(readyInterval)
  })

  await instancesStore.initialize()
  settingsStore.loadLocalPreferences()
  applyTheme()
  loadSidebarRail()
  void groupsStore.initializeGroups()
  document.addEventListener('pointerdown', onDocPointerDown)

  if (instancesStore.userCustomCSS) {
    themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
  }
  settingsStore.syncCustomProfileCss()

  if (instancesStore.hasAuthenticatedInstance) {
    notificationsStore.refreshUnreadBadge()
    conversationsStore.refreshUnreadBadge()
    conversationsStore.startLiveRefresh()
  }

  // Re-ping after init — opener may have missed early ready signals
  pingLoomReady()

  const fromQuery = String(route.query.compose || '') === 'loom'
  if (fromQuery) {
    const share = {
      story: typeof route.query.story === 'string' ? route.query.story : '',
      text: typeof route.query.text === 'string' ? route.query.text : '',
    }
    persistLoomShare(share)
    await router.replace({ path: route.path === '/login' ? '/login' : '/', query: {} })

    // Story URL is authoritative (KV-backed .img). Don't wait on postMessage.
    if (!instancesStore.isAuthenticated) {
      persistLoomShare(share)
      if (route.path !== '/login') await router.replace('/login')
    } else {
      await composeHandoff.ingestStored(share)
      loomShareAccepted = composeHandoff.hasPending
      await openLoomCompose()
    }
  } else {
    // Give optional postMessage a short window when we weren't opened via query
    await new Promise((r) => setTimeout(r, 1200))
    if (!composeHandoff.hasPending && !loomShareAccepted) {
      const loomPayload = readPersistedLoomShare()
      if (loomPayload && (loomPayload.story || loomPayload.text || loomPayload.imageDataUrl)) {
        if (!instancesStore.isAuthenticated) {
          persistLoomShare(loomPayload)
          if (route.path !== '/login') await router.replace('/login')
        } else {
          await composeHandoff.ingestStored(loomPayload)
          await openLoomCompose()
        }
      }
    }
  }

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onScheme = () => {
    if (settingsStore.localPreferences.theme === 'auto') applyTheme()
  }
  mq.addEventListener?.('change', onScheme)
  onUnmounted(() => mq.removeEventListener?.('change', onScheme))
})

onUnmounted(() => {
  conversationsStore.stopLiveRefresh()
  document.removeEventListener('pointerdown', onDocPointerDown)
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
  async (ok) => {
    if (ok) {
      conversationsStore.startLiveRefresh()
      void conversationsStore.refreshUnreadBadge()
    } else {
      conversationsStore.stopLiveRefresh()
    }
    if (!ok) return
    const loomPayload = readPersistedLoomShare()
    if (!loomPayload || (!loomPayload.story && !loomPayload.text && !loomPayload.imageDataUrl)) return
    await composeHandoff.ingestStored(loomPayload)
    await openLoomCompose()
  },
)

watch(
  () => [
    settingsStore.localPreferences.theme,
    settingsStore.localPreferences.ui,
    settingsStore.localPreferences.font,
    settingsStore.localPreferences.fontSize,
  ],
  () => applyTheme(),
)

const handleLogout = async () => {
  await instancesStore.logout()
  themeStore.setUserCustomCSS('')
  themeStore.disableChaosMode()
  router.push('/login')
}

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}

watch(mobileMenuOpen, async (open) => {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('neo-dialog-open', open)
  }
  if (!open) return
  if (groupsStore.groups.length === 0) {
    await groupsStore.initializeGroups()
  }
})

const mobileSidebarRef = ref<HTMLElement | null>(null)
useFocusTrap(mobileSidebarRef, mobileMenuOpen, {
  onEscape: closeMobileMenu,
  initialFocus: '.mobile-sidebar__close',
})
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
    }"
  >
    <a href="#main-content" class="skip-link">Skip to content</a>

    <Teleport to="head" v-if="themeStore.isChaosMode && themeStore.safeCustomCSS">
      <component :is="'style'" id="neospace-chaos-dynamic">
        {{ themeStore.safeCustomCSS }}
      </component>
    </Teleport>

    <aside
      class="sidebar"
      :class="{ 'sidebar--rail': sidebarRail }"
      aria-label="Desktop navigation"
    >
      <div class="sidebar__top">
        <NuxtLink
          to="/"
          class="sidebar__logo"
          :class="{ 'sidebar__logo--on': route.path === '/' && !columnsStore.focusedColumnId }"
          title="Home"
          aria-label="neospace home"
          :aria-current="route.path === '/' && !columnsStore.focusedColumnId ? 'page' : undefined"
          @click="onHomeClick"
        >
          <span class="sidebar__mark">ns</span>
          <span class="sidebar__brand">neospace</span>
        </NuxtLink>
        <div class="sidebar__top-actions">
          <NuxtLink
            v-if="instancesStore.hasAuthenticatedInstance"
            to="/notifications"
            class="sidebar__icon-btn"
            :class="{ 'sidebar__icon-btn--active': route.path === '/notifications' && route.query.filter !== 'mention' }"
            :title="notifBadge ? `Activity (${notifBadge} unread)` : 'Activity'"
            :aria-label="notifBadge ? `Activity, ${notifBadge} unread` : 'Activity'"
            :aria-current="route.path === '/notifications' && route.query.filter !== 'mention' ? 'page' : undefined"
          >
            <NeoIcon
              name="heart"
              :size="20"
              :stroke="route.path === '/notifications' ? 2 : 1.75"
              :filled="route.path === '/notifications' && route.query.filter !== 'mention'"
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
        <nav class="sidebar__nav" aria-label="Primary">
          <div class="sidebar__home">
            <NuxtLink
              v-if="!sidebarRail"
              to="/"
              class="sidebar__link sidebar__link--home"
              :class="{ active: route.path === '/' && !columnsStore.focusedColumnId }"
              title="Home"
              :aria-current="route.path === '/' && !columnsStore.focusedColumnId ? 'page' : undefined"
              @click="onHomeClick"
            >
              <NeoIcon
                name="home"
                :size="22"
                :stroke="route.path === '/' && !columnsStore.focusedColumnId ? 2 : 1.5"
                :filled="route.path === '/' && !columnsStore.focusedColumnId"
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

          <div
            v-if="instancesStore.hasAuthenticatedInstance"
            ref="inboxMenuRef"
            class="sidebar__inbox"
          >
            <button
              type="button"
              class="sidebar__link sidebar__link--badge"
              :class="{ active: inboxActive }"
              :title="inboxBadge ? `Inbox (${inboxBadge} unread)` : 'Inbox'"
              :aria-label="inboxBadge ? `Inbox, ${inboxBadge} unread` : 'Inbox — messages and mentions'"
              :aria-expanded="inboxMenuOpen"
              aria-haspopup="menu"
              @click="toggleInboxMenu"
            >
              <NeoIcon
                name="send"
                :size="22"
                :stroke="inboxActive ? 2 : 1.5"
                :filled="route.path === '/messages'"
              />
              <span class="sidebar__label">Inbox</span>
              <span v-if="inboxBadge" class="nav-badge" aria-hidden="true">{{ inboxBadge }}</span>
            </button>
            <div
              v-if="inboxMenuOpen"
              class="sidebar__micro"
              role="menu"
              aria-label="Inbox"
            >
              <button
                type="button"
                class="sidebar__micro-item"
                role="menuitem"
                :class="{ 'sidebar__micro-item--on': route.path === '/messages' }"
                @click="openDirectMessages"
              >
                <NeoIcon name="message" :size="16" :stroke="1.75" />
                <span>Direct messages</span>
              </button>
              <button
                type="button"
                class="sidebar__micro-item"
                role="menuitem"
                :class="{ 'sidebar__micro-item--on': route.path === '/notifications' && route.query.filter === 'mention' }"
                @click="openMentions"
              >
                <NeoIcon name="mention" :size="16" :stroke="1.75" />
                <span>Mentions</span>
              </button>
            </div>
          </div>

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

          <div v-if="visibleJoinedGroups.length" class="sidebar__section-list" role="list">
            <button
              v-for="group in visibleJoinedGroups"
              :key="`joined-${group.tag}`"
              type="button"
              class="sidebar__row"
              role="listitem"
              :title="group.name"
              @click="openDesktopGroup(group.tag)"
            >
              <span
                class="sidebar__row-icon"
                :style="{ background: categoryColor(group.category) + '22' }"
                aria-hidden="true"
              >{{ group.icon }}</span>
              <span class="sidebar__label">{{ group.name }}</span>
            </button>
          </div>

          <div v-if="showSidebarSuggested" class="sidebar__section-list" role="list">
            <p v-if="!visibleJoinedGroups.length" class="sidebar__section-hint">Suggested</p>
            <button
              v-for="group in visibleSuggestedGroups"
              :key="`suggest-${group.tag}`"
              type="button"
              class="sidebar__row"
              role="listitem"
              :title="group.name"
              @click="openDesktopGroup(group.tag)"
            >
              <span
                class="sidebar__row-icon"
                :style="{ background: categoryColor(group.category) + '22' }"
                aria-hidden="true"
              >{{ group.icon }}</span>
              <span class="sidebar__label">{{ group.name }}</span>
            </button>
          </div>

          <button
            v-if="groupsCanToggle"
            type="button"
            class="sidebar__more"
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
              'sidebar__row--on': columnsStore.deskDensity === 'roomy',
              'sidebar__density--roomy': columnsStore.deskDensity === 'roomy',
            }"
            :title="densityTitle"
            :aria-label="densityTitle"
            :aria-pressed="columnsStore.deskDensity === 'roomy'"
            @click="columnsStore.toggleDeskDensity()"
          >
            <span class="sidebar__row-glyph density-glyph" aria-hidden="true">
              <span class="density-glyph__packed"><i /><i /><i /><i /><i /><i /><i /><i /></span>
              <span class="density-glyph__roomy"><i /><i /><i /><i /></span>
            </span>
            <span class="sidebar__label">{{ columnsStore.deskDensity === 'roomy' ? 'Roomy' : 'Packed' }}</span>
          </button>
        </section>

        <section class="sidebar__section sidebar__section--look" aria-label="Look">
          <div class="sidebar__section-head">
            <h2 class="sidebar__section-title">Look</h2>
            <button
              type="button"
              class="sidebar__section-action"
              :aria-expanded="lookOpen"
              @click="lookOpen = !lookOpen"
            >
              {{ lookOpen ? 'Hide' : 'Try' }}
            </button>
          </div>

          <div v-show="lookOpen" class="sidebar__section-list">
            <button
              type="button"
              class="sidebar__row"
              :title="`Theme: ${currentThemeLabel}`"
              :aria-label="`Theme ${currentThemeLabel}. Click to cycle.`"
              @click="cycleTheme"
            >
              <span class="sidebar__theme-swatch" aria-hidden="true" />
              <span class="sidebar__label">{{ currentThemeLabel }}</span>
            </button>
            <button
              type="button"
              class="sidebar__row"
              :title="`Chrome: ${currentUiLabel}`"
              :aria-label="`Chrome ${currentUiLabel}. Click to cycle.`"
              @click="cycleUi"
            >
              <span class="sidebar__chrome-mark" aria-hidden="true">Aa</span>
              <span class="sidebar__label">{{ currentUiLabel }}</span>
            </button>
            <button
              type="button"
              class="sidebar__row"
              :title="`Corners: ${currentRadiusLabel}`"
              :aria-label="`Corners ${currentRadiusLabel}. Click to cycle.`"
              @click="cycleRadius"
            >
              <span class="sidebar__radius-mark" aria-hidden="true" />
              <span class="sidebar__label">{{ currentRadiusLabel }}</span>
            </button>
            <button
              type="button"
              class="sidebar__row"
              :title="`Density: ${currentDensityLabel}`"
              :aria-label="`Density ${currentDensityLabel}. Click to cycle.`"
              @click="cycleDensity"
            >
              <span class="sidebar__spacing-mark" aria-hidden="true"><i /><i /><i /></span>
              <span class="sidebar__label">{{ currentDensityLabel }}</span>
            </button>
            <button
              type="button"
              class="sidebar__row"
              :title="`Lines: ${currentLineLabel}`"
              :aria-label="`Lines ${currentLineLabel}. Click to cycle.`"
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
    </aside>

    <header v-if="showMobileHeader" class="mobile-header">
      <div class="mobile-header__start">
        <button
          class="mobile-header__btn"
          @click="mobileMenuOpen = !mobileMenuOpen"
          aria-label="Menu"
          type="button"
          :aria-expanded="mobileMenuOpen"
          aria-controls="mobile-sidebar"
        >
          <NeoIcon name="menu" :size="22" :stroke="1.75" />
        </button>
        <div class="mobile-header__logo">neospace</div>
      </div>
      <div class="mobile-header__actions">
        <NuxtLink
          to="/explore"
          class="mobile-header__btn"
          :class="{ 'mobile-header__btn--active': route.path === '/explore' }"
          aria-label="Search"
          title="Search"
        >
          <NeoIcon name="search" :size="20" :stroke="route.path === '/explore' ? 2 : 1.75" />
        </NuxtLink>
        <button
          class="mobile-header__btn"
          @click="cycleTheme"
          :aria-label="`Theme ${currentThemeLabel}`"
          type="button"
          :title="`Theme: ${currentThemeLabel}`"
        >
          <span class="mobile-header__theme-swatch" aria-hidden="true"></span>
        </button>
      </div>
    </header>

    <SuiteMenu />

    <Transition name="fade">
      <div v-if="mobileMenuOpen" class="mobile-overlay" @click="closeMobileMenu"></div>
    </Transition>

    <Transition name="slide">
      <aside
        v-if="mobileMenuOpen"
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

        <nav class="mobile-sidebar__nav">
          <NuxtLink to="/" class="mobile-sidebar__link" @click="closeMobileMenu">Home</NuxtLink>
          <NuxtLink to="/explore" class="mobile-sidebar__link" @click="closeMobileMenu">Search</NuxtLink>
          <NuxtLink to="/groups" class="mobile-sidebar__link" @click="closeMobileMenu">Groups</NuxtLink>
          <NuxtLink
            v-if="instancesStore.hasAuthenticatedInstance"
            to="/messages"
            class="mobile-sidebar__link"
            @click="closeMobileMenu"
          >
            Messages
            <span v-if="messagesBadge" class="nav-badge nav-badge--inline">{{ messagesBadge }}</span>
          </NuxtLink>
          <NuxtLink
            v-if="instancesStore.hasAuthenticatedInstance"
            to="/notifications"
            class="mobile-sidebar__link"
            @click="closeMobileMenu"
          >
            Notifications
            <span v-if="notifBadge" class="nav-badge nav-badge--inline">{{ notifBadge }}</span>
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
            <div class="mobile-sidebar__group-chips" role="list">
              <button
                v-for="group in sidebarJoinedGroups"
                :key="group.tag"
                type="button"
                class="mobile-sidebar__group-chip"
                role="listitem"
                @click="openGroupFromMenu(group.tag)"
              >
                <span
                  class="mobile-sidebar__group-icon"
                  :style="{ backgroundColor: categoryColor(group.category) + '28' }"
                >
                  {{ group.icon }}
                </span>
                <span class="mobile-sidebar__group-name">{{ group.name }}</span>
              </button>
            </div>
          </div>

          <div v-if="sidebarSuggestedGroups.length" class="mobile-sidebar__groups-block">
            <div class="mobile-sidebar__groups-head">
              <h2 class="mobile-sidebar__groups-title">Suggested</h2>
            </div>
            <div class="mobile-sidebar__suggest-list" role="list">
              <button
                v-for="group in sidebarSuggestedGroups"
                :key="`s-${group.tag}`"
                type="button"
                class="mobile-sidebar__suggest"
                role="listitem"
                @click="openGroupFromMenu(group.tag)"
              >
                <span
                  class="mobile-sidebar__suggest-icon"
                  :style="{ backgroundColor: categoryColor(group.category) + '28' }"
                >
                  {{ group.icon }}
                </span>
                <span class="mobile-sidebar__suggest-text">
                  <span class="mobile-sidebar__suggest-name">{{ group.name }}</span>
                  <span class="mobile-sidebar__suggest-tag">#{{ group.tag }}</span>
                </span>
              </button>
            </div>
          </div>
        </section>

        <div class="mobile-sidebar__spacer"></div>

        <div class="mobile-sidebar__footer">
          <button class="mobile-sidebar__action" @click="settingsStore.open(); closeMobileMenu()" type="button">
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
                  Posting as · {{ instancesStore.instanceUrl?.replace('https://', '') }}
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
      </aside>
    </Transition>

    <main id="main-content" class="main-content" tabindex="-1">
      <slot />
    </main>

    <!-- Threads-style: Home · Messages · + · Activity · Profile -->
    <nav v-if="showMobileNav" class="mobile-nav" aria-label="Mobile">
      <NuxtLink
        to="/"
        class="mobile-nav__item"
        :class="{ active: route.path === '/' }"
        aria-label="Home"
        :aria-current="route.path === '/' ? 'page' : undefined"
      >
        <NeoIcon name="home" :size="22" :stroke="route.path === '/' ? 2 : 1.5" :filled="route.path === '/'" />
      </NuxtLink>

      <NuxtLink
        v-if="instancesStore.hasAuthenticatedInstance"
        to="/messages"
        class="mobile-nav__item mobile-nav__item--badge"
        :class="{ active: route.path === '/messages' }"
        :aria-label="messagesBadge ? `Messages, ${messagesBadge} unread` : 'Messages'"
        :aria-current="route.path === '/messages' ? 'page' : undefined"
      >
        <NeoIcon
          name="message"
          :size="22"
          :stroke="route.path === '/messages' ? 2 : 1.5"
          :filled="route.path === '/messages'"
        />
        <span v-if="messagesBadge" class="nav-badge" aria-hidden="true">{{ messagesBadge }}</span>
      </NuxtLink>
      <NuxtLink
        v-else
        to="/login"
        class="mobile-nav__item"
        :class="{ active: route.path === '/login' }"
        aria-label="Messages — sign in"
      >
        <NeoIcon name="message" :size="22" :stroke="1.5" />
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
      </button>

      <NuxtLink
        v-if="instancesStore.hasAuthenticatedInstance"
        to="/notifications"
        class="mobile-nav__item mobile-nav__item--badge"
        :class="{ active: route.path === '/notifications' }"
        :aria-label="notifBadge ? `Notifications, ${notifBadge} unread` : 'Notifications'"
        :aria-current="route.path === '/notifications' ? 'page' : undefined"
      >
        <NeoIcon name="bell" :size="22" :stroke="route.path === '/notifications' ? 2 : 1.5" />
        <span v-if="notifBadge" class="nav-badge" aria-hidden="true">{{ notifBadge }}</span>
      </NuxtLink>
      <NuxtLink
        v-else
        to="/groups"
        class="mobile-nav__item"
        :class="{ active: route.path.startsWith('/groups') }"
        aria-label="Groups"
        :aria-current="route.path.startsWith('/groups') ? 'page' : undefined"
      >
        <NeoIcon name="users" :size="22" :stroke="route.path.startsWith('/groups') ? 2 : 1.5" />
      </NuxtLink>

      <AccountSwitcher
        v-if="instancesStore.hasAuthenticatedInstance"
        placement="nav"
        compact
      />
      <NuxtLink
        v-else
        to="/login"
        class="mobile-nav__item"
        :class="{ active: route.path === '/login' }"
        aria-label="Sign in"
      >
        <NeoIcon name="user" :size="22" :stroke="1.5" />
      </NuxtLink>
    </nav>

    <LazyComposeSheet />
    <LazyInstanceManager />
    <AccountSwitcherSheet v-if="instancesStore.hasAuthenticatedInstance" />
    <FeedbackNotes v-if="!isMobileSubview" />
    <LazySettingsModal />
    <InstallAppBanner />
  </div>
</template>

<style lang="scss" scoped>
.neo-layout {
  --neo-sidebar-w: 248px;
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--neo-bg-primary);
  overscroll-behavior-x: none;

  // iPad / small laptop: give the board more horizontal room
  @media (min-width: 1024px) and (max-width: 1199px) {
    --neo-sidebar-w: 200px;
  }

  &--rail {
    --neo-sidebar-w: 68px;
  }
}

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
  z-index: 100;
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
    .sidebar__more {
      display: none;
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
    border-radius: 999px;
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
    transform: translate(20%, -15%) scale(0.85);
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
  }

  &__nav {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
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
    border-radius: 999px;
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
    border-radius: 999px;
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

  &__micro {
    position: absolute;
    left: 0.5rem;
    right: 0.5rem;
    top: calc(100% + 0.2rem);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.35rem;
    border-radius: 14px;
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    border: 1px solid var(--neo-border-color);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--neo-text-primary) 12%, transparent);
  }

  &__micro-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: none;
    border-radius: 10px;
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

  .sidebar--rail &__micro {
    left: calc(100% + 0.4rem);
    right: auto;
    top: 0;
    width: 12.5rem;
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
    border-radius: 999px;
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
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: none;
    color: var(--neo-text-muted);
  }

  &__section-action {
    border: none;
    background: transparent;
    color: var(--neo-text-muted);
    font: inherit;
    font-size: 0.6875rem;
    font-weight: 500;
    cursor: pointer;
    padding: 0;
    text-decoration: none;

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
  }

  &__row-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    font-size: 0.95rem;
    line-height: 1;
  }

  &__row-glyph {
    flex-shrink: 0;
  }

  &__more {
    align-self: flex-start;
    margin: 0.15rem 0.75rem 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--neo-text-muted);
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
  .density-glyph__roomy {
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

  &__density--roomy .density-glyph,
  &__row--on .density-glyph {
    .density-glyph__packed {
      opacity: 0;
      transform: scale(0.86);
    }

    .density-glyph__roomy {
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
    border-radius: 10px;
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

.mobile-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: calc(52px + env(safe-area-inset-top, 0px));
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: env(safe-area-inset-top, 0px) 0.5rem 0;
  // Solid fill — translucent + backdrop-filter flashes black on iOS while translating
  background: var(--neo-bg-primary);
  border-bottom: 1px solid var(--neo-border-color);
  z-index: 90;
  @media (min-width: 1024px) {
    display: none;
  }

  &__start {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    min-width: 0;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    margin-left: auto;
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
    border-radius: 4px;
    text-decoration: none;
    transition: background-color var(--neo-transition-fast), color var(--neo-transition-fast);

    &:hover {
      background: var(--neo-bg-hover);
    }

    &--active {
      color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }
  }

  &__logo {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    letter-spacing: -0.02em;
    text-transform: lowercase;
    line-height: 1;
    padding-bottom: 1px;
  }

  &__theme-swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 30%, var(--neo-accent) 0 35%, transparent 36%),
      linear-gradient(135deg, var(--neo-bg-card) 45%, var(--neo-text-primary) 46%);
    border: 1.5px solid var(--neo-border-color-dark);
  }
}

.mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: calc(56px + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: flex-start;
  justify-content: space-around;
  padding: 4px 0.5rem 0;
  padding-bottom: env(safe-area-inset-bottom, 0);
  background: var(--neo-bg-primary);
  border-top: 1px solid var(--neo-border-color);
  z-index: 90;
  box-sizing: border-box;

  @media (min-width: 1024px) {
    display: none;
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    color: var(--neo-text-tertiary);
    text-decoration: none;
    background: transparent;
    border: none;
    border-radius: 4px;
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

  &__compose {
    color: var(--neo-text-inverse);

    &:active .mobile-nav__compose-mark {
      transform: scale(0.94);
    }
  }

  &__compose-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 36px;
    border-radius: 10px;
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
  min-width: 1.05rem;
  height: 1.05rem;
  padding: 0 0.22rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--neo-font-family-ui);
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1;
  color: var(--neo-text-inverse);
  background: var(--neo-accent);
  border-radius: 2px;
  pointer-events: none;

  &--inline {
    position: static;
    margin-left: 0.4rem;
    min-width: 1.15rem;
    height: 1.15rem;
    font-size: 0.6875rem;
  }
}

.mobile-overlay {
  position: fixed;
  inset: 0;
  background: var(--neo-bg-overlay);
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
  max-width: calc(100vw - 56px);
  display: flex;
  flex-direction: column;
  background: var(--neo-bg-secondary);
  border-right: 1px solid var(--neo-border-color);
  z-index: 100;
  overflow-y: auto;

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
    border-radius: 2px;
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
    border-radius: 4px;

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
    border-radius: 4px;
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
    border-radius: 10px;
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
    border-radius: 999px;
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
    color: var(--neo-accent);
    text-decoration: none;
  }

  &__group-chips {
    display: flex;
    gap: 0.55rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 0.1rem 0.15rem 0.35rem;

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
    padding: 0.15rem;
    border: none;
    background: transparent;
    cursor: pointer;
    color: inherit;
    -webkit-tap-highlight-color: transparent;
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
    font-size: 0.625rem;
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
  }

  &__suggest {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.45rem 0.35rem;
    border: none;
    border-radius: 8px;
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
    border-radius: 10px;
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
    border-radius: 4px;
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
    border-radius: 2px;
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

.main-content {
  flex: 1;
  min-height: 100vh;
  min-height: 100dvh;
  min-width: 0;
  width: 100%;
  padding: var(--neo-mobile-chrome-top, 52px) 0.5rem
    calc(var(--neo-mobile-nav-h, 56px) + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  background: var(--neo-bg-primary);
  overscroll-behavior-x: none;

  @media (min-width: 600px) {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  @media (min-width: 1024px) {
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

.chaos-active {
  .sidebar {
    border-right-color: var(--neo-accent);
  }

  .mobile-header {
    border-bottom-color: var(--neo-accent);
  }
}

</style>
