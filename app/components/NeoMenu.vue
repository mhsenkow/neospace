<script setup lang="ts">
/**
 * Accessible menu button + popup (APG menu pattern, lightweight).
 * Optional teleport + placement for clipped parents (e.g. sidebar).
 * `sheet`: mobile bottom-sheet (backdrop + slide-up) for dense pickers like Add Feed.
 */

import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { typeaheadMatch } from '~/utils/typeahead'

const props = withDefaults(
  defineProps<{
    label: string
    align?: 'start' | 'end'
    /** Render panel in body with fixed position (avoids overflow clipping). */
    teleport?: boolean
    /** Where the panel opens relative to the trigger when teleporting. */
    placement?: 'bottom' | 'end'
    /** Extra class on the panel (needed when teleported — parent :deep() no longer reaches it). */
    panelClass?: string
    /**
     * Bottom-sheet presentation (mobile Add Feed, etc.).
     * Uses a backdrop + max-height panel; always teleports.
     */
    sheet?: boolean
  }>(),
  { align: 'end', teleport: false, placement: 'bottom', sheet: false },
)

/** Optional controlled open state for parents that style from it */
const open = defineModel<boolean>('open', { default: false })
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const menuId = `neo-menu-${Math.random().toString(36).slice(2, 9)}`
const usePortal = computed(() => props.teleport || props.sheet)

const ITEM_SEL =
  '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), [role="menuitemradio"]:not([disabled]), button:not([disabled]), input:not([disabled]):not([type="hidden"])'

/** Filter fields inside a menu keep their own caret keys (Home/End/arrows within text) */
function isTextField(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)
}

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

function updatePanelPos(remeasure = true) {
  if (!usePortal.value || props.sheet || !triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const base =
    props.placement === 'end'
      ? { left: rect.right + 6, top: rect.top, minWidth: '12.5rem' }
      : { left: rect.left, top: rect.bottom + 4, minWidth: `${Math.max(Math.round(rect.width), 180)}px` }

  // Clamp in the same pass (no raw-then-corrected flicker while scrolling).
  // The panel is display:none on the first open, so measure again after render.
  const panel = menuRef.value
  const w = panel?.offsetWidth || 0
  const h = panel?.offsetHeight || 0
  const margin = 8
  let { left, top } = base
  if (w && left + w > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - w - margin)
  }
  // Flip above the trigger when there's no room below (and there is above)
  if (h && top + h > window.innerHeight - margin && rect.top - h - 4 >= margin) {
    top = rect.top - h - 4
  }
  panelStyle.value = {
    position: 'fixed',
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    minWidth: base.minWidth,
    // Popover tier: teleported panels may open from inside modals (followers list)
    zIndex: 'var(--neo-z-popover, 1060)',
  }
  if ((!w || !h) && remeasure) void nextTick(() => open.value && updatePanelPos(false))
}

async function onOpen() {
  if (usePortal.value && !props.sheet) updatePanelPos()
  await nextTick()
  const list = items()
  // Prefer filter input when present (Add Feed groups), else first item
  const filter = menuRef.value?.querySelector<HTMLElement>('input[type="search"], input:not([type="hidden"])')
  ;(filter || list[0])?.focus({ preventScroll: true })
}

watch(open, (v) => {
  if (v) void onOpen()
}, { flush: 'post' })

watch(
  () => props.placement,
  () => {
    if (open.value && usePortal.value && !props.sheet) updatePanelPos()
  },
)

/** Close after choosing an item — not on filter/section chrome clicks */
function onPanelClick(e: MouseEvent) {
  const el = e.target as HTMLElement | null
  if (el?.closest?.('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')) close()
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

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Focus the tabbable element before/after the trigger (within an open modal, if any). */
function focusPastTrigger(step: 1 | -1) {
  const trigger = triggerRef.value
  if (!trigger) return
  const scope = trigger.closest<HTMLElement>('[aria-modal="true"]') || document.body
  const menu = menuRef.value
  const list = Array.from(scope.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => !(menu && menu.contains(el)) && el.getClientRects().length > 0,
  )
  const i = list.indexOf(trigger)
  const target = i < 0 ? trigger : list[(i + step + list.length) % list.length]
  ;(target ?? trigger).focus()
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
  // APG menu: Tab closes the menu and moves on from the *trigger*. Done by hand:
  // a teleported panel sits at the end of <body>, so the browser's own Tab would
  // continue from there (wrapping behind modals) instead of from the trigger.
  if (e.key === 'Tab') {
    e.preventDefault()
    open.value = false
    focusPastTrigger(e.shiftKey ? -1 : 1)
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
  if (isTextField(e.target)) return
  if (e.key === 'Home') {
    e.preventDefault()
    list[0]?.focus()
    return
  }
  if (e.key === 'End') {
    e.preventDefault()
    list[list.length - 1]?.focus()
    return
  }
  // APG typeahead: printable keys jump to the next item starting with them
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
    typeBuffer += e.key
    if (typeTimer) clearTimeout(typeTimer)
    typeTimer = setTimeout(() => {
      typeBuffer = ''
      typeTimer = null
    }, 500)
    const hit = typeaheadMatch(
      list.map((el) => el.textContent || el.getAttribute('aria-label') || ''),
      typeBuffer,
      i,
    )
    if (hit >= 0) {
      e.preventDefault()
      list[hit]?.focus()
    }
  }
}

let typeBuffer = ''
let typeTimer: ReturnType<typeof setTimeout> | null = null

/** Focus left for something outside (screen-reader cursor, programmatic focus) — close */
function onMenuFocusOut(e: FocusEvent) {
  if (!open.value) return
  const next = e.relatedTarget
  // null = focus went nowhere yet (Safari click on a non-focusable spot) — keep open
  if (!(next instanceof Node)) return
  if (rootRef.value?.contains(next) || menuRef.value?.contains(next)) return
  close(false)
}

function onDocPointer(e: MouseEvent | PointerEvent) {
  if (!open.value || props.sheet) return
  const root = rootRef.value
  const menu = menuRef.value
  const t = e.target as Node
  if ((root && root.contains(t)) || (menu && menu.contains(t))) return
  close(false)
}

function onScrollOrResize() {
  if (open.value && usePortal.value && !props.sheet) updatePanelPos()
}

function onBodyScrollLock(on: boolean) {
  if (!props.sheet || typeof document === 'undefined') return
  document.documentElement.classList.toggle('neo-menu-sheet-open', on)
}

// Global listeners only while open — every post card has a menu, so binding
// them at mount meant thousands of capture handlers on each scroll / tap.
let listening = false
function listen(on: boolean) {
  if (on === listening) return
  listening = on
  if (on) {
    document.addEventListener('pointerdown', onDocPointer, true)
    if (usePortal.value && !props.sheet) {
      window.addEventListener('scroll', onScrollOrResize, true)
      window.addEventListener('resize', onScrollOrResize)
    }
  } else {
    document.removeEventListener('pointerdown', onDocPointer, true)
    window.removeEventListener('scroll', onScrollOrResize, true)
    window.removeEventListener('resize', onScrollOrResize)
  }
}

watch(open, (v) => {
  listen(v)
  onBodyScrollLock(v && props.sheet)
}, { immediate: true })
onUnmounted(() => {
  listen(false)
  onBodyScrollLock(false)
  if (typeTimer) clearTimeout(typeTimer)
})

defineExpose({ open, close, toggle })
</script>

<template>
  <div
    ref="rootRef"
    class="neo-menu"
    :class="[
      `neo-menu--align-${align}`,
      {
        'neo-menu--open': open,
        'neo-menu--teleport': usePortal,
        'neo-menu--sheet': sheet,
      },
    ]"
  >
    <button
      ref="triggerRef"
      type="button"
      class="neo-menu__trigger"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="menuId"
      :aria-haspopup="sheet ? 'dialog' : 'menu'"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <slot />
    </button>
    <Teleport to="body" :disabled="!usePortal">
      <div
        v-if="sheet && open"
        class="neo-menu__sheet-root"
        role="presentation"
      >
        <button
          type="button"
          class="neo-menu__sheet-backdrop"
          tabindex="-1"
          aria-hidden="true"
          @click="close(false)"
        />
        <div
          :id="menuId"
          ref="menuRef"
          class="neo-menu__panel neo-menu__panel--sheet"
          :class="panelClass"
          role="menu"
          :aria-label="label"
          @keydown="onMenuKeydown"
          @click="onPanelClick"
        >
          <div class="neo-menu__sheet-handle" aria-hidden="true" />
          <slot name="items" />
        </div>
      </div>
      <div
        v-else-if="!sheet"
        v-show="open"
        :id="menuId"
        ref="menuRef"
        class="neo-menu__panel"
        :class="[{ 'neo-menu__panel--portal': usePortal }, panelClass]"
        role="menu"
        :aria-label="label"
        :style="usePortal ? panelStyle : undefined"
        @keydown="onMenuKeydown"
        @focusout="onMenuFocusOut"
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

.neo-menu--align-start .neo-menu__panel:not(.neo-menu__panel--portal):not(.neo-menu__panel--sheet) {
  left: 0;
  right: auto;
}

.neo-menu--align-end .neo-menu__panel:not(.neo-menu__panel--portal):not(.neo-menu__panel--sheet) {
  right: 0;
  left: auto;
}

.neo-menu__sheet-root {
  position: fixed;
  inset: 0;
  z-index: var(--neo-z-popover, 1060);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  box-sizing: border-box;
  animation: neo-menu-sheet-in 160ms ease-out;
}

.neo-menu__sheet-backdrop {
  position: absolute;
  inset: 0;
  border: none;
  padding: 0;
  margin: 0;
  background: var(--neo-bg-overlay, rgba(0, 0, 0, 0.45));
  cursor: pointer;
}

.neo-menu__panel--sheet {
  position: relative;
  top: auto;
  left: auto;
  right: auto;
  width: 100%;
  max-width: 100%;
  max-height: min(78dvh, 36rem);
  margin: 0;
  padding: 0.35rem 0.65rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
  border: none;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.18);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  background: var(--neo-bg-secondary, var(--neo-bg-card));
}

.neo-menu__sheet-handle {
  width: 36px;
  height: 4px;
  margin: 0.2rem auto 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--neo-text-muted) 45%, transparent);
}

@keyframes neo-menu-sheet-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .neo-menu__sheet-root {
    animation: none;
  }
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

  @media (hover: hover) {
    &:hover {
      background: var(--neo-bg-hover, var(--neo-bg-tertiary));
    }
  }

  // Background tint alone is ~1.2:1 — keep a real ring for keyboard users
  &:focus-visible {
    background: var(--neo-bg-hover, var(--neo-bg-tertiary));
    outline: 2px solid var(--neo-focus, var(--neo-accent));
    outline-offset: -2px;
  }
}

/* Sheet: larger touch targets */
.neo-menu__panel--sheet :deep([role='menuitem']),
.neo-menu__panel--sheet :deep(button.add-column-menu__item),
.neo-menu__panel--sheet :deep(button.add-column-menu__section-toggle) {
  min-height: 44px;
  padding: 0.65rem 0.85rem;
  font-size: 0.9375rem;
  touch-action: manipulation;
}
</style>

<style lang="scss">
html.neo-menu-sheet-open {
  overflow: hidden;
}
</style>
