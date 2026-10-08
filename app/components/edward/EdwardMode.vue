<script setup lang="ts">
/**
 * Edward Mode — Radical Edward Session OS thought stream.
 */

import { useEdwardStore } from '~/stores/edward'
import { useEdwardStream } from '~/composables/useEdwardStream'
import { EDWARD_FACE_LEGEND } from '~/utils/edwardFaces'
import EdwardCanvas from '~/components/edward/EdwardCanvas.vue'
import EdwardPostModal from '~/components/edward/EdwardPostModal.vue'

const edward = useEdwardStore()
const stream = useEdwardStream()
const router = useRouter()
const rootEl = ref<HTMLElement | null>(null)
const visible = ref(false)

const selected = computed(() => edward.selectedStatus)
const count = computed(() => edward.ballCount)
const loading = computed(() => edward.loading)
const error = computed(() => edward.error)
const recessed = computed(() => edward.recessed)
const sourceCount = computed(() => edward.sourceCount)

const blink = ref(true)
let blinkTimer: ReturnType<typeof setInterval> | null = null

const onPick = (identity: string) => {
  edward.selectByIdentity(identity)
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
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  if (edward.selectedIdentity) {
    closeModal()
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
  void stream.start()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKey, true)
  document.body.style.overflow = prevOverflow
  if (blinkTimer) clearInterval(blinkTimer)
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
          <span class="edward-mode__title">edward · faces OS</span>
          <span class="edward-mode__sub">WOW!! net · thought stream · radical</span>
        </div>

        <div class="edward-mode__meta">
          <span v-if="loading && !count" class="edward-mode__count">hacking feed…</span>
          <span v-else class="edward-mode__count">
            {{ count }} emoticoins
            <template v-if="sourceCount"> · {{ sourceCount }} srv</template>
          </span>
          <ul class="edward-mode__legend" aria-label="Face legend">
            <li v-for="item in EDWARD_FACE_LEGEND" :key="item.mood">
              <span class="edward-mode__glyph" aria-hidden="true">{{ item.glyph }}</span>
              {{ item.label }}
            </li>
          </ul>
        </div>

        <button
          type="button"
          class="edward-mode__exit"
          aria-label="Exit edward mode"
          @click="exit"
        >
          logout!!
        </button>
      </div>

      <p v-if="error" class="edward-mode__error" role="alert">
        {{ error }}
      </p>

      <p class="edward-mode__hint">
        ↑ rises · hover · click!! heart · reply · follow
      </p>

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

.edward-mode__hint {
  position: absolute;
  bottom: max(1rem, env(safe-area-inset-bottom));
  left: 50%;
  z-index: 3;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.35rem 0.75rem;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: lowercase;
  color: #59d1e0;
  pointer-events: none;
  white-space: nowrap;
  border: 1px dashed color-mix(in srgb, #59d1e0 50%, transparent);
  background: color-mix(in srgb, #12081c 75%, transparent);
}
</style>
