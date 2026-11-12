/**
 * Home board shell: the horizontal scroller (desktop multi-column / phone
 * carousel), active-column tracking, parking + settle animation, touch / wheel
 * gestures, and the page's mount / keepalive lifecycle.
 *
 * Mobile portal chrome lives in useBoardPortals; add-menu / reorder / labels
 * live in useBoardColumns.
 */

import type { Ref } from 'vue'
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useColumnsStore } from '~/stores/columns'
import { useGroupsStore } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'
import { useThemeStore } from '~/stores/theme'
import { BOARD_EDGE_LEFT, BOARD_EDGE_RIGHT, type useBoardPortals } from '~/composables/useBoardPortals'
import { useBoardCoach } from '~/composables/useBoardCoach'
import { useBoardPortal } from '~/composables/useBoardPortal'
import { useActiveBoardColumnId, usePendingColumnJump } from '~/composables/useBoardNav'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'

export function useBoardShell({
  isMobileUi,
  portals,
}: {
  isMobileUi: Ref<boolean>
  portals: Pick<ReturnType<typeof useBoardPortals>, 'syncBoardPortalFromSlide' | 'isPortalActionLocked'>
}) {
  const themeStore = useThemeStore()
  const instancesStore = useInstancesStore()
  const columnsStore = useColumnsStore()
  const groupsStore = useGroupsStore()
  const { setBoardPortal } = useBoardPortal()
  const pendingColumnJump = usePendingColumnJump()
  const activeBoardColumnId = useActiveBoardColumnId()
  const { syncBoardPortalFromSlide, isPortalActionLocked } = portals
  const reducedMotion = usePrefersReducedMotion()
  /** JS smooth scrolling ignores the CSS reduced-motion rule — downgrade it here */
  const motionBehavior = (behavior: ScrollBehavior): ScrollBehavior =>
    reducedMotion.value && behavior === 'smooth' ? 'auto' : behavior

  const columnsContainer = ref<HTMLElement | null>(null)
  const activeColumnIndex = ref(0)
  watch(
    activeColumnIndex,
    (idx) => {
      activeBoardColumnId.value = columnsStore.columns[idx]?.id ?? null
    },
    { immediate: true },
  )
  watch(
    () => columnsStore.columns.map((c) => c.id).join(','),
    () => {
      activeBoardColumnId.value =
        columnsStore.columns[activeColumnIndex.value]?.id ?? null
    },
  )

  /** Phone carousel only (≤767) — tablets graduate to multi-column board + sidebar rail */
  const MOBILE_CAROUSEL_MQ = '(max-width: 767px)'
  const EDGE_LEFT = BOARD_EDGE_LEFT
  const EDGE_RIGHT = BOARD_EDGE_RIGHT
  /** Phone landscape short shell — merge feed pills into the top chrome */
  const PHONE_LANDSCAPE_MQ =
    '(max-height: 500px) and (orientation: landscape) and (max-width: 1023px)'
  const isPhoneLandscapeUi = ref(false)
  let landscapeMq: MediaQueryList | null = null
  const carouselSlideIndex = ref(0)
  let mobileMq: MediaQueryList | null = null

  const slideCount = computed(() => {
    const feeds = columnsStore.columns.length
    return isMobileUi.value ? EDGE_LEFT + feeds + EDGE_RIGHT : feeds
  })

  const feedSlideOffset = computed(() => (isMobileUi.value ? EDGE_LEFT : 0))

  const isDeskTabs = computed(
    () => columnsStore.deskDensity === 'tabs' && !isMobileUi.value,
  )

  const scrollActiveFeedToTop = () => {
    if (!import.meta.client) return
    const root = columnsContainer.value
    if (!root) return
    const col = root.querySelector(
      `.timeline-column:not(.board-col--hidden) .column-scroll, .panel-column:not(.board-col--hidden) .column-scroll`,
    ) as HTMLElement | null
    // Prefer the slide matching the active index when several are mounted
    const slides = root.querySelectorAll<HTMLElement>('.timeline-column .column-scroll, .panel-column .column-scroll')
    const active = slides[activeColumnIndex.value] || col
    if (!active || active.scrollTop <= 0) return
    active.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const feedTabsScroller = ref<HTMLElement | null>(null)

  const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)

  const getColumnEls = (): HTMLElement[] => {
    const el = columnsContainer.value
    if (!el) return []
    return Array.from(
      el.querySelectorAll<HTMLElement>(':scope > .timeline-column, :scope > .panel-column'),
    )
  }

  /**
   * Mobile carousel: only the parked page is interactive. Off-screen feeds and
   * edge portals stay rendered for swiping, but leave the tab order and the a11y
   * tree — otherwise Tab / a screen reader walks into slides you can't see (and
   * focusing one scrolls the board sideways under the park logic). The feed pills
   * and Prev / Next move between pages.
   */
  const slideInert = (slideIndex: number) =>
    isMobileUi.value && carouselSlideIndex.value !== slideIndex

  /** Desktop focus mode: other columns stay mounted (scroll survives) but hidden. */
  const isColumnHidden = (columnId: string) =>
    !!columnsStore.focusedColumnId && columnsStore.focusedColumnId !== columnId && !isMobileUi.value

  /** Every full-width carousel page (edge portals + feed columns). */
  const getSlideEls = (): HTMLElement[] => {
    const el = columnsContainer.value
    if (!el) return []
    return Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement)
  }

  /**
   * Slide position inside the scroller.
   * Mobile pages are full-bleed — index × width avoids layout thrash every frame.
   * Desktop still uses getBoundingClientRect (padding / unequal widths).
   */
  const slideScrollLeft = (el: HTMLElement, child: HTMLElement) => {
    if (isMobileUi.value) {
      const slides = getSlideEls()
      const idx = slides.indexOf(child)
      const w = el.clientWidth
      if (idx >= 0 && w > 0) return idx * w
    }
    return child.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
  }

  /** Prefer viewport-relative left — padding/subpixels break index math with many slides. */
  const nearestSlideIndex = (scrollLeft?: number) => {
    const el = columnsContainer.value
    const slides = getSlideEls()
    if (!el || !slides.length) return 0
    const x = scrollLeft ?? el.scrollLeft
    if (isMobileUi.value) {
      const w = el.clientWidth
      if (w <= 0) return 0
      return clamp(Math.round(x / w), 0, slides.length - 1)
    }
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
  let parkAnimRaf = 0
  /** Finger lost cancelable touchmove — native scrolling; park when it ends */
  let nativeTookOver = false

  const armParkCooldown = (ms = 320) => {
    parkCooldownUntil = performance.now() + ms
  }

  const cancelParkAnim = () => {
    if (parkAnimRaf) cancelAnimationFrame(parkAnimRaf)
    parkAnimRaf = 0
  }

  const syncParkedFeedTabs = (slideIndex: number) => {
    const feeds = columnsStore.columns.length
    if (slideIndex >= EDGE_LEFT && slideIndex < EDGE_LEFT + feeds) {
      const colIdx = slideIndex - EDGE_LEFT
      if (activeColumnIndex.value !== colIdx) activeColumnIndex.value = colIdx
      syncTabIntoView(colIdx, 'auto')
    }
  }

  const parkSlideNow = (el: HTMLElement, slideIndex: number) => {
    cancelParkAnim()
    const slides = getSlideEls()
    const child = slides[clamp(slideIndex, 0, Math.max(0, slides.length - 1))]
    if (!child) return
    el.scrollLeft = slideScrollLeft(el, child)
    el.style.scrollSnapType = 'none'
    el.style.touchAction = ''
    el.classList.remove('columns-container--settling', 'columns-container--swiping')
    carouselSettling = false
    armParkCooldown()
    syncParkedFeedTabs(slideIndex)
  }

  /** Short ease-out park for finger flicks — feels glued without bounce loops. */
  const parkSlideAnimated = (el: HTMLElement, slideIndex: number) => {
    const slides = getSlideEls()
    const idx = clamp(slideIndex, 0, Math.max(0, slides.length - 1))
    const child = slides[idx]
    if (!child) return
    const target = slideScrollLeft(el, child)
    const dist = target - el.scrollLeft
    if (reducedMotion.value || Math.abs(dist) < 3) {
      parkSlideNow(el, idx)
      return
    }

    cancelParkAnim()
    el.style.scrollSnapType = 'none'
    el.style.touchAction = ''
    el.classList.remove('columns-container--swiping')
    el.classList.add('columns-container--settling')
    carouselSettling = true
    carouselSlideIndex.value = idx
    syncBoardPortalFromSlide(idx)

    const start = el.scrollLeft
    const duration = clamp(150 + Math.abs(dist) * 0.12, 140, 240)
    const t0 = performance.now()
    const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      el.scrollLeft = start + dist * easeOutCubic(t)
      onColumnsScroll()
      if (t < 1) {
        parkAnimRaf = requestAnimationFrame(step)
        return
      }
      parkAnimRaf = 0
      el.scrollLeft = target
      el.classList.remove('columns-container--settling')
      carouselSettling = false
      armParkCooldown()
      syncParkedFeedTabs(idx)
    }
    parkAnimRaf = requestAnimationFrame(step)
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
    window.clearTimeout(settleTimer)

    if (isMobileUi.value) {
      // Instant for restores / tab taps; short ease for flick settle
      if (motionBehavior(behavior) === 'smooth') {
        parkSlideAnimated(el, idx)
      } else {
        carouselSettling = false
        parkSlideNow(el, idx)
      }
      return
    }

    if (motionBehavior(behavior) === 'auto') {
      carouselSettling = false
      parkSlideNow(el, idx)
      return
    }

    const gen = ++settleGen
    carouselSettling = true
    el.style.scrollSnapType = 'none'
    el.classList.add('columns-container--settling')
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

  /** Outer overflow scroller for the mobile feed-tab strip (not nested neo-tabs__list). */
  const feedTabScrollRoot = (): HTMLElement | null => {
    const root = feedTabsScroller.value
    if (!root) return null
    if (root.scrollWidth > root.clientWidth + 2) return root
    const inner = root.querySelector('.neo-tabs__list') as HTMLElement | null
    if (inner && inner.scrollWidth > inner.clientWidth + 2) return inner
    return root
  }

  /** Scroll the feed-tab strip so the active column’s tab is visible. */
  const syncTabIntoView = (columnIndex: number, behavior: ScrollBehavior = 'smooth') => {
    nextTick(() => {
      const list = feedTabScrollRoot()
      if (!list) return
      const tabs = list.querySelectorAll<HTMLElement>('[role="tab"]')
      const tab = tabs[columnIndex]
      if (!tab) return
      // Never use document scrollIntoView — it yanks the page vertically on Chrome Android.
      const listRect = list.getBoundingClientRect()
      const tabRect = tab.getBoundingClientRect()
      const delta =
        tabRect.left + tabRect.width / 2 - (listRect.left + listRect.width / 2)
      if (Math.abs(delta) < 2) return
      const nextLeft = list.scrollLeft + delta
      if (typeof list.scrollTo === 'function') {
        list.scrollTo({ left: nextLeft, behavior: isMobileUi.value ? 'auto' : motionBehavior(behavior) })
      } else {
        list.scrollLeft = nextLeft
      }
    })
  }

  /**
   * While the board pans, keep the feed strip locked to the same fractional
   * progress — tabs slide with your finger instead of jumping after settle.
   */
  const syncTabsWithPanProgress = () => {
    if (!isMobileUi.value) return
    const el = columnsContainer.value
    const list = feedTabScrollRoot()
    if (!el || !list) return
    const feeds = columnsStore.columns.length
    if (feeds < 1) return

    const w = el.clientWidth
    if (w <= 0) return
    // Full-bleed slides: one division, no per-slide layout reads
    const fractional = clamp(el.scrollLeft / w - EDGE_LEFT, 0, Math.max(0, feeds - 1))

    const tabs = list.querySelectorAll<HTMLElement>('[role="tab"]')
    if (!tabs.length) return
    const i0 = clamp(Math.floor(fractional), 0, tabs.length - 1)
    const i1 = clamp(Math.ceil(fractional), 0, tabs.length - 1)
    const tab0 = tabs[i0]
    const tab1 = tabs[i1] || tab0
    if (!tab0 || !tab1) return

    const t = fractional - i0
    const listRect = list.getBoundingClientRect()
    const centerDoc = (tab: HTMLElement) => {
      const r = tab.getBoundingClientRect()
      return r.left + r.width / 2 - listRect.left + list.scrollLeft
    }
    const targetCenter = centerDoc(tab0) + (centerDoc(tab1) - centerDoc(tab0)) * t
    const maxLeft = Math.max(0, list.scrollWidth - list.clientWidth)
    const nextLeft = clamp(targetCenter - list.clientWidth / 2, 0, maxLeft)
    if (Math.abs(list.scrollLeft - nextLeft) > 0.5) {
      list.scrollLeft = nextLeft
    }
  }

  const scrollToColumn = (index: number, behavior: ScrollBehavior = 'smooth') => {
    const colIdx = clamp(index, 0, Math.max(0, columnsStore.columns.length - 1))
    activeColumnIndex.value = colIdx
    if (isMobileUi.value) {
      scrollToSlide(colIdx + feedSlideOffset.value, behavior)
    } else {
      const el = columnsContainer.value
      const col = getColumnEls()[colIdx]
      // Measure against the scroller (not offsetLeft, which depends on the
      // offsetParent chain) and honour its start padding so column 1 isn't clipped.
      if (el && col) {
        const pad = parseFloat(getComputedStyle(el).scrollPaddingInlineStart) || 0
        el.scrollTo({ left: Math.max(0, slideScrollLeft(el, col) - pad), behavior: motionBehavior(behavior) })
      }
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
      // While focused the other columns collapse and the strip's scrollLeft clamps
      // to 0 — put the strip back on this column once the layout is restored
      if (columnsStore.focusedColumnId == null) {
        void nextTick(() => scrollToColumn(idx, 'auto'))
      }
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

  /** Scroll fires many times per frame — measure slides at most once per frame. */
  let columnsScrollRaf = 0

  const onColumnsScroll = () => {
    if (columnsScrollRaf) return
    columnsScrollRaf = requestAnimationFrame(() => {
      columnsScrollRaf = 0
      syncFromColumnsScroll()
    })
  }

  const syncFromColumnsScroll = () => {
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
    // Remap tab highlight while nearest a real feed
    if (index >= EDGE_LEFT && index < EDGE_LEFT + feeds) {
      const next = index - EDGE_LEFT
      if (activeColumnIndex.value !== next) {
        activeColumnIndex.value = next
      }
    }
    // Continuous: tab strip tracks finger/momentum during the pan, not only on settle
    syncTabsWithPanProgress()
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
    if (carouselGesture || isPortalActionLocked() || carouselSettling) return
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
  /** A horizontally scrollable element between `target` and the board that can still move toward `dx` */
  const nestedHorizontalScroller = (target: EventTarget | null, board: HTMLElement, dx: number): boolean => {
    let node = target instanceof HTMLElement ? target : null
    while (node && node !== board) {
      if (node.scrollWidth > node.clientWidth + 1) {
        const ox = getComputedStyle(node).overflowX
        if (ox === 'auto' || ox === 'scroll') {
          const atStart = node.scrollLeft <= 0
          const atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1
          if ((dx < 0 && !atStart) || (dx > 0 && !atEnd)) return true
        }
      }
      node = node.parentElement
    }
    return false
  }

  /** Is `target` inside any element that scrolls horizontally (below the board)? */
  const insideHorizontalScroller = (target: EventTarget | null, board: HTMLElement): boolean => {
    let node = target instanceof HTMLElement ? target : null
    while (node && node !== board) {
      if (node.scrollWidth > node.clientWidth + 1) {
        const ox = getComputedStyle(node).overflowX
        if (ox === 'auto' || ox === 'scroll') return true
      }
      node = node.parentElement
    }
    return false
  }

  /** After an x-locked swipe, the lift-off must not "click" the link / button it began on */
  let swallowClickUntil = 0
  const onCarouselClickCapture = (e: MouseEvent) => {
    if (performance.now() > swallowClickUntil) return
    swallowClickUntil = 0
    e.preventDefault()
    e.stopPropagation()
  }

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
    // Let nested horizontal scrollers (account strips, wide media / code) pan themselves
    if (nestedHorizontalScroller(e.target, el, dx)) return

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

  /** `[` / `]`: keyboard users jump between columns instead of tabbing through every card */
  const onBoardKeydown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
    if (e.key !== '[' && e.key !== ']') return
    if (isMobileUi.value) return
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    const cols = getColumnEls()
    if (cols.length < 2) return
    let cur = cols.findIndex((c) => c.contains(document.activeElement))
    if (cur < 0) cur = activeColumnIndex.value
    const next = clamp(cur + (e.key === ']' ? 1 : -1), 0, cols.length - 1)
    if (next === cur) return
    e.preventDefault()
    scrollToColumn(next)
    const col = cols[next]
    const target =
      col?.querySelector<HTMLElement>('[role="feed"]') ??
      col?.querySelector<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]')
    target?.focus({ preventScroll: true })
  }

  const onCarouselTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return
    const el = columnsContainer.value
    // Track even when fully scrolled — horizontal lock still blocks history swipe
    if (!el) return
    const t = e.touches[0]!
    const target = e.target as HTMLElement | null
    // Don't steal taps from column chrome / compose / menus (iPad move/close/focus).
    // Links and buttons inside posts DO start a swipe — names, reblog labels and the action bar
    // cover most of a card, and a tap on them still works (the click is swallowed only after an x-locked swipe).
    if (
      target?.closest(
        'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="slider"], video, audio, .mobile-feed-tabs, .mobile-feed-chrome, .column-header, .feed-dropdown, .add-column-panel, .compose, .compose-pill, .feed-portal__search, .feed-portal__list',
      )
    ) {
      return
    }
    // Wide media / code / account strips pan themselves
    if (insideHorizontalScroller(target, el)) return
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
    // scroll events can coalesce under preventDefault — keep tabs glued every move
    onColumnsScroll()
  }

  const scheduleNativePark = () => {
    const el = columnsContainer.value
    if (!el || !isMobileUi.value) return
    whenScrollIdle(el, () => {
      if (carouselGesture || carouselSettling || isPortalActionLocked()) return
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
    swallowClickUntil = performance.now() + 400

    el.style.touchAction = ''
    el.classList.remove('columns-container--swiping')

    // Mobile — eased park on a full-width slide (±1 on a clear flick)
    if (isMobileUi.value) {
      let index = nearestSlideIndex()
      if (vx < -FLICK_VX) index += 1
      else if (vx > FLICK_VX) index -= 1
      index = clamp(index, 0, Math.max(0, slideCount.value - 1))
      settleCarousel(index, 'smooth')
      return
    }

    // Desktop / iPad — gentle coast, leave where it lands (no spring-back)
    el.style.scrollSnapType = ''
    if (Math.abs(vx) > 0.08) {
      const max = Math.max(0, el.scrollWidth - el.clientWidth)
      const coast = Math.max(0, Math.min(max, el.scrollLeft - vx * 180))
      el.scrollTo({ left: coast, behavior: motionBehavior('smooth') })
    }
    syncActiveColumnFromScroll()
  }

  /** Re-park after Android URL-bar / keyboard / orientation changes slide width. */
  let carouselResizeRo: ResizeObserver | null = null
  let carouselVvParkTimer = 0

  const reparkCarouselAfterResize = () => {
    if (!isMobileUi.value || carouselGesture || carouselSettling || isPortalActionLocked()) return
    window.clearTimeout(carouselVvParkTimer)
    carouselVvParkTimer = window.setTimeout(() => {
      if (!isMobileUi.value || carouselGesture || carouselSettling) return
      scrollToSlide(carouselSlideIndex.value, 'auto')
    }, 80)
  }

  /** Element the carousel listeners were bound to — the template ref is null by unmount */
  let carouselBoundEl: HTMLElement | null = null

  const bindCarouselGestures = () => {
    const el = columnsContainer.value
    if (!el) return
    if (carouselBoundEl) unbindCarouselGestures()
    carouselBoundEl = el
    el.addEventListener('touchstart', onCarouselTouchStart, { passive: true, capture: true })
    el.addEventListener('touchmove', onCarouselTouchMove, { passive: false, capture: true })
    el.addEventListener('touchend', finishCarouselGesture, { passive: true, capture: true })
    el.addEventListener('touchcancel', finishCarouselGesture, { passive: true, capture: true })
    el.addEventListener('click', onCarouselClickCapture, true)
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
    const el = carouselBoundEl
    if (!el) return
    carouselBoundEl = null
    el.removeEventListener('touchstart', onCarouselTouchStart, true)
    el.removeEventListener('touchmove', onCarouselTouchMove, true)
    el.removeEventListener('touchend', finishCarouselGesture, true)
    el.removeEventListener('touchcancel', finishCarouselGesture, true)
    el.removeEventListener('click', onCarouselClickCapture, true)
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
    const landscape = !!landscapeMq?.matches
    isPhoneLandscapeUi.value = landscape
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
      // initialize() can drop the focused column — Tabs density needs a selected tab
      columnsStore.ensureTabsFocus()
      activeColumnIndex.value = 0
      nextTick(() => scrollToColumn(0, 'auto'))
    },
  )

  /**
   * After returning from a subview / portal route, Android often leaves the board
   * mid-slide or at Settings (slide 0). Prefer an explicit pending jump, then the
   * last visible feed — not a stale shelf-focus from an earlier nav jump.
   */
  const restoreFeedPark = () => {
    nextTick(() => {
      requestAnimationFrame(() => {
        if (pendingColumnJump.value) {
          const idx = columnsStore.columns.findIndex((c) => c.id === pendingColumnJump.value)
          pendingColumnJump.value = null
          if (idx >= 0) {
            scrollToColumn(idx, 'auto')
            return
          }
        }
        if (!isMobileUi.value && columnsStore.focusedColumnId) {
          const idx = columnsStore.columns.findIndex((c) => c.id === columnsStore.focusedColumnId)
          if (idx >= 0) {
            scrollToColumn(idx, 'auto')
            return
          }
        }
        scrollToColumn(activeColumnIndex.value, 'auto')
      })
    })
  }

  /** Set on unmount so work queued behind onMounted's await doesn't bind listeners afterwards */
  let disposed = false

  /** Side nav / tab bar asked to park on a board column (may already be on `/`). */
  watch(
    pendingColumnJump,
    (id) => {
      if (!id || disposed) return
      const idx = columnsStore.columns.findIndex((c) => c.id === id)
      if (idx < 0) {
        pendingColumnJump.value = null
        return
      }
      nextTick(() => {
        requestAnimationFrame(() => {
          if (disposed || pendingColumnJump.value !== id) return
          pendingColumnJump.value = null
          activeColumnIndex.value = idx
          scrollToColumn(idx, isMobileUi.value ? 'auto' : 'smooth')
        })
      })
    },
    { flush: 'post' },
  )

  onMounted(async () => {
    await instancesStore.initialize()
    if (disposed) return
    columnsStore.initialize()

    // Discover groups for everyone (menu Suggested + /groups hub)
    groupsStore.initializeGroups()

    if (instancesStore.userCustomCSS) {
      themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
    }

    mobileMq = window.matchMedia(MOBILE_CAROUSEL_MQ)
    landscapeMq = window.matchMedia(PHONE_LANDSCAPE_MQ)
    isMobileUi.value = mobileMq.matches
    isPhoneLandscapeUi.value = landscapeMq.matches
    mobileMq.addEventListener('change', syncMobileUi)
    landscapeMq.addEventListener('change', syncMobileUi)

    nextTick(() => {
      if (disposed) return
      bindCarouselGestures()
      // Edge slides sit left of feeds — jump to first feed without animating through Settings
      scrollToColumn(activeColumnIndex.value, 'auto')
      if (instancesStore.hasAuthenticatedInstance && isMobileUi.value) {
        const { startIfNeeded } = useBoardCoach()
        // Let the board paint first so the coach doesn't fight the carousel park
        window.setTimeout(() => startIfNeeded(), 700)
      }
    })
  })

  onActivated(() => {
    // keepalive: onMounted won't re-run; subview back can leave scroll at Settings (slide 0)
    activeBoardColumnId.value =
      columnsStore.columns[activeColumnIndex.value]?.id ?? null
    restoreFeedPark()
  })

  onDeactivated(() => {
    setBoardPortal(null)
    activeBoardColumnId.value = null
    cancelParkAnim()
  })

  onUnmounted(() => {
    disposed = true
    cancelParkAnim()
    if (columnsScrollRaf) cancelAnimationFrame(columnsScrollRaf)
    columnsScrollRaf = 0
    setBoardPortal(null)
    unbindCarouselGestures()
    mobileMq?.removeEventListener('change', syncMobileUi)
    landscapeMq?.removeEventListener('change', syncMobileUi)
    mobileMq = null
    landscapeMq = null
  })

  return {
    columnsContainer,
    feedTabsScroller,
    activeColumnIndex,
    carouselSlideIndex,
    isPhoneLandscapeUi,
    slideCount,
    isDeskTabs,
    motionBehavior,
    scrollActiveFeedToTop,
    getColumnEls,
    scrollToColumn,
    slideInert,
    isColumnHidden,
    onColumnFocus,
    onColumnsScroll,
    onBoardKeydown,
    reparkCarouselAfterResize,
    goPrevFeed,
    goNextFeed,
  }
}
