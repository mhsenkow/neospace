<script setup lang="ts">
/**
 * Edward Mode — Radical Edward Session OS thought stream.
 */

import { useEdwardStore } from '~/stores/edward'
import { useEdwardStream } from '~/composables/useEdwardStream'
import { EDWARD_FACE_LEGEND } from '~/utils/edwardFaces'
import { statusIdentity } from '~/utils/statusIdentity'
import { stripHtml } from '~/utils/sanitizeHtml'
import {
  EDWARD_EXPLORE_CHIPS,
  EDWARD_EXPLORE_PLACEHOLDERS,
  EDWARD_SORT_LABELS,
  describeEdwardExplore,
  parseEdwardExplore,
} from '~/utils/edwardExplore'
import EdwardCanvas from '~/components/edward/EdwardCanvas.vue'
import EdwardPostModal from '~/components/edward/EdwardPostModal.vue'

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
const focusedStatus = computed(() => {
  const id = edward.focusedIdentity
  if (!id || edward.focusMode === 'off') return null
  return edward.statuses.find((s) => statusIdentity(s) === id) || null
})
const focusLabel = computed(() => {
  if (focusMode.value === 'bar') return 'focus · bar'
  if (focusMode.value === 'square') return 'focus · square'
  return 'focus · off'
})
const sortLabel = computed(
  () => `sort · ${EDWARD_SORT_LABELS[edward.exploreSort]}`,
)

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

  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  if (edward.selectedIdentity) {
    closeModal()
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
  void stream.start()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKey, true)
  document.body.style.overflow = prevOverflow
  if (blinkTimer) clearInterval(blinkTimer)
  if (placeholderTimer) clearInterval(placeholderTimer)
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

      <div class="edward-mode__hud" aria-live="polite">
        <div class="edward-mode__brand">
          <span class="edward-mode__session">
            SESSION<span :class="{ 'is-off': !blink }" class="edward-mode__cursor">_</span>
          </span>
          <span class="edward-mode__title">EDWARD!! · faces OS</span>
          <span class="edward-mode__sub">soap bubbles · smileys · radical net</span>
        </div>

        <div class="edward-mode__meta">
          <span v-if="loading && !count" class="edward-mode__count">hacking feed…</span>
          <span v-else class="edward-mode__count">
            <template v-if="exploreSummary.active">
              {{ exploreSummary.matched }}/{{ exploreSummary.total }}
            </template>
            <template v-else>{{ count }} emoticoins</template>
            <template v-if="sourceCount"> · {{ sourceCount }} srv</template>
          </span>
          <ul class="edward-mode__legend" aria-label="Face legend">
            <li v-for="item in EDWARD_FACE_LEGEND" :key="item.mood">
              <span class="edward-mode__glyph" aria-hidden="true">{{ item.glyph }}</span>
              {{ item.label }}
            </li>
          </ul>
        </div>

        <div class="edward-mode__actions">
          <button
            type="button"
            class="edward-mode__focus-btn"
            :aria-label="`Cycle focus mode, currently ${focusLabel}`"
            @click="cycleFocus"
          >
            {{ focusLabel }}
          </button>
          <button
            type="button"
            class="edward-mode__exit"
            aria-label="Exit edward mode"
            @click="exit"
          >
            logout!!
          </button>
        </div>
      </div>

      <button
        v-if="focusedStatus && !selected && !recessed"
        type="button"
        class="edward-mode__watch"
        @click="openFocused"
      >
        <span class="edward-mode__watch-label">watching</span>
        <strong class="edward-mode__watch-name">
          {{
            (focusedStatus.reblog || focusedStatus).account?.displayName ||
            (focusedStatus.reblog || focusedStatus).account?.acct ||
            'someone'
          }}
        </strong>
        <span class="edward-mode__watch-text">
          {{
            stripHtml((focusedStatus.reblog || focusedStatus).content || '').slice(0, 120) ||
            '···'
          }}
        </span>
      </button>

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
          <span class="edward-mode__explore-prompt" aria-hidden="true">&gt;</span>
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
            {{ sortLabel }}
          </button>
          <button
            v-if="exploreSummary.active"
            type="button"
            class="edward-mode__explore-clear"
            aria-label="Clear explore filters"
            @click="clearExplore"
          >
            clr
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
            {{ chip.label }}
          </button>
        </div>
        <p class="edward-mode__explore-crumb" aria-live="polite">
          {{ exploreCrumb }}
          <span class="edward-mode__explore-hint"> · / to type · esc clears</span>
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

.edward-mode__hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem 1.25rem;
  padding: max(0.85rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
    0.75rem max(1rem, env(safe-area-inset-left));
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, #12081c 88%, transparent),
    transparent
  );
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
}

.edward-mode__brand {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.edward-mode__session {
  font-size: 0.6875rem;
  letter-spacing: 0.22em;
  color: #ff7eb3;
  text-transform: uppercase;
}

.edward-mode__cursor {
  display: inline-block;
  color: #ffe566;

  &.is-off {
    opacity: 0;
  }
}

.edward-mode__title {
  font-size: 1rem;
  letter-spacing: 0.06em;
  text-transform: lowercase;
  color: #ffe566;
  text-shadow: 2px 2px 0 #1a1420;
}

.edward-mode__sub {
  font-size: 0.625rem;
  letter-spacing: 0.1em;
  text-transform: lowercase;
  color: #59d1e0;
}

.edward-mode__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.4rem;
  margin-left: auto;
}

.edward-mode__count {
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  color: #fff8d6;
  font-variant-numeric: tabular-nums;
  border: 1px solid color-mix(in srgb, #ffe566 55%, transparent);
  padding: 0.2rem 0.45rem;
  background: color-mix(in srgb, #1a1420 70%, transparent);
}

.edward-mode__legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.625rem;
  letter-spacing: 0.04em;
  text-transform: lowercase;
  color: color-mix(in srgb, #fff8d6 70%, transparent);
  max-width: min(420px, 70vw);

  li {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
}

.edward-mode__glyph {
  color: #ffe566;
  font-size: 0.7rem;
}

.edward-mode__actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.45rem;
  flex-shrink: 0;
}

.edward-mode__focus-btn,
.edward-mode__exit {
  flex-shrink: 0;
  padding: 0.45rem 0.85rem;
  border: 2px solid #ffe566;
  border-radius: 3px;
  background: #1a1420;
  color: #ffe566;
  font-family: inherit;
  font-size: 0.75rem;
  letter-spacing: 0.1em;
  text-transform: lowercase;
  cursor: pointer;
  box-shadow: 3px 3px 0 #ff7eb3;

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
  border-color: #59d1e0;
  color: #59d1e0;
  box-shadow: 3px 3px 0 #59d1e0;
}

.edward-mode__watch {
  position: absolute;
  left: max(1rem, env(safe-area-inset-left));
  bottom: max(7.5rem, calc(env(safe-area-inset-bottom) + 6.75rem));
  z-index: 3;
  width: min(320px, calc(100vw - 2rem));
  padding: 0.65rem 0.85rem;
  text-align: left;
  border: 2px solid #ffe566;
  border-radius: 4px;
  background: color-mix(in srgb, #12081c 92%, transparent);
  color: #fff8d6;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 4px 4px 0 #ff7eb3;

  &:hover,
  &:focus-visible {
    background: #1a1420;
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 2px;
  }
}

.edward-mode__watch-label {
  display: block;
  font-size: 0.625rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #ff7eb3;
  margin-bottom: 0.2rem;
}

.edward-mode__watch-name {
  display: block;
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
  color: #ffe566;
}

.edward-mode__watch-text {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 0.75rem;
  line-height: 1.35;
  color: color-mix(in srgb, #fff8d6 85%, transparent);
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
  flex-shrink: 0;
  color: #ff7eb3;
  font-size: 0.9rem;
  font-weight: 700;
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
