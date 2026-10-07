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
import { useColumnsStore, MAX_COLUMNS, isTimelineFeed, type ColumnFeedType } from '~/stores/columns'
import { useGroupsStore } from '~/stores/groups'
import { useSettingsStore } from '~/stores/settings'

const themeStore = useThemeStore()
const instancesStore = useInstancesStore()
const columnsStore = useColumnsStore()
const groupsStore = useGroupsStore()
const settingsStore = useSettingsStore()
const router = useRouter()

const addMenuOpen = ref(false)
const addGroupsExpanded = ref(false)
const columnsContainer = ref<HTMLElement | null>(null)
const activeColumnIndex = ref(0)
const draggingColumnId = ref<string | null>(null)
const dropTargetColumnId = ref<string | null>(null)

/** Mobile-only edge slides: Settings → Profile → feeds → Communities */
const MOBILE_CAROUSEL_MQ = '(max-width: 1023px)'
const EDGE_LEFT = 2
const EDGE_RIGHT = 1
const isMobileUi = ref(false)
const carouselSlideIndex = ref(0)
let portalActionLock = false
let mobileMq: MediaQueryList | null = null

const slideCount = computed(() => {
  const feeds = columnsStore.columns.length
  return isMobileUi.value ? EDGE_LEFT + feeds + EDGE_RIGHT : feeds
})

const feedSlideOffset = computed(() => (isMobileUi.value ? EDGE_LEFT : 0))

const FEED_LABELS: Record<string, string> = {
  home: 'For You',
  local: 'Local',
  federated: 'Federated',
  profile: 'Profile',
  search: 'Search',
  notifications: 'Notifications',
  messages: 'Messages',
}

const columnTabLabels = computed(() =>
  columnsStore.columns.map((column) => {
    if (column.feedType === 'group' && column.groupTag) {
      const group = groupsStore.getGroup(column.groupTag)
      return group ? `${group.icon} ${group.name}` : `#${column.groupTag}`
    }
    return FEED_LABELS[column.feedType] ?? column.feedType
  }),
)

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

const closeAddMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (
    !target.closest('.add-column-panel') &&
    !target.closest('.mobile-feed-tabs')
  ) {
    addMenuOpen.value = false
  }
}

const addColumn = (feedType: ColumnFeedType, groupTag?: string) => {
  const id = columnsStore.addColumn(feedType, groupTag)
  addMenuOpen.value = false
  addGroupsExpanded.value = false
  nextTick(() => {
    const idx = id
      ? columnsStore.columns.findIndex((c) => c.id === id)
      : columnsStore.columns.length - 1
    if (idx >= 0) scrollToColumn(idx)
  })
}

const feedTabsScroller = ref<HTMLElement | null>(null)

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)

/** Desktop/iPad multi-column: end pad only (start pad was shifting col1 off-screen) */
const showBoardGutters = computed(
  () => !isMobileUi.value && columnsStore.isMultiColumn && !columnsStore.focusedColumnId,
)

const getColumnEls = (): HTMLElement[] => {
  const el = columnsContainer.value
  if (!el) return []
  return Array.from(
    el.querySelectorAll<HTMLElement>(':scope > .timeline-column, :scope > .panel-column'),
  )
}

const boardGutterWidth = () => {
  const el = columnsContainer.value
  if (!el || !showBoardGutters.value) return 0
  const g = el.querySelector('.board-gutter--end') as HTMLElement | null
  return g?.offsetWidth || 0
}

const scrollToSlide = (slideIndex: number, behavior: ScrollBehavior = 'smooth') => {
  const el = columnsContainer.value
  if (!el) return
  const idx = clamp(slideIndex, 0, Math.max(0, el.children.length - 1))
  const child = el.children[idx] as HTMLElement | undefined
  if (!child) return
  el.scrollTo({ left: child.offsetLeft, behavior })
  carouselSlideIndex.value = idx
}

const syncTabIntoView = (columnIndex: number, behavior: ScrollBehavior = 'smooth') => {
  nextTick(() => {
    const tab = feedTabsScroller.value?.children[columnIndex] as HTMLElement | undefined
    tab?.scrollIntoView({ behavior, inline: 'center', block: 'nearest' })
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

/**
 * Park on a column without overshooting. Stay on the active column unless
 * you've clearly crossed mid (or flicked) — stops elastic settle landing on col2.
 */
const snapBoardToNearest = (velocity = 0) => {
  const el = columnsContainer.value
  const cols = getColumnEls()
  if (!el || !cols.length || isMobileUi.value) return

  const active = clamp(activeColumnIndex.value, 0, cols.length - 1)
  let best = active

  if (velocity < -FLICK_VX) {
    best = Math.min(cols.length - 1, active + 1)
  } else if (velocity > FLICK_VX) {
    best = Math.max(0, active - 1)
  } else {
    const x = el.scrollLeft
    const cur = cols[active]!
    const curLeft = cur.offsetLeft
    const curW = Math.max(1, cur.offsetWidth)
    if (x > curLeft + curW * 0.55 && active < cols.length - 1) {
      best = active + 1
    } else if (x < curLeft - curW * 0.45 && active > 0) {
      best = active - 1
    } else {
      best = active
    }
  }

  activeColumnIndex.value = best
  const target = cols[best]!.offsetLeft
  if (Math.abs(el.scrollLeft - target) < 2) return
  el.scrollTo({ left: target, behavior: 'smooth' })
}

/**
 * Free travel across columns. Light resistance only past the last column
 * into the end pad (Safari history lives at the true edges).
 */
const applyBoardScroll = (el: HTMLElement, raw: number) => {
  const max = Math.max(0, el.scrollWidth - el.clientWidth)
  const gutter = boardGutterWidth()
  const next = Math.max(0, Math.min(max, raw))

  // Left edge: hard stop at 0 (first column parks here — no start spacer)
  if (next <= 0) {
    el.scrollLeft = 0
    return
  }

  if (gutter > 0 && max > gutter && next > max - gutter) {
    const hi = max - gutter
    const over = next - hi
    const resisted = over / (1 + over / (gutter * 0.9))
    el.scrollLeft = Math.min(max, hi + resisted)
    return
  }

  el.scrollLeft = next
}

let wheelSnapTimer = 0
let wheelSnapArmed = false

const openPortal = async (kind: 'settings' | 'profile' | 'communities') => {
  if (portalActionLock) return
  portalActionLock = true
  try {
    if (kind === 'settings') {
      settingsStore.open()
      scrollToColumn(0, 'smooth')
      return
    }
    // Park on nearest feed so Back lands on a real column
    if (kind === 'profile') {
      scrollToColumn(0, 'auto')
      await router.push(instancesStore.isAuthenticated ? '/profile' : '/login')
      return
    }
    scrollToColumn(Math.max(0, columnsStore.columns.length - 1), 'auto')
    await router.push('/groups')
  } finally {
    // Allow another edge settle after navigation/modal settles
    window.setTimeout(() => {
      portalActionLock = false
    }, 400)
  }
}

const settleCarousel = (slideIndex: number, behavior: ScrollBehavior = 'smooth') => {
  const feeds = columnsStore.columns.length
  if (!isMobileUi.value) {
    scrollToColumn(clamp(slideIndex, 0, Math.max(0, feeds - 1)), behavior)
    return
  }

  const maxSlide = EDGE_LEFT + feeds + EDGE_RIGHT - 1
  const idx = clamp(slideIndex, 0, maxSlide)

  if (idx === 0) {
    void openPortal('settings')
    return
  }
  if (idx === 1) {
    void openPortal('profile')
    return
  }
  if (idx >= EDGE_LEFT + feeds) {
    void openPortal('communities')
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
    const cols = getColumnEls()
    if (!cols.length) return
    let best = 0
    let bestDist = Infinity
    const x = el.scrollLeft
    for (let i = 0; i < cols.length; i++) {
      const d = Math.abs(cols[i]!.offsetLeft - x)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    activeColumnIndex.value = best
    return
  }

  const index = Math.round(el.scrollLeft / el.clientWidth)
  carouselSlideIndex.value = index
  const feeds = columnsStore.columns.length
  // Only remap tab highlight while parked on a real feed
  if (index >= EDGE_LEFT && index < EDGE_LEFT + feeds) {
    activeColumnIndex.value = index - EDGE_LEFT
  }
}

/** Trackpad / snap settle onto an edge portal (gesture path calls settleCarousel itself) */
const onCarouselScrollEnd = () => {
  if (carouselGesture || portalActionLock) return
  if (!isMobileUi.value) {
    if (showBoardGutters.value) snapBoardToNearest(0)
    return
  }
  const idx = carouselSlideIndex.value
  const feeds = columnsStore.columns.length
  if (idx <= 1 || idx >= EDGE_LEFT + feeds) {
    settleCarousel(idx)
  }
}

/**
 * Nested `.column-scroll` uses touch-action: pan-y, so Chrome Android + iPadOS
 * latch vertical and never chain horizontal pans to the board. Drive scrollLeft
 * ourselves on clear horizontal intent (finger). Trackpads use the wheel bridge.
 */
const AXIS_LOCK_PX = 10
const FLICK_VX = 0.35 // px/ms — easier column chunks on flick

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
 * iPad Magic Keyboard / trackpad: map horizontal wheel onto the board scroller.
 * Claim the gesture so Safari history needs a long slide into the gutter first.
 */
const onColumnsWheel = (e: WheelEvent) => {
  const el = columnsContainer.value
  if (!el || isMobileUi.value) return
  // Nothing to pan — don't steal the gesture
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

  // Shift+vertical wheel (mice) → horizontal
  if (e.shiftKey && Math.abs(dy) >= Math.abs(dx)) {
    dx = dy
  }

  // Dominant-horizontal trackpad swipe (iPadOS often sends deltaX here)
  if (Math.abs(dx) < 0.5 || Math.abs(dx) <= Math.abs(dy) * 1.05) return

  // preventDefault even when clamped — blocks Safari history until true edge
  e.preventDefault()
  if (!wheelSnapArmed) {
    wheelSnapArmed = true
    el.style.scrollSnapType = 'none'
    el.classList.add('columns-container--swiping')
  }
  applyBoardScroll(el, el.scrollLeft + dx)

  window.clearTimeout(wheelSnapTimer)
  wheelSnapTimer = window.setTimeout(() => {
    wheelSnapArmed = false
    el.style.scrollSnapType = ''
    el.classList.remove('columns-container--swiping')
    // Only chunk-snap when gutters/elastic pads are in play
    if (showBoardGutters.value) snapBoardToNearest(0)
  }, 140)
}

const onCarouselTouchStart = (e: TouchEvent) => {
  if (e.touches.length !== 1) return
  const el = columnsContainer.value
  // Track even when fully scrolled — horizontal lock still blocks history swipe
  if (!el) return
  const t = e.touches[0]!
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], .mobile-feed-tabs')) {
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
      el.classList.add('columns-container--swiping')
    }
  }

  if (g.locked !== 'x') return

  e.preventDefault()
  const dt = Math.max(1, now - g.lastT)
  g.vx = (t.clientX - g.lastX) / dt
  g.lastX = t.clientX
  g.lastT = now
  applyBoardScroll(el, g.startScroll - dx)
}

const finishCarouselGesture = (e: TouchEvent) => {
  const g = carouselGesture
  if (!g) return
  const ended = Array.from(e.changedTouches).some((c) => c.identifier === g.id)
  if (!ended) return

  const el = columnsContainer.value
  const wasX = g.locked === 'x'
  const vx = g.vx
  carouselGesture = null
  if (!el || !wasX) return

  el.style.scrollSnapType = ''
  el.classList.remove('columns-container--swiping')

  // Mobile snap carousel — park on a full-width slide
  if (isMobileUi.value) {
    const w = el.clientWidth || 1
    let index = Math.round(el.scrollLeft / w)
    if (vx < -FLICK_VX) index += 1
    else if (vx > FLICK_VX) index -= 1
    index = clamp(index, 0, Math.max(0, slideCount.value - 1))
    settleCarousel(index)
    return
  }

  // Desktop / iPad — chunk onto nearest column (elastic gutters spring back)
  snapBoardToNearest(vx)
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
  window.clearTimeout(wheelSnapTimer)
  wheelSnapArmed = false
  el.style.scrollSnapType = ''
  el.classList.remove('columns-container--swiping')
  carouselGesture = null
}

const syncMobileUi = () => {
  const next = !!mobileMq?.matches
  if (next === isMobileUi.value) return
  isMobileUi.value = next
  nextTick(() => scrollToColumn(activeColumnIndex.value, 'auto'))
}

watch(
  () => columnsStore.columnCount,
  (count) => {
    if (activeColumnIndex.value >= count) {
      activeColumnIndex.value = Math.max(0, count - 1)
    }
    nextTick(() => scrollToColumn(activeColumnIndex.value, 'auto'))
  },
)

// Gutters change column offsetLeft — re-park so we don't sit in the pad
watch(showBoardGutters, () => {
  nextTick(() => scrollToColumn(activeColumnIndex.value, 'auto'))
})

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

onMounted(async () => {
  await instancesStore.initialize()
  columnsStore.initialize()

  // Discover groups for everyone (menu Suggested + /groups hub)
  groupsStore.initializeGroups()

  if (instancesStore.userCustomCSS) {
    themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
  }

  document.addEventListener('click', closeAddMenu)

  mobileMq = window.matchMedia(MOBILE_CAROUSEL_MQ)
  isMobileUi.value = mobileMq.matches
  mobileMq.addEventListener('change', syncMobileUi)

  nextTick(() => {
    bindCarouselGestures()
    // Edge slides sit left of feeds — jump to first feed without animating through Settings
    scrollToColumn(activeColumnIndex.value, 'auto')
  })
})

onUnmounted(() => {
  document.removeEventListener('click', closeAddMenu)
  unbindCarouselGestures()
  mobileMq?.removeEventListener('change', syncMobileUi)
  mobileMq = null
})

useHead({ title: 'Home | NeoSpace' })
</script>

<template>
  <div
    class="columns-page"
    :class="{
      'columns-page--multi': columnsStore.isMultiColumn && !columnsStore.focusedColumnId,
      'columns-page--packed': columnsStore.deskDensity === 'packed',
      'columns-page--roomy': columnsStore.deskDensity === 'roomy',
      'columns-page--focus': !!columnsStore.focusedColumnId && !isMobileUi,
    }"
  >
    <!-- Mobile: feed strip + thumb-zone prev/next + add -->
    <nav class="mobile-feed-tabs" aria-label="Feeds">
      <div ref="feedTabsScroller" class="mobile-feed-tabs__scroller">
        <button
          v-for="(label, idx) in columnTabLabels"
          :key="columnsStore.columns[idx]!.id"
          type="button"
          class="mobile-feed-tabs__tab neo-btn neo-btn--tertiary"
          :class="{
            'mobile-feed-tabs__tab--active': activeColumnIndex === idx,
            'mobile-feed-tabs__tab--recessed': activeColumnIndex !== idx,
          }"
          :aria-current="activeColumnIndex === idx ? 'true' : undefined"
          @click="scrollToColumn(idx)"
        >
          {{ label }}
        </button>
      </div>

      <div class="mobile-feed-tabs__thumb">
        <!-- Quiet Flow ↔ Flip for the active feed -->
        <button
          type="button"
          class="mobile-feed-tabs__mode"
          :class="{ 'mobile-feed-tabs__mode--flip': activeViewMode === 'flip' }"
          :aria-label="activeViewMode === 'flip' ? 'Flip — tap for Flow' : 'Flow — tap for Flip'"
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
          v-if="columnsStore.columnCount >= 2 || isMobileUi"
          type="button"
          class="neo-btn neo-btn--tertiary neo-btn--icon mobile-feed-tabs__jump"
          aria-label="Previous"
          :disabled="isMobileUi ? carouselSlideIndex <= 0 : activeColumnIndex <= 0"
          @click="goPrevFeed"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          v-if="columnsStore.columnCount >= 2 || isMobileUi"
          type="button"
          class="neo-btn neo-btn--tertiary neo-btn--icon mobile-feed-tabs__jump"
          aria-label="Next"
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
          <button
            type="button"
            class="neo-btn neo-btn--tertiary neo-btn--icon mobile-feed-tabs__add-btn"
            :title="`Add feed (${columnsStore.columnCount}/${MAX_COLUMNS})`"
            aria-label="Add feed"
            @click="addMenuOpen = !addMenuOpen"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <Transition name="add-menu">
            <div v-if="addMenuOpen" class="add-column-menu add-column-menu--mobile">
              <span class="add-column-menu__title">Add Feed</span>
              <button class="add-column-menu__item" @click="addColumn('home')">For You</button>
              <button class="add-column-menu__item" @click="addColumn('local')">Local</button>
              <button class="add-column-menu__item" @click="addColumn('federated')">Federated</button>
              <div class="add-column-menu__divider"></div>
              <button class="add-column-menu__item" @click="addColumn('search')">Search</button>
              <button class="add-column-menu__item" @click="addColumn('profile')">Profile</button>
              <button
                v-if="instancesStore.hasAuthenticatedInstance"
                class="add-column-menu__item"
                @click="addColumn('notifications')"
              >Notifications</button>
              <button
                v-if="instancesStore.hasAuthenticatedInstance"
                class="add-column-menu__item"
                @click="addColumn('messages')"
              >Messages</button>
              <template v-if="groupsStore.joinedGroups.length > 0">
                <div class="add-column-menu__divider"></div>
                <button class="add-column-menu__section-toggle" @click.stop="addGroupsExpanded = !addGroupsExpanded">
                  <span>Groups</span>
                  <svg :class="{ 'rotated': addGroupsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <template v-if="addGroupsExpanded">
                  <button
                    v-for="group in groupsStore.joinedGroups"
                    :key="group.tag"
                    class="add-column-menu__item add-column-menu__item--group"
                    @click="addColumn('group', group.tag)"
                  >
                    <span class="add-column-menu__group-icon">{{ group.icon }}</span>
                    {{ group.name }}
                  </button>
                </template>
              </template>
              <span class="add-column-menu__hint">
                {{ columnsStore.columnCount }}/{{ MAX_COLUMNS }}
                <template v-if="instancesStore.isAuthenticated"> · syncs to your profile</template>
              </span>
            </div>
          </Transition>
        </div>
      </div>
    </nav>

    <div
      ref="columnsContainer"
      class="columns-container"
      :class="{ 'columns-container--gutters': showBoardGutters }"
      @scroll.passive="onColumnsScroll"
    >
      <!-- Mobile edge: keep swiping left → Profile, then Settings -->
      <aside
        v-if="isMobileUi"
        class="feed-portal"
        aria-label="Settings"
      >
        <h2 class="feed-portal__title">Settings</h2>
        <p class="feed-portal__body">Appearance and defaults.</p>
        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('settings')">
          Open
        </button>
      </aside>

      <aside
        v-if="isMobileUi"
        class="feed-portal"
        aria-label="Profile"
      >
        <h2 class="feed-portal__title">Profile</h2>
        <p class="feed-portal__body">
          {{ instancesStore.isAuthenticated ? 'Your posts and follows.' : 'Sign in to continue.' }}
        </p>
        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('profile')">
          {{ instancesStore.isAuthenticated ? 'Open' : 'Sign in' }}
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
          @focus="columnsStore.toggleColumnFocus(column.id)"
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
          @focus="columnsStore.toggleColumnFocus(column.id)"
          @column-drag-start="onColumnDragStart"
          @column-drag-end="onColumnDragEnd"
          @column-drag-over="onColumnDragOver"
          @column-drop="(fromId) => onColumnDrop(fromId, column.id)"
          @move-left="moveColumnLeft(idx)"
          @move-right="moveColumnRight(idx)"
        />
      </template>

      <!-- Mobile edge: past the last feed → find communities -->
      <aside
        v-if="isMobileUi"
        class="feed-portal"
        aria-label="Find communities"
      >
        <h2 class="feed-portal__title">Groups</h2>
        <p class="feed-portal__body">Communities and tags.</p>
        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('communities')">
          Browse
        </button>
      </aside>

      <div
        v-if="showBoardGutters"
        class="board-gutter board-gutter--end"
        aria-hidden="true"
      />
    </div>

    <!-- Desktop Add Column Panel -->
    <div
      v-if="columnsStore.canAddColumn"
      class="add-column-panel"
      :class="{ 'add-column-panel--expanded': addMenuOpen }"
      @click.stop
    >
      <button
        type="button"
        class="neo-btn neo-btn--tertiary neo-btn--icon add-column-btn"
        :title="`Add column (${columnsStore.columnCount}/${MAX_COLUMNS})`"
        :aria-label="`Add column (${columnsStore.columnCount}/${MAX_COLUMNS})`"
        @click="addMenuOpen = !addMenuOpen"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <Transition name="add-menu">
        <div v-if="addMenuOpen" class="add-column-menu">
          <span class="add-column-menu__title">Add Column</span>
          <button class="add-column-menu__item" @click="addColumn('home')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            For You
          </button>
          <button class="add-column-menu__item" @click="addColumn('local')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            Local
          </button>
          <button class="add-column-menu__item" @click="addColumn('federated')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            Federated
          </button>

          <div class="add-column-menu__divider"></div>
          <button class="add-column-menu__item" @click="addColumn('search')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            Search
          </button>
          <button class="add-column-menu__item" @click="addColumn('profile')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Profile
          </button>
          <button
            v-if="instancesStore.hasAuthenticatedInstance"
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
            class="add-column-menu__item"
            @click="addColumn('messages')"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            Messages
          </button>

          <template v-if="groupsStore.joinedGroups.length > 0">
            <div class="add-column-menu__divider"></div>
            <button class="add-column-menu__section-toggle" @click.stop="addGroupsExpanded = !addGroupsExpanded">
              <span>Groups</span>
              <svg :class="{ 'rotated': addGroupsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <template v-if="addGroupsExpanded">
              <button
                v-for="group in groupsStore.joinedGroups"
                :key="group.tag"
                class="add-column-menu__item add-column-menu__item--group"
                @click="addColumn('group', group.tag)"
              >
                <span class="add-column-menu__group-icon">{{ group.icon }}</span>
                {{ group.name }}
              </button>
            </template>
          </template>

          <span class="add-column-menu__hint">
            {{ columnsStore.columnCount }}/{{ MAX_COLUMNS }} columns
            <template v-if="instancesStore.isAuthenticated"> · syncs to profile</template>
          </span>
        </div>
      </Transition>
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

  // Mobile: fill viewport minus header + nav (keep height stable while scrolling)
  @media (max-width: 1023px) {
    flex-direction: column;
    height: calc(
      100dvh - var(--neo-mobile-chrome-top, 52px) - var(--neo-mobile-nav-h, 56px) -
        env(safe-area-inset-bottom, 0px)
    );
  }

  // Single column mode on desktop: center the content
  &:not(.columns-page--multi) {
    @media (min-width: 1024px) {
      justify-content: center;
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
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  // none (not contain) — stop Safari history swipe at the board edges
  overscroll-behavior-x: none;
  overscroll-behavior-y: none;
  -webkit-overflow-scrolling: touch;
  // Let iPad finger + trackpad claim horizontal; nested feeds keep pan-y for vertical
  touch-action: pan-x pan-y;
  scrollbar-width: thin;

  &--swiping {
    scroll-snap-type: none !important;
    cursor: grabbing;
    user-select: none;
  }

  // End pad only — start spacer was shoving col1 under the fold / looking like col2
  .board-gutter {
    flex: 0 0 clamp(36px, 6vw, 72px);
    width: clamp(36px, 6vw, 72px);
    min-width: clamp(36px, 6vw, 72px);
    pointer-events: none;
    flex-shrink: 0;
    scroll-snap-align: none;
  }

  &--gutters {
    @media (min-width: 1024px) and (max-width: 1366px) {
      .board-gutter--end {
        flex-basis: clamp(48px, 8vw, 88px);
        width: clamp(48px, 8vw, 88px);
        min-width: clamp(48px, 8vw, 88px);
      }
    }
  }

  // Single column: cap width for readability
  .columns-page:not(.columns-page--multi) & {
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

  // Multi-column: fill available space; columns keep a readable min-width and scroll
  .columns-page--multi & {
    max-width: none;
  }

  // Mobile: full-width snap carousel — swipe left/right between feeds
  @media (max-width: 1023px) {
    width: 100%;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;

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
      scroll-snap-align: start;
      scroll-snap-stop: always;
      border-right: none;
    }
  }

  @media (min-width: 1024px) {
    // Packed: share the row, but never crush past a readable width.
    // Wide desks: up to 6 across; narrower: step down to 4, then scroll.
    // iPad landscape (~1024–1366): chunky mandatory snap + elastic gutters.
    .columns-page--multi.columns-page--packed & {
      overflow-x: auto;
      scroll-snap-type: x proximity;
      scroll-padding-inline: 0;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 1 1 0;
        min-width: max(280px, calc(100% / 6));
        max-width: none;
        scroll-snap-align: start;
        scroll-snap-stop: always;
      }
    }

    @media (max-width: 1366px) {
      .columns-page--multi.columns-page--packed & {
        // Chunky column hits on iPad — must stop on each column
        scroll-snap-type: x mandatory;

        :deep(.timeline-column),
        :deep(.panel-column) {
          // ~3 across on iPad landscape, then trackpad/finger scroll
          min-width: max(300px, 32%);
          scroll-snap-stop: always;
        }
      }

      .columns-page--multi.columns-page--roomy & {
        scroll-snap-type: x mandatory;

        :deep(.timeline-column),
        :deep(.panel-column) {
          scroll-snap-align: start;
          scroll-snap-stop: always;
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
        scroll-snap-stop: always;
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

:deep(.board-col--hidden) {
  display: none !important;
}

.feed-portal {
  display: none;
  box-sizing: border-box;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.75rem;
  padding: 2.5rem 1.75rem 5rem;
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
    margin-top: 0.5rem;
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
  }
}

.add-column-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;

  @media (hover: none), (pointer: coarse) {
    width: 44px;
    height: 44px;
  }
}

.add-column-menu {
  position: absolute;
  top: 0.5rem;
  right: calc(100% + 0.5rem);
  width: 200px;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  box-shadow: var(--neo-shadow-xl);
  padding: 0.5rem;
  z-index: 50;

  &--mobile {
    top: calc(100% + 0.35rem);
    right: 0;
    left: auto;
  }

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
    border-radius: 8px;
    transition: all 0.12s ease;

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
    border-radius: 6px;
    transition: all 0.12s ease;

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

  &__hint {
    display: block;
    padding: 0.25rem 0.75rem 0.375rem;
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    text-align: center;
  }
}

// ========================================
// Add menu transition
// ========================================
.add-menu-enter-active,
.add-menu-leave-active {
  transition: all 0.15s ease;
  transform-origin: right top;
}
.add-menu-enter-from,
.add-menu-leave-to {
  opacity: 0;
  transform: scale(0.95) translateX(4px);
}
.add-column-menu--mobile.add-menu-enter-from,
.add-column-menu--mobile.add-menu-leave-to {
  transform: scale(0.95) translateY(-4px);
}
</style>
