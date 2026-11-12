<script setup lang="ts">
/**
 * TimelineColumn - Self-contained timeline column for multi-column layout.
 * Each column manages its own feed data, scroll, and infinite loading.
 * Supports home/local/federated, group, liked, saved, and algorithm feeds.
 */

import type { mastodon } from 'masto'
import { useInstancesStore } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import { useAlgorithmsStore } from '~/stores/algorithms'
import {
  useColumnsStore,
  ALL_ACCOUNTS_INSTANCE,
  FEED_LABELS,
  type ColumnConfig,
  type ColumnFeedType,
} from '~/stores/columns'
import { hostnameOf, isAuthGatedPublicHost, resolvePublicInstanceUrl } from '~/utils/instances'
import { statusListKey } from '~/utils/statusIdentity'
import { useSettingsStore } from '~/stores/settings'
import { useToastStore } from '~/stores/toast'
import { useFeedKeyboard } from '~/composables/useFeedKeyboard'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useDeskViewport, useMobileViewport } from '~/composables/useBreakpoint'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'
import { useColumnDnd } from '~/composables/useColumnDnd'
import { useTimelineColumn } from '~/composables/useTimelineColumn'
import type { NeoIconName } from '~/utils/neoIcons'

interface Props {
  column: ColumnConfig
  canRemove: boolean
  isFirst: boolean
  isLast?: boolean
  canReorder?: boolean
  /** Highlight when another column is dragged over this one */
  dropTarget?: boolean
  dragging?: boolean
  /**
   * Quieter chrome (quaternary) when this column isn't the focused one.
   * Cleared on hover / focus-within via .neo-chrome.
   */
  recessed?: boolean
  focused?: boolean
  /** Column is mounted but hidden (desktop focus mode) — stop polling until shown */
  paused?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isLast: false,
  canReorder: false,
  dropTarget: false,
  dragging: false,
  recessed: false,
  focused: false,
  paused: false,
})

/** Desktop-only inline compose — mobile uses the + sheet (avoids stealing Loom handoff) */
const isDesktop = useDeskViewport()

/**
 * Flick (flip) = one post per screen, snap to the next. Phones always honour
 * the column's mode; on desktop it applies to the focused column, where
 * there's room for it — the board's skinny columns stay a feed.
 */
const isFlip = computed(
  () => (!isDesktop.value || props.focused) && (props.column.viewMode || 'flow') === 'flip',
)
/** Desktop focused column: choose how to move through it */
const showModeSwitch = computed(() => isDesktop.value && props.focused)
const setViewMode = (mode: 'flow' | 'flip') => columnsStore.setColumnViewMode(props.column.id, mode)

const emit = defineEmits<{
  remove: []
  /** Second arg is groupTag or algorithmId depending on feedType */
  'update-feed-type': [feedType: ColumnFeedType, feedParam?: string]
  'column-drag-start': [columnId: string]
  'column-drag-end': []
  'column-drag-over': [columnId: string]
  'column-drop': [fromColumnId: string]
  'move-left': []
  'move-right': []
  focus: []
}>()

// Drop target for the whole column; the drag handle itself lives in ColumnChrome
const { onColumnDragOver, onColumnDrop } = useColumnDnd(
  () => props.column.id,
  emit,
  () => props.canReorder,
)

const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()
const groupsStore = useGroupsStore()
const columnsStore = useColumnsStore()
const algorithmsStore = useAlgorithmsStore()
const toastStore = useToastStore()
algorithmsStore.hydrate()

const feedMenuOpen = ref(false)
const serverFilterMenuOpen = ref(false)
const algorithmsExpanded = ref(true)
const groupsExpanded = ref(false)

const isMobileRef = useMobileViewport()
const isMobileViewportFn = () => isMobileRef.value
const reducedMotion = usePrefersReducedMotion()

/**
 * Enter motion only for short prepend windows (not full refresh). A plain
 * keyed v-for plus a class on just-prepended cards — TransitionGroup would
 * measure every card (getBoundingClientRect) on every list update.
 */
const enteringKeys = shallowRef<ReadonlySet<string>>(new Set())
let listMotionTimer: ReturnType<typeof setTimeout> | null = null

const withPrependMotion = (fn: () => void) => {
  if (reducedMotion.value) {
    fn()
    return
  }
  const before = new Set(statuses.value.map((s) => statusListKey(s)))
  fn()
  const added = new Set<string>()
  for (const s of statuses.value) {
    const key = statusListKey(s)
    if (!before.has(key)) added.add(key)
  }
  if (!added.size) return
  enteringKeys.value = added
  if (listMotionTimer) clearTimeout(listMotionTimer)
  listMotionTimer = setTimeout(() => {
    enteringKeys.value = new Set()
    listMotionTimer = null
  }, 280)
}


const {
  scrollContainer,
  loadTrigger,
  statuses,
  displayStatuses,
  displayRows,
  feedSetSize,
  isLoading,
  isLoadingMore,
  error,
  loadMoreError,
  hasMore,
  pendingNew,
  pendingLabel,
  lastLoadAddedNothing,
  sparsePauseCopy,
  endOfFeedCopy,
  timelineGap,
  recoverTimelineGap,
  jumpToNew,
  loadMore,
  continueAfterSparsePause,
  fetchTimeline,
  pullDistance,
  PTR_THRESHOLD,
  isRefreshing,
  pullHint,
  sparseSkipStreak,
  onScroll,
  onPullStart,
  onPullMove,
  onPullEnd,
  newPostsAnnounce,
  autoRetryIn,
  scrollBehavior,
} = useTimelineColumn({
  column: () => props.column,
  paused: () => props.paused,
  recessed: () => props.recessed,
  isMobileViewport: isMobileViewportFn,
  withPrependMotion,
})

let flipRo: ResizeObserver | null = null
let newPostsAnnounceTimer: ReturnType<typeof setTimeout> | null = null

const syncFlipPort = () => {
  const el = scrollContainer.value
  if (!el || !isFlip.value) return
  el.style.setProperty('--flip-port', `${el.clientHeight}px`)
}

watch(isFlip, () => {
  nextTick(() => {
    syncFlipPort()
    scrollContainer.value?.scrollTo({ top: 0 })
  })
})

watch(pendingLabel, (label) => {
  if (newPostsAnnounceTimer) clearTimeout(newPostsAnnounceTimer)
  if (!label) {
    newPostsAnnounce.value = ''
    return
  }
  // Throttle polite announcements while posts keep arriving. Name the feed —
  // several board columns can each announce, and "3 new posts" alone is ambiguous.
  newPostsAnnounceTimer = setTimeout(() => {
    newPostsAnnounce.value = `${label} in ${feedLabel.value}`
  }, 700)
})

const canShowHome = computed(() => instancesStore.hasAuthenticatedInstance)

const joinedGroups = computed(() => groupsStore.joinedGroups)

/** This column follows a specific account/server, or the global active one when unpinned */
const columnPinnedInstanceId = computed(() => props.column.instanceId || null)
const columnPinnedHost = computed(() =>
  props.column.serverHost?.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase() || null,
)
const isUnifiedHome = computed(
  () => props.column.feedType === 'home' && columnPinnedInstanceId.value === ALL_ACCOUNTS_INSTANCE,
)
const browsingHost = computed(() => {
  if (columnPinnedHost.value) return columnPinnedHost.value
  if (columnPinnedInstanceId.value && columnPinnedInstanceId.value !== ALL_ACCOUNTS_INSTANCE) {
    const pinned = instancesStore.instances.find((i) => i.id === columnPinnedInstanceId.value)
    if (pinned) return hostnameOf(pinned.url) || 'this server'
  }
  const filteredId = instancesStore.activeInstanceFilter
  const filtered = filteredId
    ? instancesStore.instances.find((i) => i.id === filteredId)
    : null
  const preferred =
    filtered?.url ||
    instancesStore.activeAccount?.url ||
    instancesStore.instances[0]?.url ||
    resolvePublicInstanceUrl()
  return hostnameOf(preferred) || 'this server'
})

/** Local / Federated / Home can hop between connected + watched servers when you have more than one */
const canSwitchPublicServer = computed(
  () =>
    (props.column.feedType === 'local' ||
      props.column.feedType === 'federated' ||
      props.column.feedType === 'home') &&
    (instancesStore.instances.length > 1 ||
      instancesStore.authenticatedInstances.length > 1 ||
      !!columnPinnedHost.value),
)

const publicServerChoices = computed(() => {
  const rows = instancesStore.instances.map((instance) => {
    const host = hostnameOf(instance.url)
    const kind =
      instance.accessToken && instance.user && !instance.sessionExpired
        ? 'signed-in'
        : instance.user
          ? 'expired'
          : 'watching'
    return { id: instance.id, host, kind, label: host }
  })
  if (props.column.feedType === 'home' && instancesStore.authenticatedInstances.length > 1) {
    return [
      { id: ALL_ACCOUNTS_INSTANCE, host: 'all accounts', kind: 'signed-in' as const, label: 'All accounts' },
      ...rows.filter((r) => r.kind === 'signed-in' || r.kind === 'expired'),
    ]
  }
  if (columnPinnedHost.value && !rows.some((r) => r.host === columnPinnedHost.value)) {
    return [
      { id: `host:${columnPinnedHost.value}`, host: columnPinnedHost.value, kind: 'watching' as const, label: columnPinnedHost.value },
      ...rows,
    ]
  }
  return rows
})

const isPublicServerSelected = (instanceId: string) => {
  if (columnPinnedHost.value && instanceId === `host:${columnPinnedHost.value}`) return true
  if (columnPinnedInstanceId.value) return columnPinnedInstanceId.value === instanceId
  return (instancesStore.activeInstanceFilter || instancesStore.activeAccount?.id) === instanceId
}

const pickPublicServer = (instanceId: string) => {
  serverFilterMenuOpen.value = false
  if (instanceId.startsWith('host:')) {
    columnsStore.setColumnPin(props.column.id, {
      instanceId: null,
      serverHost: instanceId.slice(5),
    })
  } else {
    columnsStore.setColumnPin(props.column.id, {
      instanceId,
      serverHost: null,
    })
  }
  const label =
    instanceId === ALL_ACCOUNTS_INSTANCE
      ? 'all accounts'
      : instanceId.startsWith('host:')
        ? instanceId.slice(5)
        : hostnameOf(instancesStore.instances.find((i) => i.id === instanceId)?.url || '') ||
          'this server'
  toastStore.show({
    message:
      props.column.feedType === 'home'
        ? `Home · ${label}`
        : `Browsing ${props.column.feedType === 'federated' ? 'Federated' : 'Local'} on ${label}`,
    duration: 2200,
  })
  void fetchTimeline(true)
}

const { open: openAccountsManager } = useAccountsManager()

const openAddOrWatchServer = () => {
  serverFilterMenuOpen.value = false
  openAccountsManager()
}

const activeRecipe = computed(() =>
  props.column.feedType === 'algorithm'
    ? algorithmsStore.getRecipe(props.column.algorithmId)
    : null,
)

const homeFeedMode = computed(() => settingsStore.localPreferences.homeFeedMode || 'forYou')

const setHomeFeedMode = (mode: 'forYou' | 'following') => {
  if (homeFeedMode.value === mode) return
  settingsStore.updateAppearance({ homeFeedMode: mode })
}

const feedLabel = computed(() => {
  if (props.column.feedType === 'group' && props.column.groupTag) {
    const group = groupsStore.getGroup(props.column.groupTag)
    return group ? `${group.icon} ${group.name}` : `#${props.column.groupTag}`
  }
  if (props.column.feedType === 'algorithm') {
    return activeRecipe.value?.name || 'Algorithm'
  }
  if (props.column.feedType === 'list') {
    return props.column.listTitle || 'List'
  }
  if (props.column.feedType === 'rss') {
    return props.column.rssTitle || 'RSS'
  }
  if (props.column.feedType === 'local') {
    return columnPinnedHost.value || columnPinnedInstanceId.value
      ? `Local (${browsingHost.value})`
      : canSwitchPublicServer.value
        ? 'Local'
        : `Local (${browsingHost.value})`
  }
  if (props.column.feedType === 'federated') {
    return columnPinnedHost.value || columnPinnedInstanceId.value
      ? `Federated (${browsingHost.value})`
      : canSwitchPublicServer.value
        ? 'Federated'
        : `Federated (${browsingHost.value})`
  }
  if (props.column.feedType === 'home') {
    if (isUnifiedHome.value) return 'Home · All'
    if (columnPinnedInstanceId.value) {
      const pinned = instancesStore.instances.find((i) => i.id === columnPinnedInstanceId.value)
      const who = pinned?.user?.username || hostnameOf(pinned?.url || '') || 'account'
      return homeFeedMode.value === 'following' ? `Following · ${who}` : `For You · ${who}`
    }
    return homeFeedMode.value === 'following' ? 'Following' : 'For You'
  }
  return FEED_LABELS[props.column.feedType] ?? props.column.feedType
})

/** Guest browsing only auth-gated hosts (e.g. mastodon.social) with no token */
const isGatedGuestBrowse = computed(() => {
  if (instancesStore.hasAuthenticatedInstance) return false
  const targets = instancesStore.instances.length
    ? instancesStore.instances
    : [{ url: resolvePublicInstanceUrl(), accessToken: null as string | null }]
  return targets.every((i) => !i.accessToken && isAuthGatedPublicHost(i.url))
})

const isLoginRequiredError = computed(() => {
  const msg = (error.value || '').toLowerCase()
  return (
    msg.includes('requires login') ||
    msg.includes('authenticated') ||
    msg.includes('sign in') ||
    isGatedGuestBrowse.value
  )
})

type EmptyAction = { to: string; label: string; primary?: boolean }

const emptyState = computed((): {
  icon: NeoIconName
  title: string
  body: string
  actions: EmptyAction[]
} => {
  const authed = instancesStore.hasAuthenticatedInstance
  const feed = props.column.feedType

  if (!authed && isGatedGuestBrowse.value) {
    return {
      icon: 'lock',
      title: 'Sign in to open this feed',
      body: `${browsingHost.value} only shows its public timeline to signed-in people. Sign in with any Mastodon account, or pick a server that still shares public posts.`,
      actions: [
        { to: '/login', label: 'Sign in', primary: true },
        { to: '/explore', label: 'Find an open server' },
      ],
    }
  }

  if (!authed) {
    return {
      icon: 'globe',
      title: 'Browsing as a guest',
      body: 'You’re looking at public posts — no account needed. Sign in when you want your home feed, notifications, and to join groups.',
      actions: [
        { to: '/login', label: 'Sign in', primary: true },
        { to: '/explore', label: 'Explore servers' },
      ],
    }
  }

  if (feed === 'home') {
    return {
      icon: 'sparkle',
      title: 'Your feed is quiet',
      body: 'Follow people or explore servers to fill this column.',
      actions: [{ to: '/explore', label: 'Explore servers', primary: true }],
    }
  }

  if (feed === 'favourites') {
    return {
      icon: 'heart',
      title: 'No liked posts yet',
      body: 'Posts you like show up here.',
      actions: [],
    }
  }

  if (feed === 'bookmarks') {
    return {
      icon: 'bookmark',
      title: 'Nothing saved yet',
      body: 'Bookmark posts to read them later in this feed.',
      actions: [],
    }
  }

  if (feed === 'algorithm') {
    return {
      icon: 'filter',
      title: activeRecipe.value ? `No matches in ${activeRecipe.value.name}` : 'Algorithm not found',
      body: activeRecipe.value
        ? 'Try loosening filters, or wait for more posts on the source timeline.'
        : 'This recipe isn’t on this device. Open the share link again to import it.',
      actions: [],
    }
  }

  return {
    icon: 'message',
    title: 'No posts yet',
    body: 'Try another timeline, or find a different server to watch.',
    actions: [{ to: '/explore', label: 'Explore', primary: true }],
  }
})

const errorActions = computed((): EmptyAction[] => {
  if (!isLoginRequiredError.value) return []
  return [
    { to: '/login', label: 'Sign in', primary: true },
    { to: '/explore', label: 'Explore servers' },
  ]
})

const router = useRouter()

const switchFeed = (type: ColumnFeedType, feedParam?: string) => {
  feedMenuOpen.value = false
  algorithmsExpanded.value = true
  groupsExpanded.value = false
  pendingNew.value = []
  // Profiles are a full page — don't shrink them into a board column
  if (type === 'profile') {
    router.push(instancesStore.isAuthenticated ? '/profile' : '/login')
    return
  }
  if (type === props.column.feedType) {
    if (type === 'group' && feedParam === props.column.groupTag) return
    if (type === 'algorithm' && feedParam === props.column.algorithmId) return
    if (type === 'list' && feedParam === props.column.listId) return
    if (type === 'rss' && feedParam === props.column.rssUrl) return
    if (type !== 'group' && type !== 'algorithm' && type !== 'list' && type !== 'rss') return
  }
  emit('update-feed-type', type, feedParam)
}

const promptSwitchRss = () => {
  feedMenuOpen.value = false
  const raw = window.prompt(
    'Paste an RSS or Atom feed URL\n(e.g. https://example.com/feed.xml)',
  )
  if (!raw) return
  const url = raw.trim()
  if (!/^https?:\/\//i.test(url)) return
  emit('update-feed-type', 'rss', url)
}

const composeSheet = useComposeSheetStore()

const openColumnCompose = () => {
  if (!instancesStore.isAuthenticated) {
    router.push('/login')
    return
  }
  composeSheet.show({
    groupTag: props.column.feedType === 'group' ? props.column.groupTag : undefined,
  })
}

/** Tap feed title — scroll to top / jump to new posts (menu is on the chevron). */
const onFeedTitleClick = () => {
  if (!scrollContainer.value || scrollContainer.value.scrollTop <= 0) return
  if (pendingNew.value.length) {
    jumpToNew()
  } else {
    scrollContainer.value.scrollTo({ top: 0, behavior: scrollBehavior() })
  }
}
watch(feedMenuOpen, (open) => {
  if (!open) {
    algorithmsExpanded.value = true
    groupsExpanded.value = false
  }
})

const feedRoot = ref<HTMLElement | null>(null)
const { onKeydown: onFeedKeydown } = useFeedKeyboard(feedRoot)

onMounted(() => {
  nextTick(() => {
    const el = scrollContainer.value
    syncFlipPort()
    if (el && typeof ResizeObserver !== 'undefined') {
      flipRo?.disconnect()
      flipRo = new ResizeObserver(() => syncFlipPort())
      flipRo.observe(el)
    }
  })

  void (async () => {
    if (instancesStore.isAuthenticated && groupsStore.groups.length === 0) {
      groupsStore.initializeGroups()
    }
  })()
})

onUnmounted(() => {
  if (listMotionTimer) clearTimeout(listMotionTimer)
  if (newPostsAnnounceTimer) clearTimeout(newPostsAnnounceTimer)
  flipRo?.disconnect()
  flipRo = null
})

</script>
<template>
  <div
    class="timeline-column neo-chrome"
    :class="{
      'neo-chrome--recessed': recessed,
      'timeline-column--drop-target': dropTarget,
      'timeline-column--dragging': dragging,
      'timeline-column--menu-open': feedMenuOpen || serverFilterMenuOpen,
      'timeline-column--focus-wide': isDesktop && focused,
    }"
    @dragover="onColumnDragOver"
    @drop="onColumnDrop"
  >
    <h2 class="column-title">{{ feedLabel }}</h2>

    <!-- Column Header — drag handle, reorder arrows and close live in ColumnChrome -->
    <ColumnChrome
      :column-id="column.id"
      :can-reorder="canReorder"
      :is-first="isFirst"
      :is-last="isLast"
      @column-drag-start="emit('column-drag-start', $event)"
      @column-drag-end="emit('column-drag-end')"
      @column-drag-over="emit('column-drag-over', $event)"
      @column-drop="emit('column-drop', $event)"
      @move-left="emit('move-left')"
      @move-right="emit('move-right')"
    >
      <template #title>
        <div class="column-feed-select">
          <button
            type="button"
            class="column-feed-title"
            :aria-label="`${feedLabel}. Scroll to top`"
            @click.stop="onFeedTitleClick"
          >
            <span class="column-feed-label">{{ feedLabel }}</span>
          </button>
          <NeoMenu
            v-if="canSwitchPublicServer"
            v-model:open="serverFilterMenuOpen"
            class="column-server-menu"
            align="start"
            :label="`Browse ${feedLabel} on ${browsingHost}`"
            @pointerdown.stop
          >
            <span class="column-server-pill">
              <span class="column-server-pill__host">{{ browsingHost }}</span>
              <svg
                class="column-server-pill__chevron"
                :class="{ 'column-server-pill__chevron--open': serverFilterMenuOpen }"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
            <template #items>
              <button
                v-for="server in publicServerChoices"
                :key="server.id"
                type="button"
                role="menuitemradio"
                class="feed-dropdown__item"
                :class="{ 'feed-dropdown__item--on': isPublicServerSelected(server.id) }"
                :aria-checked="isPublicServerSelected(server.id)"
                @click="pickPublicServer(server.id)"
              >
                <span class="column-server-choice">
                  <span class="column-server-choice__host">{{ server.host }}</span>
                  <span
                    v-if="server.kind === 'watching'"
                    class="column-server-choice__tag"
                  >Watching</span>
                  <span
                    v-else-if="server.kind === 'expired'"
                    class="column-server-choice__tag column-server-choice__tag--warn"
                  >Expired</span>
                </span>
                <NeoIcon
                  v-if="isPublicServerSelected(server.id)"
                  name="check"
                  :size="16"
                  :stroke="2.5"
                />
              </button>
              <div class="feed-dropdown__divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                class="feed-dropdown__item"
                @click="openAddOrWatchServer"
              >
                Add / watch server…
              </button>
            </template>
          </NeoMenu>
          <div
            v-if="column.feedType === 'home' && canShowHome"
            class="column-home-mode"
            role="group"
            aria-label="Home feed ranking"
            @pointerdown.stop
          >
            <button
              type="button"
              class="column-home-mode__opt"
              :class="{ 'is-on': homeFeedMode === 'forYou' }"
              :aria-pressed="homeFeedMode === 'forYou'"
              @click.stop="setHomeFeedMode('forYou')"
            >
              For you
            </button>
            <button
              type="button"
              class="column-home-mode__opt"
              :class="{ 'is-on': homeFeedMode === 'following' }"
              :aria-pressed="homeFeedMode === 'following'"
              @click.stop="setHomeFeedMode('following')"
            >
              Following
            </button>
          </div>
          <NeoMenu
            v-model:open="feedMenuOpen"
            class="column-feed-menu"
            align="start"
            :label="`Switch feed (${feedLabel})`"
          >
            <svg
              class="column-feed-chevron"
              :class="{ 'column-feed-chevron--open': feedMenuOpen }"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <template #items>
              <FeedMenuItems
                variant="switch"
                :timelines-expanded="algorithmsExpanded"
                local-host-label=""
                :active-feed-type="column.feedType"
                :active-algorithm-id="column.algorithmId"
                :active-group-tag="column.groupTag"
                :active-list-id="column.listId"
                :active-rss-url="column.rssUrl"
                :can-show-home="canShowHome"
                :groups-expanded="groupsExpanded"
                :joined-groups="joinedGroups"
                show-panel-feeds
                @toggle-timelines="algorithmsExpanded = !algorithmsExpanded"
                @toggle-groups="groupsExpanded = !groupsExpanded"
                @pick="switchFeed"
                @add-rss="promptSwitchRss"
                @create-algorithm="feedMenuOpen = false; algorithmsStore.openEditor()"
                @edit-algorithm="(id) => { feedMenuOpen = false; algorithmsStore.openEditor(id) }"
              />
              <div class="feed-dropdown__divider" role="separator" />
              <NuxtLink
                to="/groups"
                role="menuitem"
                class="feed-dropdown__item feed-dropdown__item--link"
                @click="feedMenuOpen = false"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87" />
                  <path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
                Browse Groups
              </NuxtLink>
            </template>
          </NeoMenu>
        </div>
      </template>
      <template #actions>
        <div
          v-if="showModeSwitch"
          class="column-mode"
          role="group"
          aria-label="How to move through this feed"
          @pointerdown.stop
        >
          <button
            type="button"
            class="column-mode__opt"
            :class="{ 'is-on': !isFlip }"
            :aria-pressed="!isFlip"
            title="Feed — scroll a list"
            @click.stop="setViewMode('flow')"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
            Feed
          </button>
          <button
            type="button"
            class="column-mode__opt"
            :class="{ 'is-on': isFlip }"
            :aria-pressed="isFlip"
            title="Flick — one post at a time (j / k, wheel, or arrows)"
            @click.stop="setViewMode('flip')"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <rect x="6" y="3" width="12" height="18" rx="2" />
              <polyline points="9 10 12 7 15 10" />
            </svg>
            Flick
          </button>
        </div>

        <button
          type="button"
          class="neo-chrome-btn column-focus"
          :class="{ 'column-focus--push': !canReorder && !showModeSwitch, 'neo-chrome-btn--on': focused }"
          :aria-label="focused ? 'Show all views' : 'Focus this view'"
          :aria-pressed="focused"
          @pointerdown.stop
          @click.stop="emit('focus')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </template>
      <template #close>
        <button
          v-if="canRemove"
          type="button"
          class="neo-chrome-btn neo-chrome-btn--danger column-close"
          aria-label="Remove column"
          @pointerdown.stop
          @click.stop="emit('remove')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </template>
    </ColumnChrome>

    <!-- Mobile: column header is hidden — keep For you / Following reachable -->
    <div
      v-if="column.feedType === 'home' && canShowHome"
      class="column-home-mode column-home-mode--mobile"
      role="group"
      aria-label="Home feed ranking"
    >
      <button
        type="button"
        class="column-home-mode__opt"
        :class="{ 'is-on': homeFeedMode === 'forYou' }"
        :aria-pressed="homeFeedMode === 'forYou'"
        @click="setHomeFeedMode('forYou')"
      >
        For you
      </button>
      <button
        type="button"
        class="column-home-mode__opt"
        :class="{ 'is-on': homeFeedMode === 'following' }"
        :aria-pressed="homeFeedMode === 'following'"
        @click="setHomeFeedMode('following')"
      >
        Following
      </button>
    </div>

    <!-- Scrollable Content -->
    <div
      class="column-scroll"
      :class="{ 'column-scroll--flip': isFlip }"
      ref="scrollContainer"
    >
      <!-- Mobile pull-to-refresh affordance -->
      <div
        v-if="pullDistance > 0 || isRefreshing"
        class="column-ptr"
        :class="{ 'column-ptr--ready': pullDistance >= PTR_THRESHOLD || isRefreshing }"
        :style="{ height: `${isRefreshing ? 48 : pullDistance}px` }"
        aria-live="polite"
      >
        <span class="column-ptr__label">{{ pullHint }}</span>
      </div>

      <!-- Compose: desktop first column — opens Threads-style New thread modal -->
      <div
        v-if="isFirst && instancesStore.isAuthenticated && isDesktop"
        class="column-compose"
      >
        <button
          type="button"
          class="column-compose__launch"
          @click="openColumnCompose"
        >
          <img
            v-if="instancesStore.userAvatar"
            :src="instancesStore.userAvatar"
            alt=""
            class="column-compose__avatar neo-avatar"
          />
          <span class="column-compose__placeholder">What's new?</span>
        </button>
      </div>

      <!-- New posts pill — never auto-jumps the feed -->
      <span class="sr-only" aria-live="polite" aria-atomic="true">{{ newPostsAnnounce }}</span>
      <Transition name="pill-slide">
        <button
          v-if="pendingNew.length"
          type="button"
          class="column-new-pill"
          :aria-label="`${pendingLabel}. Jump to the top.`"
          @click="jumpToNew"
        >
          {{ pendingLabel }}
        </button>
      </Transition>

      <!-- Busy-timeline gap: catch-up hit its page cap -->
      <div v-if="timelineGap" class="column-gap" role="status">
        <p class="column-gap__text">
          This feed was busy — some newer posts may still be catching up.
        </p>
        <button type="button" class="column-retry column-retry--accent" @click="recoverTimelineGap">
          Reload feed
        </button>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="column-state" aria-busy="true">
        <FunLoader fill quiet label="Loading" />
      </div>

      <!-- Error -->
      <div v-else-if="error" class="column-state column-state--error" role="alert">
        <span class="column-error__icon">
          <NeoIcon :name="isLoginRequiredError ? 'lock' : 'alert'" :size="22" :stroke="1.75" />
        </span>
        <p class="column-state__title">
          {{ isLoginRequiredError ? 'Sign in to see this feed' : 'Couldn’t load posts' }}
        </p>
        <p>{{ error }}</p>
        <div v-if="errorActions.length" class="column-state__actions">
          <NuxtLink
            v-for="action in errorActions"
            :key="action.to + action.label"
            :to="action.to"
            class="neo-btn neo-btn--sm"
            :class="action.primary ? 'neo-btn--primary' : 'neo-btn--ghost'"
          >
            {{ action.label }}
          </NuxtLink>
        </div>
        <p v-if="autoRetryIn" class="column-state__hint">Trying again automatically in about {{ autoRetryIn }}s.</p>
        <button v-if="!errorActions.length" type="button" class="column-retry" @click="fetchTimeline(true)">Retry</button>
      </div>

      <!-- Login prompt for home when not authenticated -->
      <div v-else-if="column.feedType === 'home' && !canShowHome" class="column-state">
        <span aria-hidden="true">👋</span>
        <p class="column-state__title">Home needs a sign-in</p>
        <p>
          You’re browsing as a guest. Sign in with a Mastodon account to see people you follow —
          or switch this column to Local / Federated for public posts.
        </p>
        <div class="column-state__actions">
          <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in</NuxtLink>
          <NuxtLink to="/explore" class="neo-btn neo-btn--ghost neo-btn--sm">Explore servers</NuxtLink>
        </div>
      </div>

      <!-- Empty / first-run -->
      <div v-else-if="statuses.length === 0" class="column-state">
        <span class="column-state__icon"><NeoIcon :name="emptyState.icon" :size="28" :stroke="1.5" /></span>
        <p class="column-state__title">{{ emptyState.title }}</p>
        <p>{{ emptyState.body }}</p>
        <div v-if="emptyState.actions.length" class="column-state__actions">
          <NuxtLink
            v-for="action in emptyState.actions"
            :key="action.to + action.label"
            :to="action.to"
            class="neo-btn neo-btn--sm"
            :class="action.primary ? 'neo-btn--primary' : 'neo-btn--ghost'"
          >
            {{ action.label }}
          </NuxtLink>
        </div>
      </div>

      <!-- Posts — role="feed" owns articles only; paging/status chrome follows as siblings -->
      <template v-else>
        <div
          ref="feedRoot"
          class="column-posts"
          :class="{
            'column-posts--flip': isFlip,
            'column-posts--focus-wide': isDesktop && focused,
          }"
          role="feed"
          tabindex="0"
          :aria-busy="isLoadingMore || isLoading"
          :aria-label="`${feedLabel} posts`"
          @keydown="onFeedKeydown"
        >
          <template v-if="isFlip">
            <RealPostCard
              v-for="(row, idx) in displayRows"
              :key="row.key"
              :status="row.status"
              :column-id="column.id"
              variant="flip"
              hide-inline-reply
              :aria-posinset="idx + 1"
              :aria-setsize="feedSetSize"
            />
          </template>
          <template v-else>
            <RealPostCard
              v-for="(row, idx) in displayRows"
              :key="row.key"
              :status="row.status"
              :column-id="column.id"
              :class="{ 'post-list-enter': enteringKeys.has(row.key) }"
              :aria-posinset="idx + 1"
              :aria-setsize="feedSetSize"
            />
          </template>
        </div>

        <!-- Infinite scroll trigger -->
        <div ref="loadTrigger" class="column-load-trigger" :class="{ 'column-load-trigger--flip': isFlip }">
          <Transition name="fade">
            <div v-if="isLoadingMore" class="column-loading-more" role="status" aria-busy="true">
              <FunLoader
                :size="sparseSkipStreak > 0 ? 72 : 120"
                quiet
                :label="sparseSkipStreak > 0 ? 'Looking further' : 'Loading more'"
              />
              <p v-if="sparseSkipStreak > 0" class="column-loading-more__hint">
                Looking further…
              </p>
            </div>
          </Transition>
          <div v-if="loadMoreError" class="column-load-foot column-load-foot--error" role="alert">
            <p class="column-load-foot__title">Couldn’t load more</p>
            <p class="column-load-foot__body">{{ loadMoreError }}</p>
            <button type="button" class="column-retry" @click="loadMoreError = null; loadMore()">
              Try again
            </button>
          </div>
          <div
            v-else-if="lastLoadAddedNothing && hasMore && !isLoadingMore"
            class="column-load-foot"
            role="status"
          >
            <p class="column-load-foot__title">{{ sparsePauseCopy.title }}</p>
            <p class="column-load-foot__body">{{ sparsePauseCopy.body }}</p>
            <button type="button" class="column-retry column-retry--accent" @click="continueAfterSparsePause">
              {{ sparsePauseCopy.action }}
            </button>
          </div>
        </div>

        <div
          v-if="!hasMore && statuses.length > 0 && !isLoadingMore"
          class="column-end"
          :class="{ 'column-end--flip': isFlip }"
          role="status"
        >
          <p class="column-end__title">{{ endOfFeedCopy }}</p>
          <p class="column-end__body">Pull to refresh, or check back when something new lands.</p>
          <button type="button" class="column-retry" @click="fetchTimeline(true)">
            Refresh feed
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.timeline-column {
  flex: 1 0 280px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 280px;
  border-right: 1px solid var(--neo-border-color);
  position: relative;
  transition: opacity 0.15s ease, background 0.15s ease;

  &:last-of-type {
    border-right: none;
  }

  &--dragging {
    opacity: 0.45;
  }

  &--drop-target {
    background: color-mix(in srgb, var(--neo-accent) 6%, transparent);

    .column-header {
      box-shadow: inset 3px 0 0 var(--neo-accent);
    }
  }

  /* Keep feed menu above neighboring columns so items stay clickable */
  &--menu-open {
    z-index: 40;

    .column-header {
      z-index: 40;
    }
  }

  // Focused desktop: keep the title/chrome readable while the stage goes wide
  &--focus-wide {
    .column-header {
      max-width: 44rem;
      width: 100%;
      margin-inline: auto;
      box-sizing: border-box;
    }
  }
}

.column-title {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.column-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.5rem 0 0.35rem;
  height: 48px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
  position: relative;
  z-index: 10;

  // Mobile tabs already name the feed — drop the duplicate chrome
  @media (max-width: 1023px) {
    display: none;
  }
}

.column-focus--push {
  margin-left: auto;
}

.column-home-mode {
  display: inline-flex;
  flex-shrink: 0;
  margin-left: 0.35rem;
  padding: 2px;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-secondary);

  &--mobile {
    display: none;
    margin: 0;
    padding: 0.35rem 0.75rem;
    border: none;
    border-bottom: 1px solid var(--neo-border-color);
    border-radius: 0;
    background: var(--neo-bg-primary);

    @media (max-width: 1023px) {
      display: flex;
      justify-content: center;
    }
  }

  &__opt {
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 0 0.7rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--neo-chrome-fg, var(--neo-text-secondary));
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      color var(--neo-dur-quick, 160ms) var(--neo-ease-out),
      background-color var(--neo-dur-quick, 160ms) var(--neo-ease-out),
      transform var(--neo-dur-instant, 90ms) var(--neo-ease-spring),
      box-shadow var(--neo-dur-quick, 160ms) var(--neo-ease-out);

    @include hover {
      color: var(--neo-text-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--neo-focus, var(--neo-accent));
      outline-offset: 1px;
    }

    &:active {
      transform: scale(0.95);
    }

    &.is-on {
      background: var(--neo-bg-card, var(--neo-bg-primary));
      color: var(--neo-text-primary);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--neo-text-primary) 14%, transparent);
      animation: column-pill-settle var(--neo-dur-normal, 240ms) var(--neo-ease-spring) both;
    }
  }
}

/* Feed / Flick — segmented, quiet until hovered */
.column-mode {
  display: inline-flex;
  flex-shrink: 0;
  margin-left: auto;
  margin-right: 0.25rem;
  padding: 2px;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-secondary);

  // Reorder arrows (when shown) sit between title and this — they own the push
  .column-reorder + & {
    margin-left: 0.25rem;
  }

  &__opt {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 26px;
    padding: 0 0.6rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--neo-chrome-fg);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      color var(--neo-dur-quick, 160ms) var(--neo-ease-out),
      background-color var(--neo-dur-quick, 160ms) var(--neo-ease-out),
      transform var(--neo-dur-instant, 90ms) var(--neo-ease-spring),
      box-shadow var(--neo-dur-quick, 160ms) var(--neo-ease-out);

    @include hover {
      color: var(--neo-text-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--neo-focus, var(--neo-accent));
      outline-offset: 1px;
    }

    &:active {
      transform: scale(0.95);
    }

    &.is-on {
      background: var(--neo-bg-card, var(--neo-bg-primary));
      color: var(--neo-text-primary);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--neo-text-primary) 14%, transparent);
      animation: column-pill-settle var(--neo-dur-normal, 240ms) var(--neo-ease-spring) both;
    }
  }
}

@keyframes column-pill-settle {
  0% { transform: scale(0.94); }
  55% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

/* Desktop flick (board / multi-column): keep a centred readable stage.
   Focused mode uses .column-posts--focus-wide for edge-to-edge media. */
@media (min-width: 1024px) {
  .column-posts--flip:not(.column-posts--focus-wide) {
    width: min(760px, 100%);
    margin-inline: auto;
  }
}

.neo-chrome-btn--on {
  color: var(--neo-accent);
}


.column-gap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin: 0.75rem 1rem;
  padding: 0.75rem 1rem;
  text-align: center;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-lg);

  &__text {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
  }
}

.column-new-pill {
  position: sticky;
  top: 0.75rem;
  z-index: 8;
  display: block;
  margin: 0.75rem auto;
  padding: 0.4rem 0.9rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--neo-text-inverse);
  background: var(--neo-accent);
  border: 1px solid var(--neo-accent-dark, var(--neo-accent));
  border-radius: var(--neo-radius-sm);
  cursor: pointer;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--neo-accent) 28%, transparent);
  transition:
    transform var(--neo-dur-quick, 160ms) var(--neo-ease-spring),
    background-color var(--neo-dur-quick, 160ms) var(--neo-ease-out),
    box-shadow var(--neo-dur-quick, 160ms) var(--neo-ease-out);

  @include hover {
    background: var(--neo-accent-hover);
    transform: translateY(var(--neo-hover-lift, -2px));
    box-shadow: 0 5px 14px color-mix(in srgb, var(--neo-accent) 36%, transparent);
  }

  &:active {
    transition-duration: var(--neo-dur-instant, 90ms);
    transform: translateY(var(--neo-anticipate-y, 2px))
      scale3d(var(--neo-press-squash-x, 1.07), var(--neo-press-squash-y, 0.9), 1);
  }
}

.pill-slide-enter-active {
  transition:
    opacity var(--neo-dur-normal, 240ms) var(--neo-ease-out),
    transform var(--neo-dur-normal, 240ms) var(--neo-ease-bounce, var(--neo-ease-spring));
}

.pill-slide-leave-active {
  transition:
    opacity var(--neo-dur-quick, 160ms) var(--neo-ease-in),
    transform var(--neo-dur-quick, 160ms) var(--neo-ease-in);
}

.pill-slide-enter-from,
.pill-slide-leave-to {
  opacity: 0;
  transform: translateY(-0.65rem) scale(0.92);
}

.column-feed-select {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  // Title area owns the free space, so focus / close stay pinned right even
  // when the hover-only reorder arrows (their old margin-left: auto) are hidden
  flex: 1 1 auto;
  min-width: 0;
  border-radius: var(--neo-radius-md);
  user-select: none;
}

.column-feed-title {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0.375rem 0.35rem 0.375rem 0.5rem;
  border: none;
  border-radius: var(--neo-radius-md);
  background: transparent;
  cursor: pointer;
  transition: background-color var(--neo-transition-fast);

  @include hover {
    background: var(--neo-bg-tertiary);
  }
}

.column-feed-menu {
  flex-shrink: 0;

  :deep(.neo-menu__trigger) {
    padding: 0.375rem 0.5rem 0.375rem 0.25rem;
    border-radius: var(--neo-radius-md);
    color: var(--neo-chrome-fg);

    @include hover {
      background: var(--neo-bg-tertiary);
    }
  }

  :deep(.neo-menu__panel) {
    left: 0;
    right: auto;
    width: 220px;
    max-height: min(70vh, 28rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--neo-bg-secondary);
    border-radius: var(--neo-radius-md);
    box-shadow: var(--neo-shadow-md);
    padding: 0.375rem;
    z-index: var(--neo-z-dropdown, 1000);
  }
}

.column-server-menu {
  flex-shrink: 0;
  margin-left: 0.35rem;
}

.column-server-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  max-width: 10rem;
  padding: 0.15rem 0.45rem 0.15rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--neo-border-color);
  background: var(--neo-bg-secondary);
  color: var(--neo-text-secondary);
  font-size: 0.75rem;
  font-weight: 650;
}

.column-server-pill__host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.column-server-pill__chevron {
  flex-shrink: 0;
  transition: transform var(--neo-dur-quick, 160ms) var(--neo-ease-out);

  &--open {
    transform: rotate(180deg);
  }
}

.column-server-choice {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.column-server-choice__host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.column-server-choice__tag {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--neo-text-muted);

  &--warn {
    color: var(--neo-warning);
  }
}

.column-feed-label {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-chrome-label);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: min(280px, 46vw);
  transition: color var(--neo-transition-fast);
}

.column-feed-chevron {
  color: var(--neo-chrome-fg);
  transition: transform 0.2s ease, color var(--neo-transition-fast);
  flex-shrink: 0;

  &--open {
    transform: rotate(180deg);
  }
}

// ========================================
// Feed Dropdown items (inside NeoMenu panel)
// ========================================
.feed-dropdown {
  &__item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--neo-text-secondary);
    border-radius: var(--neo-radius-lg);
    transition: background-color 0.12s ease, color 0.12s ease;
    text-decoration: none;

    @include hover(':not(:disabled)') {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &--active {
      background: var(--neo-accent-soft);
      color: var(--neo-text-primary);
      font-weight: 600;
    }

    &--group {
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
    }

    &--link {
      color: var(--neo-text-muted);
      font-size: 0.8125rem;
    }

    &--algo {
      align-items: flex-start;
    }

    svg {
      flex-shrink: 0;
    }
  }

  &__algo {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    text-align: left;
  }

  &__algo-name {
    font: inherit;
  }

  &__algo-tip {
    font-size: 0.6875rem;
    font-weight: 450;
    line-height: 1.3;
    color: var(--neo-text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__group-icon {
    font-size: 1rem;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  &__divider {
    height: 1px;
    background: var(--neo-border-color);
    margin: 0.375rem 0.5rem;
  }

  &__subhead {
    display: block;
    padding: 0.4rem 0.85rem 0.15rem;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--neo-text-muted);
  }

  &__section-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: var(--neo-radius-lg);
    transition: background-color 0.12s ease, color 0.12s ease;

    @include hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-secondary);
    }

    svg {
      transition: transform 0.2s ease;
      &.rotated {
        transform: rotate(180deg);
      }
    }
  }

  &__groups {
    display: flex;
    flex-direction: column;
  }
}

// ========================================
// Column Scroll + Posts
// ========================================
.column-ptr {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  color: var(--neo-text-tertiary);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  transition: color 0.12s ease;

  &--ready {
    color: var(--neo-accent);
  }

  &__label {
    padding-bottom: 0.5rem;
  }

  @media (min-width: 1024px) {
    display: none;
  }
}

.column-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  // Queryable width so focused-mode media can bleed to the column edges
  container-type: inline-size;
  container-name: timeline-col;
  // Mobile: vertical latch — horizontal feed switches are driven by index.vue
  // axis-lock (Chrome Android won't chain pan-x through this).
  // Desktop / iPad board: allow horizontal pan so Magic Keyboard trackpad can
  // reach .columns-container (wheel bridge is the other half).
  touch-action: pan-y;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  background: var(--neo-bg-primary);
  scrollbar-width: thin;
  scrollbar-color: var(--neo-text-muted) transparent;

  @media (min-width: 1024px) {
    touch-action: pan-x pan-y;
  }

  @media (max-width: 1023px) {
    // Clear bottom pills + tab bar so end-of-feed / Look further isn't tucked under chrome
    padding-bottom: calc(
      var(--neo-mobile-nav-h, 56px) + var(--neo-feed-tabs-h, 48px) + env(safe-area-inset-bottom, 0px) +
        1.25rem
    );
  }

  &--flip {
    scroll-snap-type: y mandatory;
    scroll-padding: 0;
    padding-bottom: 0;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--neo-text-muted);
    border-radius: 3px;
    @include hover {
      background: var(--neo-text-secondary);
    }
  }
}

.column-compose {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--neo-border-color);
}

.column-compose__launch {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  min-height: 44px;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-muted);
  cursor: pointer;
  text-align: left;
  touch-action: manipulation;

  &:focus-visible {
    background: var(--neo-bg-hover);
    color: var(--neo-text-secondary);
  }

  @include hover {
    background: var(--neo-bg-hover);
    color: var(--neo-text-secondary);
  }

  &:focus-visible {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }
}

.column-compose__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.column-compose__placeholder {
  font-size: 0.9375rem;
  font-weight: 500;
}

.column-state {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 0.625rem;
  min-height: 100%;
  width: 100%;
  padding: 1.25rem 1.5rem;
  text-align: center;
  box-sizing: border-box;

  &[aria-busy='true'] {
    min-height: min(55dvh, 28rem);
  }

  &__icon,
  .column-error__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    color: var(--neo-text-tertiary);
  }

  p {
    max-width: 28ch;
    margin-left: auto;
    margin-right: auto;
    color: var(--neo-text-muted);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  &__title {
    margin: 0;
    max-width: none !important;
    font-size: 1rem !important;
    font-weight: 600;
    color: var(--neo-text-primary) !important;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 0.35rem;
  }
}

.column-state__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
}

.column-retry {
  padding: 0.55rem 1.1rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-tertiary);
  border: none;
  border-radius: var(--neo-radius-lg);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;

  @include hover {
    background: var(--neo-bg-hover);
    color: var(--neo-text-primary);
  }

  &--accent {
    color: var(--neo-text-on-accent, #fff);
    background: var(--neo-accent);

    @include hover {
      background: var(--neo-accent-hover, var(--neo-accent));
      color: var(--neo-text-on-accent, #fff);
    }
  }
}

.column-load-foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  margin: 0.35rem 0.75rem 0.75rem;
  padding: 1rem 1rem 1.15rem;
  text-align: center;
  color: var(--neo-text-muted);
  font-size: 0.875rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-lg);

  &--error {
    border-color: color-mix(in srgb, var(--neo-danger, #dc2626) 35%, var(--neo-border-color));
  }

  &__title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 650;
    color: var(--neo-text-primary);
  }

  &__body {
    margin: 0 0 0.45rem;
    max-width: 22rem;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--neo-text-secondary);
  }
}

.column-posts {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.5rem;

  // Wide single columns (tablet portrait, desktop tab mode): keep ~70ch lines
  &:not(.column-posts--flip) {
    width: 100%;
    max-width: 44rem;
    margin-inline: auto;
    box-sizing: border-box;
  }

  // Subtle card edges within columns
  // Paint containment clips the post's "More options" dropdown at the card edge
  :deep(.status-card.status-card--menu-open) {
    content-visibility: visible;
  }

  :deep(.status-card) {
    content-visibility: auto;
    contain-intrinsic-size: auto 220px;
    border: 1px solid var(--neo-border-color);
    border-radius: var(--neo-radius-md);
    transition: border-color var(--neo-transition-fast);

    @include hover {
      border-color: var(--neo-border-color-dark);
    }
  }

  &--flip {
    gap: 0;
    padding: 0;

    :deep(.status-card) {
      border: none;
      border-radius: 0;
      flex: 0 0 var(--flip-port, 100%);
      height: var(--flip-port, 100%);
      min-height: var(--flip-port, 100%);
      max-height: var(--flip-port, 100%);

      @include hover {
        border-color: transparent;
      }
    }
  }

  // Focused desktop: media spans the column; reading chrome stays ~44rem
  &--focus-wide:not(.column-posts--flip) {
    // content-visibility paint-containment would clip the media breakout
    :deep(.status-card) {
      content-visibility: visible;
    }

    :deep(.status-media) {
      width: 100cqi;
      max-width: 100cqi;
      margin-left: calc(50% - 50cqi);
      border-radius: 0;
    }

    :deep(.status-media-image) {
      max-height: min(70vh, 720px);
      object-fit: contain;
      background: var(--neo-bg-secondary);

      @media (max-height: 500px) and (orientation: landscape) {
        max-height: calc(100dvh - 4.5rem);
      }
    }

    :deep(.status-media-video) {
      max-height: min(75vh, 800px);

      @media (max-height: 500px) and (orientation: landscape) {
        max-height: calc(100dvh - 4.5rem);
      }
    }
  }

  &--focus-wide.column-posts--flip {
    width: 100%;
    max-width: none;
    margin-inline: 0;
  }
}

.column-load-trigger {
  min-height: 1px;
  padding: 0.5rem 0;

  // Sibling of the flip feed (not inside it), so size from the flip viewport
  &--flip {
    min-height: calc(var(--flip-port, 0px) * 0.4);
    scroll-snap-align: start;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.column-loading-more {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0.35rem;
  min-height: 9rem;
  padding: 1.25rem 0.75rem;
  box-sizing: border-box;

  &__hint {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--neo-text-muted);
  }
}

.column-end {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin: 0.5rem 0.75rem 1.25rem;
  padding: 1.25rem 1rem 1.35rem;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-lg);

  &--flip {
    margin-inline: 1rem;
    min-height: calc(var(--flip-port, 0px) * 0.35);
  }

  &__title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 650;
    color: var(--neo-text-primary);
  }

  &__body {
    margin: 0 0 0.45rem;
    max-width: 20rem;
    line-height: 1.4;
    color: var(--neo-text-secondary);
  }
}

// ========================================
// Animations
// ========================================
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
  transform-origin: top left;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}

.groups-expand-enter-active,
.groups-expand-leave-active {
  transition: opacity 0.2s ease, max-height 0.2s ease;
  overflow: hidden;
}
.groups-expand-enter-from,
.groups-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.groups-expand-enter-to,
.groups-expand-leave-from {
  max-height: 300px;
}

// Just-prepended cards (see withPrependMotion) — directional spring settle + bounded micro-cascade
.post-list-enter {
  animation: post-list-enter var(--neo-dur-normal, 240ms) var(--neo-ease-spring, var(--neo-ease-out)) backwards;

  @for $i from 1 through 8 {
    &:nth-child(#{$i}) {
      animation-delay: calc(#{$i - 1} * var(--neo-stagger-step, 26ms));
    }
  }
}
@keyframes post-list-enter {
  from {
    opacity: 0;
    transform: translateY(-10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .post-list-enter {
    animation: none !important;
  }
  .dropdown-enter-active,
  .dropdown-leave-active,
  .groups-expand-enter-active,
  .groups-expand-leave-active,
  .pill-slide-enter-active,
  .pill-slide-leave-active,
  .fade-enter-active,
  .fade-leave-active {
    transition: none !important;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
