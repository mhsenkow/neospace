<script setup lang="ts">
/**
 * Home Page - Multi-column TweetDeck-style layout
 *
 * Supports 1-8 independent timeline columns, each with its own
 * feed type, scroll position, and data. Column config is persisted.
 * Desktop: equal-flex columns with a min width + horizontal scroll.
 * Mobile: full-width scroll-snap carousel (swipe left/right).
 */

import { useThemeStore } from '~/stores/theme'
import { useInstancesStore } from '~/stores/instances'
import {
  useColumnsStore,
  MAX_COLUMNS,
  FEED_LABELS,
  isTimelineFeed,
  type ColumnFeedType,
} from '~/stores/columns'
import { useGroupsStore } from '~/stores/groups'
import { useAlgorithmsStore } from '~/stores/algorithms'
import { useSettingsStore } from '~/stores/settings'
import { useConversationsStore } from '~/stores/conversations'
import { useNotificationsStore } from '~/stores/notifications'
import { THEME_OPTIONS, UI_OPTIONS, resolveTheme } from '~/utils/appearance'
import { hostnameOf, resolvePublicInstanceUrl } from '~/utils/instances'
import { BOARD_RIGHT_PORTALS, type BoardPortal } from '~/composables/useBoardPortal'
import { participantLabel } from '~/utils/dmHelpers'

const themeStore = useThemeStore()
const instancesStore = useInstancesStore()
const columnsStore = useColumnsStore()
const groupsStore = useGroupsStore()
const settingsStore = useSettingsStore()
const conversationsStore = useConversationsStore()
const notificationsStore = useNotificationsStore()
const { setBoardPortal } = useBoardPortal()
const router = useRouter()

const addMenuOpen = ref(false)
const addAlgorithmsExpanded = ref(true)
const addGroupsExpanded = ref(true)
const addGroupQuery = ref('')
const columnsContainer = ref<HTMLElement | null>(null)
const activeColumnIndex = ref(0)
const draggingColumnId = ref<string | null>(null)
const dropTargetColumnId = ref<string | null>(null)

/** Mobile-only: Settings → Profile → feeds → Search → Inbox → Activity → Groups */
const MOBILE_CAROUSEL_MQ = '(max-width: 1023px)'
const EDGE_LEFT = 2
const EDGE_RIGHT = BOARD_RIGHT_PORTALS.length
const isMobileUi = ref(false)
const carouselSlideIndex = ref(0)
const portalSearch = ref('')
let portalActionLock = false
let mobileMq: MediaQueryList | null = null

const slideCount = computed(() => {
  const feeds = columnsStore.columns.length
  return isMobileUi.value ? EDGE_LEFT + feeds + EDGE_RIGHT : feeds
})

const feedSlideOffset = computed(() => (isMobileUi.value ? EDGE_LEFT : 0))

const localHostLabel = computed(() => {
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

const algorithmsStore = useAlgorithmsStore()
algorithmsStore.hydrate()

const columnTabLabels = computed(() =>
  columnsStore.columns.map((column) => {
    if (column.feedType === 'group' && column.groupTag) {
      const group = groupsStore.getGroup(column.groupTag)
      return group ? `${group.icon} ${group.name}` : `#${column.groupTag}`
    }
    if (column.feedType === 'algorithm' && column.algorithmId) {
      return algorithmsStore.getRecipe(column.algorithmId)?.name || 'Algorithm'
    }
    if (column.feedType === 'local') {
      return `Local (${localHostLabel.value})`
    }
    return FEED_LABELS[column.feedType] ?? column.feedType
  }),
)

const feedTabs = computed(() =>
  columnsStore.columns.map((column, idx) => ({
    id: column.id,
    label: columnTabLabels.value[idx] || column.feedType,
  })),
)

const isDeskTabs = computed(
  () => columnsStore.deskDensity === 'tabs' && !isMobileUi.value,
)

const activeFeedTabId = computed({
  get: () => {
    if (isDeskTabs.value && columnsStore.focusedColumnId) {
      return columnsStore.focusedColumnId
    }
    return columnsStore.columns[activeColumnIndex.value]?.id || feedTabs.value[0]?.id || ''
  },
  set: (id: string) => {
    const idx = columnsStore.columns.findIndex((c) => c.id === id)
    if (idx < 0) return
    activeColumnIndex.value = idx
    if (isDeskTabs.value) {
      columnsStore.setFocusedColumn(id)
      return
    }
    // Always re-park — same-id taps recover Android desync; use auto on mobile
    scrollToColumn(idx, isMobileUi.value ? 'auto' : 'smooth')
  },
})

/** Keep the active mobile feed glued to the same column id across reorders */
const withActivePreserved = (fn: () => void) => {
  const activeId = columnsStore.columns[activeColumnIndex.value]?.id
  fn()
  if (!activeId) return
  const next = columnsStore.columns.findIndex(c => c.id === activeId)
  if (next !== -1) activeColumnIndex.value = next
}

const reorderToIndex = (fromColumnId: string, toIndex: number) => {
  withActivePreserved(() => {
    columnsStore.moveColumnById(fromColumnId, toIndex)
  })
}

const onColumnDragStart = (columnId: string) => {
  draggingColumnId.value = columnId
}

const onColumnDragEnd = () => {
  draggingColumnId.value = null
  dropTargetColumnId.value = null
}

const onColumnDragOver = (columnId: string) => {
  if (draggingColumnId.value && draggingColumnId.value !== columnId) {
    dropTargetColumnId.value = columnId
  }
}

const onColumnDrop = (fromColumnId: string, toColumnId: string) => {
  const toIndex = columnsStore.columns.findIndex(c => c.id === toColumnId)
  if (toIndex === -1) return
  reorderToIndex(fromColumnId, toIndex)
  onColumnDragEnd()
}

const moveColumnLeft = (index: number) => {
  if (index <= 0) return
  withActivePreserved(() => columnsStore.moveColumn(index, index - 1))
}

const moveColumnRight = (index: number) => {
  if (index >= columnsStore.columns.length - 1) return
  withActivePreserved(() => columnsStore.moveColumn(index, index + 1))
}

const addColumn = (feedType: ColumnFeedType, groupTag?: string) => {
  const id = columnsStore.addColumn(feedType, groupTag)
  addMenuOpen.value = false
  addGroupQuery.value = ''
  nextTick(() => {
    const idx = id
      ? columnsStore.columns.findIndex((c) => c.id === id)
      : columnsStore.columns.length - 1
    if (idx < 0) return
    if (isDeskTabs.value && id) {
      columnsStore.setFocusedColumn(id)
      activeColumnIndex.value = idx
      return
    }
    scrollToColumn(idx)
  })
}

/** Joined first, then featured (News, etc.) — filterable so the list isn’t a dead end. */
const addableGroups = computed(() => {
  const seen = new Set<string>()
  const out: typeof groupsStore.joinedGroups = []
  for (const g of [...groupsStore.joinedGroups, ...groupsStore.featuredGroups]) {
    const key = g.tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(g)
  }
  const q = addGroupQuery.value.trim().toLowerCase().replace(/^#/, '')
  if (!q) return out
  return out.filter(
    (g) => g.tag.toLowerCase().includes(q) || g.name.toLowerCase().includes(q),
  )
})

const addGroupCustomTag = computed(() => {
  const q = addGroupQuery.value.trim().toLowerCase().replace(/^#/, '')
  if (!q || !/^[a-z0-9_]+$/i.test(q)) return null
  if (addableGroups.value.some((g) => g.tag.toLowerCase() === q)) return null
  return q
})

const addGroupAsColumn = (tag: string) => {
  addColumn('group', tag.replace(/^#/, '').toLowerCase())
}

watch(addMenuOpen, (open) => {
  if (!open) {
    addGroupQuery.value = ''
    addAlgorithmsExpanded.value = true
    addGroupsExpanded.value = true
  }
})

const feedTabsScroller = ref<HTMLElement | null>(null)

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)

const getColumnEls = (): HTMLElement[] => {
  const el = columnsContainer.value
  if (!el) return []
  return Array.from(
    el.querySelectorAll<HTMLElement>(':scope > .timeline-column, :scope > .panel-column'),
  )
}

/** Every full-width carousel page (edge portals + feed columns). */
const getSlideEls = (): HTMLElement[] => {
  const el = columnsContainer.value
  if (!el) return []
  return Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement)
}

/**
 * Slide position inside the scroller — getBoundingClientRect survives Android
 * subpixel / transform quirks better than offsetLeft alone.
 */
const slideScrollLeft = (el: HTMLElement, child: HTMLElement) => {
  return child.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
}

/** Prefer viewport-relative left — padding/subpixels break index math with many slides. */
const nearestSlideIndex = (scrollLeft?: number) => {
  const el = columnsContainer.value
  const slides = getSlideEls()
  if (!el || !slides.length) return 0
  const x = scrollLeft ?? el.scrollLeft
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < slides.length; i++) {
    const d = Math.abs(slideScrollLeft(el, slides[i]!) - x)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

let settleTimer = 0
let settleGen = 0
let carouselSettling = false
/** Ignore scrollend parks right after we snap — prevents bounce loops */
let parkCooldownUntil = 0
let nativeParkTimer = 0
/** Finger lost cancelable touchmove — native scrolling; park when it ends */
let nativeTookOver = false

const armParkCooldown = (ms = 320) => {
  parkCooldownUntil = performance.now() + ms
}

const parkSlideNow = (el: HTMLElement, slideIndex: number) => {
  const slides = getSlideEls()
  const child = slides[clamp(slideIndex, 0, Math.max(0, slides.length - 1))]
  if (!child) return
  el.scrollLeft = slideScrollLeft(el, child)
  el.style.scrollSnapType = 'none'
  el.style.touchAction = ''
  el.classList.remove('columns-container--settling', 'columns-container--swiping')
  armParkCooldown()
  // Keep the top feed strip glued to the parked column (Android swipe path)
  const feeds = columnsStore.columns.length
  if (slideIndex >= EDGE_LEFT && slideIndex < EDGE_LEFT + feeds) {
    const colIdx = slideIndex - EDGE_LEFT
    if (activeColumnIndex.value !== colIdx) activeColumnIndex.value = colIdx
    syncTabIntoView(colIdx, 'auto')
  }
}

const finishCarouselSettle = (gen: number, finalIndex: number) => {
  if (gen !== settleGen) return
  const el = columnsContainer.value
  if (el) parkSlideNow(el, finalIndex)
  carouselSettling = false
  carouselSlideIndex.value = finalIndex
  syncBoardPortalFromSlide(finalIndex)
}

const scrollToSlide = (slideIndex: number, behavior: ScrollBehavior = 'smooth') => {
  const el = columnsContainer.value
  const slides = getSlideEls()
  if (!el || !slides.length) return
  const idx = clamp(slideIndex, 0, slides.length - 1)
  const child = slides[idx]
  if (!child) return
  carouselSlideIndex.value = idx
  syncBoardPortalFromSlide(idx)

  // Mobile parks instantly — smooth + residual momentum bounced back and forth
  if (behavior === 'auto' || isMobileUi.value) {
    window.clearTimeout(settleTimer)
    carouselSettling = false
    parkSlideNow(el, idx)
    return
  }

  const gen = ++settleGen
  carouselSettling = true
  el.style.scrollSnapType = 'none'
  el.classList.add('columns-container--settling')
  window.clearTimeout(settleTimer)
  el.scrollTo({ left: slideScrollLeft(el, child), behavior: 'smooth' })

  const done = () => {
    el.removeEventListener('scrollend', done)
    window.clearTimeout(settleTimer)
    finishCarouselSettle(gen, idx)
  }
  el.addEventListener('scrollend', done, { once: true })
  // Safari / older WebViews may not fire scrollend
  settleTimer = window.setTimeout(done, 380)
}

/** Scroll the feed-tab strip so the active column’s tab is visible. */
const syncTabIntoView = (columnIndex: number, behavior: ScrollBehavior = 'smooth') => {
  nextTick(() => {
    const root = feedTabsScroller.value
    if (!root) return
    const tabs = root.querySelectorAll<HTMLElement>('[role="tab"]')
    const tab = tabs[columnIndex]
    if (!tab) return
    // Nested overflow (scroller + neo-tabs__list) is common — Android only
    // moves the ancestor that actually overflows. Prefer that one; never use
    // document scrollIntoView (it yanks the page vertically on Chrome Android).
    const inner = tab.closest('.neo-tabs__list') as HTMLElement | null
    const list =
      (inner && inner.scrollWidth > inner.clientWidth + 2 ? inner : null) ||
      (root.scrollWidth > root.clientWidth + 2 ? root : null) ||
      inner ||
      root
    const listRect = list.getBoundingClientRect()
    const tabRect = tab.getBoundingClientRect()
    const delta =
      tabRect.left + tabRect.width / 2 - (listRect.left + listRect.width / 2)
    if (Math.abs(delta) < 2) return
    const nextLeft = list.scrollLeft + delta
    if (typeof list.scrollTo === 'function') {
      list.scrollTo({ left: nextLeft, behavior: isMobileUi.value ? 'auto' : behavior })
    } else {
      list.scrollLeft = nextLeft
    }
  })
}

const scrollToColumn = (index: number, behavior: ScrollBehavior = 'smooth') => {
  const colIdx = clamp(index, 0, Math.max(0, columnsStore.columns.length - 1))
  activeColumnIndex.value = colIdx
  if (isMobileUi.value) {
    scrollToSlide(colIdx + feedSlideOffset.value, behavior)
  } else {
    const el = columnsContainer.value
    const col = getColumnEls()[colIdx]
    if (el && col) el.scrollTo({ left: col.offsetLeft, behavior })
  }
  syncTabIntoView(colIdx, behavior)
}

/** Desktop: shelf focus. Mobile: park that column in the carousel instead. */
const onColumnFocus = (columnId: string) => {
  const idx = columnsStore.columns.findIndex((c) => c.id === columnId)
  if (isMobileUi.value) {
    if (idx >= 0) scrollToColumn(idx, 'auto')
    return
  }
  columnsStore.toggleColumnFocus(columnId)
  if (idx >= 0) {
    activeColumnIndex.value = idx
    syncTabIntoView(idx, 'smooth')
  }
}

/** Update which column is "active" from scroll position — never yanks scrollLeft back */
const syncActiveColumnFromScroll = () => {
  const el = columnsContainer.value
  const cols = getColumnEls()
  if (!el || !cols.length) return
  let best = 0
  let bestDist = Infinity
  const x = el.scrollLeft
  for (let i = 0; i < cols.length; i++) {
    const d = Math.abs(slideScrollLeft(el, cols[i]!) - x)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  activeColumnIndex.value = best
}

let wheelIdleTimer = 0
let wheelArmed = false

const portalThemeLabel = computed(() => {
  const id = resolveTheme(settingsStore.localPreferences.theme)
  return THEME_OPTIONS.find((t) => t.id === id)?.label || id
})

const portalUiLabel = computed(() => {
  const id = settingsStore.localPreferences.ui
  return UI_OPTIONS.find((u) => u.id === id)?.label || id
})

const portalUser = computed(() => instancesStore.currentUser)

const portalGroupChips = computed(() => {
  const joined = groupsStore.joinedGroups.slice(0, 6)
  if (joined.length) return joined
  return groupsStore.recommendedGroups.slice(0, 6)
})

const portalInboxRows = computed(() => {
  const myId = instancesStore.currentUser?.id || ''
  const myAcct = instancesStore.currentUser?.acct || ''
  return conversationsStore.conversations.slice(0, 4).map((c) => ({
    id: c.id,
    label: participantLabel(c),
    preview: conversationsStore.previewFor(c, myId, myAcct),
    unread: !!c.unread,
    statusId: c.lastStatus?.id || null,
    avatar: c.accounts?.[0]?.avatar || '',
  }))
})

const portalActivityRows = computed(() =>
  notificationsStore.notifications.slice(0, 4).map((n) => {
    const who = n.account?.displayName || n.account?.username || 'Someone'
    const verb =
      n.type === 'mention'
        ? 'mentioned you'
        : n.type === 'favourite'
          ? 'liked your post'
          : n.type === 'reblog'
            ? 'boosted you'
            : n.type === 'follow'
              ? 'followed you'
              : n.type === 'poll'
                ? 'poll ended'
                : 'interacted'
    return {
      id: n.id,
      label: `${who} ${verb}`,
      avatar: n.account?.avatar || '',
    }
  }),
)

const syncBoardPortalFromSlide = (index: number) => {
  if (!isMobileUi.value) {
    setBoardPortal(null)
    return
  }
  const feeds = columnsStore.columns.length
  if (index === 0) setBoardPortal('settings')
  else if (index === 1) setBoardPortal('profile')
  else if (index >= EDGE_LEFT + feeds) {
    const ri = index - (EDGE_LEFT + feeds)
    setBoardPortal((BOARD_RIGHT_PORTALS[ri] as BoardPortal) ?? null)
  } else setBoardPortal(null)
}

const openPortal = async (
  kind: Exclude<BoardPortal, null>,
  opts?: { q?: string; filter?: string },
) => {
  if (portalActionLock) return
  portalActionLock = true
  try {
    if (kind === 'settings') {
      settingsStore.open()
      return
    }
    if (kind === 'profile') {
      await router.push(instancesStore.isAuthenticated ? '/profile' : '/login')
      return
    }
    if (kind === 'search') {
      const q = (opts?.q ?? portalSearch.value).trim()
      await router.push(q ? { path: '/explore', query: { q } } : '/explore')
      return
    }
    if (kind === 'inbox') {
      await router.push(
        instancesStore.hasAuthenticatedInstance ? '/messages' : '/login',
      )
      return
    }
    if (kind === 'activity') {
      if (!instancesStore.hasAuthenticatedInstance) {
        await router.push('/login')
        return
      }
      await router.push(
        opts?.filter
          ? { path: '/notifications', query: { filter: opts.filter } }
          : '/notifications',
      )
      return
    }
    await router.push('/groups')
  } finally {
    window.setTimeout(() => {
      portalActionLock = false
    }, 400)
  }
}

const openInboxRow = async (statusId: string | null) => {
  if (!statusId) {
    await openPortal('inbox')
    return
  }
  await router.push(`/status/${statusId}`)
}

const settleCarousel = (slideIndex: number, behavior: ScrollBehavior = 'smooth') => {
  const feeds = columnsStore.columns.length
  if (!isMobileUi.value) {
    scrollToColumn(clamp(slideIndex, 0, Math.max(0, feeds - 1)), behavior)
    return
  }

  const maxSlide = Math.max(0, EDGE_LEFT + feeds + EDGE_RIGHT - 1)
  const idx = clamp(slideIndex, 0, maxSlide)

  // Edge portals stay parked (filled cards + chrome hints) — CTA opens the destination
  if (idx < EDGE_LEFT || idx >= EDGE_LEFT + feeds) {
    scrollToSlide(idx, behavior)
    return
  }
  scrollToColumn(idx - EDGE_LEFT, behavior)
}

const goPrevFeed = () => {
  if (isMobileUi.value) {
    settleCarousel(carouselSlideIndex.value - 1)
    return
  }
  if (activeColumnIndex.value <= 0) return
  scrollToColumn(activeColumnIndex.value - 1)
}

const goNextFeed = () => {
  if (isMobileUi.value) {
    settleCarousel(carouselSlideIndex.value + 1)
    return
  }
  if (activeColumnIndex.value >= columnsStore.columns.length - 1) return
  scrollToColumn(activeColumnIndex.value + 1)
}

const removeActiveColumn = () => {
  const col = columnsStore.columns[activeColumnIndex.value]
  if (!col || !columnsStore.canRemoveColumn) return
  const nextIdx = Math.min(activeColumnIndex.value, columnsStore.columnCount - 2)
  columnsStore.removeColumn(col.id)
  nextTick(() => {
    if (nextIdx >= 0) scrollToColumn(nextIdx)
  })
}

const activeViewMode = computed(
  () => columnsStore.columns[activeColumnIndex.value]?.viewMode || 'flow',
)

const toggleActiveViewMode = () => {
  const col = columnsStore.columns[activeColumnIndex.value]
  if (!col) return
  columnsStore.toggleColumnViewMode(col.id)
}

const onColumnsScroll = () => {
  const el = columnsContainer.value
  if (!el || el.clientWidth <= 0) return

  if (!isMobileUi.value) {
    syncActiveColumnFromScroll()
    return
  }

  const index = nearestSlideIndex()
  carouselSlideIndex.value = index
  // Never sync portal chrome mid-gesture — hint thrash feels like vibration
  if (!carouselSettling && !carouselGesture && !nativeTookOver) {
    syncBoardPortalFromSlide(index)
  }
  const feeds = columnsStore.columns.length
  // Only remap tab highlight while parked on a real feed
  if (index >= EDGE_LEFT && index < EDGE_LEFT + feeds) {
    const next = index - EDGE_LEFT
    if (activeColumnIndex.value !== next) {
      activeColumnIndex.value = next
    }
    // Keep the top strip glued while swiping — highlight alone isn't enough
    // when many feeds push the active pill off-screen (Chrome Android).
    syncTabIntoView(next, 'auto')
  }
}

/** Wait until scrollLeft stops changing before parking (Android momentum). */
const whenScrollIdle = (el: HTMLElement, cb: () => void) => {
  window.clearTimeout(nativeParkTimer)
  let last = el.scrollLeft
  let stable = 0
  const tick = () => {
    if (carouselGesture || carouselSettling) return
    const x = el.scrollLeft
    if (Math.abs(x - last) < 1) {
      stable += 1
      if (stable >= 3) {
        cb()
        return
      }
    } else {
      stable = 0
      last = x
    }
    nativeParkTimer = window.setTimeout(tick, 48)
  }
  nativeParkTimer = window.setTimeout(tick, 48)
}

/** Native scroll / momentum ended — park on the nearest full slide */
const onCarouselScrollEnd = () => {
  if (carouselGesture || portalActionLock || carouselSettling) return
  if (performance.now() < parkCooldownUntil) return
  if (!isMobileUi.value) {
    syncActiveColumnFromScroll()
    return
  }
  const el = columnsContainer.value
  const idx = nearestSlideIndex()
  const child = getSlideEls()[idx]
  if (!el || !child) return
  carouselSlideIndex.value = idx
  syncBoardPortalFromSlide(idx)
  // Already parked — don't kick another settle (avoids bounce loops)
  if (Math.abs(el.scrollLeft - slideScrollLeft(el, child)) < 8) {
    armParkCooldown(200)
    const feeds = columnsStore.columns.length
    if (idx >= EDGE_LEFT && idx < EDGE_LEFT + feeds) {
      syncTabIntoView(idx - EDGE_LEFT, 'auto')
    }
    return
  }
  settleCarousel(idx, 'auto')
}

/**
 * Nested `.column-scroll` uses touch-action: pan-y, so Chrome Android + iPadOS
 * latch vertical and never chain horizontal pans to the board. Drive scrollLeft
 * ourselves on clear horizontal intent (finger). Trackpads use the wheel bridge.
 */
const AXIS_LOCK_PX = 10
const FLICK_VX = 0.22 // px/ms — one-slide flicks without needing a hard whip

type CarouselGesture = {
  id: number
  startX: number
  startY: number
  startScroll: number
  locked: null | 'x' | 'y'
  lastX: number
  lastT: number
  vx: number
}

let carouselGesture: CarouselGesture | null = null

/**
 * Trackpad: drive horizontal board scroll ourselves and claim the gesture
 * so Safari history swipe doesn't steal it. No snap-back on idle.
 */
const onColumnsWheel = (e: WheelEvent) => {
  const el = columnsContainer.value
  if (!el || isMobileUi.value) return
  if (el.scrollWidth <= el.clientWidth + 2) return

  let dx = e.deltaX
  let dy = e.deltaY
  if (e.deltaMode === 1) {
    dx *= 16
    dy *= 16
  } else if (e.deltaMode === 2) {
    dx *= el.clientWidth
    dy *= el.clientHeight
  }

  if (e.shiftKey && Math.abs(dy) >= Math.abs(dx)) {
    dx = dy
  }

  if (Math.abs(dx) < 0.5 || Math.abs(dx) <= Math.abs(dy) * 1.05) return

  if (e.cancelable) e.preventDefault()
  if (!wheelArmed) {
    wheelArmed = true
    el.style.scrollSnapType = 'none'
  }
  const max = Math.max(0, el.scrollWidth - el.clientWidth)
  el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + dx))

  window.clearTimeout(wheelIdleTimer)
  wheelIdleTimer = window.setTimeout(() => {
    wheelArmed = false
    el.style.scrollSnapType = ''
    syncActiveColumnFromScroll()
  }, 120)
}

const onCarouselTouchStart = (e: TouchEvent) => {
  if (e.touches.length !== 1) return
  const el = columnsContainer.value
  // Track even when fully scrolled — horizontal lock still blocks history swipe
  if (!el) return
  const t = e.touches[0]!
  const target = e.target as HTMLElement | null
  // Don't steal taps from column chrome / compose / menus (iPad move/close/focus)
  if (
    target?.closest(
      'input, textarea, select, button, a, [role="button"], [contenteditable="true"], .mobile-feed-tabs, .column-header, .feed-dropdown, .add-column-panel, .compose, .compose-pill, .feed-portal__search, .feed-portal__list',
    )
  ) {
    return
  }
  const now = performance.now()
  carouselGesture = {
    id: t.identifier,
    startX: t.clientX,
    startY: t.clientY,
    startScroll: el.scrollLeft,
    locked: null,
    lastX: t.clientX,
    lastT: now,
    vx: 0,
  }
}

const onCarouselTouchMove = (e: TouchEvent) => {
  const g = carouselGesture
  if (!g) return
  const el = columnsContainer.value
  if (!el) return
  const t =
    Array.from(e.touches).find((c) => c.identifier === g.id) ??
    Array.from(e.changedTouches).find((c) => c.identifier === g.id)
  if (!t) return

  const dx = t.clientX - g.startX
  const dy = t.clientY - g.startY
  const now = performance.now()

  if (!g.locked) {
    if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
    g.locked = Math.abs(dx) > Math.abs(dy) * 1.05 ? 'x' : 'y'
    if (g.locked === 'x') {
      el.style.scrollSnapType = 'none'
      // Claim the gesture fully so Android doesn't also scroll underneath us
      el.style.touchAction = 'none'
      el.classList.add('columns-container--swiping')
    }
  }

  if (g.locked !== 'x') return

  // iOS/Chrome mark touchmove cancelable=false once scrolling has begun.
  // Calling preventDefault then is ignored (Intervention) and fighting
  // native scrollLeft makes the board vibrate / bounce.
  if (!e.cancelable) {
    // Chrome Android: allow native horizontal momentum, then park when idle
    el.style.touchAction = 'pan-x'
    el.classList.remove('columns-container--swiping')
    nativeTookOver = true
    carouselGesture = null
    return
  }

  e.preventDefault()
  const dt = Math.max(1, now - g.lastT)
  g.vx = (t.clientX - g.lastX) / dt
  g.lastX = t.clientX
  g.lastT = now
  const max = Math.max(0, el.scrollWidth - el.clientWidth)
  el.scrollLeft = Math.max(0, Math.min(max, g.startScroll - dx))
}

const scheduleNativePark = () => {
  const el = columnsContainer.value
  if (!el || !isMobileUi.value) return
  whenScrollIdle(el, () => {
    if (carouselGesture || carouselSettling || portalActionLock) return
    settleCarousel(nearestSlideIndex(), 'auto')
  })
}

const finishCarouselGesture = (e: TouchEvent) => {
  const g = carouselGesture
  if (!g) {
    // Native took the gesture — park once momentum quiets
    if (nativeTookOver) {
      nativeTookOver = false
      scheduleNativePark()
    }
    return
  }
  const ended = Array.from(e.changedTouches).some((c) => c.identifier === g.id)
  if (!ended) return

  const el = columnsContainer.value
  const wasX = g.locked === 'x'
  const vx = g.vx
  carouselGesture = null
  nativeTookOver = false
  if (!el || !wasX) return

  el.style.touchAction = ''
  el.classList.remove('columns-container--swiping')

  // Mobile — instant park on a full-width slide (±1 on a clear flick)
  if (isMobileUi.value) {
    let index = nearestSlideIndex()
    if (vx < -FLICK_VX) index += 1
    else if (vx > FLICK_VX) index -= 1
    index = clamp(index, 0, Math.max(0, slideCount.value - 1))
    settleCarousel(index, 'auto')
    return
  }

  // Desktop / iPad — gentle coast, leave where it lands (no spring-back)
  el.style.scrollSnapType = ''
  if (Math.abs(vx) > 0.08) {
    const max = Math.max(0, el.scrollWidth - el.clientWidth)
    const coast = Math.max(0, Math.min(max, el.scrollLeft - vx * 180))
    el.scrollTo({ left: coast, behavior: 'smooth' })
  }
  syncActiveColumnFromScroll()
}

/** Re-park after Android URL-bar / keyboard / orientation changes slide width. */
let carouselResizeRo: ResizeObserver | null = null
let carouselVvParkTimer = 0

const reparkCarouselAfterResize = () => {
  if (!isMobileUi.value || carouselGesture || carouselSettling || portalActionLock) return
  window.clearTimeout(carouselVvParkTimer)
  carouselVvParkTimer = window.setTimeout(() => {
    if (!isMobileUi.value || carouselGesture || carouselSettling) return
    scrollToSlide(carouselSlideIndex.value, 'auto')
  }, 80)
}

const bindCarouselGestures = () => {
  const el = columnsContainer.value
  if (!el) return
  el.addEventListener('touchstart', onCarouselTouchStart, { passive: true, capture: true })
  el.addEventListener('touchmove', onCarouselTouchMove, { passive: false, capture: true })
  el.addEventListener('touchend', finishCarouselGesture, { passive: true, capture: true })
  el.addEventListener('touchcancel', finishCarouselGesture, { passive: true, capture: true })
  el.addEventListener('wheel', onColumnsWheel, { passive: false, capture: true })
  el.addEventListener('scrollend', onCarouselScrollEnd)
  // Mobile: JS parks — never leave mandatory snap armed (it bounced against settle)
  if (isMobileUi.value) el.style.scrollSnapType = 'none'

  if (typeof ResizeObserver !== 'undefined') {
    carouselResizeRo?.disconnect()
    carouselResizeRo = new ResizeObserver(() => reparkCarouselAfterResize())
    carouselResizeRo.observe(el)
  }
  window.visualViewport?.addEventListener('resize', reparkCarouselAfterResize)
  window.addEventListener('orientationchange', reparkCarouselAfterResize)
}

const unbindCarouselGestures = () => {
  const el = columnsContainer.value
  if (!el) return
  el.removeEventListener('touchstart', onCarouselTouchStart, true)
  el.removeEventListener('touchmove', onCarouselTouchMove, true)
  el.removeEventListener('touchend', finishCarouselGesture, true)
  el.removeEventListener('touchcancel', finishCarouselGesture, true)
  el.removeEventListener('wheel', onColumnsWheel, true)
  el.removeEventListener('scrollend', onCarouselScrollEnd)
  carouselResizeRo?.disconnect()
  carouselResizeRo = null
  window.visualViewport?.removeEventListener('resize', reparkCarouselAfterResize)
  window.removeEventListener('orientationchange', reparkCarouselAfterResize)
  window.clearTimeout(carouselVvParkTimer)
  window.clearTimeout(wheelIdleTimer)
  window.clearTimeout(settleTimer)
  window.clearTimeout(nativeParkTimer)
  wheelArmed = false
  carouselSettling = false
  nativeTookOver = false
  parkCooldownUntil = 0
  el.style.scrollSnapType = ''
  el.style.touchAction = ''
  el.classList.remove('columns-container--swiping', 'columns-container--settling')
  carouselGesture = null
}

const syncMobileUi = () => {
  const next = !!mobileMq?.matches
  if (next === isMobileUi.value) return
  isMobileUi.value = next
  const el = columnsContainer.value
  if (el) el.style.scrollSnapType = next ? 'none' : ''
  nextTick(() => scrollToColumn(activeColumnIndex.value, 'auto'))
}

watch(
  () => columnsStore.columnCount,
  (count) => {
    if (activeColumnIndex.value >= count) {
      activeColumnIndex.value = Math.max(0, count - 1)
    }
    if (columnsStore.deskDensity === 'tabs') {
      columnsStore.ensureTabsFocus()
      return
    }
    nextTick(() => scrollToColumn(activeColumnIndex.value, 'auto'))
  },
)

watch(
  () => columnsStore.deskDensity,
  (density) => {
    if (density === 'tabs') columnsStore.ensureTabsFocus()
  },
)

// Reload feeds when switching accounts (per-account + profile sync)
watch(
  () => instancesStore.activeAccountId,
  (id, prev) => {
    if (id === prev) return
    columnsStore.initialize()
    activeColumnIndex.value = 0
    nextTick(() => scrollToColumn(0, 'auto'))
  },
)

/**
 * After returning from a subview / portal route, Android often leaves the board
 * mid-slide or at Settings (slide 0). Always re-park on the active feed.
 */
const restoreFeedPark = () => {
  nextTick(() => {
    requestAnimationFrame(() => {
      scrollToColumn(activeColumnIndex.value, 'auto')
    })
  })
}

onMounted(async () => {
  await instancesStore.initialize()
  columnsStore.initialize()

  // Discover groups for everyone (menu Suggested + /groups hub)
  groupsStore.initializeGroups()

  if (instancesStore.userCustomCSS) {
    themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
  }

  mobileMq = window.matchMedia(MOBILE_CAROUSEL_MQ)
  isMobileUi.value = mobileMq.matches
  mobileMq.addEventListener('change', syncMobileUi)

  nextTick(() => {
    bindCarouselGestures()
    // Edge slides sit left of feeds — jump to first feed without animating through Settings
    scrollToColumn(activeColumnIndex.value, 'auto')
  })
})

onActivated(() => {
  // keepalive: onMounted won't re-run; subview back can leave scroll at Settings (slide 0)
  restoreFeedPark()
})

onDeactivated(() => {
  setBoardPortal(null)
})

onUnmounted(() => {
  setBoardPortal(null)
  unbindCarouselGestures()
  mobileMq?.removeEventListener('change', syncMobileUi)
  mobileMq = null
})

definePageMeta({ keepalive: true })

useHead({ title: 'Home | NeoSpace' })
</script>

<template>
  <div
    class="columns-page"
    :class="{
      'columns-page--multi': columnsStore.isMultiColumn && !columnsStore.focusedColumnId,
      'columns-page--packed': columnsStore.deskDensity === 'packed',
      'columns-page--roomy': columnsStore.deskDensity === 'roomy',
      'columns-page--tabs': isDeskTabs,
      'columns-page--focus': !!columnsStore.focusedColumnId && !isMobileUi,
    }"
  >
    <h1 class="sr-only">Home</h1>

    <!-- Desktop focused-tab mode: one wide feed + tab strip -->
    <nav
      v-if="isDeskTabs"
      class="desk-feed-tabs"
      aria-label="Feeds"
    >
      <NeoTabs
        class="desk-feed-tabs__neo"
        :tabs="feedTabs"
        controls-id="feed-columns"
        aria-label="Feeds"
        :model-value="activeFeedTabId"
        :panels="false"
        @update:model-value="(id) => (activeFeedTabId = id)"
      />
      <div v-if="columnsStore.canAddColumn" class="desk-feed-tabs__add" @click.stop>
        <NeoMenu
          v-model:open="addMenuOpen"
          class="add-column-neo add-column-neo--desk-tabs"
          align="end"
          :label="`Add feed (${columnsStore.columnCount}/${MAX_COLUMNS})`"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <template #items>
            <span class="add-column-menu__title">Add feed</span>
            <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('home')">For You</button>
            <div class="add-column-menu__divider" role="separator" />
            <button type="button" class="add-column-menu__section-toggle" @click.stop="addAlgorithmsExpanded = !addAlgorithmsExpanded">
              <span>Algorithms</span>
              <svg :class="{ rotated: addAlgorithmsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <template v-if="addAlgorithmsExpanded">
              <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('local')">
                Local ({{ localHostLabel }})
              </button>
              <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('federated')">Federated</button>
              <button
                v-if="instancesStore.hasAuthenticatedInstance"
                type="button"
                role="menuitem"
                class="add-column-menu__item"
                @click="addColumn('favourites')"
              >Liked</button>
              <button
                v-if="instancesStore.hasAuthenticatedInstance"
                type="button"
                role="menuitem"
                class="add-column-menu__item"
                @click="addColumn('bookmarks')"
              >Saved</button>
              <button
                v-for="recipe in algorithmsStore.allRecipes"
                :key="recipe.id"
                type="button"
                role="menuitem"
                class="add-column-menu__item"
                @click="addColumn('algorithm', recipe.id)"
              >{{ recipe.name }}</button>
              <button
                type="button"
                role="menuitem"
                class="add-column-menu__item"
                @click="algorithmsStore.openEditor(); addMenuOpen = false"
              >Create algorithm…</button>
            </template>
          </template>
        </NeoMenu>
      </div>
    </nav>

    <!-- Mobile: feed strip + thumb-zone prev/next + add -->
    <nav class="mobile-feed-tabs" aria-label="Feeds">
      <div ref="feedTabsScroller" class="mobile-feed-tabs__scroller">
        <NeoTabs
          class="mobile-feed-tabs__neo"
          :tabs="feedTabs"
          controls-id="feed-columns"
          aria-label="Feeds"
          :model-value="activeFeedTabId"
          :panels="false"
          @update:model-value="(id) => (activeFeedTabId = id)"
        />
      </div>

      <div class="mobile-feed-tabs__thumb">
        <!-- Quiet Flow ↔ Flip for the active feed -->
        <button
          type="button"
          class="mobile-feed-tabs__mode"
          :class="{ 'mobile-feed-tabs__mode--flip': activeViewMode === 'flip' }"
          :aria-label="activeViewMode === 'flip' ? 'Flip' : 'Flow'"
          :aria-pressed="activeViewMode === 'flip'"
          :title="activeViewMode === 'flip' ? 'Flip' : 'Flow'"
          @click="toggleActiveViewMode"
        >
          <span class="mode-glyph" aria-hidden="true">
            <span class="mode-glyph__flow">
              <i /><i /><i />
            </span>
            <span class="mode-glyph__flip" />
          </span>
        </button>

        <!-- Jump arrows when multi-feed or edge portals exist -->
        <button
          v-if="columnsStore.columnCount >= 2"
          type="button"
          class="neo-btn neo-btn--tertiary neo-btn--icon mobile-feed-tabs__jump"
          aria-label="Previous feed"
          :disabled="isMobileUi ? carouselSlideIndex <= 0 : activeColumnIndex <= 0"
          @click="goPrevFeed"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          v-if="columnsStore.columnCount >= 2"
          type="button"
          class="neo-btn neo-btn--tertiary neo-btn--icon mobile-feed-tabs__jump"
          aria-label="Next feed"
          :disabled="isMobileUi ? carouselSlideIndex >= slideCount - 1 : activeColumnIndex >= columnsStore.columns.length - 1"
          @click="goNextFeed"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <button
          v-if="columnsStore.canRemoveColumn"
          type="button"
          class="neo-btn neo-btn--tertiary neo-btn--icon mobile-feed-tabs__jump"
          aria-label="Remove this feed"
          title="Remove this feed"
          @click="removeActiveColumn"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div v-if="columnsStore.canAddColumn" class="mobile-feed-tabs__add" @click.stop>
          <NeoMenu
            v-model:open="addMenuOpen"
            class="add-column-neo add-column-neo--mobile"
            align="end"
            teleport
            panel-class="add-column-menu-panel"
            :label="`Add feed (${columnsStore.columnCount}/${MAX_COLUMNS})`"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <template #items>
              <span class="add-column-menu__title">Add Feed</span>
              <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('home')">For You</button>
              <div class="add-column-menu__divider" role="separator" />
              <button type="button" class="add-column-menu__section-toggle" @click.stop="addAlgorithmsExpanded = !addAlgorithmsExpanded">
                <span>Algorithms</span>
                <svg :class="{ rotated: addAlgorithmsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <template v-if="addAlgorithmsExpanded">
                <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('local')">
                  Local ({{ localHostLabel }})
                </button>
                <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('federated')">Federated</button>
                <button
                  v-if="instancesStore.hasAuthenticatedInstance"
                  type="button"
                  role="menuitem"
                  class="add-column-menu__item"
                  @click="addColumn('favourites')"
                >Liked</button>
                <button
                  v-if="instancesStore.hasAuthenticatedInstance"
                  type="button"
                  role="menuitem"
                  class="add-column-menu__item"
                  @click="addColumn('bookmarks')"
                >Saved</button>
                <button
                  v-for="recipe in algorithmsStore.allRecipes"
                  :key="`m-${recipe.id}`"
                  type="button"
                  role="menuitem"
                  class="add-column-menu__item"
                  @click="addColumn('algorithm', recipe.id)"
                >{{ recipe.name }}</button>
                <button
                  type="button"
                  role="menuitem"
                  class="add-column-menu__item"
                  @click="algorithmsStore.openEditor(); addMenuOpen = false"
                >Create algorithm…</button>
              </template>
              <div class="add-column-menu__divider" role="separator" />
              <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('search')">Search</button>
              <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('profile')">Profile</button>
              <button
                v-if="instancesStore.hasAuthenticatedInstance"
                type="button"
                role="menuitem"
                class="add-column-menu__item"
                @click="addColumn('notifications')"
              >Notifications</button>
              <button
                v-if="instancesStore.hasAuthenticatedInstance"
                type="button"
                role="menuitem"
                class="add-column-menu__item"
                @click="addColumn('messages')"
              >Messages</button>
              <div class="add-column-menu__divider" role="separator" />
              <button type="button" class="add-column-menu__section-toggle" @click.stop="addGroupsExpanded = !addGroupsExpanded">
                <span>Groups</span>
                <svg :class="{ rotated: addGroupsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <template v-if="addGroupsExpanded">
                <div class="add-column-menu__filter" @click.stop>
                  <input
                    v-model="addGroupQuery"
                    type="search"
                    class="add-column-menu__filter-input"
                    placeholder="Find News, Dogs…"
                    aria-label="Filter groups"
                    @keydown.enter.prevent="addGroupCustomTag ? addGroupAsColumn(addGroupCustomTag) : addableGroups[0] && addGroupAsColumn(addableGroups[0].tag)"
                  >
                </div>
                <div class="add-column-menu__groups">
                  <button
                    v-for="group in addableGroups"
                    :key="group.tag"
                    type="button"
                    role="menuitem"
                    class="add-column-menu__item add-column-menu__item--group"
                    @click="addGroupAsColumn(group.tag)"
                  >
                    <span class="add-column-menu__group-icon">{{ group.icon }}</span>
                    {{ group.name }}
                  </button>
                  <button
                    v-if="addGroupCustomTag"
                    type="button"
                    role="menuitem"
                    class="add-column-menu__item add-column-menu__item--group"
                    @click="addGroupAsColumn(addGroupCustomTag)"
                  >
                    <span class="add-column-menu__group-icon">🏷️</span>
                    Add #{{ addGroupCustomTag }}
                  </button>
                  <p v-else-if="addGroupQuery.trim() && !addableGroups.length" class="add-column-menu__empty">
                    No matching groups
                  </p>
                </div>
              </template>
              <span class="add-column-menu__hint">
                {{ columnsStore.columnCount }}/{{ MAX_COLUMNS }} feeds on this device
              </span>
            </template>
          </NeoMenu>
        </div>
      </div>
    </nav>

    <div
      ref="columnsContainer"
      id="feed-columns"
      class="columns-container"
      @scroll.passive="onColumnsScroll"
    >
      <!-- Mobile edge: keep swiping left → Profile, then Settings -->
      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--settings"
        aria-label="Settings"
      >
        <p class="feed-portal__kicker">Edge</p>
        <h2 class="feed-portal__title">Settings</h2>
        <p class="feed-portal__body">Appearance, posting defaults, and accounts.</p>

        <div class="feed-portal__panel">
          <button
            type="button"
            class="feed-portal__row"
            @click="settingsStore.cycleTheme()"
          >
            <span class="feed-portal__swatch" aria-hidden="true" />
            <span class="feed-portal__row-text">
              <strong>Theme</strong>
              <span>{{ portalThemeLabel }}</span>
            </span>
            <span class="feed-portal__row-action">Tap to cycle</span>
          </button>
          <button
            type="button"
            class="feed-portal__row"
            @click="settingsStore.cycleUi()"
          >
            <NeoIcon name="settings" :size="18" :stroke="1.75" />
            <span class="feed-portal__row-text">
              <strong>Chrome</strong>
              <span>{{ portalUiLabel }}</span>
            </span>
            <span class="feed-portal__row-action">Tap to cycle</span>
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('settings')">
          Open settings
        </button>
      </aside>

      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--profile"
        aria-label="Profile"
      >
        <p class="feed-portal__kicker">Edge</p>
        <h2 class="feed-portal__title">Profile</h2>

        <div v-if="portalUser" class="feed-portal__identity">
          <img
            :src="portalUser.avatar"
            alt=""
            class="feed-portal__avatar"
          />
          <div class="feed-portal__who">
            <strong>{{ portalUser.displayName || portalUser.username }}</strong>
            <span>@{{ portalUser.acct }}</span>
          </div>
          <p class="feed-portal__stats">
            <span><b>{{ portalUser.statusesCount ?? 0 }}</b> posts</span>
            <span><b>{{ portalUser.followingCount ?? 0 }}</b> following</span>
            <span><b>{{ portalUser.followersCount ?? 0 }}</b> followers</span>
          </p>
        </div>
        <p v-else class="feed-portal__body">
          Sign in to post, follow people, and keep your layout.
        </p>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('profile')">
          {{ portalUser ? 'Open profile' : 'Sign in' }}
        </button>
      </aside>

      <template v-for="(column, idx) in columnsStore.columns" :key="column.id">
        <TimelineColumn
          v-if="isTimelineFeed(column.feedType)"
          :class="{ 'board-col--hidden': !!columnsStore.focusedColumnId && columnsStore.focusedColumnId !== column.id && !isMobileUi }"
          :column="column"
          :is-first="idx === 0"
          :is-last="idx === columnsStore.columns.length - 1"
          :can-remove="columnsStore.canRemoveColumn"
          :can-reorder="columnsStore.isMultiColumn"
          :recessed="columnsStore.isMultiColumn && activeColumnIndex !== idx"
          :dragging="draggingColumnId === column.id"
          :drop-target="dropTargetColumnId === column.id"
          :focused="columnsStore.focusedColumnId === column.id"
          @remove="columnsStore.removeColumn(column.id)"
          @focus="onColumnFocus(column.id)"
          @update-feed-type="(type: ColumnFeedType, groupTag?: string) => columnsStore.updateColumnFeedType(column.id, type, groupTag)"
          @column-drag-start="onColumnDragStart"
          @column-drag-end="onColumnDragEnd"
          @column-drag-over="onColumnDragOver"
          @column-drop="(fromId) => onColumnDrop(fromId, column.id)"
          @move-left="moveColumnLeft(idx)"
          @move-right="moveColumnRight(idx)"
        />
        <PanelColumn
          v-else
          :class="{ 'board-col--hidden': !!columnsStore.focusedColumnId && columnsStore.focusedColumnId !== column.id && !isMobileUi }"
          :column="column"
          :is-first="idx === 0"
          :is-last="idx === columnsStore.columns.length - 1"
          :can-remove="columnsStore.canRemoveColumn"
          :can-reorder="columnsStore.isMultiColumn"
          :recessed="columnsStore.isMultiColumn && activeColumnIndex !== idx"
          :dragging="draggingColumnId === column.id"
          :drop-target="dropTargetColumnId === column.id"
          :focused="columnsStore.focusedColumnId === column.id"
          @remove="columnsStore.removeColumn(column.id)"
          @focus="onColumnFocus(column.id)"
          @column-drag-start="onColumnDragStart"
          @column-drag-end="onColumnDragEnd"
          @column-drag-over="onColumnDragOver"
          @column-drop="(fromId) => onColumnDrop(fromId, column.id)"
          @move-left="moveColumnLeft(idx)"
          @move-right="moveColumnRight(idx)"
        />
      </template>

      <!-- Mobile edge: past last feed → Search → Inbox → Activity → Groups -->
      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--search"
        aria-label="Search"
      >
        <p class="feed-portal__kicker">Edge</p>
        <h2 class="feed-portal__title">Search</h2>
        <p class="feed-portal__body">People, posts, tags, and servers.</p>

        <label class="feed-portal__search">
          <span class="sr-only">Search the fediverse</span>
          <NeoIcon name="search" :size="18" :stroke="1.75" />
          <input
            v-model="portalSearch"
            type="search"
            class="feed-portal__search-input"
            placeholder="Search…"
            autocomplete="off"
            enterkeyhint="search"
            @focus="($event.target as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' })"
            @blur="reparkCarouselAfterResize"
            @keydown.enter.prevent="openPortal('search')"
          />
        </label>

        <div class="feed-portal__chips">
          <button type="button" class="feed-portal__chip" @click="openPortal('search', { q: 'fediverse' })">
            #fediverse
          </button>
          <button
            type="button"
            class="feed-portal__chip"
            @click="router.push({ path: '/explore', query: { tab: 'people' } })"
          >
            People
          </button>
          <button
            type="button"
            class="feed-portal__chip"
            @click="router.push({ path: '/explore', query: { tab: 'servers' } })"
          >
            Servers
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('search')">
          Open search
        </button>
      </aside>

      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--inbox"
        aria-label="Inbox"
      >
        <p class="feed-portal__kicker">Edge</p>
        <h2 class="feed-portal__title">
          Inbox
          <span v-if="conversationsStore.badgeLabel" class="feed-portal__badge">
            {{ conversationsStore.badgeLabel }}
          </span>
        </h2>
        <p class="feed-portal__body">
          {{
            instancesStore.hasAuthenticatedInstance
              ? 'Direct messages and group chats.'
              : 'Sign in to read and send messages.'
          }}
        </p>

        <div v-if="portalInboxRows.length" class="feed-portal__list">
          <button
            v-for="row in portalInboxRows"
            :key="row.id"
            type="button"
            class="feed-portal__list-row"
            :class="{ 'feed-portal__list-row--unread': row.unread }"
            @click="openInboxRow(row.statusId)"
          >
            <img v-if="row.avatar" :src="row.avatar" alt="" class="feed-portal__list-avatar" />
            <span v-else class="feed-portal__list-avatar feed-portal__list-avatar--empty" />
            <span class="feed-portal__row-text">
              <strong>{{ row.label }}</strong>
              <span>{{ row.preview }}</span>
            </span>
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('inbox')">
          {{ instancesStore.hasAuthenticatedInstance ? 'Open inbox' : 'Sign in' }}
        </button>
      </aside>

      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--activity"
        aria-label="Activity"
      >
        <p class="feed-portal__kicker">Edge</p>
        <h2 class="feed-portal__title">
          Activity
          <span v-if="notificationsStore.badgeLabel" class="feed-portal__badge">
            {{ notificationsStore.badgeLabel }}
          </span>
        </h2>
        <p class="feed-portal__body">
          {{
            instancesStore.hasAuthenticatedInstance
              ? 'Mentions, likes, boosts, and follows.'
              : 'Sign in to see notifications.'
          }}
        </p>

        <div v-if="instancesStore.hasAuthenticatedInstance" class="feed-portal__chips">
          <button type="button" class="feed-portal__chip" @click="openPortal('activity', { filter: 'mention' })">
            Mentions
          </button>
          <button type="button" class="feed-portal__chip" @click="openPortal('activity', { filter: 'favourite' })">
            Likes
          </button>
          <button type="button" class="feed-portal__chip" @click="openPortal('activity', { filter: 'reblog' })">
            Boosts
          </button>
        </div>

        <div v-if="portalActivityRows.length" class="feed-portal__list">
          <button
            v-for="row in portalActivityRows"
            :key="row.id"
            type="button"
            class="feed-portal__list-row"
            @click="openPortal('activity')"
          >
            <img v-if="row.avatar" :src="row.avatar" alt="" class="feed-portal__list-avatar" />
            <span v-else class="feed-portal__list-avatar feed-portal__list-avatar--empty" />
            <span class="feed-portal__row-text">
              <strong>{{ row.label }}</strong>
            </span>
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('activity')">
          {{ instancesStore.hasAuthenticatedInstance ? 'Open activity' : 'Sign in' }}
        </button>
      </aside>

      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--communities"
        aria-label="Find communities"
      >
        <p class="feed-portal__kicker">Edge</p>
        <h2 class="feed-portal__title">Groups</h2>
        <p class="feed-portal__body">
          {{
            groupsStore.joinedGroups.length
              ? 'Communities you follow — swipe back for feeds.'
              : 'Find communities and tags to follow.'
          }}
        </p>

        <div v-if="portalGroupChips.length" class="feed-portal__chips">
          <button
            v-for="group in portalGroupChips"
            :key="group.tag"
            type="button"
            class="feed-portal__chip"
            @click="router.push(`/groups/${encodeURIComponent(group.tag)}`)"
          >
            <span aria-hidden="true">{{ group.icon }}</span>
            {{ group.name }}
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('communities')">
          Browse groups
        </button>
      </aside>

    </div>

    <!-- Desktop Add Column Panel -->
    <div
      v-if="columnsStore.canAddColumn && !isDeskTabs"
      class="add-column-panel"
      :class="{ 'add-column-panel--expanded': addMenuOpen }"
      @click.stop
    >
      <NeoMenu
        v-model:open="addMenuOpen"
        class="add-column-neo add-column-neo--desktop"
        align="end"
        :label="`Add column (${columnsStore.columnCount}/${MAX_COLUMNS})`"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <template #items>
          <span class="add-column-menu__title">Add Column</span>
          <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('home')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            For You
          </button>
          <div class="add-column-menu__divider" role="separator" />
          <button type="button" class="add-column-menu__section-toggle" @click.stop="addAlgorithmsExpanded = !addAlgorithmsExpanded">
            <span>Algorithms</span>
            <svg :class="{ rotated: addAlgorithmsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <template v-if="addAlgorithmsExpanded">
            <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('local')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
              </svg>
              Local ({{ localHostLabel }})
            </button>
            <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('federated')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
              </svg>
              Federated
            </button>
            <button
              v-if="instancesStore.hasAuthenticatedInstance"
              type="button"
              role="menuitem"
              class="add-column-menu__item"
              @click="addColumn('favourites')"
            >
              <NeoIcon name="heart" :size="16" :stroke="1.5" />
              Liked
            </button>
            <button
              v-if="instancesStore.hasAuthenticatedInstance"
              type="button"
              role="menuitem"
              class="add-column-menu__item"
              @click="addColumn('bookmarks')"
            >
              <NeoIcon name="bookmark" :size="16" :stroke="1.5" />
              Saved
            </button>
            <button
              v-for="recipe in algorithmsStore.allRecipes"
              :key="`d-${recipe.id}`"
              type="button"
              role="menuitem"
              class="add-column-menu__item"
              @click="addColumn('algorithm', recipe.id)"
            >
              <NeoIcon name="filter" :size="16" :stroke="1.5" />
              {{ recipe.name }}
            </button>
            <button
              type="button"
              role="menuitem"
              class="add-column-menu__item"
              @click="algorithmsStore.openEditor(); addMenuOpen = false"
            >
              <NeoIcon name="plus" :size="16" :stroke="1.5" />
              Create algorithm…
            </button>
          </template>
          <div class="add-column-menu__divider" role="separator" />
          <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('search')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            Search
          </button>
          <button type="button" role="menuitem" class="add-column-menu__item" @click="addColumn('profile')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Profile
          </button>
          <button
            v-if="instancesStore.hasAuthenticatedInstance"
            type="button"
            role="menuitem"
            class="add-column-menu__item"
            @click="addColumn('notifications')"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            Notifications
          </button>
          <button
            v-if="instancesStore.hasAuthenticatedInstance"
            type="button"
            role="menuitem"
            class="add-column-menu__item"
            @click="addColumn('messages')"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            Messages
          </button>
          <div class="add-column-menu__divider" role="separator" />
          <button type="button" class="add-column-menu__section-toggle" @click.stop="addGroupsExpanded = !addGroupsExpanded">
            <span>Groups</span>
            <svg :class="{ rotated: addGroupsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <template v-if="addGroupsExpanded">
            <div class="add-column-menu__filter" @click.stop>
              <input
                v-model="addGroupQuery"
                type="search"
                class="add-column-menu__filter-input"
                placeholder="Find News, Dogs…"
                aria-label="Filter groups"
                @keydown.enter.prevent="addGroupCustomTag ? addGroupAsColumn(addGroupCustomTag) : addableGroups[0] && addGroupAsColumn(addableGroups[0].tag)"
              >
            </div>
            <div class="add-column-menu__groups">
              <button
                v-for="group in addableGroups"
                :key="group.tag"
                type="button"
                role="menuitem"
                class="add-column-menu__item add-column-menu__item--group"
                @click="addGroupAsColumn(group.tag)"
              >
                <span class="add-column-menu__group-icon">{{ group.icon }}</span>
                {{ group.name }}
              </button>
              <button
                v-if="addGroupCustomTag"
                type="button"
                role="menuitem"
                class="add-column-menu__item add-column-menu__item--group"
                @click="addGroupAsColumn(addGroupCustomTag)"
              >
                <span class="add-column-menu__group-icon">🏷️</span>
                Add #{{ addGroupCustomTag }}
              </button>
              <p v-else-if="addGroupQuery.trim() && !addableGroups.length" class="add-column-menu__empty">
                No matching groups
              </p>
            </div>
          </template>
          <span class="add-column-menu__hint">
            {{ columnsStore.columnCount }}/{{ MAX_COLUMNS }} columns on this device
          </span>
        </template>
      </NeoMenu>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.columns-page {
  display: flex;
  overflow: hidden;

  // Desktop: extend into main-content padding to fill the full viewport
  @media (min-width: 1024px) {
    height: 100vh;
    height: 100dvh;
    margin: -1.25rem;
    width: calc(100% + 2.5rem);
    overscroll-behavior-x: none;
  }

  @media (min-width: 1200px) {
    margin: -1.5rem -2rem;
    width: calc(100% + 4rem);
  }

  // Mobile: fill the padded main box (don't re-subtract chrome — that grew past the screen)
  @media (max-width: 1023px) {
    flex: 1;
    flex-direction: column;
    min-height: 0;
    width: 100%;
    max-width: 100%;
    margin-inline: 0;
  }

  // Single column / focused tab: center the content
  &:not(.columns-page--multi) {
    @media (min-width: 1024px) {
      justify-content: center;
    }
  }

  &--tabs {
    @media (min-width: 1024px) {
      flex-direction: column;
      align-items: stretch;
    }
  }

  // Desktop multi: whisper until hovered — only when real hover exists (not iPad sticky-hover)
  &--multi {
    @media (min-width: 1024px) and (hover: hover) and (pointer: fine) {
      :deep(.timeline-column.neo-chrome),
      :deep(.panel-column.neo-chrome) {
        --neo-chrome-fg: var(--neo-text-quaternary);
        --neo-chrome-fg-strong: var(--neo-text-tertiary);
        --neo-chrome-label: var(--neo-text-tertiary);
      }

      :deep(.timeline-column.neo-chrome:hover),
      :deep(.timeline-column.neo-chrome:focus-within),
      :deep(.panel-column.neo-chrome:hover),
      :deep(.panel-column.neo-chrome:focus-within) {
        --neo-chrome-fg: var(--neo-text-tertiary);
        --neo-chrome-fg-strong: var(--neo-text-secondary);
        --neo-chrome-label: var(--neo-text-primary);
      }
    }
  }
}

.columns-container {
  display: flex;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  // none (not contain) — stop Safari history swipe at the board edges
  overscroll-behavior-x: none;
  overscroll-behavior-y: none;
  -webkit-overflow-scrolling: touch;
  // Let iPad finger + trackpad claim horizontal; nested feeds keep pan-y for vertical
  touch-action: pan-x pan-y;
  scrollbar-width: thin;
  // Keep first column clear of the fixed sidebar when board scrolls
  scroll-padding-inline-start: 0.5rem;
  padding-inline-start: 0.25rem;
  box-sizing: border-box;

  @media (min-width: 1024px) {
    scroll-padding-inline-start: 0.75rem;
    padding-inline-start: 0.5rem;
  }

  &--swiping,
  &--settling {
    scroll-snap-type: none !important;
    cursor: grabbing;
    user-select: none;
  }

  // Single column: cap width for readability
  .columns-page:not(.columns-page--multi):not(.columns-page--tabs) & {
    @media (min-width: 1024px) {
      max-width: 620px;
      overflow-x: hidden;
      touch-action: pan-y;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 1 1 auto;
        min-width: 0;
      }
    }
  }

  // Focused tab: one wider reading column
  .columns-page--tabs & {
    @media (min-width: 1024px) {
      max-width: min(840px, 100%);
      width: 100%;
      margin-inline: auto;
      overflow-x: hidden;
      touch-action: pan-y;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        max-width: none;
      }
    }
  }

  // Multi-column: fill available space; columns keep a readable min-width and scroll
  .columns-page--multi & {
    max-width: none;
  }

  // Mobile: full-width pages — JS parks on release (CSS mandatory snap bounced vs settle)
  @media (max-width: 1023px) {
    width: 100%;
    // No side padding — equal-width pages + scrollLeft math need a clean box
    padding-inline: 0;
    scroll-padding-inline: 0;
    scroll-snap-type: none;
    scrollbar-width: none;
    // Finger: we axis-lock in JS; keep pan-y for nested feed scroll
    touch-action: pan-y;

    &::-webkit-scrollbar {
      display: none;
    }

    :deep(.timeline-column),
    :deep(.panel-column),
    .feed-portal {
      flex: 0 0 100%;
      width: 100%;
      min-width: 100%;
      max-width: 100%;
      border-right: none;
      box-sizing: border-box;
    }
  }

  @media (min-width: 1024px) {
    // Packed: share the row, but never crush past a readable width.
    // Soft proximity snap only — no mandatory/always (those fought trackpad panning).
    .columns-page--multi.columns-page--packed & {
      overflow-x: auto;
      scroll-snap-type: x proximity;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 1 1 0;
        min-width: max(280px, calc(100% / 6));
        max-width: none;
        scroll-snap-align: start;
      }
    }

    @media (max-width: 1366px) {
      .columns-page--multi.columns-page--packed & {
        :deep(.timeline-column),
        :deep(.panel-column) {
          // ~3 across on iPad landscape, then trackpad/finger scroll
          min-width: max(300px, 32%);
        }
      }
    }

    @media (min-width: 1367px) and (max-width: 1599px) {
      .columns-page--multi.columns-page--packed & {
        :deep(.timeline-column),
        :deep(.panel-column) {
          min-width: max(300px, 25%);
        }
      }
    }

    .columns-page--multi.columns-page--roomy & {
      overflow-x: auto;
      scroll-snap-type: x proximity;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 0 0 30%;
        min-width: 320px;
        max-width: 520px;
        scroll-snap-align: start;
      }
    }

    @media (max-width: 1199px) {
      .columns-page--multi.columns-page--roomy & {
        :deep(.timeline-column),
        :deep(.panel-column) {
          flex: 0 0 42%;
          min-width: 300px;
          max-width: 480px;
        }
      }
    }

    // Single column: Board toggle still changes width (was a silent no-op before)
    .columns-page:not(.columns-page--multi).columns-page--roomy & {
      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 0 1 auto;
        width: min(100%, 520px);
        max-width: 520px;
      }
    }

    .columns-page:not(.columns-page--multi).columns-page--packed & {
      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 1 1 auto;
        width: 100%;
        max-width: none;
      }
    }
  }
}

/* Keep mounted so column scrollTop survives focus mode (avoid display:none). */
:deep(.board-col--hidden) {
  content-visibility: hidden;
  visibility: hidden;
  position: absolute !important;
  inset: 0 auto auto 0;
  width: 1px !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 1px !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  overflow: hidden !important;
  opacity: 0;
  pointer-events: none;
  z-index: -1;
}

.feed-portal {
  display: none;
  box-sizing: border-box;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.75rem;
  padding: 2.5rem 1.25rem 5rem;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  background:
    radial-gradient(
      ellipse 70% 45% at 20% 35%,
      color-mix(in srgb, var(--neo-accent) 10%, transparent),
      transparent 70%
    ),
    var(--neo-bg-primary);
  color: var(--neo-text-primary);

  @media (max-width: 1023px) {
    display: flex;
  }

  &__kicker {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--neo-text-muted);
  }

  &__title {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }

  &__body {
    margin: 0;
    max-width: 22rem;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--neo-text-secondary);
  }

  &__cta {
    margin-top: 0.35rem;
  }

  &__panel {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: min(100%, 20rem);
    margin-top: 0.15rem;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover {
      border-color: color-mix(in srgb, var(--neo-accent) 40%, var(--neo-border-color));
      background: var(--neo-bg-hover, var(--neo-bg-tertiary));
    }
  }

  &__swatch {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 30%, var(--neo-accent) 0 35%, transparent 36%),
      linear-gradient(135deg, var(--neo-bg-card) 45%, var(--neo-text-primary) 46%);
    border: 1.5px solid var(--neo-border-color-dark);
  }

  &__row-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    flex: 1;

    strong {
      font-size: 0.8125rem;
      font-weight: 650;
    }

    span {
      font-size: 0.8125rem;
      color: var(--neo-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  &__row-action {
    flex-shrink: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--neo-text-muted);
  }

  &__identity {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.65rem;
    width: min(100%, 20rem);
  }

  &__avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid var(--neo-border-color);
    background: var(--neo-bg-tertiary);
  }

  &__who {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;

    strong {
      font-size: 1.125rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    span {
      font-size: 0.875rem;
      color: var(--neo-text-secondary);
    }
  }

  &__stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
    margin: 0;
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);

    b {
      color: var(--neo-text-primary);
      font-weight: 650;
    }
  }

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    width: min(100%, 22rem);
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--neo-border-color);
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    color: var(--neo-text-primary);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 550;
    cursor: pointer;

    &:hover {
      border-color: color-mix(in srgb, var(--neo-accent) 40%, var(--neo-border-color));
      background: var(--neo-accent-soft);
    }
  }

  &__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.35rem;
    height: 1.35rem;
    margin-left: 0.4rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: var(--neo-accent);
    color: var(--neo-on-accent, #fff);
    font-size: 0.75rem;
    font-weight: 700;
    vertical-align: middle;
  }

  &__search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: min(100%, 22rem);
    padding: 0.65rem 0.85rem;
    border-radius: 12px;
    border: 1px solid var(--neo-border-color);
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    color: var(--neo-text-secondary);

    &:focus-within {
      border-color: var(--neo-accent);
      box-shadow: 0 0 0 3px var(--neo-accent-soft);
    }
  }

  &__search-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--neo-text-primary);
    font: inherit;
    font-size: 0.9375rem;

    &:focus {
      outline: none;
    }

    &::placeholder {
      color: var(--neo-text-muted);
    }
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    width: min(100%, 22rem);
  }

  &__list-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover {
      border-color: color-mix(in srgb, var(--neo-accent) 40%, var(--neo-border-color));
      background: var(--neo-bg-hover, var(--neo-bg-tertiary));
    }

    &--unread {
      border-color: color-mix(in srgb, var(--neo-accent) 35%, var(--neo-border-color));
      background: var(--neo-accent-soft);
    }

    &--static {
      cursor: default;

      &:hover {
        border-color: var(--neo-border-color);
        background: var(--neo-bg-card, var(--neo-bg-secondary));
      }
    }
  }

  &__list-avatar {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 50%;
    object-fit: cover;
    background: var(--neo-bg-tertiary);

    &--empty {
      display: block;
    }
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

// ========================================
// Desktop focused-tab strip
// ========================================
.desk-feed-tabs {
  display: none;

  @media (min-width: 1024px) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    max-width: min(840px, 100%);
    width: 100%;
    margin: 0 auto;
    padding: 0.35rem 0.25rem 0.5rem;
    border-bottom: 1px solid var(--neo-border-color);
    box-sizing: border-box;
  }

  &__neo {
    flex: 1;
    min-width: 0;

    :deep(.neo-tabs__list) {
      gap: 0.25rem;
      border-bottom: none;
      overflow-x: auto;
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }
    }

    :deep(.neo-tabs__tab) {
      flex-shrink: 0;
      min-height: 40px;
      padding: 0.45rem 0.95rem;
      font-size: 0.9375rem;
      font-weight: 600;
      white-space: nowrap;
      border-radius: 999px;
      box-shadow: none;

      &[aria-selected='true'] {
        color: var(--neo-text-inverse, #fff);
        background: var(--neo-accent);
        box-shadow: none;
      }
    }
  }

  &__add {
    flex-shrink: 0;
  }
}

// ========================================
// Mobile feed tabs
// ========================================
.mobile-feed-tabs {
  display: none;
  flex-shrink: 0;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.35rem 0.35rem 0.55rem;
  border-bottom: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
  position: sticky;
  top: 0;
  z-index: 20;

  @media (max-width: 1023px) {
    display: flex;
  }

  &__scroller {
    display: flex;
    flex: 1;
    min-width: 0;
    gap: 0.35rem;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__neo {
    flex: 1;
    min-width: 0;

    // One horizontal scroller only (the outer __scroller). Nested overflow
    // made syncTabIntoView scroll a list that never overflowed on Android.
    :deep(.neo-tabs__list) {
      display: flex;
      gap: 0.35rem;
      border-bottom: none;
      overflow: visible;
    }

    :deep(.neo-tabs__tab) {
      flex-shrink: 0;
      max-width: 11rem;
      min-height: 44px;
      padding: 0.5rem 0.9rem;
      font-size: 0.875rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border-radius: 8px;
      box-shadow: none;
      // Column switcher is primary nav on phones — quaternary read ~2:1
      color: var(--neo-text-tertiary);

      &[aria-selected='true'] {
        color: var(--neo-text-primary);
        background: var(--neo-bg-tertiary);
        // Android touch often never shows :focus-visible — make selection unmistakable
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--neo-accent) 70%, transparent);
      }

      &:focus-visible {
        outline: 2px solid var(--neo-focus, var(--neo-accent));
        outline-offset: 2px;
      }
    }
  }

  // Right-edge thumb cluster: prev / next / add
  &__thumb {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.15rem;
  }

  &__jump,
  &__add-btn,
  &__mode {
    width: 44px;
    height: 44px;
  }

  &__jump:disabled {
    opacity: 0.28;
  }

  // Surreptitious Flow / Flip — reads as chrome until you notice
  &__mode {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--neo-text-quaternary);
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.18s ease, background 0.18s ease;

    &:active {
      transform: scale(0.96);
    }

    &--flip {
      color: var(--neo-text-tertiary);
    }

    &:hover,
    &:focus-visible {
      color: var(--neo-text-secondary);
      background: var(--neo-bg-tertiary);
    }
  }
}

.mode-glyph {
  position: relative;
  width: 18px;
  height: 16px;
  display: block;

  &__flow,
  &__flip {
    position: absolute;
    inset: 0;
    transition: opacity 0.2s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }

  &__flow {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    opacity: 1;
    transform: scale(1);

    i {
      display: block;
      height: 2px;
      border-radius: 1px;
      background: currentColor;
    }

    i:nth-child(1) { width: 100%; }
    i:nth-child(2) { width: 78%; }
    i:nth-child(3) { width: 92%; }
  }

  &__flip {
    width: 11px;
    height: 15px;
    margin: 0 auto;
    left: 0;
    right: 0;
    border: 1.75px solid currentColor;
    border-radius: 3px;
    opacity: 0;
    transform: scale(0.86);
  }
}

.mobile-feed-tabs__mode--flip .mode-glyph {
  .mode-glyph__flow {
    opacity: 0;
    transform: scale(0.86);
  }

  .mode-glyph__flip {
    opacity: 1;
    transform: scale(1);
  }
}

.mobile-feed-tabs {
  &__add {
    position: relative;
    flex-shrink: 0;
  }

  &__tab {
    flex-shrink: 0;
    max-width: 11rem;
    height: auto;
    min-height: 44px;
    padding: 0.5rem 0.9rem;
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-radius: 8px;

    &--recessed {
      color: var(--neo-text-quaternary);
      background: transparent;
      border-color: transparent;
    }

    &--active {
      color: var(--neo-text-secondary);
      background: var(--neo-bg-tertiary);
      border-color: transparent;
    }

    &:active {
      transform: scale(0.97);
    }
  }
}

// ========================================
// Add Column Panel
// ========================================
.add-column-panel {
  display: none;
  flex-shrink: 0;
  width: 48px;
  height: 100%;
  flex-direction: column;
  align-items: center;
  padding-top: 0.5rem;
  border-left: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
  position: relative;
  transition: width 0.2s ease;

  @media (min-width: 1024px) {
    display: flex;
  }

  &--expanded {
    width: 48px;
    z-index: var(--neo-z-dropdown, 1000);
  }
}

.add-column-neo {
  :deep(.neo-menu__trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    color: var(--neo-text-secondary);

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }

    @media (hover: none), (pointer: coarse) {
      width: 44px;
      height: 44px;
    }
  }

  :deep(.neo-menu__panel) {
    width: 240px;
    max-height: min(70vh, 28rem);
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--neo-bg-secondary);
    border-radius: 12px;
    box-shadow: var(--neo-shadow-xl);
    padding: 0.5rem;
    z-index: 50;
  }

  &--desktop :deep(.neo-menu__panel) {
    top: 0;
    right: calc(100% + 0.5rem);
    left: auto;
  }

  &--mobile :deep(.neo-menu__panel) {
    top: calc(100% + 0.35rem);
    right: 0;
    left: auto;
  }
}

.add-column-menu {
  &__title {
    display: block;
    padding: 0.375rem 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--neo-text-secondary);
    border-radius: var(--neo-radius-lg, 8px);
    transition: background-color 0.12s ease, color 0.12s ease;

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }

    &--server {
      color: var(--neo-text-muted);
    }

    svg {
      flex-shrink: 0;
    }
  }

  &__divider {
    height: 1px;
    background: var(--neo-border-color);
    margin: 0.375rem 0.5rem;
  }

  &__section-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: var(--neo-radius-lg, 6px);
    transition: background-color 0.12s ease, color 0.12s ease;

    &:hover {
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

  &__item--group {
    font-size: 0.8125rem;
    padding: 0.5rem 0.75rem;
  }

  &__group-icon {
    font-size: 1rem;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  &__filter {
    padding: 0.25rem 0.5rem 0.5rem;
  }

  &__filter-input {
    width: 100%;
    padding: 0.45rem 0.6rem;
    font-size: 0.8125rem;
    color: var(--neo-text-primary);
    background: var(--neo-bg-primary);
    border: 1px solid var(--neo-border-color);
    border-radius: 8px;

    &::placeholder {
      color: var(--neo-text-muted);
    }

    &:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-border-color));
    }
  }

  &__groups {
    max-height: 14rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  &__empty {
    margin: 0;
    padding: 0.5rem 0.75rem 0.75rem;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }

  &__hint {
    display: block;
    padding: 0.25rem 0.75rem 0.375rem;
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    text-align: center;
  }
}

</style>

<!-- Teleported Add Feed panel lives on <body>; scoped :deep() cannot reach it. -->
<style lang="scss">
.add-column-menu-panel.neo-menu__panel {
  width: 240px;
  max-height: min(70vh, 28rem);
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--neo-bg-secondary);
  border-radius: 12px;
  box-shadow: var(--neo-shadow-xl);
  padding: 0.5rem;
}
</style>
