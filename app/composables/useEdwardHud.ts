/**
 * Edward Mode HUD — watch film, deck, tour, pace, chips, quips, explore console helpers.
 */

import { useEdwardStore, edwardBallFor } from '~/stores/edward'
import { useMediaQuery } from '~/composables/useBreakpoint'
import { MOOD_GLYPH } from '~/utils/edwardFaces'
import { stripHtml } from '~/utils/stripHtml'
import { statusIdentity } from '~/utils/statusIdentity'
import type { ExtendedStatus } from '~/stores/instances'
import {
  EDWARD_CHANNELS,
  EDWARD_EXPLORE_CHIPS,
  EDWARD_EXPLORE_PLACEHOLDERS,
  EDWARD_SORT_LABELS,
  describeEdwardExplore,
  parseEdwardExplore,
  type EdwardSortMode,
} from '~/utils/edwardExplore'
import {
  EDWARD_SPEEDS,
  edwardBallCap,
  edwardDeckColumn,
  pickTourCandidate,
  speedMeta,
  type EdwardSpeed,
} from '~/utils/edwardPace'
import { dialectForHost } from '~/utils/edwardServers'
import { edQuip } from '~/utils/edwardVoice'
import type { EdwardReason } from '~/utils/edwardSemantics'
import type { NeoIconName } from '~/utils/neoIcons'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'

export function useEdwardHud(exploreInput: Ref<HTMLInputElement | null>) {
  const edward = useEdwardStore()
  const selected = computed(() => edward.selectedStatus)
  const recessed = computed(() => edward.recessed)

  const CHIP_ICONS: Record<string, NeoIconName> = {
    'no bots': 'ban',
    you: 'user',
    quiet: 'eye-off',
    media: 'image',
    words: 'edit',
    anger: 'alert',
    love: 'heart',
    replies: 'message',
    asks: 'mention',
    links: 'share',
    polls: 'poll',
    bots: 'servers',
  }

  const SPEED_ICONS: Record<EdwardSpeed, NeoIconName> = {
    still: 'pause',
    drift: 'play',
    flow: 'play',
    rush: 'zap',
  }

  function chipIcon(label: string): NeoIconName | null {
    return CHIP_ICONS[label] ?? null
  }

  type WatchCard = {
    identity: string
    offset: number
    current: boolean
    name: string
    host: string | null
    text: string
    media: string | null
    moodGlyph: string
    accent: string
    age: string
    tag: string | null
    why: string
    counts: { fav: number; boost: number; reply: number } | null
    reasons: EdwardReason[]
  }

  const ageLabel = (createdAt: number) => {
    const s = Math.max(0, (Date.now() - createdAt) / 1000)
    if (s < 60) return 'now'
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    return `${Math.floor(s / 86400)}d`
  }

  const exploreEl = ref<HTMLElement | null>(null)
  /** Console height → CSS var, so the phone watch deck docks right on top of it */
  const exploreH = ref(0)
  let exploreRo: ResizeObserver | null = null
  watch(exploreEl, (el) => {
    exploreRo?.disconnect()
    exploreRo = null
    if (!el || typeof ResizeObserver === 'undefined') return
    exploreRo = new ResizeObserver(() => {
      exploreH.value = Math.round(el.getBoundingClientRect().height)
    })
    exploreRo.observe(el)
  })
  /** Header height → CSS var, so the desktop deck starts right under it */
  const headerEl = ref<HTMLElement | null>(null)
  const headerH = ref(0)
  let headerRo: ResizeObserver | null = null
  watch(headerEl, (el) => {
    headerRo?.disconnect()
    headerRo = null
    if (!el || typeof ResizeObserver === 'undefined') return
    headerRo = new ResizeObserver(() => {
      headerH.value = Math.round(el.getBoundingClientRect().height)
    })
    headerRo.observe(el)
  })
  const sourceCount = computed(() => edward.sourceCount)
  const focusMode = computed(() => edward.focusMode)
  const lensIcon = computed((): NeoIconName => {
    if (focusMode.value === 'bar') return 'focus-bar'
    if (focusMode.value === 'square') return 'square'
    if (focusMode.value === 'circle') return 'circle'
    return 'eye-off'
  })
  const exploreQuery = computed({
    get: () => edward.exploreQuery,
    set: (v: string) => edward.setExploreQuery(v),
  })
  const exploreSummary = computed(() => edward.exploreSummary)
  const exploreCrumb = computed(() => {
    const parsed = parseEdwardExplore(edward.exploreQuery)
    const sort = parsed.sort || edward.exploreSort
    return describeEdwardExplore(
      parsed,
      sort,
      exploreSummary.value.matched,
      exploreSummary.value.total,
    )
  })
  const cardFromStatus = (
    status: ExtendedStatus,
    identity: string,
    offset: number,
    current: boolean,
    textMax = current ? 180 : 72,
  ): WatchCard => {
    const body = status.reblog || status
    const ball = edwardBallFor(status, edward.affinity)
    let host: string | null = null
    try {
      host = status._instanceUrl ? new URL(status._instanceUrl).host : null
    } catch {
      host = ball.instanceHost
    }
    const media =
      !body.sensitive && body.mediaAttachments?.[0]
        ? body.mediaAttachments[0].previewUrl || body.mediaAttachments[0].url || null
        : null
    const dialect = dialectForHost(host || ball.instanceHost)
    return {
      identity,
      offset,
      current,
      name: ball.label,
      host,
      text: (ball.badges.includes('cw') ? `CW · ${body.spoilerText || 'sensitive'}` : stripHtml(body.content || '').slice(0, textMax)) || '···',
      media,
      moodGlyph: MOOD_GLYPH[ball.mood] || '◉‿◉',
      accent: dialect.accent,
      age: ageLabel(ball.createdAt),
      tag: ball.topTag,
      why: ball.moodWhy,
      counts: ball.counts ?? null,
      reasons: ball.reasons ?? [],
    }
  }

  const watchFilm = computed((): WatchCard[] => {
    if (edward.focusMode === 'off') return []
    const strip = edward.watchFilmstrip
    const cards: WatchCard[] = []
    for (const slot of strip) {
      const status = edward.statuses.find((s) => statusIdentity(s) === slot.identity)
      if (!status) continue
      cards.push(cardFromStatus(status, slot.identity, slot.offset, slot.current))
    }
    return cards
  })

  const watchCurrent = computed(() => watchFilm.value.find((c) => c.current) || null)
  const watchTrail = computed(() => watchFilm.value.filter((c) => c.offset < 0))
  const watchAhead = computed(() => watchFilm.value.filter((c) => c.offset > 0))
  const watchStatus = computed((): ExtendedStatus | null => {
    const id = watchCurrent.value?.identity
    if (!id) return null
    return edward.statuses.find((s) => statusIdentity(s) === id) || null
  })

  /** Desktop deck: the hero gets the long text; earlier posts stack below it */
  const viewportH = ref(typeof window !== 'undefined' ? window.innerHeight : 900)
  const viewportW = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
  const onViewportResize = () => {
    viewportH.value = window.innerHeight
    viewportW.value = window.innerWidth
  }
  const deckHero = computed((): WatchCard | null => {
    const status = watchStatus.value
    const cur = watchCurrent.value
    if (!status || !cur) return null
    return cardFromStatus(status, cur.identity, 0, true, 420)
  })
  /**
   * Earlier posts under the hero. The deck is a fixed height; the list takes
   * whatever the hero leaves and fades out at the bottom, so a growing or
   * shrinking hero slides rows in and out instead of resizing the panel.
   */
  const DECK_ROWS = 10
  const deckRecent = computed((): WatchCard[] => {
    if (edward.focusMode === 'off') return []
    const n = DECK_ROWS
    const out: WatchCard[] = []
    for (const id of edward.watchRecent) {
      if (out.length >= n) break
      const status = edward.statuses.find((s) => statusIdentity(s) === id)
      if (status) out.push(cardFromStatus(status, id, -1, false, 140))
    }
    return out
  })
  const deckWidth = computed(() => edwardDeckColumn(viewportW.value))
  /** Hero height animates to its content; the rows below glide with it */
  const heroInner = ref<HTMLElement | null>(null)
  const heroH = ref(0)
  let heroRo: ResizeObserver | null = null
  watch(heroInner, (el) => {
    heroRo?.disconnect()
    heroRo = null
    if (!el || typeof ResizeObserver === 'undefined') return
    heroRo = new ResizeObserver(() => {
      // Only the entering card is in flow (the leaving one is absolute)
      heroH.value = Math.round(el.getBoundingClientRect().height)
    })
    heroRo.observe(el)
  })

  // ── Ed's running commentary ───────────────────────────────────────────────
  const quip = ref('')
  const quipShown = ref('')
  let quipTimer: ReturnType<typeof setInterval> | null = null
  let typeTimer: ReturnType<typeof setInterval> | null = null
  const nextQuip = () => {
    const visibleNow = edward.visibleBalls.slice(0, edwardBallCap())
    const line = edQuip({
      speed: edward.speed,
      touring: edward.touring,
      scrubbing: edward.watchScrubbing,
      filtered: edward.exploreSummary.active,
      matched: edward.exploreSummary.matched,
      total: edward.exploreSummary.total,
      backpack: edward.backpack,
      fromHome: visibleNow.filter((b) => b.source === 'home').length,
      loading: edward.loading,
      error: edward.error,
      visible: visibleNow,
      watching: watchCurrent.value?.name ?? null,
    })
    if (line === quip.value) return
    quip.value = line
    if (typeTimer) clearInterval(typeTimer)
    if (reduceMotion.value) {
      quipShown.value = line
      return
    }
    // Typed out, Ed-at-the-keyboard style
    const chars = [...line]
    let i = 0
    quipShown.value = ''
    typeTimer = setInterval(() => {
      i += 1
      quipShown.value = chars.slice(0, i).join('')
      if (i >= chars.length && typeTimer) {
        clearInterval(typeTimer)
        typeTimer = null
      }
    }, 28)
  }

  // ── Channels + source / language chips ────────────────────────────────────
  const viewerLang =
    typeof navigator !== 'undefined' && navigator.language ? navigator.language.split('-')[0]!.toLowerCase() : 'en'
  const channelQuery = (q: string) => q.replace('{lang}', viewerLang)
  const channelActive = (ch: (typeof EDWARD_CHANNELS)[number]) =>
    edward.exploreQuery.trim() === channelQuery(ch.query) && edward.exploreSort === ch.sort
  const setChannel = (ch: (typeof EDWARD_CHANNELS)[number]) => {
    if (channelActive(ch)) {
      edward.clearExplore()
      return
    }
    edward.setExploreQuery(channelQuery(ch.query))
    edward.setExploreSort(ch.sort)
  }
  const langChip = { label: 'my language', query: `lang:${viewerLang}` }
  /** Secondary chips + servers + language sit behind "more" (active ones always show) */
  const filtersOpen = ref(false)
  const shownChips = computed(() =>
    EDWARD_EXPLORE_CHIPS.filter((c) => !c.more || filtersOpen.value || chipActive(c.query)),
  )
  const backpackLabel = computed(() => {
    const b = edward.backpackBySource
    return `${edward.backpack} waiting · home ${b.home} · tags ${b.tag} · trending ${b.trend} · firehose ${b.firehose}`
  })

  // ── Pace + tour ──────────────────────────────────────────────────────────
  const speed = computed(() => edward.speed)
  const speedLabel = computed(() => speedMeta(edward.speed).label)
  const touring = computed(() => edward.touring)
  const captionsOn = computed(() => edward.captions)
  let lastMovingSpeed: EdwardSpeed = 'flow'
  const setSpeed = (s: EdwardSpeed) => {
    if (s !== 'still') lastMovingSpeed = s
    edward.setSpeed(s)
  }
  /** Space / the still button: freeze, and un-freeze to wherever you were */
  const toggleStill = () => setSpeed(edward.speed === 'still' ? lastMovingSpeed : 'still')
  const cycleSpeedCompact = () => {
    const i = EDWARD_SPEEDS.findIndex((x) => x.id === edward.speed)
    setSpeed(EDWARD_SPEEDS[(i + 1) % EDWARD_SPEEDS.length]!.id)
  }
  const toggleTour = () => edward.setTouring(!edward.touring)
  const toggleCaptions = () => edward.setCaptions(!edward.captions)

  let tourTimer: ReturnType<typeof setTimeout> | null = null
  const tourStep = () => {
    tourTimer = null
    if (!edward.touring) return
    const busy = edward.selectedIdentity || edward.recessed || edward.watchHold || edward.watchScrubbing
    if (!busy) {
      const recent = new Set(edward.watchHistory.slice(-24))
      const id = pickTourCandidate(edward.visibleBalls.slice(0, edwardBallCap()), recent, edward.focusedIdentity)
      if (id) edward.tourTo(id)
    }
    scheduleTour()
  }
  const scheduleTour = () => {
    if (tourTimer) clearTimeout(tourTimer)
    tourTimer = edward.touring ? setTimeout(tourStep, speedMeta(edward.speed).tourMs) : null
  }
  watch(
    () => edward.touring,
    (on) => {
      if (tourTimer) clearTimeout(tourTimer)
      tourTimer = null
      // Turning it on shows something right away; the timer takes it from there
      if (on) tourStep()
    },
  )
  watch(() => edward.speed, () => edward.touring && scheduleTour())
  // Filters changed what's on stage — tour within the new set promptly
  watch(
    () => [edward.exploreQuery, edward.exploreSort] as const,
    () => {
      if (edward.touring) {
        if (tourTimer) clearTimeout(tourTimer)
        tourTimer = setTimeout(tourStep, 900)
      }
    },
  )

  const setSort = (mode: EdwardSortMode) => edward.setExploreSort(mode)
  const sortActive = (mode: EdwardSortMode) =>
    (parseEdwardExplore(edward.exploreQuery).sort || edward.exploreSort) === mode

  /** Phone deck: one "why" alongside the host — no extra height */
  const watchCurrentReason = computed(() => {
    const id = watchCurrent.value?.identity
    if (!id) return null
    const status = edward.statuses.find((s) => statusIdentity(s) === id)
    return status ? (edwardBallFor(status, edward.affinity).reasons?.[0] ?? null) : null
  })

  const watchScrubbing = computed(() => edward.watchScrubbing)
  const watchDeckShown = computed(() => !!watchCurrent.value && !selected.value && !recessed.value)
  /** ≥1100px: deck is a left column, actions get their own right-hand rail */
  const isWideDesk = useMediaQuery('(min-width: 1100px)')

  /** Reaching for the deck freezes it, so ♥ / ghost hit the post you're looking at */
  let holdReleaseTimer: ReturnType<typeof setTimeout> | null = null
  const holdWatch = (v: boolean) => {
    if (holdReleaseTimer) clearTimeout(holdReleaseTimer)
    holdReleaseTimer = null
    edward.setWatchHold(v)
  }
  /** Touch lifts fire pointerleave immediately — linger so a second tap still lands */
  const onWatchPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      holdWatch(false)
      return
    }
    if (holdReleaseTimer) clearTimeout(holdReleaseTimer)
    holdReleaseTimer = setTimeout(() => {
      holdReleaseTimer = null
      edward.setWatchHold(false)
    }, 2500)
  }
  const onWatchFocusOut = (e: FocusEvent) => {
    const deck = e.currentTarget as HTMLElement | null
    if (deck && e.relatedTarget instanceof Node && deck.contains(e.relatedTarget)) return
    edward.setWatchHold(false)
  }
  watch(watchDeckShown, (shown) => {
    if (!shown) edward.setWatchHold(false)
  })
  const canPrev = computed(() => edward.watchCanPrev)
  const canNext = computed(() => edward.watchCanNext)
  const servers = computed(() => edward.serverDialects)
  const tickNow = ref(Date.now())
  const sessionAge = computed(() => {
    void tickNow.value
    if (!edward.streamStartedAt) return '—'
    const s = Math.floor((tickNow.value - edward.streamStartedAt) / 1000)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${String(r).padStart(2, '0')}`
  })
  let sessionTimer: ReturnType<typeof setInterval> | null = null
  const focusLabel = computed(() => {
    if (focusMode.value === 'bar') return 'bar'
    if (focusMode.value === 'square') return 'square'
    if (focusMode.value === 'circle') return 'circle'
    return 'off'
  })
  const sortLabel = computed(() => EDWARD_SORT_LABELS[edward.exploreSort])

  /**
   * Screen readers hear filter results when *you* change the filter — not the
   * crumb re-counting on every poll.
   */
  const exploreAnnounce = ref('')
  let announceTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    () => [edward.exploreQuery, edward.exploreSort] as const,
    () => {
      if (announceTimer) clearTimeout(announceTimer)
      announceTimer = setTimeout(() => {
        const { matched, total, active } = edward.exploreSummary
        exploreAnnounce.value = active
          ? `${matched} of ${total} posts match, sorted by ${sortLabel.value}`
          : `Showing all ${total} posts`
      }, 700)
    },
  )

  const blink = ref(true)
  const placeholderIdx = ref(0)
  /** Blinking cursor + rotating placeholder hold still under reduced motion */
  const reduceMotion = usePrefersReducedMotion()
  let blinkTimer: ReturnType<typeof setInterval> | null = null
  let placeholderTimer: ReturnType<typeof setInterval> | null = null

  const explorePlaceholder = computed(
    () => EDWARD_EXPLORE_PLACEHOLDERS[placeholderIdx.value % EDWARD_EXPLORE_PLACEHOLDERS.length]!,
  )

  const chipActive = (query: string) => {
    const parts = edward.exploreQuery.toLowerCase().split(/\s+/).filter(Boolean)
    return parts.includes(query.toLowerCase())
  }

  /**
   * Text twin of the canvas (which is aria-hidden): the same filtered + sorted
   * posts as a list of buttons, so keyboard and screen reader users can browse
   * and open them. One Tab stop; ↑↓ / Home / End move. Shown as a panel while
   * it holds focus, visually hidden otherwise.
   */
  const LIST_MAX = 50
  /** Snapshot while the list holds focus — new posts prepend, which would shove
   * the focused row out of view mid-read (same idea as the deck's hold) */
  const listHeld = shallowRef<typeof edward.visibleBalls | null>(null)
  const listBalls = computed(() => listHeld.value ?? edward.visibleBalls.slice(0, LIST_MAX))
  const onListFocusIn = () => {
    if (!listHeld.value) listHeld.value = listBalls.value
  }
  const onListFocusOut = (e: FocusEvent) => {
    const list = e.currentTarget as HTMLElement | null
    if (list && e.relatedTarget instanceof Node && list.contains(e.relatedTarget)) return
    listHeld.value = null
  }
  const listActiveId = ref<string | null>(null)
  const listTabId = computed(() => {
    const items = listBalls.value
    return items.some((b) => b.identity === listActiveId.value)
      ? listActiveId.value
      : items[0]?.identity ?? null
  })
  const listItemText = (b: { badges: string[]; preview: string }) =>
    b.badges.includes('cw') ? 'content warning' : b.preview || 'no text'
  const onListKeydown = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const btns = Array.from(
      (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.edward-mode__list-item'),
    )
    if (!btns.length) return
    const cur = btns.indexOf(document.activeElement as HTMLButtonElement)
    let i = cur
    if (e.key === 'Home') i = 0
    else if (e.key === 'End') i = btns.length - 1
    else if (e.key === 'ArrowDown') i = Math.min(btns.length - 1, cur + 1)
    else i = Math.max(0, cur - 1)
    e.preventDefault()
    btns[i]!.focus()
  }

  const cycleFocus = () => {
    edward.cycleFocusMode()
  }

  const toggleChip = (query: string) => {
    edward.toggleExploreChip(query)
  }

  const clearExplore = () => {
    edward.clearExplore()
    exploreInput.value?.focus()
  }

  const openFocused = () => {
    if (edward.focusedIdentity) {
      edward.selectByIdentity(edward.focusedIdentity)
    }
  }

  const openCard = (identity: string) => {
    edward.watchJumpTo(identity)
    edward.selectByIdentity(identity)
  }

  const jumpFilm = (identity: string) => {
    edward.watchJumpTo(identity)
  }

  const watchPrev = (e?: Event) => {
    e?.stopPropagation()
    edward.watchPrev()
  }

  const watchNext = (e?: Event) => {
    e?.stopPropagation()
    edward.watchNext()
  }

  const resumeLive = (e?: Event) => {
    e?.stopPropagation()
    edward.resumeWatchLive()
  }

  function mountHudTimers() {
    blinkTimer = setInterval(() => {
      blink.value = reduceMotion.value ? true : !blink.value
    }, 530)
    placeholderTimer = setInterval(() => {
      if (reduceMotion.value) return
      placeholderIdx.value = (placeholderIdx.value + 1) % EDWARD_EXPLORE_PLACEHOLDERS.length
    }, 4200)
    sessionTimer = setInterval(() => {
      tickNow.value = Date.now()
    }, 1000)
    window.addEventListener('resize', onViewportResize, { passive: true })
    quipTimer = setInterval(nextQuip, 9000)
    setTimeout(nextQuip, 2200)
    if (edward.touring) tourTimer = setTimeout(tourStep, 2500)
  }

  function disposeHud() {
    if (announceTimer) clearTimeout(announceTimer)
    exploreRo?.disconnect()
    headerRo?.disconnect()
    if (holdReleaseTimer) clearTimeout(holdReleaseTimer)
    if (blinkTimer) clearInterval(blinkTimer)
    if (placeholderTimer) clearInterval(placeholderTimer)
    if (sessionTimer) clearInterval(sessionTimer)
    if (tourTimer) clearTimeout(tourTimer)
    if (quipTimer) clearInterval(quipTimer)
    if (typeTimer) clearInterval(typeTimer)
    heroRo?.disconnect()
    window.removeEventListener('resize', onViewportResize)
  }

  return {
    chipIcon,
    exploreInput,
    exploreEl,
    exploreH,
    headerEl,
    headerH,
    recessed,
    sourceCount,
    focusMode,
    lensIcon,
    exploreQuery,
    exploreSummary,
    exploreCrumb,
    watchFilm,
    watchCurrent,
    watchTrail,
    watchAhead,
    watchStatus,
    viewportH,
    deckHero,
    deckRecent,
    deckWidth,
    heroInner,
    heroH,
    quip,
    quipShown,
    channelActive,
    setChannel,
    langChip,
    filtersOpen,
    shownChips,
    backpackLabel,
    speed,
    speedLabel,
    touring,
    captionsOn,
    setSpeed,
    toggleStill,
    cycleSpeedCompact,
    toggleTour,
    toggleCaptions,
    setSort,
    sortActive,
    watchCurrentReason,
    watchScrubbing,
    watchDeckShown,
    isWideDesk,
    holdWatch,
    onWatchPointerLeave,
    onWatchFocusOut,
    canPrev,
    canNext,
    servers,
    sessionAge,
    focusLabel,
    sortLabel,
    exploreAnnounce,
    blink,
    reduceMotion,
    explorePlaceholder,
    chipActive,
    listHeld,
    listBalls,
    onListFocusIn,
    onListFocusOut,
    listActiveId,
    listTabId,
    listItemText,
    onListKeydown,
    cycleFocus,
    toggleChip,
    clearExplore,
    openFocused,
    openCard,
    jumpFilm,
    watchPrev,
    watchNext,
    resumeLive,
    mountHudTimers,
    disposeHud,
  }
}
