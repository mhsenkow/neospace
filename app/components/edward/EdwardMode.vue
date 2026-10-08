<script setup lang="ts">
/**
 * Edward Mode — fullscreen fediverse thought stream overlay.
 */

import { useEdwardStore } from '~/stores/edward'
import { useEdwardStream } from '~/composables/useEdwardStream'
import { EDWARD_LEGEND } from '~/utils/edwardSemantics'
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

const onPick = (identity: string) => {
  edward.selectByIdentity(identity)
}

const closeModal = () => {
  edward.clearSelection()
}

const openThread = () => {
  const status = edward.selectedStatus
  if (!status) return
  const body = status.reblog || status
  const id = body.id
  const url = body.url || body.uri || status.url || status.uri || ''
  edward.exit()
  stream.stop()
  router.push({
    path: `/status/${id}`,
    query: url ? { url } : undefined,
  })
}

const exit = () => {
  visible.value = false
  // brief fade then tear down
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
  void stream.start()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKey, true)
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
      :class="{ 'is-visible': visible }"
      role="dialog"
      aria-modal="true"
      aria-label="Edward mode thought stream"
    >
      <ClientOnly>
        <EdwardCanvas @pick="onPick" />
      </ClientOnly>

      <div class="edward-mode__hud" aria-live="polite">
        <div class="edward-mode__brand">
          <span class="edward-mode__title">edward mode</span>
          <span class="edward-mode__sub">thought stream</span>
        </div>

        <div class="edward-mode__meta">
          <span v-if="loading && !count" class="edward-mode__count">seeding…</span>
          <span v-else class="edward-mode__count">{{ count }} thoughts</span>
          <ul class="edward-mode__legend" aria-label="Legend">
            <li v-for="item in EDWARD_LEGEND" :key="item.kind">
              <i :style="{ background: item.swatch }" />
              {{ item.label }}
            </li>
            <li>
              <i class="edward-mode__legend-ring" />
              poll / reply
            </li>
          </ul>
        </div>

        <button
          type="button"
          class="edward-mode__exit"
          aria-label="Exit edward mode"
          @click="exit"
        >
          exit
        </button>
      </div>

      <p v-if="error" class="edward-mode__error" role="alert">
        {{ error }}
      </p>

      <p class="edward-mode__hint">
        drag to look · scroll to zoom · click a thought
      </p>

      <EdwardPostModal
        v-if="selected"
        :status="selected"
        @close="closeModal"
        @open-thread="openThread"
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
  font-family: var(--neo-font-family-ui, var(--neo-font-family), system-ui, sans-serif);
  color: #d8e4f0;
  pointer-events: auto;

  &.is-visible {
    opacity: 1;
  }
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
    color-mix(in srgb, #05060a 82%, transparent),
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
  gap: 0.15rem;
}

.edward-mode__title {
  font-size: 0.8125rem;
  letter-spacing: 0.14em;
  text-transform: lowercase;
  color: #e8f2fa;
}

.edward-mode__sub {
  font-size: 0.625rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: color-mix(in srgb, #8aa0b8 90%, transparent);
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
  letter-spacing: 0.06em;
  color: color-mix(in srgb, #d8e4f0 70%, transparent);
  font-variant-numeric: tabular-nums;
}

.edward-mode__legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.55rem 0.85rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.625rem;
  letter-spacing: 0.06em;
  text-transform: lowercase;
  color: color-mix(in srgb, #d8e4f0 55%, transparent);

  li {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
}

.edward-mode__legend-ring {
  box-sizing: border-box;
  border: 1.5px solid #f2ad52 !important;
  background: transparent !important;
}

.edward-mode__exit {
  flex-shrink: 0;
  padding: 0.4rem 0.85rem;
  border: 1px solid color-mix(in srgb, #6a90b0 50%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, #0a1018 70%, transparent);
  color: #e2ebf4;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    border-color: #59d1e0;
    color: #fff;
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
  color: #f2ad52;
  background: color-mix(in srgb, #0a1018 88%, transparent);
  border: 1px solid color-mix(in srgb, #f2ad52 40%, transparent);
  border-radius: 2px;
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
  letter-spacing: 0.1em;
  text-transform: lowercase;
  color: color-mix(in srgb, #8aa0b8 75%, transparent);
  pointer-events: none;
  white-space: nowrap;
}
</style>
