<script setup lang="ts">
/**
 * APG tabs: tablist / tab / tabpanel with arrow-key navigation.
 * Gliding underline indicator driven by measured active tab bounds.
 */

import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'

export type NeoTab = { id: string; label: string }

const props = withDefaults(
  defineProps<{
    tabs: NeoTab[]
    modelValue: string
    /** When false, only the tablist is rendered (parent owns the panel). */
    panels?: boolean
    /** External panel id when `panels` is false (for aria-controls). */
    controlsId?: string
    /** Accessible name for the tablist ("Notification filter", …). */
    ariaLabel?: string
    /**
     * Stable id prefix — lets a parent-owned panel (`panels: false`) point
     * `aria-labelledby` at `${idPrefix}-tab-${activeId}`.
     */
    idPrefix?: string
    /** Sliding underline under the active tab (off for pill/chip strips). */
    indicator?: boolean
  }>(),
  { panels: true, indicator: true },
)

const emit = defineEmits<{
  'update:modelValue': [id: string]
}>()

const listRef = ref<HTMLElement | null>(null)
const uid = props.idPrefix || `neo-tabs-${useId()}`
const indicator = ref({ left: 0, width: 0, ready: false })

const activeId = computed(() => {
  if (props.tabs.some((t) => t.id === props.modelValue)) return props.modelValue
  return props.tabs[0]?.id ?? ''
})

const indicatorStyle = computed(() => ({
  transform: `translateX(${indicator.value.left}px)`,
  width: `${indicator.value.width}px`,
  opacity: indicator.value.ready ? 1 : 0,
}))

function select(id: string) {
  // Always emit — parents may need to re-scroll / re-park even when the
  // selected id is unchanged (Android carousel desync recovery).
  emit('update:modelValue', id)
}

function tabId(id: string) {
  return `${uid}-tab-${id}`
}

function panelId(id: string) {
  return `${uid}-panel-${id}`
}

function measureIndicator() {
  const list = listRef.value
  if (!list) return
  const el = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  if (!el) {
    indicator.value = { left: 0, width: 0, ready: false }
    return
  }
  // offsetLeft is relative to the list; abspos children scroll with the strip
  indicator.value = {
    left: el.offsetLeft,
    width: el.offsetWidth,
    ready: true,
  }
}

function onTabKeydown(e: KeyboardEvent, index: number) {
  const n = props.tabs.length
  if (!n) return
  let next = index
  // Under dir="rtl" the tab strip runs right-to-left, so ArrowRight steps backwards
  const rtl = !!listRef.value && getComputedStyle(listRef.value).direction === 'rtl'
  const forwardKey = rtl ? 'ArrowLeft' : 'ArrowRight'
  const backwardKey = rtl ? 'ArrowRight' : 'ArrowLeft'
  if (e.key === forwardKey || e.key === 'ArrowDown') {
    e.preventDefault()
    next = (index + 1) % n
  } else if (e.key === backwardKey || e.key === 'ArrowUp') {
    e.preventDefault()
    next = (index - 1 + n) % n
  } else if (e.key === 'Home') {
    e.preventDefault()
    next = 0
  } else if (e.key === 'End') {
    e.preventDefault()
    next = n - 1
  } else {
    return
  }
  const tab = props.tabs[next]
  if (!tab) return
  select(tab.id)
  const el = listRef.value?.querySelector<HTMLElement>(`#${CSS.escape(tabId(tab.id))}`)
  el?.focus()
}

/** Narrow screens scroll the tab strip — keep the selected tab in view (no page scroll) */
function revealActive() {
  const list = listRef.value
  if (!list || list.scrollWidth <= list.clientWidth) return
  const el = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  if (!el) return
  const left = el.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft
  if (left < list.scrollLeft) list.scrollLeft = left
  else if (left + el.offsetWidth > list.scrollLeft + list.clientWidth) {
    list.scrollLeft = left + el.offsetWidth - list.clientWidth
  }
}

function syncChrome() {
  revealActive()
  measureIndicator()
}

onMounted(() => {
  syncChrome()
  listRef.value?.addEventListener('scroll', measureIndicator, { passive: true })
  window.addEventListener('resize', measureIndicator)
})

onUnmounted(() => {
  listRef.value?.removeEventListener('scroll', measureIndicator)
  window.removeEventListener('resize', measureIndicator)
})

watch(activeId, () => nextTick(syncChrome))
watch(
  () => props.tabs.map((t) => `${t.id}:${t.label}`).join('|'),
  () => nextTick(syncChrome),
)

watch(
  () => props.tabs,
  (tabs) => {
    if (!tabs.length) return
    if (!tabs.some((t) => t.id === props.modelValue)) {
      emit('update:modelValue', tabs[0]!.id)
    }
  },
)
</script>

<template>
  <div class="neo-tabs">
    <div ref="listRef" class="neo-tabs__list" role="tablist" :aria-label="ariaLabel">
      <button
        v-for="(tab, i) in tabs"
        :id="tabId(tab.id)"
        :key="tab.id"
        type="button"
        class="neo-tabs__tab"
        role="tab"
        :aria-selected="tab.id === activeId"
        :aria-controls="panels ? panelId(tab.id) : controlsId"
        :tabindex="tab.id === activeId ? 0 : -1"
        @click="select(tab.id)"
        @keydown="onTabKeydown($event, i)"
      >
        {{ tab.label }}
      </button>
      <span
        v-if="indicator"
        class="neo-tabs__indicator"
        aria-hidden="true"
        :style="indicatorStyle"
      />
    </div>
    <template v-if="panels">
      <div
        v-for="tab in tabs"
        v-show="tab.id === activeId"
        :id="panelId(tab.id)"
        :key="`panel-${tab.id}`"
        class="neo-tabs__panel"
        role="tabpanel"
        :aria-labelledby="tabId(tab.id)"
        tabindex="0"
      >
        <slot :name="tab.id" :active="tab.id === activeId" />
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.neo-tabs__list {
  position: relative;
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--neo-border-color);
  // Many tabs scroll instead of overflowing the container (revealActive keeps the selected one in view)
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.neo-tabs__indicator {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  border-radius: 1px 1px 0 0;
  background: var(--neo-accent);
  pointer-events: none;
  transition:
    transform var(--neo-dur-normal, 240ms) var(--neo-ease-in-out),
    width var(--neo-dur-normal, 240ms) var(--neo-ease-in-out),
    opacity var(--neo-dur-quick, 160ms) var(--neo-ease-out);
}

.neo-tabs__tab {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--neo-text-tertiary);
  font-family: var(--neo-font-family-ui, inherit);
  font-size: var(--neo-font-size-sm);
  font-weight: var(--neo-font-weight-medium, 500);
  padding: var(--neo-spacing-3, 0.5rem) var(--neo-spacing-4, 0.75rem);
  cursor: pointer;
  border-radius: var(--neo-radius-chrome, var(--neo-radius-sm))
    var(--neo-radius-chrome, var(--neo-radius-sm)) 0 0;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    color var(--neo-transition-fast, 100ms),
    background-color var(--neo-transition-fast, 100ms),
    transform var(--neo-dur-instant, 90ms) var(--neo-ease-spring);

  &[aria-selected='true'] {
    color: var(--neo-text-primary);
    // Sliding indicator owns the underline
    box-shadow: none;
  }

  &:hover {
    // Hover must not lower contrast — secondary is lighter than the resting tertiary
    color: var(--neo-text-primary);
    background: var(--neo-bg-hover, var(--neo-bg-tertiary));
  }

  &:active {
    transform: scale(0.97);
  }
}

.neo-tabs__panel {
  padding-top: var(--neo-spacing-4, 0.75rem);
  outline: none;
  animation: neo-tab-panel-in var(--neo-dur-normal, 240ms) var(--neo-ease-out) both;

  // Panels are a Tab stop — keep keyboard focus visible
  &:focus-visible {
    outline: 2px solid var(--neo-focus, var(--neo-accent));
    outline-offset: 2px;
  }
}

@keyframes neo-tab-panel-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .neo-tabs__indicator {
    transition: none;
  }

  .neo-tabs__panel {
    animation: none;
  }
}
</style>
