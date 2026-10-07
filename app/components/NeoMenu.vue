<script setup lang="ts">
/**
 * Accessible menu button + popup (APG menu pattern, lightweight).
 * Optional teleport + placement for clipped parents (e.g. sidebar).
 */

import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    align?: 'start' | 'end'
    /** Render panel in body with fixed position (avoids overflow clipping). */
    teleport?: boolean
    /** Where the panel opens relative to the trigger when teleporting. */
    placement?: 'bottom' | 'end'
  }>(),
  { align: 'end', teleport: false, placement: 'bottom' },
)

/** Optional controlled open state for parents that style from it */
const open = defineModel<boolean>('open', { default: false })
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const menuId = `neo-menu-${Math.random().toString(36).slice(2, 9)}`

const ITEM_SEL =
  '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), [role="menuitemradio"]:not([disabled]), button:not([disabled])'

function items(): HTMLElement[] {
  const menu = menuRef.value
  if (!menu) return []
  return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SEL))
}

function close(restore = true) {
  if (!open.value) return
  open.value = false
  if (restore) {
    nextTick(() => triggerRef.value?.focus())
  }
}

function toggle() {
  open.value = !open.value
}

function updatePanelPos() {
  if (!props.teleport || !triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  if (props.placement === 'end') {
    panelStyle.value = {
      position: 'fixed',
      left: `${Math.round(rect.right + 6)}px`,
      top: `${Math.round(rect.top)}px`,
      minWidth: '12.5rem',
      zIndex: 'var(--neo-z-dropdown, 1000)',
    }
  } else {
    panelStyle.value = {
      position: 'fixed',
      left: `${Math.round(rect.left)}px`,
      top: `${Math.round(rect.bottom + 4)}px`,
      minWidth: `${Math.max(Math.round(rect.width), 180)}px`,
      zIndex: 'var(--neo-z-dropdown, 1000)',
    }
  }
}

async function onOpen() {
  if (props.teleport) updatePanelPos()
  await nextTick()
  const list = items()
  list[0]?.focus({ preventScroll: true })
}

watch(open, (v) => {
  if (v) void onOpen()
})

watch(
  () => props.placement,
  () => {
    if (open.value && props.teleport) updatePanelPos()
  },
)

/** Close after choosing an item — not on filter/section chrome clicks */
function onPanelClick(e: MouseEvent) {
  const el = e.target as HTMLElement | null
  if (el?.closest?.('[role="menuitem"]')) close()
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    open.value = true
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    open.value = true
    nextTick(() => {
      const list = items()
      list[list.length - 1]?.focus()
    })
  }
}

function onMenuKeydown(e: KeyboardEvent) {
  const list = items()
  if (!list.length) return
  const i = list.indexOf(document.activeElement as HTMLElement)

  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = list[(i + 1) % list.length]
    next?.focus()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    const prev = list[(i - 1 + list.length) % list.length]
    prev?.focus()
    return
  }
  if (e.key === 'Home') {
    e.preventDefault()
    list[0]?.focus()
    return
  }
  if (e.key === 'End') {
    e.preventDefault()
    list[list.length - 1]?.focus()
  }
}

function onDocPointer(e: MouseEvent | PointerEvent) {
  if (!open.value) return
  const root = rootRef.value
  const menu = menuRef.value
  const t = e.target as Node
  if ((root && root.contains(t)) || (menu && menu.contains(t))) return
  close(false)
}

function onScrollOrResize() {
  if (open.value && props.teleport) updatePanelPos()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
})

defineExpose({ open, close, toggle })
</script>

<template>
  <div
    ref="rootRef"
    class="neo-menu"
    :class="[`neo-menu--align-${align}`, { 'neo-menu--open': open, 'neo-menu--teleport': teleport }]"
  >
    <button
      ref="triggerRef"
      type="button"
      class="neo-menu__trigger"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="menuId"
      aria-haspopup="menu"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <slot />
    </button>
    <Teleport to="body" :disabled="!teleport">
      <div
        v-show="open"
        :id="menuId"
        ref="menuRef"
        class="neo-menu__panel"
        :class="{ 'neo-menu__panel--portal': teleport }"
        role="menu"
        :aria-label="label"
        :style="teleport ? panelStyle : undefined"
        @keydown="onMenuKeydown"
        @click="onPanelClick"
      >
        <slot name="items" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.neo-menu {
  position: relative;
  display: inline-flex;
}

/* Sit above sibling columns so menu items stay clickable */
.neo-menu--open {
  z-index: var(--neo-z-dropdown, 1000);
}

.neo-menu__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: var(--neo-radius-chrome, var(--neo-radius-sm));
  font: inherit;
}

.neo-menu__panel {
  position: absolute;
  top: calc(100% + 4px);
  z-index: var(--neo-z-dropdown);
  min-width: 10rem;
  padding: var(--neo-spacing-2, 0.25rem);
  background: var(--neo-bg-card, var(--neo-bg-primary));
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md, var(--neo-radius-sm));
  box-shadow: var(--neo-chrome-card-shadow, 0 8px 24px rgba(0, 0, 0, 0.12));
}

.neo-menu__panel--portal {
  position: fixed;
  top: auto;
}

.neo-menu--align-start .neo-menu__panel:not(.neo-menu__panel--portal) {
  left: 0;
  right: auto;
}

.neo-menu--align-end .neo-menu__panel:not(.neo-menu__panel--portal) {
  right: 0;
  left: auto;
}

.neo-menu__panel :deep([role='menuitem']),
.neo-menu__panel :deep(button) {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--neo-spacing-2, 0.35rem);
  padding: var(--neo-spacing-3, 0.5rem) var(--neo-spacing-4, 0.75rem);
  border: none;
  border-radius: var(--neo-radius-chrome, var(--neo-radius-sm));
  background: transparent;
  color: var(--neo-text-primary);
  font: inherit;
  font-size: var(--neo-font-size-sm);
  text-align: left;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--neo-bg-hover, var(--neo-bg-tertiary));
    outline: none;
  }
}
</style>
