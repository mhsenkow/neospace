<script setup lang="ts">
/**
 * Edward Mode — Radical Edward Session OS thought stream.
 */

import { useEdwardStore } from '~/stores/edward'
import { useEdwardStream } from '~/composables/useEdwardStream'
import { EDWARD_FACE_LEGEND, MOOD_GLYPH } from '~/utils/edwardFaces'
import { stripHtml } from '~/utils/sanitizeHtml'
import { statusIdentity } from '~/utils/statusIdentity'
import { statusToEdwardBall } from '~/utils/edwardSemantics'
import type { ExtendedStatus } from '~/stores/instances'
import {
  EDWARD_EXPLORE_CHIPS,
  EDWARD_EXPLORE_PLACEHOLDERS,
  EDWARD_SORT_LABELS,
  describeEdwardExplore,
  parseEdwardExplore,
} from '~/utils/edwardExplore'
import { dialectForHost } from '~/utils/edwardServers'
import NeoIcon from '~/components/NeoIcon.vue'
import type { NeoIconName } from '~/utils/neoIcons'
import EdwardCanvas from '~/components/edward/EdwardCanvas.vue'
import EdwardPostModal from '~/components/edward/EdwardPostModal.vue'

const CHIP_ICONS: Record<string, NeoIconName> = {
  'no bots': 'ban',
  you: 'user',
  media: 'image',
  anger: 'alert',
  love: 'heart',
  replies: 'message',
  asks: 'mention',
  bots: 'servers',
  near: 'sparkle',
  loud: 'zap',
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
}

const edward = useEdwardStore()
const stream = useEdwardStream()
const router = useRouter()
const rootEl = ref<HTMLElement | null>(null)
const exploreInput = ref<HTMLInputElement | null>(null)
const visible = ref(false)

const selected = computed(() => edward.selectedStatus)
const count = computed(() => edward.ballCount)
const loading = computed(() => edward.loading)
const error = computed(() => edward.error)
const recessed = computed(() => edward.recessed)
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
const cardFromStatus = (status: ExtendedStatus, identity: string, offset: number, current: boolean): WatchCard => {
  const body = status.reblog || status
  const ball = statusToEdwardBall(status, edward.affinity)
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
    name: body.account?.displayName || body.account?.acct || 'someone',
    host,
    text: stripHtml(body.content || '').slice(0, current ? 180 : 72) || '···',
    media,
    moodGlyph: MOOD_GLYPH[ball.mood] || '◉‿◉',
    accent: dialect.accent,
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

const watchScrubbing = computed(() => edward.watchScrubbing)
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

const blink = ref(true)
const placeholderIdx = ref(0)
let blinkTimer: ReturnType<typeof setInterval> | null = null
let placeholderTimer: ReturnType<typeof setInterval> | null = null

const explorePlaceholder = computed(
  () => EDWARD_EXPLORE_PLACEHOLDERS[placeholderIdx.value % EDWARD_EXPLORE_PLACEHOLDERS.length]!,
)

const chipActive = (query: string) => {
  const parts = edward.exploreQuery.toLowerCase().split(/\s+/).filter(Boolean)
  return parts.includes(query.toLowerCase())
}

const onPick = (identity: string) => {
  edward.selectByIdentity(identity)
}

const cycleFocus = () => {
  edward.cycleFocusMode()
}

const cycleSort = () => {
  edward.cycleExploreSort()
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

const exit = () => {
  visible.value = false
  window.setTimeout(() => {
    stream.stop()
    edward.exit()
  }, 220)
}

const onKey = (e: KeyboardEvent) => {
  if (e.defaultPrevented) return
  const target = e.target as HTMLElement | null
  const typing =
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.isContentEditable

  // / focuses explore console (Session OS muscle memory)
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    exploreInput.value?.focus()
    exploreInput.value?.select()
    return
  }

  // ← → scrub watch history when something cool just flew by
  if (!typing && (e.key === 'ArrowLeft' || e.key === '[')) {
    e.preventDefault()
    edward.watchPrev()
    return
  }
  if (!typing && (e.key === 'ArrowRight' || e.key === ']')) {
    e.preventDefault()
    edward.watchNext()
    return
  }

  if (e.key !== 'Escape') return
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

onMounted(() => {
  requestAnimationFrame(() => {
    visible.value = true
  })
  document.addEventListener('keydown', onKey, true)
  prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  blinkTimer = setInterval(() => {
    blink.value = !blink.value
  }, 530)
  placeholderTimer = setInterval(() => {
    placeholderIdx.value = (placeholderIdx.value + 1) % EDWARD_EXPLORE_PLACEHOLDERS.length
  }, 4200)
  sessionTimer = setInterval(() => {
    tickNow.value = Date.now()
  }, 1000)
  void stream.start()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKey, true)
  document.body.style.overflow = prevOverflow
  if (blinkTimer) clearInterval(blinkTimer)
  if (placeholderTimer) clearInterval(placeholderTimer)
  if (sessionTimer) clearInterval(sessionTimer)
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
      role="dialog"
      aria-modal="true"
      aria-label="Edward mode session"
    >
      <ClientOnly>
        <EdwardCanvas @pick="onPick" />
      </ClientOnly>

      <div class="edward-mode__scan" aria-hidden="true" />

      <header class="edward-mode__header" aria-live="polite">
        <div class="edward-mode__header-row">
          <div class="edward-mode__brand">
            <span class="edward-mode__session">
              SESSION<span :class="{ 'is-off': !blink }" class="edward-mode__cursor">_</span>
              <span class="edward-mode__uptime">{{ sessionAge }}</span>
            </span>
            <span class="edward-mode__title">EDWARD!! · faces OS</span>
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
            <span class="edward-mode__stat edward-mode__stat--sort">
              <NeoIcon name="sort" :size="12" :stroke="1.75" />
              {{ sortLabel }}
            </span>
          </div>

          <div class="edward-mode__header-actions">
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

      <aside
        v-if="watchCurrent && !selected && !recessed"
        class="edward-mode__watch"
        :class="{ 'is-scrubbing': watchScrubbing }"
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
            {{ watchScrubbing ? 'paused · scrub' : 'watching · live' }}
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

        <div class="edward-mode__watch-film" aria-label="Watch filmstrip">
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

          <button
            type="button"
            class="edward-mode__watch-hero"
            :style="{ '--srv': watchCurrent.accent }"
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
              <span v-if="watchCurrent.host" class="edward-mode__watch-host">{{
                watchCurrent.host
              }}</span>
              <span class="edward-mode__watch-text">{{ watchCurrent.text }}</span>
            </div>
          </button>

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
          trailing · current · ahead · click tile · esc live
        </p>
      </aside>

      <p v-if="error" class="edward-mode__error" role="alert">
        {{ error }}
      </p>

      <div
        v-if="!recessed"
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
            type="button"
            class="edward-mode__explore-sort"
            :aria-label="`Cycle sort, currently ${sortLabel}`"
            @click="cycleSort"
          >
            <NeoIcon name="sort" :size="13" :stroke="1.85" />
            {{ sortLabel }}
          </button>
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
        <div class="edward-mode__explore-chips" role="group" aria-label="Quick filters">
          <button
            v-for="chip in EDWARD_EXPLORE_CHIPS"
            :key="chip.query"
            type="button"
            class="edward-mode__chip"
            :class="{ 'is-on': chipActive(chip.query) }"
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
            v-for="srv in servers.slice(0, 4)"
            :key="srv.token"
            type="button"
            class="edward-mode__chip edward-mode__chip--srv"
            :class="{ 'is-on': chipActive(srv.token) }"
            :style="{ '--srv': srv.accent }"
            :title="srv.host"
            @click="toggleChip(srv.token)"
          >
            <NeoIcon name="globe" :size="11" :stroke="1.75" />
            {{ srv.short }}
          </button>
        </div>
        <p class="edward-mode__explore-crumb" aria-live="polite">
          {{ exploreCrumb }}
          <span class="edward-mode__explore-hint"> · / search · scrub · esc clears</span>
        </p>
      </div>

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
  z-index: calc(var(--neo-z-modal, 1050) + 40);
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
    z-index: calc(var(--neo-z-modal, 1050) - 20);
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

  &:hover,
  &:focus-visible {
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

  &:hover,
  &:focus-visible {
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
  gap: 0.25rem;
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
  bottom: max(7.25rem, calc(env(safe-area-inset-bottom) + 6.5rem));
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

  &:not(:disabled):hover,
  &:not(:disabled):focus-visible {
    background: #59d1e0;
    color: #1a1420;
  }
}

.edward-mode__watch-live {
  border-color: #ff7eb3;
  color: #ff7eb3;
  margin-left: auto;

  &:hover,
  &:focus-visible {
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

  &:hover,
  &:focus-visible {
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
  gap: 0.4rem;
  min-width: 0;
  padding: 0;
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
  object-fit: cover;
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
  border-radius: 3px;
  box-shadow: 4px 4px 0 #ff7eb3;
}

.edward-mode__explore {
  position: absolute;
  bottom: max(0.75rem, env(safe-area-inset-bottom));
  left: 50%;
  z-index: 4;
  transform: translateX(-50%);
  width: min(640px, calc(100vw - 1.5rem));
  padding: 0.55rem 0.65rem 0.45rem;
  border: 2px solid #ffe566;
  border-radius: 4px;
  background: color-mix(in srgb, #12081c 94%, transparent);
  box-shadow:
    4px 4px 0 #ff7eb3,
    0 0 28px color-mix(in srgb, #59d1e0 18%, transparent);
  pointer-events: auto;
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

  &:hover,
  &:focus-visible {
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

  &:hover,
  &:focus-visible {
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
  gap: 0.28rem;
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

  &:hover,
  &:focus-visible {
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
</style>
