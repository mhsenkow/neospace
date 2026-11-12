<script setup lang="ts">

/**
 * Edward Mode — Radical Edward Session OS thought stream.
 */

import { useEdwardStore } from '~/stores/edward'
import { useEdwardRecessRestore } from '~/composables/useEdwardRecess'
import { useToastStore } from '~/stores/toast'
import { useEdwardStream } from '~/composables/useEdwardStream'
import { useEdwardHud } from '~/composables/useEdwardHud'
import { EDWARD_FACE_LEGEND } from '~/utils/edwardFaces'
import {
  EDWARD_CHANNELS,
  EDWARD_SOURCE_CHIPS,
  EDWARD_EXPLORE_CHIPS,
  EDWARD_SORT_HINTS,
  EDWARD_SORT_LABELS,
  EDWARD_SORT_ORDER,
} from '~/utils/edwardExplore'
import { EDWARD_SPEEDS, type EdwardSpeed } from '~/utils/edwardPace'
import { formatCount } from '~/utils/searchQuery'
import NeoIcon from '~/components/NeoIcon.vue'
import type { NeoIconName } from '~/utils/neoIcons'
import EdwardCanvas from '~/components/edward/EdwardCanvas.vue'
import EdwardPostModal from '~/components/edward/EdwardPostModal.vue'
import EdwardWatchActions from '~/components/edward/EdwardWatchActions.vue'
import { useFocusTrap } from '~/composables/useFocusTrap'

const SPEED_ICONS: Record<EdwardSpeed, NeoIconName> = {
  still: 'pause',
  drift: 'play',
  flow: 'play',
  rush: 'zap',
}

const edward = useEdwardStore()
const stream = useEdwardStream()
const router = useRouter()
const rootEl = ref<HTMLElement | null>(null)
const visible = ref(false)
const canvasRef = ref<InstanceType<typeof EdwardCanvas> | null>(null)
const selected = computed(() => edward.selectedStatus)
const count = computed(() => edward.ballCount)
const loading = computed(() => edward.loading)
const error = computed(() => edward.error)
const restart3d = () => {
  void canvasRef.value?.restart3d?.()
}
const showRestart3d = computed(
  () => !!error.value && /3d view|paused the 3d/i.test(error.value),
)

const exploreInput = ref<HTMLInputElement | null>(null)
const {
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
  explorePlaceholder,
  chipActive,
  chipIcon,
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
} = useEdwardHud(exploreInput)

const onPick = (identity: string) => {
  edward.selectByIdentity(identity)
}

// Un-recess Edward whenever the compose sheet closes (see useEdwardRecess)
useEdwardRecessRestore()

const closeModal = () => {
  edward.clearSelection()
}

const leaveTo = (to: { path: string; query?: Record<string, string> }) => {
  edward.exit()
  stream.stop()
  router.push(to)
}

const openThread = () => {
  const status = edward.selectedStatus
  if (!status) return
  const body = status.reblog || status
  const id = body.id
  const url = body.url || body.uri || status.url || status.uri || ''
  const query: Record<string, string> = {}
  if (url) query.url = url
  if (status._instanceId) query.account = status._instanceId
  leaveTo({ path: `/status/${id}`, query })
}

const openProfile = (acct: string) => {
  const status = edward.selectedStatus
  const query: Record<string, string> = { user: acct.replace(/^@/, '') }
  if (status?._instanceId) query.account = status._instanceId
  leaveTo({ path: '/profile', query })
}

/** No WebGL: there is no stage to show, so stop polling every server and leave with an explanation */
const onWebglUnsupported = () => {
  useToastStore().show({ message: 'Edward needs WebGL, which this browser or device can’t start.' })
  exit()
}

let exitTimer: ReturnType<typeof setTimeout> | null = null
const exit = () => {
  visible.value = false
  if (exitTimer) return
  exitTimer = setTimeout(() => {
    exitTimer = null
    stream.stop()
    edward.exit()
  }, 220)
}

/**
 * Widgets that own arrow keys — never steal them for scrubbing. Plain buttons
 * don't use arrows (focus lands on Exit when the session opens), so they're
 * left out; buttons inside toolbars/menus/radiogroups are covered by the roles.
 */
const ARROW_OWNERS =
  'select, input, textarea, [contenteditable="true"], [role="toolbar"], [role="radiogroup"], [role="menu"], [role="listbox"], [role="slider"]'
/** Widgets that consume typed characters (typeahead) — no single-key shortcuts */
const CHAR_OWNERS =
  'select, input, textarea, [contenteditable="true"], [role="toolbar"], [role="radiogroup"], [role="menu"], [role="listbox"]'

/**
 * Shortcuts run in the bubble phase so focused widgets (menus, toolbars,
 * inputs) handle their own keys first; anything they preventDefault is left alone.
 */
const onKey = (e: KeyboardEvent) => {
  // Recessed under the compose sheet: its keys are the sheet's, not ours
  if (e.defaultPrevented || edward.recessed) return
  if (e.key === 'Escape') return
  const target = e.target as HTMLElement | null
  const typing = !!target?.closest?.(CHAR_OWNERS)
  const arrowOwned = !!target?.closest?.(ARROW_OWNERS)

  // / focuses explore console (Session OS muscle memory)
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    exploreInput.value?.focus()
    exploreInput.value?.select()
    return
  }

  // Enter opens what's in the lens (the watch deck subject)
  if (
    e.key === 'Enter' &&
    !typing &&
    !edward.selectedIdentity &&
    !(target && target.closest('button, a, [role="button"]'))
  ) {
    if (edward.focusedIdentity) {
      e.preventDefault()
      openFocused()
    }
    return
  }

  const plain = !typing && !e.metaKey && !e.ctrlKey && !e.altKey

  // Space freezes / unfreezes the stream (not while a control has focus)
  if (e.key === ' ' && plain && !(target && target.closest('button, a, [role="button"]'))) {
    e.preventDefault()
    toggleStill()
    return
  }
  // - / = step the pace down / up
  if (plain && (e.key === '-' || e.key === '_')) {
    e.preventDefault()
    edward.stepSpeed(-1)
    return
  }
  if (plain && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    edward.stepSpeed(1)
    return
  }
  // T tours (lean back); C toggles the bubble captions
  if (plain && (e.key === 't' || e.key === 'T')) {
    e.preventDefault()
    toggleTour()
    return
  }
  if (plain && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault()
    toggleCaptions()
    return
  }

  // L cycles the lens shape (bar → square → circle → off)
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault()
    edward.cycleFocusMode()
    return
  }

  // ← → scrub watch history when something cool just flew by
  if ((e.key === 'ArrowLeft' && !arrowOwned) || (e.key === '[' && !typing)) {
    e.preventDefault()
    edward.watchPrev()
    return
  }
  if ((e.key === 'ArrowRight' && !arrowOwned) || (e.key === ']' && !typing)) {
    e.preventDefault()
    edward.watchNext()
    return
  }
}

/**
 * Escape stays in the capture phase: it steps back one layer at a time
 * (peek → scrub → filters → input → exit) ahead of the peek's own handlers.
 * Open menus/listboxes keep their own Escape.
 */
const onEscapeKey = (e: KeyboardEvent) => {
  // The compose sheet on top owns Escape — capturing it here used to close the
  // hidden peek / exit Edward while the reply draft stayed open
  if (e.key !== 'Escape' || e.defaultPrevented || edward.recessed) return
  const target = e.target as HTMLElement | null
  if (target?.closest?.('[role="menu"], [role="listbox"]')) return
  e.preventDefault()
  e.stopPropagation()
  if (edward.selectedIdentity) {
    closeModal()
    return
  }
  if (edward.watchScrubbing) {
    edward.resumeWatchLive()
    return
  }
  if (edward.exploreQuery || edward.exploreSort !== 'stream') {
    clearExplore()
    return
  }
  if (document.activeElement === exploreInput.value) {
    exploreInput.value?.blur()
    return
  }
  exit()
}

let prevOverflow = ''

// Keep Tab inside the session; Escape is owned by onEscapeKey (layered), so no onEscape here
useFocusTrap(rootEl, visible, { initialFocus: '.edward-mode__exit' })

onMounted(() => {
  requestAnimationFrame(() => {
    visible.value = true
  })
  document.addEventListener('keydown', onKey)
  document.addEventListener('keydown', onEscapeKey, true)
  prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  mountHudTimers()
  void stream.start()
})

onUnmounted(() => {
  disposeHud()
  // Unmounted some other way (leaveTo, suite toggle) — a late timer must not
  // exit the *next* session
  if (exitTimer) clearTimeout(exitTimer)
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('keydown', onEscapeKey, true)
  document.body.style.overflow = prevOverflow
  stream.stop()
  document.body.classList.remove('edward-active')
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootEl"
      class="edward-mode"
      :class="{
        'is-visible': visible,
        'is-recessed': recessed,
      }"
      :style="{
        '--edward-deck-w': `${deckWidth}px`,
        ...(headerH ? { '--edward-header-h': `${headerH}px` } : {}),
        ...(exploreH ? { '--edward-explore-h': `${exploreH}px` } : {}),
      }"
      role="dialog"
      aria-modal="true"
      aria-label="Edward mode session"
    >
      <ClientOnly>
        <EdwardCanvas
          ref="canvasRef"
          :stage-header-h="headerH"
          :stage-explore-h="exploreH"
          @pick="onPick"
          @unsupported="onWebglUnsupported"
        />
      </ClientOnly>

      <div class="edward-mode__scan" aria-hidden="true" />

      <!-- Not a live region: the clock ticks every second and coins every poll -->
      <header ref="headerEl" class="edward-mode__header">
        <div class="edward-mode__header-row">
          <div class="edward-mode__brand">
            <span class="edward-mode__session">
              SESSION<span :class="{ 'is-off': !blink }" class="edward-mode__cursor">_</span>
              <span class="edward-mode__uptime">{{ sessionAge }}</span>
            </span>
            <span class="edward-mode__title">EDWARD!! · faces OS</span>
            <span class="edward-mode__quip" :title="quip">
              <span class="edward-mode__quip-tag" aria-hidden="true">ed&gt;</span>
              {{ quipShown }}<span class="edward-mode__quip-caret" aria-hidden="true">▍</span>
            </span>
          </div>

          <div class="edward-mode__stats">
            <span v-if="loading && !count" class="edward-mode__stat">hacking…</span>
            <span v-else class="edward-mode__stat">
              <template v-if="exploreSummary.active">
                {{ exploreSummary.matched }}/{{ exploreSummary.total }}
              </template>
              <template v-else>{{ count }}</template>
              coins
            </span>
            <span v-if="sourceCount" class="edward-mode__stat">
              <NeoIcon name="servers" :size="12" :stroke="1.75" />
              {{ sourceCount }}
            </span>
            <span
              v-if="edward.backpack"
              class="edward-mode__stat edward-mode__stat--pack"
              :title="backpackLabel"
              :aria-label="backpackLabel"
            >
              <NeoIcon name="bookmark" :size="12" :stroke="1.75" />
              {{ edward.backpack }}
            </span>
            <span class="edward-mode__stat edward-mode__stat--sort">
              <NeoIcon name="sort" :size="12" :stroke="1.75" />
              {{ sortLabel }}
            </span>
          </div>

          <div class="edward-mode__header-actions">
            <!-- Narrow screens: pace + tour live up here (desktop has the right rail) -->
            <template v-if="!isWideDesk">
              <button
                type="button"
                class="edward-mode__focus-btn edward-mode__pace-btn"
                :aria-label="`Stream pace ${speedLabel}. Tap to change`"
                @click="cycleSpeedCompact"
              >
                <NeoIcon :name="SPEED_ICONS[speed]" :size="13" :stroke="1.85" :filled="speed !== 'still'" />
                <span>{{ speedLabel }}</span>
              </button>
              <button
                type="button"
                class="edward-mode__focus-btn edward-mode__pace-btn"
                :class="{ 'is-on': touring }"
                :aria-pressed="touring"
                aria-label="Tour — posts drift into the lens on their own"
                @click="toggleTour"
              >
                <NeoIcon name="sparkle" :size="13" :stroke="1.85" />
                <span>tour</span>
              </button>
            </template>
            <button
              type="button"
              class="edward-mode__focus-btn"
              :aria-label="`Cycle focus lens, currently ${focusLabel}`"
              @click="cycleFocus"
            >
              <NeoIcon :name="lensIcon" :size="14" :stroke="1.85" />
              <span>{{ focusLabel }}</span>
            </button>
            <button
              type="button"
              class="edward-mode__exit"
              aria-label="Exit edward mode"
              @click="exit"
            >
              <NeoIcon name="x" :size="16" :stroke="2" />
            </button>
          </div>
        </div>

        <div class="edward-mode__header-rail">
          <ul class="edward-mode__legend" aria-label="Face legend">
            <li v-for="item in EDWARD_FACE_LEGEND.slice(0, 10)" :key="item.mood">
              <span class="edward-mode__glyph" aria-hidden="true">{{ item.glyph }}</span>
              {{ item.label }}
            </li>
          </ul>
          <ul
            v-if="servers.length"
            class="edward-mode__servers"
            aria-label="Servers in stream"
          >
            <li v-for="srv in servers.slice(0, 6)" :key="srv.host">
              <button
                type="button"
                class="edward-mode__srv-chip"
                :class="{ 'is-on': chipActive(srv.token) }"
                :aria-pressed="chipActive(srv.token)"
                :style="{ '--srv': srv.accent }"
                :title="`${srv.host} · ${srv.count}`"
                @click="toggleChip(srv.token)"
              >
                <span class="edward-mode__srv-dot" aria-hidden="true" />
                {{ srv.short }}
                <span class="edward-mode__srv-n">{{ srv.count }}</span>
              </button>
            </li>
          </ul>
        </div>
      </header>

      <!-- Desktop deck: big hero + earlier posts stacked below (five previews) -->
      <aside
        v-if="deckHero && watchDeckShown && isWideDesk"
        class="edward-mode__deck"
        :class="{ 'is-scrubbing': watchScrubbing, 'is-touring': touring}"
        :style="{ '--srv': deckHero.accent }"
        aria-label="Watched post"
        @pointerenter="holdWatch(true)"
        @pointerleave="onWatchPointerLeave"
        @focusin="holdWatch(true)"
        @focusout="onWatchFocusOut"
      >
        <div class="edward-mode__watch-nav">
          <button
            type="button"
            class="edward-mode__watch-step"
            :disabled="!canPrev"
            aria-label="Previous watched post"
            @click="watchPrev"
          >
            <NeoIcon name="chevron-left" :size="16" :stroke="2" />
          </button>
          <span class="edward-mode__watch-label">
            <NeoIcon
              :name="watchScrubbing ? 'pause' : touring ? 'sparkle' : 'play'"
              :size="12"
              :stroke="1.85"
              :filled="!watchScrubbing && !touring"
            />
            {{
              watchScrubbing
                ? 'paused · scrub'
                : edward.watchHold
                  ? 'held'
                  : touring
                    ? `touring · ${speedLabel}`
                    : `watching · ${speedLabel}`
            }}
          </span>
          <button
            type="button"
            class="edward-mode__watch-step"
            :disabled="!canNext"
            aria-label="Next watched post"
            @click="watchNext"
          >
            <NeoIcon name="chevron-right" :size="16" :stroke="2" />
          </button>
          <button
            v-if="watchScrubbing"
            type="button"
            class="edward-mode__watch-live"
            @click="resumeLive"
          >
            <NeoIcon name="play" :size="12" :stroke="2" filled />
            live
          </button>
        </div>

        <div
          class="edward-mode__deck-hero-wrap"
          :style="heroH ? { height: `${heroH}px` } : undefined"
        >
          <div ref="heroInner" class="edward-mode__deck-hero-inner">
            <Transition name="deck-hero">
        <button
          :key="deckHero.identity"
          type="button"
          class="edward-mode__deck-hero"
          :aria-label="`Open post by ${deckHero.name}`"
          @click="openCard(deckHero.identity)"
        >
          <div v-if="deckHero.media" class="edward-mode__deck-media">
            <img :src="deckHero.media" alt="" loading="lazy" />
          </div>
          <div class="edward-mode__deck-head">
            <span class="edward-mode__deck-face" aria-hidden="true">{{ deckHero.moodGlyph }}</span>
            <span class="edward-mode__deck-who">
              <strong>{{ deckHero.name }}</strong>
              <span>{{ deckHero.host }} · {{ deckHero.age }}</span>
            </span>
          </div>
          <span class="edward-mode__deck-text">{{ deckHero.text }}</span>
          <ul v-if="deckHero.reasons.length" class="edward-mode__why">
            <li v-for="r in deckHero.reasons" :key="r.text" :class="`edward-mode__why--${r.kind}`">
              <span aria-hidden="true">{{ r.glyph }}</span>{{ r.text }}
            </li>
          </ul>
          <span class="edward-mode__deck-meta">
            <span v-if="deckHero.counts?.fav">♥ {{ formatCount(deckHero.counts.fav) }}</span>
            <span v-if="deckHero.counts?.boost">↻ {{ formatCount(deckHero.counts.boost) }}</span>
            <span v-if="deckHero.counts?.reply">↩ {{ formatCount(deckHero.counts.reply) }}</span>
            <span v-if="deckHero.tag" class="edward-mode__deck-tag">#{{ deckHero.tag }}</span>
            <span class="edward-mode__deck-why">{{ deckHero.why }}</span>
          </span>
        </button>
            </Transition>
          </div>
        </div>

        <p v-if="deckRecent.length" class="edward-mode__deck-label">earlier in the lens</p>
        <TransitionGroup tag="ol" name="deck-row" class="edward-mode__deck-recent">
            <li v-for="card in deckRecent" :key="card.identity">
              <button
                type="button"
                class="edward-mode__deck-row"
                :style="{ '--srv': card.accent }"
                @click="jumpFilm(card.identity)"
              >
                <img v-if="card.media" :src="card.media" alt="" class="edward-mode__deck-thumb" loading="lazy" />
                <span v-else class="edward-mode__deck-thumb edward-mode__deck-thumb--face" aria-hidden="true">{{
                  card.moodGlyph
                }}</span>
                <span class="edward-mode__deck-row-copy">
                  <strong>{{ card.name }} <em>{{ card.age }}</em></strong>
                  <span>{{ card.text }}</span>
                  <small v-if="card.reasons[0]" class="edward-mode__deck-row-why">
                    {{ card.reasons[0].glyph }} {{ card.reasons[0].text }}
                  </small>
                </span>
              </button>
            </li>
        </TransitionGroup>
        <p v-if="deckRecent.length < 3" class="edward-mode__deck-empty" aria-hidden="true">
          ed remembers what floats through the lens — it stacks up here ♪
        </p>
      </aside>

      <aside
        v-if="watchCurrent && watchDeckShown && !isWideDesk"
        class="edward-mode__watch"
        :class="{ 'is-scrubbing': watchScrubbing, 'is-held': edward.watchHold }"
        aria-label="Watched post"
        @pointerenter="holdWatch(true)"
        @pointerleave="onWatchPointerLeave"
        @focusin="holdWatch(true)"
        @focusout="onWatchFocusOut"
      >
        <div class="edward-mode__watch-nav">
          <button
            type="button"
            class="edward-mode__watch-step"
            :disabled="!canPrev"
            aria-label="Previous watched post"
            @click="watchPrev"
          >
            <NeoIcon name="chevron-left" :size="16" :stroke="2" />
          </button>
          <span class="edward-mode__watch-label">
            <NeoIcon
              :name="watchScrubbing ? 'pause' : 'play'"
              :size="12"
              :stroke="1.85"
              :filled="!watchScrubbing"
            />
            {{ watchScrubbing ? 'paused · scrub' : edward.watchHold ? 'held · live' : 'watching · live' }}
          </span>
          <button
            type="button"
            class="edward-mode__watch-step"
            :disabled="!canNext"
            aria-label="Next watched post"
            @click="watchNext"
          >
            <NeoIcon name="chevron-right" :size="16" :stroke="2" />
          </button>
          <button
            v-if="watchScrubbing"
            type="button"
            class="edward-mode__watch-live"
            @click="resumeLive"
          >
            <NeoIcon name="play" :size="12" :stroke="2" filled />
            live
          </button>
        </div>

        <div class="edward-mode__watch-film" role="group" aria-label="Watch filmstrip">
          <button
            v-for="card in watchTrail"
            :key="`t-${card.identity}`"
            type="button"
            class="edward-mode__film-tile"
            :style="{ '--srv': card.accent }"
            :title="card.name"
            @click="jumpFilm(card.identity)"
          >
            <img
              v-if="card.media"
              :src="card.media"
              alt=""
              class="edward-mode__film-img"
              loading="lazy"
            />
            <span v-else class="edward-mode__film-face" aria-hidden="true">{{
              card.moodGlyph
            }}</span>
            <span class="edward-mode__film-name">{{ card.name }}</span>
          </button>

          <div
            class="edward-mode__watch-hero"
            :style="{ '--srv': watchCurrent.accent }"
          >
            <button
              type="button"
              class="edward-mode__watch-hero-main"
              @click="openCard(watchCurrent.identity)"
            >
              <div class="edward-mode__watch-hero-media">
                <img
                  v-if="watchCurrent.media"
                  :src="watchCurrent.media"
                  alt=""
                  class="edward-mode__watch-hero-img"
                  loading="lazy"
                />
                <div v-else class="edward-mode__watch-hero-face" aria-hidden="true">
                  {{ watchCurrent.moodGlyph }}
                </div>
              </div>
              <div class="edward-mode__watch-copy">
                <strong class="edward-mode__watch-name">{{ watchCurrent.name }}</strong>
                <span v-if="watchCurrent.host" class="edward-mode__watch-host">
                  {{ watchCurrent.host }}<template v-if="watchCurrentReason">
                    · {{ watchCurrentReason.glyph }} {{ watchCurrentReason.text }}</template
                  >
                </span>
                <span class="edward-mode__watch-text">{{ watchCurrent.text }}</span>
              </div>
            </button>
            <!-- Desktop: actions live in the right-hand rail instead -->
            <EdwardWatchActions v-if="watchStatus && !isWideDesk" :status="watchStatus" />
          </div>

          <button
            v-for="card in watchAhead"
            :key="`a-${card.identity}`"
            type="button"
            class="edward-mode__film-tile edward-mode__film-tile--ahead"
            :style="{ '--srv': card.accent }"
            :title="card.name"
            @click="jumpFilm(card.identity)"
          >
            <img
              v-if="card.media"
              :src="card.media"
              alt=""
              class="edward-mode__film-img"
              loading="lazy"
            />
            <span v-else class="edward-mode__film-face" aria-hidden="true">{{
              card.moodGlyph
            }}</span>
            <span class="edward-mode__film-name">{{ card.name }}</span>
          </button>
        </div>

        <p class="edward-mode__watch-hint">
          edges scroll · middle 3d · heart stash beam · esc live
        </p>
      </aside>

      <!-- Desktop: actions on the watched post as a list on the right edge -->
      <aside
        v-if="watchCurrent && watchDeckShown && watchStatus && isWideDesk"
        class="edward-mode__actions-rail"
        :style="{ '--srv': watchCurrent.accent }"
        aria-label="Actions on the watched post"
        @pointerenter="holdWatch(true)"
        @pointerleave="onWatchPointerLeave"
        @focusin="holdWatch(true)"
        @focusout="onWatchFocusOut"
      >
        <p class="edward-mode__actions-rail-head">
          <span>acting on</span>
          <strong>{{ watchCurrent.name }}</strong>
        </p>
        <EdwardWatchActions :status="watchStatus" variant="rail" />
      </aside>

      <!-- Desktop: quiet pace controls, bottom right — set it and just watch -->
      <div
        v-if="isWideDesk && !recessed"
        class="edward-mode__pace"
        role="group"
        aria-label="Stream pace"
      >
        <div class="edward-mode__pace-row">
          <button
            v-for="sp in EDWARD_SPEEDS"
            :key="sp.id"
            type="button"
            class="edward-mode__pace-opt"
            :class="{ 'is-on': speed === sp.id }"
            :aria-pressed="speed === sp.id"
            :title="sp.hint"
            @click="setSpeed(sp.id)"
          >
            {{ sp.label }}
          </button>
        </div>
        <div class="edward-mode__pace-row">
          <button
            type="button"
            class="edward-mode__pace-opt edward-mode__pace-opt--wide"
            :class="{ 'is-on': touring }"
            :aria-pressed="touring"
            title="Posts drift into the lens on their own (T)"
            @click="toggleTour"
          >
            <NeoIcon name="sparkle" :size="11" :stroke="1.85" />
            tour
          </button>
          <button
            type="button"
            class="edward-mode__pace-opt edward-mode__pace-opt--wide"
            :class="{ 'is-on': captionsOn }"
            :aria-pressed="captionsOn"
            title="Names + first words under the bubbles (C)"
            @click="toggleCaptions"
          >
            <NeoIcon name="edit" :size="11" :stroke="1.85" />
            words
          </button>
        </div>
      </div>

      <p v-if="error" class="edward-mode__error" role="alert">
        {{ error }}
        <button
          v-if="showRestart3d"
          type="button"
          class="edward-mode__error-restart"
          @click="restart3d"
        >
          Restart 3D
        </button>
      </p>

      <div
        v-if="!recessed"
        ref="exploreEl"
        class="edward-mode__explore"
        role="search"
        aria-label="Explore thought stream"
      >
        <div class="edward-mode__explore-row">
          <span class="edward-mode__explore-prompt" aria-hidden="true">
            <NeoIcon name="search" :size="14" :stroke="1.85" />
          </span>
          <input
            ref="exploreInput"
            v-model="exploreQuery"
            type="search"
            class="edward-mode__explore-input"
            :placeholder="explorePlaceholder"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="search"
            aria-label="Search filter and sort the thought stream"
          />
          <button
            v-if="exploreSummary.active"
            type="button"
            class="edward-mode__explore-clear"
            aria-label="Clear explore filters"
            @click="clearExplore"
          >
            <NeoIcon name="x" :size="13" :stroke="2" />
          </button>
        </div>
        <div class="edward-mode__channels" role="group" aria-label="Ed's channels">
          <button
            v-for="ch in EDWARD_CHANNELS"
            :key="ch.id"
            type="button"
            class="edward-mode__channel"
            :class="{ 'is-on': channelActive(ch) }"
            :aria-pressed="channelActive(ch)"
            :title="ch.hint"
            @click="setChannel(ch)"
          >
            <span aria-hidden="true">{{ ch.glyph }}</span>
            {{ ch.label }}
          </button>
        </div>
        <div class="edward-mode__sorts" role="group" aria-label="Sort">
          <span class="edward-mode__sorts-label" aria-hidden="true">
            <NeoIcon name="sort" :size="11" :stroke="1.85" />
          </span>
          <button
            v-for="mode in EDWARD_SORT_ORDER"
            :key="mode"
            type="button"
            class="edward-mode__sort"
            :class="{ 'is-on': sortActive(mode) }"
            :aria-pressed="sortActive(mode)"
            :title="EDWARD_SORT_HINTS[mode]"
            @click="setSort(mode)"
          >
            <NeoIcon v-if="mode === 'gems'" name="sparkle" :size="11" :stroke="1.85" />
            <NeoIcon v-else-if="mode === 'shuffle'" name="refresh" :size="11" :stroke="1.85" />
            {{ EDWARD_SORT_LABELS[mode] }}
          </button>
        </div>
        <div class="edward-mode__explore-chips" role="group" aria-label="Quick filters">
          <button
            v-for="src in EDWARD_SOURCE_CHIPS"
            :key="src.query"
            type="button"
            class="edward-mode__chip edward-mode__chip--src"
            :class="{ 'is-on': chipActive(src.query) }"
            :aria-pressed="chipActive(src.query)"
            :title="`only posts from ${src.label}`"
            @click="toggleChip(src.query)"
          >
            <span aria-hidden="true">{{ src.glyph }}</span>
            {{ src.label }}
          </button>
          <button
            v-if="filtersOpen || chipActive(langChip.query)"
            type="button"
            class="edward-mode__chip"
            :class="{ 'is-on': chipActive(langChip.query) }"
            :aria-pressed="chipActive(langChip.query)"
            title="only posts in your language"
            @click="toggleChip(langChip.query)"
          >
            <span aria-hidden="true">文</span>
            {{ langChip.label }}
          </button>
          <button
            v-for="chip in shownChips"
            :key="chip.query"
            type="button"
            class="edward-mode__chip"
            :class="{ 'is-on': chipActive(chip.query) }"
            :aria-pressed="chipActive(chip.query)"
            :title="chip.hint"
            @click="toggleChip(chip.query)"
          >
            <NeoIcon
              v-if="chipIcon(chip.label)"
              :name="chipIcon(chip.label) as NeoIconName"
              :size="12"
              :stroke="1.85"
              :filled="
                chipActive(chip.query) && (chip.label === 'love' || chip.label === 'replies')
              "
            />
            {{ chip.label }}
          </button>
          <button
            v-for="srv in servers.slice(0, 4).filter((x) => filtersOpen || chipActive(x.token))"
            :key="srv.token"
            type="button"
            class="edward-mode__chip edward-mode__chip--srv"
            :class="{ 'is-on': chipActive(srv.token) }"
            :aria-pressed="chipActive(srv.token)"
            :style="{ '--srv': srv.accent }"
            :title="srv.host"
            @click="toggleChip(srv.token)"
          >
            <NeoIcon name="globe" :size="11" :stroke="1.75" />
            {{ srv.short }}
          </button>
          <button
            type="button"
            class="edward-mode__chip edward-mode__chip--more"
            :aria-expanded="filtersOpen"
            @click="filtersOpen = !filtersOpen"
          >
            {{ filtersOpen ? 'less' : 'more…' }}
          </button>
        </div>
        <p class="sr-only" role="status" aria-live="polite">{{ exploreAnnounce }}</p>
        <p class="edward-mode__explore-crumb">
          {{ exploreCrumb }}
          <span class="edward-mode__explore-hint">
            · / search · space still · −/= pace · T tour · C words · ←→ scrub · ⏎ open · L lens · esc</span
          >
        </p>
      </div>

      <nav
        v-if="!recessed && listBalls.length"
        class="edward-mode__list"
        aria-label="Posts in the stream"
        @keydown="onListKeydown"
        @focusin="onListFocusIn"
        @focusout="onListFocusOut"
      >
        <p class="edward-mode__list-head" aria-hidden="true">posts · ↑↓ move · ⏎ open</p>
        <ul>
          <li v-for="b in listBalls" :key="b.identity">
            <button
              type="button"
              class="edward-mode__list-item"
              :tabindex="b.identity === listTabId ? 0 : -1"
              @focus="listActiveId = b.identity"
              @click="onPick(b.identity)"
            >
              <strong>{{ b.label }}</strong>
              <span>{{ listItemText(b) }}</span>
            </button>
          </li>
        </ul>
      </nav>

      <EdwardPostModal
        v-if="selected && !recessed"
        :status="selected"
        @close="closeModal"
        @open-thread="openThread"
        @open-profile="openProfile"
      />
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.edward-mode {
  position: fixed;
  inset: 0;
  z-index: var(--neo-z-edward, 1090);
  opacity: 0;
  transition: opacity 0.22s ease;
  font-family: 'Courier New', ui-monospace, monospace;
  color: #fff8d6;
  pointer-events: auto;

  &.is-visible {
    opacity: 1;
  }

  /* Drop under compose sheet for quick reply */
  &.is-recessed {
    z-index: var(--neo-z-edward-recessed, 150);
    pointer-events: none;
    opacity: 0.35;
  }
}

.edward-mode__scan {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 2px,
    color-mix(in srgb, #000 18%, transparent) 3px
  );
  mix-blend-mode: multiply;
  opacity: 0.35;
}

.edward-mode__header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 4;
  padding: max(0.55rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right))
    0.55rem max(0.75rem, env(safe-area-inset-left));
  border-bottom: 2px solid #ffe566;
  background: color-mix(in srgb, #12081c 94%, transparent);
  box-shadow: 0 4px 0 color-mix(in srgb, #ff7eb3 55%, transparent);
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
}

.edward-mode__header-row {
  display: flex;
  align-items: center;
  gap: 0.75rem 1rem;
  flex-wrap: wrap;
}

.edward-mode__brand {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.edward-mode__session {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  font-size: 0.625rem;
  letter-spacing: 0.22em;
  color: #ff7eb3;
  text-transform: uppercase;
}

.edward-mode__uptime {
  letter-spacing: 0.08em;
  color: #59d1e0;
  font-variant-numeric: tabular-nums;
}

.edward-mode__cursor {
  display: inline-block;
  color: #ffe566;

  &.is-off {
    opacity: 0;
  }
}

.edward-mode__title {
  font-size: 1.05rem;
  letter-spacing: 0.06em;
  text-transform: lowercase;
  color: #ffe566;
  text-shadow: 2px 2px 0 #1a1420;
}

.edward-mode__stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
}

.edward-mode__stat {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  font-size: 0.625rem;
  letter-spacing: 0.06em;
  color: #fff8d6;
  font-variant-numeric: tabular-nums;
  border: 1px solid color-mix(in srgb, #ffe566 50%, transparent);
  padding: 0.22rem 0.45rem;
  background: color-mix(in srgb, #1a1420 75%, transparent);

  &--sort {
    border-color: color-mix(in srgb, #59d1e0 55%, transparent);
    color: #59d1e0;
  }
}

.edward-mode__header-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}

.edward-mode__header-rail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.85rem;
  margin-top: 0.45rem;
  padding-top: 0.4rem;
  border-top: 1px dashed color-mix(in srgb, #ffe566 35%, transparent);
}

.edward-mode__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.65rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.5625rem;
  letter-spacing: 0.04em;
  text-transform: lowercase;
  color: color-mix(in srgb, #fff8d6 70%, transparent);

  li {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
}

.edward-mode__glyph {
  color: #ffe566;
  font-size: 0.65rem;
}

.edward-mode__exit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.1rem;
  height: 2.1rem;
  padding: 0;
  border: 2px solid #ffe566;
  border-radius: 3px;
  background: #1a1420;
  color: #ffe566;
  font-family: inherit;
  line-height: 1;
  cursor: pointer;
  box-shadow: 2px 2px 0 #ff7eb3;

  &:focus-visible {
    background: #ffe566;
    color: #1a1420;
  }

  @include hover {
    background: #ffe566;
    color: #1a1420;
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 2px;
  }
}

.edward-mode__focus-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
  padding: 0.35rem 0.65rem;
  border: 2px solid #59d1e0;
  border-radius: 3px;
  background: #1a1420;
  color: #59d1e0;
  font-family: inherit;
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  cursor: pointer;
  box-shadow: 2px 2px 0 #59d1e0;

  &:focus-visible {
    background: #59d1e0;
    color: #1a1420;
  }

  @include hover {
    background: #59d1e0;
    color: #1a1420;
  }

  &:focus-visible {
    outline: 2px solid #ffe566;
    outline-offset: 2px;
  }
}

.edward-mode__servers {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.edward-mode__srv-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-height: 24px;
  min-width: 24px;
  padding: 0.15rem 0.4rem;
  border: 1px solid color-mix(in srgb, var(--srv, #ffe566) 70%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, #1a1420 75%, transparent);
  color: #fff8d6;
  font-family: inherit;
  font-size: 0.5625rem;
  letter-spacing: 0.04em;
  cursor: pointer;

  &.is-on {
    background: color-mix(in srgb, var(--srv, #ff7eb3) 35%, transparent);
    border-color: var(--srv, #ff7eb3);
  }
}

.edward-mode__srv-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--srv, #ffe566);
}

.edward-mode__srv-n {
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}

.edward-mode__watch {
  position: absolute;
  left: max(0.75rem, env(safe-area-inset-left));
  // Clear the explore console (measured → --edward-explore-h) on every width
  bottom: calc(max(0.75rem, env(safe-area-inset-bottom)) + var(--edward-explore-h, 112px) + 0.6rem);
  z-index: 3;
  width: min(420px, calc(100vw - 1.5rem));
  padding: 0.55rem;
  text-align: left;
  border: 2px solid #ffe566;
  border-radius: 4px;
  background: color-mix(in srgb, #12081c 95%, transparent);
  color: #fff8d6;
  font-family: inherit;
  box-shadow: 4px 4px 0 #ff7eb3;

  &.is-scrubbing {
    border-color: #ff7eb3;
    box-shadow: 4px 4px 0 #59d1e0;
  }
}

.edward-mode__watch-nav {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
}

.edward-mode__watch-step,
.edward-mode__watch-live {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  flex-shrink: 0;
  min-width: 1.75rem;
  min-height: 1.75rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid #59d1e0;
  border-radius: 2px;
  background: #1a1420;
  color: #59d1e0;
  font-family: inherit;
  font-size: 0.6875rem;
  cursor: pointer;

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }

  &:not(:disabled):focus-visible {
    background: #59d1e0;
    color: #1a1420;
  }

  @include hover(':not(:disabled)') {
    background: #59d1e0;
    color: #1a1420;
  }
}

.edward-mode__watch-live {
  border-color: #ff7eb3;
  color: #ff7eb3;
  margin-left: auto;

  &:focus-visible {
    background: #ff7eb3;
    color: #1a1420;
  }

  @include hover {
    background: #ff7eb3;
    color: #1a1420;
  }
}

.edward-mode__watch-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex: 1;
  font-size: 0.5625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #ff7eb3;
}

.edward-mode__watch-film {
  display: flex;
  gap: 0.4rem;
  align-items: stretch;
}

.edward-mode__film-tile {
  display: flex;
  flex-direction: column;
  flex: 0 0 64px;
  width: 64px;
  gap: 0.2rem;
  min-width: 0;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--srv, #ffe566) 55%, transparent);
  border-radius: 3px;
  background: #1a1420;
  color: inherit;
  font-family: inherit;
  cursor: pointer;
  overflow: hidden;
  opacity: 0.72;

  &:focus-visible {
    opacity: 1;
    border-color: var(--srv, #ffe566);
  }

  @include hover {
    opacity: 1;
    border-color: var(--srv, #ffe566);
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }

  &--ahead {
    opacity: 0.55;
  }
}

.edward-mode__film-img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
  background: #0a0614;
}

.edward-mode__film-face {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  font-size: 0.85rem;
  color: #ffe566;
  background: color-mix(in srgb, var(--srv, #ff7eb3) 18%, #1a1420);
}

.edward-mode__film-name {
  padding: 0 0.2rem 0.25rem;
  font-size: 0.5rem;
  letter-spacing: 0.02em;
  color: color-mix(in srgb, #fff8d6 80%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.edward-mode__watch-hero {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 0;
  min-width: 0;
  padding: 0 0 0.45rem;
  border: 2px solid var(--srv, #ffe566);
  border-radius: 3px;
  background: #1a1420;
  color: inherit;
  overflow: hidden;
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--srv, #ff7eb3) 70%, transparent);
}

.edward-mode__watch-hero-main {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: -2px;
  }
}

.edward-mode__watch-hero :deep(.edward-watch-actions) {
  margin: 0 0.45rem;
}

.edward-mode__watch-hero-media {
  width: 100%;
  aspect-ratio: 16 / 10;
  background: #0a0614;
  overflow: hidden;
}

.edward-mode__watch-hero-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.edward-mode__watch-hero-face {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 2rem;
  color: #ffe566;
  background: radial-gradient(
    circle at 30% 30%,
    color-mix(in srgb, var(--srv, #ff7eb3) 35%, #1a1420),
    #1a1420
  );
}

.edward-mode__watch-copy {
  min-width: 0;
  padding: 0 0.55rem 0.55rem;
}

.edward-mode__watch-name {
  display: block;
  font-size: 0.875rem;
  margin-bottom: 0.1rem;
  color: #ffe566;
}

.edward-mode__watch-host {
  display: block;
  font-size: 0.5625rem;
  letter-spacing: 0.06em;
  color: #59d1e0;
  margin-bottom: 0.25rem;
}

.edward-mode__watch-text {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 0.6875rem;
  line-height: 1.35;
  color: color-mix(in srgb, #fff8d6 88%, transparent);
}

.edward-mode__watch-hint {
  margin: 0.4rem 0 0;
  font-size: 0.5rem;
  letter-spacing: 0.08em;
  color: color-mix(in srgb, #59d1e0 70%, transparent);
}

@media (max-width: 520px) {
  .edward-mode__film-tile {
    flex-basis: 52px;
    width: 52px;
  }

  .edward-mode__watch-film .edward-mode__film-tile:first-child {
    display: none;
  }
}

.edward-mode__error {
  position: absolute;
  left: 50%;
  top: 40%;
  z-index: 3;
  transform: translate(-50%, -50%);
  max-width: min(360px, 90vw);
  margin: 0;
  padding: 0.85rem 1rem;
  text-align: center;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: #ffe566;
  background: #1a1420;
  border: 2px solid #ff7eb3;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  align-items: center;
  border-radius: 3px;
  box-shadow: 4px 4px 0 #ff7eb3;
}

.edward-mode__error-restart {
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #1a1420;
  background: #59d1e0;
  border: none;
  border-radius: 4px;
  padding: 0.35rem 0.75rem;
  cursor: pointer;

  @include hover {
    filter: brightness(1.05);
  }
}

.edward-mode__explore {
  position: absolute;
  bottom: max(0.75rem, env(safe-area-inset-bottom));
  left: 50%;
  z-index: 4;
  transform: translateX(-50%);
  width: min(700px, calc(100vw - 1.5rem));
  padding: 0.55rem 0.65rem 0.45rem;
  border: 2px solid #ffe566;
  border-radius: 4px;
  background: color-mix(in srgb, #12081c 94%, transparent);
  box-shadow:
    4px 4px 0 #ff7eb3,
    0 0 28px color-mix(in srgb, #59d1e0 18%, transparent);
  pointer-events: auto;

  /* The input drops its own outline — ring the console instead */
  &:has(.edward-mode__explore-input:focus-visible) {
    outline: 2px solid #59d1e0;
    outline-offset: 2px;
  }
}

@media (min-width: 1100px) {
  .edward-mode__explore {
    // Stage = between the deck column and the right rail (204px)
    left: calc(var(--edward-deck-w, 452px) + (100vw - var(--edward-deck-w, 452px) - 204px) / 2);
    width: min(700px, calc(100vw - var(--edward-deck-w, 452px) - 204px - 1.5rem));
  }
}

.edward-mode__chip--more {
  border-style: solid;
  color: #59d1e0;
}

.edward-mode__explore-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.edward-mode__explore-prompt {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: #ff7eb3;
}

.edward-mode__explore-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #fff8d6;
  font-family: inherit;
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  padding: 0.25rem 0;

  &::placeholder {
    color: color-mix(in srgb, #59d1e0 75%, transparent);
    letter-spacing: 0.03em;
  }

  &::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
}

.edward-mode__explore-sort,
.edward-mode__explore-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  flex-shrink: 0;
  padding: 0.28rem 0.5rem;
  border: 1px solid #59d1e0;
  border-radius: 2px;
  background: color-mix(in srgb, #1a1420 80%, transparent);
  color: #59d1e0;
  font-family: inherit;
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  cursor: pointer;
  white-space: nowrap;

  &:focus-visible {
    background: #59d1e0;
    color: #1a1420;
  }

  @include hover {
    background: #59d1e0;
    color: #1a1420;
  }

  &:focus-visible {
    outline: 2px solid #ffe566;
    outline-offset: 1px;
  }
}

.edward-mode__explore-clear {
  border-color: #ff7eb3;
  color: #ff7eb3;

  &:focus-visible {
    background: #ff7eb3;
    color: #1a1420;
  }

  @include hover {
    background: #ff7eb3;
    color: #1a1420;
  }
}

.edward-mode__explore-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.45rem;
}

.edward-mode__chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  min-height: 24px;
  min-width: 24px;
  padding: 0.18rem 0.45rem;
  border: 1px dashed color-mix(in srgb, #ffe566 45%, transparent);
  border-radius: 2px;
  background: transparent;
  color: color-mix(in srgb, #fff8d6 75%, transparent);
  font-family: inherit;
  font-size: 0.625rem;
  letter-spacing: 0.06em;
  text-transform: lowercase;
  cursor: pointer;

  &:focus-visible {
    border-style: solid;
    color: #ffe566;
    border-color: #ffe566;
  }

  @include hover {
    border-style: solid;
    color: #ffe566;
    border-color: #ffe566;
  }

  &.is-on {
    border-style: solid;
    border-color: #ff7eb3;
    background: color-mix(in srgb, #ff7eb3 22%, transparent);
    color: #ffe566;
  }

  &--srv {
    border-color: color-mix(in srgb, var(--srv, #ffe566) 55%, transparent);
    color: var(--srv, #ffe566);

    &.is-on {
      border-color: var(--srv, #ff7eb3);
      background: color-mix(in srgb, var(--srv, #ff7eb3) 28%, transparent);
    }
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }
}

.edward-mode__explore-crumb {
  margin: 0.4rem 0 0;
  font-size: 0.5625rem;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  color: color-mix(in srgb, #fff8d6 55%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.edward-mode__explore-hint {
  color: color-mix(in srgb, #59d1e0 70%, transparent);
}

/* ============================================================
 * Phones: the canvas is the show. Keep chrome to three slim layers —
 * header row · (lens stage) · watch deck docked on the console.
 * The canvas reserves a fixed band above the console for the deck
 * (PHONE_DECK_RESERVE in EdwardCanvas) — keep the deck under ~180px.
 * ========================================================== */
@media (max-width: 639px) {
  .edward-mode__header {
    padding-bottom: 0.4rem;
  }

  .edward-mode__header-row {
    flex-wrap: nowrap;
    gap: 0.5rem;
  }

  .edward-mode__title {
    font-size: 0.875rem;
  }

  .edward-mode__stats {
    flex-wrap: nowrap;
    overflow: hidden;
    min-width: 0;
  }

  // Sort is already on the console; server count is a desktop nicety
  .edward-mode__stat--sort,
  .edward-mode__stat:nth-child(2) {
    display: none;
  }

  // Face legend + server rail duplicate the console chips — too much on a phone
  .edward-mode__header-rail {
    display: none;
  }

  .edward-mode__focus-btn span {
    display: none;
  }
}

/* Phones + tablets: the watch deck docks on the console as one compact card.
 * EdwardCanvas reserves PHONE_DECK_RESERVE px for it below DOCKED_DECK_MAX_W. */
@media (max-width: 1099px) {
  .edward-mode__watch {
    left: max(0.5rem, env(safe-area-inset-left));
    right: max(0.5rem, env(safe-area-inset-right));
    width: auto;
    bottom: calc(max(0.75rem, env(safe-area-inset-bottom)) + var(--edward-explore-h, 104px) + 0.4rem);
    padding: 0.35rem 0.4rem 0.4rem;
    box-shadow: 3px 3px 0 #ff7eb3;
  }

  .edward-mode__watch-nav {
    margin-bottom: 0.3rem;
  }

  // One post at a time — the filmstrip lives on larger screens
  .edward-mode__watch-film .edward-mode__film-tile,
  .edward-mode__watch-hint {
    display: none;
  }

  .edward-mode__watch-hero {
    padding-bottom: 0.35rem;
    box-shadow: none;
  }

  .edward-mode__watch-hero-main {
    flex-direction: row;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.4rem 0;
  }

  .edward-mode__watch-hero-media {
    flex: 0 0 52px;
    width: 52px;
    height: 52px;
    aspect-ratio: 1;
    border-radius: 2px;
  }

  .edward-mode__watch-hero-face {
    font-size: 1rem;
  }

  .edward-mode__watch-copy {
    flex: 1;
    padding: 0;
  }

  .edward-mode__watch-name {
    display: inline;
    font-size: 0.8125rem;
    margin-right: 0.35rem;
  }

  .edward-mode__watch-host {
    display: inline;
  }

  .edward-mode__watch-text {
    margin-top: 0.15rem;
    -webkit-line-clamp: 2;
  }

  .edward-mode__watch-hero :deep(.edward-watch-actions) {
    flex-wrap: nowrap;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    margin: 0.35rem 0.4rem 0;
    padding-top: 0.35rem;

    &::-webkit-scrollbar {
      display: none;
    }
  }

}

/* Tablets: console stays a centered 640px panel — dock the deck to match */
@media (min-width: 640px) and (max-width: 1099px) {
  .edward-mode__watch {
    left: 50%;
    right: auto;
    width: min(640px, calc(100vw - 1.5rem));
    transform: translateX(-50%);
  }
}

@media (max-width: 639px) {
  .edward-mode__explore {
    left: max(0.5rem, env(safe-area-inset-left));
    right: max(0.5rem, env(safe-area-inset-right));
    width: auto;
    transform: none;
    padding: 0.45rem 0.5rem 0.4rem;
  }

  // Chips scroll sideways instead of stacking three rows deep
  .edward-mode__explore-chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    margin-inline: -0.5rem;
    padding-inline: 0.5rem;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .edward-mode__chip {
    flex-shrink: 0;
  }
}

/* Fingers, not cursors: real targets + no keyboard-only hints */
@media (pointer: coarse) {
  .edward-mode__exit {
    width: 2.5rem;
    height: 2.5rem;
  }

  .edward-mode__focus-btn {
    min-height: 2.5rem;
    min-width: 2.5rem;
    justify-content: center;
  }

  .edward-mode__watch-step,
  .edward-mode__watch-live {
    min-width: 2.5rem;
    min-height: 2.25rem;
  }

  .edward-mode__explore-sort,
  .edward-mode__explore-clear {
    min-height: 2.25rem;
  }

  .edward-mode__explore-clear {
    min-width: 2.25rem;
  }

  .edward-mode__chip,
  .edward-mode__srv-chip {
    min-height: 2.125rem;
    padding-inline: 0.6rem;
  }

  .edward-mode__explore-hint {
    display: none;
  }
}

/* Landscape phones: one-line deck so the stage isn't all chrome
 * (EdwardCanvas SHORT_DECK_RESERVE matches this height) */
@media (max-width: 1099px) and (max-height: 519px) {
  .edward-mode__watch {
    padding: 0.25rem 0.4rem;
  }

  .edward-mode__watch-nav {
    position: absolute;
    top: 0.3rem;
    right: 0.4rem;
    margin: 0;
    gap: 0.25rem;
  }

  .edward-mode__watch-label {
    display: none;
  }

  .edward-mode__watch-hero {
    border: 0;
    padding: 0;
    background: transparent;
  }

  .edward-mode__watch-hero-main {
    padding: 0;
    padding-right: 7rem;
  }

  .edward-mode__watch-hero-media {
    flex-basis: 40px;
    width: 40px;
    height: 40px;
  }

  .edward-mode__watch-text {
    -webkit-line-clamp: 1;
  }

  .edward-mode__watch-hero :deep(.edward-watch-actions) {
    display: none;
  }

  // Quick-filter chips + legend rail: keep the field, drop the extras
  .edward-mode__explore-chips,
  .edward-mode__explore-crumb,
  .edward-mode__header-rail {
    display: none;
  }
}

/* Post list (text twin of the canvas) — off-screen until it holds focus */
.edward-mode__list {
  position: absolute;
  top: 50%;
  left: max(0.75rem, env(safe-area-inset-left));
  z-index: 5;
  width: min(320px, calc(100vw - 1.5rem));
  max-height: min(60vh, 28rem);
  max-height: min(60dvh, 28rem);
  overflow-y: auto;
  overscroll-behavior: contain;
  transform: translateY(-50%);
  padding: 0.45rem;
  border: 2px solid #ffe566;
  border-radius: 4px;
  background: color-mix(in srgb, #12081c 97%, transparent);
  box-shadow: 4px 4px 0 #ff7eb3;

  &:not(:focus-within) {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    border: 0;
    white-space: nowrap;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
}

.edward-mode__list-head {
  margin: 0 0 0.35rem;
  font-size: 0.625rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #ff7eb3;
}

.edward-mode__list-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  width: 100%;
  min-height: 44px;
  padding: 0.35rem 0.45rem;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: #fff8d6;
  font-family: inherit;
  text-align: left;
  cursor: pointer;

  strong {
    font-size: 0.75rem;
    color: #ffe566;
  }

  span {
    font-size: 0.6875rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &:focus-visible {
    border-color: #59d1e0;
    background: color-mix(in srgb, #59d1e0 14%, transparent);
  }

  @include hover {
    border-color: #59d1e0;
    background: color-mix(in srgb, #59d1e0 14%, transparent);
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: -2px;
  }
}

/* Desktop action rail — right edge, clear of the lens (EdwardCanvas reserves
 * DESK_RAIL_COLUMN for it). Same chrome language as the watch deck. */
/* ── Desktop deck: hero + earlier posts, a column on the left ── */
.edward-mode__deck {
  position: absolute;
  left: max(0.75rem, env(safe-area-inset-left));
  top: calc(var(--edward-header-h, 96px) + 0.75rem);
  // Fixed height — header to console (or to the floor when the centered
  // console can't reach this column). Content moves inside; the panel doesn't.
  bottom: calc(max(0.75rem, env(safe-area-inset-bottom)) + var(--edward-explore-h, 112px) + 0.75rem);
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: calc(var(--edward-deck-w, 452px) - 1.5rem);
  padding: 0.55rem;
  box-sizing: border-box;
  overflow: hidden;
  border: 2px solid #ffe566;
  border-radius: 4px;
  background: color-mix(in srgb, #12081c 95%, transparent);
  color: #fff8d6;
  box-shadow: 4px 4px 0 #ff7eb3;

  &.is-scrubbing {
    border-color: #ff7eb3;
    box-shadow: 4px 4px 0 #59d1e0;
  }

  &.is-touring {
    box-shadow: 4px 4px 0 #59d1e0, 0 0 32px color-mix(in srgb, #59d1e0 22%, transparent);
  }

  // Desktop: the console is centered in the stage (not the screen), so the
  // deck always has the full height to itself
  @media (min-width: 1100px) {
    bottom: max(0.75rem, env(safe-area-inset-bottom));
  }

  .edward-mode__watch-nav {
    margin-bottom: 0;
  }
}

.edward-mode__deck-hero-wrap {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  // Height follows the current card (measured) — rows below glide with it
  transition: height 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.edward-mode__deck-hero-inner {
  position: relative;
}

.deck-hero-enter-active {
  transition:
    opacity 0.34s ease,
    transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.deck-hero-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

// The outgoing card fades in place, out of flow, so only the new one is measured
.deck-hero-leave-active {
  position: absolute;
  inset: 0 0 auto;
  transition: opacity 0.22s ease;
}

.deck-hero-leave-to {
  opacity: 0;
}

.edward-mode__deck-hero {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  width: 100%;
  box-sizing: border-box;
  padding: 0 0 0.55rem;
  border: 2px solid var(--srv, #ffe566);
  border-radius: 3px;
  background: #1a1420;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--srv, #ff7eb3) 70%, transparent);

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 2px;
  }

  > :not(.edward-mode__deck-media) {
    margin: 0 0.65rem;
  }
}

.edward-mode__deck-media {
  background: #0a0614;
  overflow: hidden;

  img {
    display: block;
    width: 100%;
    max-height: min(46vh, 480px);
    object-fit: contain;
  }
}

.edward-mode__deck-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.55rem !important;
}

.edward-mode__deck-face {
  display: grid;
  flex: 0 0 2.25rem;
  place-items: center;
  height: 2.25rem;
  font-size: 0.75rem;
  color: #ffe566;
  border: 1px solid var(--srv, #ffe566);
  border-radius: 50%;
  background: color-mix(in srgb, var(--srv, #ff7eb3) 20%, #1a1420);
}

.edward-mode__deck-who {
  display: flex;
  flex-direction: column;
  min-width: 0;

  strong {
    overflow: hidden;
    font-size: 0.9375rem;
    color: #ffe566;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  span {
    overflow: hidden;
    font-size: 0.625rem;
    letter-spacing: 0.05em;
    color: #59d1e0;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

.edward-mode__deck-text {
  display: -webkit-box;
  -webkit-line-clamp: 10;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: color-mix(in srgb, #fff8d6 92%, transparent);
  overflow-wrap: anywhere;
}

.edward-mode__deck-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.75rem;
  font-size: 0.6875rem;
  color: #ffe566;
  font-variant-numeric: tabular-nums;
}

.edward-mode__deck-tag {
  color: #ff7eb3;
}

.edward-mode__deck-why {
  color: color-mix(in srgb, #59d1e0 80%, transparent);
}

.edward-mode__deck-label {
  margin: 0.15rem 0 -0.15rem;
  font-size: 0.5625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in srgb, #ff7eb3 85%, transparent);
}

.edward-mode__deck-recent {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1 1 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
  // Rows that don't fit fade out instead of being cut — the list breathes
  // as the hero above grows and shrinks
  mask-image: linear-gradient(to bottom, #000 calc(100% - 56px), transparent);
}

.edward-mode__deck-empty {
  margin: auto 0 0.25rem;
  font-size: 0.5625rem;
  letter-spacing: 0.06em;
  text-align: center;
  color: color-mix(in srgb, #59d1e0 55%, transparent);
}

.deck-row-enter-active,
.deck-row-move {
  transition:
    opacity 0.4s ease,
    transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.deck-row-enter-from {
  opacity: 0;
  transform: translateY(-14px);
}

.deck-row-leave-active {
  position: absolute;
  left: 0;
  right: 0;
  transition: opacity 0.25s ease;
}

.deck-row-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .edward-mode__deck-hero-wrap,
  .deck-hero-enter-active,
  .deck-hero-leave-active,
  .deck-row-enter-active,
  .deck-row-move,
  .deck-row-leave-active {
    transition: none;
  }
}

/* Why it's here — personal, source, then nuance */
.edward-mode__why {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    padding: 0.1rem 0.45rem;
    border: 1px solid color-mix(in srgb, #59d1e0 45%, transparent);
    border-radius: 999px;
    font-size: 0.625rem;
    letter-spacing: 0.03em;
    color: #59d1e0;
  }

  .edward-mode__why--you {
    border-color: color-mix(in srgb, #ff7eb3 60%, transparent);
    color: #ff7eb3;
  }

  .edward-mode__why--nuance {
    border-color: color-mix(in srgb, #ffe566 40%, transparent);
    color: #ffe566;
  }
}

.edward-mode__deck-row-why {
  overflow: hidden;
  font-size: 0.5625rem;
  letter-spacing: 0.03em;
  color: color-mix(in srgb, #ff7eb3 85%, transparent);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Ed's running commentary, typed out under the title */
.edward-mode__quip {
  display: block;
  // Never widen the header — the line fits whatever room the brand has
  contain: inline-size;
  max-width: min(46ch, 60vw);
  margin-top: 0.15rem;
  overflow: hidden;
  font-size: 0.6875rem;
  letter-spacing: 0.03em;
  color: color-mix(in srgb, #59d1e0 92%, transparent);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.edward-mode__quip-tag {
  margin-right: 0.35rem;
  color: #ff7eb3;
}

.edward-mode__quip-caret {
  margin-left: 1px;
  color: #ffe566;
  animation: edward-caret 1.06s steps(1) infinite;
}

@keyframes edward-caret {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .edward-mode__quip-caret {
    animation: none;
  }
}

/* Ed's channels — one tap, a whole mood */
.edward-mode__channels {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.45rem;
}

.edward-mode__channel {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 24px;
  padding: 0.15rem 0.55rem;
  border: 1px solid color-mix(in srgb, #ff7eb3 45%, transparent);
  border-radius: 3px;
  background: color-mix(in srgb, #ff7eb3 6%, transparent);
  color: color-mix(in srgb, #fff8d6 85%, transparent);
  font-family: inherit;
  font-size: 0.625rem;
  letter-spacing: 0.05em;
  text-transform: lowercase;
  cursor: pointer;

  > span {
    color: #ff7eb3;
  }

  &:focus-visible {
    border-color: #ff7eb3;
    color: #fff8d6;
  }

  @include hover {
    border-color: #ff7eb3;
    color: #fff8d6;
  }

  &.is-on {
    border-color: #ff7eb3;
    background: color-mix(in srgb, #ff7eb3 26%, transparent);
    color: #fff8d6;

    > span {
      color: #ffe566;
    }
  }
}

@media (max-width: 639px) {
  // Header is tight on phones — the backpack count lives in the narrator instead
  .edward-mode__stat--pack {
    display: none;
  }

  .edward-mode__channels {
    flex-wrap: nowrap;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    margin-inline: -0.5rem;
    padding-inline: 0.5rem;

    &::-webkit-scrollbar {
      display: none;
    }

    > * {
      flex-shrink: 0;
    }
  }

  .edward-mode__quip {
    max-width: 100%;
  }
}

.edward-mode__chip--src > span {
  color: #59d1e0;
}

.edward-mode__deck-row {
  display: flex;
  gap: 0.55rem;
  width: 100%;
  padding: 0.35rem;
  border: 1px solid color-mix(in srgb, var(--srv, #ffe566) 45%, transparent);
  border-radius: 3px;
  background: #1a1420;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  opacity: 0.82;
  transition: opacity 0.15s ease, border-color 0.15s ease;

  &:focus-visible {
    opacity: 1;
    border-color: var(--srv, #ffe566);
  }

  @include hover {
    opacity: 1;
    border-color: var(--srv, #ffe566);
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }
}

.edward-mode__deck-thumb {
  flex: 0 0 3.5rem;
  width: 3.5rem;
  height: 3.5rem;
  object-fit: cover;
  border-radius: 2px;
  background: #0a0614;

  &--face {
    display: grid;
    place-items: center;
    font-size: 0.75rem;
    color: #ffe566;
    background: color-mix(in srgb, var(--srv, #ff7eb3) 18%, #1a1420);
  }
}

.edward-mode__deck-row-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;

  strong {
    overflow: hidden;
    font-size: 0.6875rem;
    color: #ffe566;
    white-space: nowrap;
    text-overflow: ellipsis;

    em {
      font-style: normal;
      font-weight: 400;
      color: color-mix(in srgb, #fff8d6 55%, transparent);
    }
  }

  span {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.6875rem;
    line-height: 1.35;
    color: color-mix(in srgb, #fff8d6 82%, transparent);
  }
}

/* ── Pace dock: tertiary, bottom right — set it and lean back ── */
.edward-mode__pace {
  position: absolute;
  right: max(0.75rem, env(safe-area-inset-right));
  bottom: max(0.75rem, env(safe-area-inset-bottom));
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  width: 11rem;
  padding: 0.4rem;
  border: 1px solid color-mix(in srgb, #59d1e0 30%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, #12081c 70%, transparent);
  opacity: 0.6;
  transition: opacity 0.2s ease;

  &:focus-within {
    opacity: 1;
  }

  @include hover {
    opacity: 1;
  }
}

.edward-mode__pace-row {
  display: flex;
  gap: 0.2rem;
}

.edward-mode__pace-opt {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-height: 1.6rem;
  padding: 0.15rem 0.2rem;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: color-mix(in srgb, #fff8d6 62%, transparent);
  font-family: inherit;
  font-size: 0.5625rem;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  cursor: pointer;

  &:focus-visible {
    color: #fff8d6;
    border-color: color-mix(in srgb, #59d1e0 50%, transparent);
  }

  @include hover {
    color: #fff8d6;
    border-color: color-mix(in srgb, #59d1e0 50%, transparent);
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }

  &.is-on {
    color: #59d1e0;
    border-color: color-mix(in srgb, #59d1e0 60%, transparent);
    background: color-mix(in srgb, #59d1e0 12%, transparent);
  }
}

.edward-mode__pace-btn.is-on {
  background: color-mix(in srgb, #59d1e0 22%, #1a1420);
  color: #fff8d6;
}

/* ── Sort row in the console ── */
.edward-mode__sorts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem;
  margin-top: 0.4rem;
}

// Phones: one sideways-scrolling line, like the chips below it
@media (max-width: 639px) {
  .edward-mode__sorts {
    flex-wrap: nowrap;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    margin-inline: -0.5rem;
    padding-inline: 0.5rem;

    &::-webkit-scrollbar {
      display: none;
    }

    > * {
      flex-shrink: 0;
    }
  }
}

.edward-mode__sorts-label {
  display: inline-flex;
  margin-right: 0.15rem;
  color: #ff7eb3;
}

.edward-mode__sort {
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
  min-height: 22px;
  padding: 0.12rem 0.45rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: color-mix(in srgb, #59d1e0 80%, transparent);
  font-family: inherit;
  font-size: 0.625rem;
  letter-spacing: 0.06em;
  text-transform: lowercase;
  cursor: pointer;

  &:focus-visible {
    border-color: color-mix(in srgb, #59d1e0 55%, transparent);
    color: #59d1e0;
  }

  @include hover {
    border-color: color-mix(in srgb, #59d1e0 55%, transparent);
    color: #59d1e0;
  }

  &.is-on {
    border-color: #59d1e0;
    background: color-mix(in srgb, #59d1e0 18%, transparent);
    color: #fff8d6;
  }
}

.edward-mode__actions-rail {
  position: absolute;
  top: 50%;
  right: max(0.75rem, env(safe-area-inset-right));
  z-index: 3;
  width: 11rem;
  transform: translateY(-50%);
  padding: 0.55rem;
  border: 2px solid #ffe566;
  border-radius: 4px;
  background: color-mix(in srgb, #12081c 95%, transparent);
  color: #fff8d6;
  box-shadow: 4px 4px 0 #ff7eb3;
}

.edward-mode__actions-rail-head {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin: 0 0 0.5rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px dashed color-mix(in srgb, #59d1e0 40%, transparent);
  font-size: 0.5625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #ff7eb3;

  strong {
    overflow: hidden;
    color: var(--srv, #ffe566);
    font-size: 0.75rem;
    letter-spacing: 0.02em;
    text-transform: none;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
</style>
