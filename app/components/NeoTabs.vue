<script setup lang="ts">
/**
 * APG tabs: tablist / tab / tabpanel with arrow-key navigation.
 */

import { computed, ref, watch } from 'vue'

export type NeoTab = { id: string; label: string }

const props = withDefaults(
  defineProps<{
    tabs: NeoTab[]
    modelValue: string
    /** When false, only the tablist is rendered (parent owns the panel). */
    panels?: boolean
    /** External panel id when `panels` is false (for aria-controls). */
    controlsId?: string
  }>(),
  { panels: true },
)

const emit = defineEmits<{
  'update:modelValue': [id: string]
}>()

const listRef = ref<HTMLElement | null>(null)
const uid = `neo-tabs-${Math.random().toString(36).slice(2, 9)}`

const activeId = computed(() => {
  if (props.tabs.some((t) => t.id === props.modelValue)) return props.modelValue
  return props.tabs[0]?.id ?? ''
})

function select(id: string) {
  if (id === props.modelValue) return
  emit('update:modelValue', id)
}

function tabId(id: string) {
  return `${uid}-tab-${id}`
}

function panelId(id: string) {
  return `${uid}-panel-${id}`
}

function onTabKeydown(e: KeyboardEvent, index: number) {
  const n = props.tabs.length
  if (!n) return
  let next = index
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    next = (index + 1) % n
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
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
    <div ref="listRef" class="neo-tabs__list" role="tablist">
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
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--neo-border-color);
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
  transition: color var(--neo-transition-fast, 100ms), background-color var(--neo-transition-fast, 100ms);

  &[aria-selected='true'] {
    color: var(--neo-text-primary);
    box-shadow: inset 0 -2px 0 var(--neo-accent);
  }

  &:hover {
    color: var(--neo-text-secondary);
    background: var(--neo-bg-hover, var(--neo-bg-tertiary));
  }
}

.neo-tabs__panel {
  padding-top: var(--neo-spacing-4, 0.75rem);
  outline: none;
}
</style>
