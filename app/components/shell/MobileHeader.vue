<script setup lang="ts">
import { usePhoneLandscape, useSidebarShell } from '~/composables/useBreakpoint'
import { useColumnsStore, isTimelineFeed } from '~/stores/columns'
import { useActiveBoardColumnId } from '~/composables/useBoardNav'

const open = defineModel<boolean>('open', { default: false })

const { boardPortal } = useBoardPortal()
const { goHome } = useBoardNav()
const route = useRoute()
const isPhoneLandscape = usePhoneLandscape()
const isSidebarShell = useSidebarShell()
const columnsStore = useColumnsStore()
const activeBoardColumnId = useActiveBoardColumnId()

const toggleMenu = () => {
  open.value = !open.value
}

/** Hidden in phone landscape (rail owns menu/search) and tablet+ (sidebar). */
const visible = computed(() => !isPhoneLandscape.value && !isSidebarShell.value)

const activeBoardColumn = computed(() => {
  const id = activeBoardColumnId.value || columnsStore.focusedColumnId
  if (id) {
    const match = columnsStore.columns.find((c) => c.id === id)
    if (match) return match
  }
  return columnsStore.columns[0] || null
})

const showModeSwitch = computed(
  () =>
    route.path === '/' &&
    !boardPortal.value &&
    !!activeBoardColumn.value &&
    isTimelineFeed(activeBoardColumn.value.feedType),
)

const flickOn = computed(() => activeBoardColumn.value?.viewMode === 'flip')

const setViewMode = (mode: 'flow' | 'flip') => {
  const col = activeBoardColumn.value
  if (!col || !isTimelineFeed(col.feedType)) return
  columnsStore.setColumnViewMode(col.id, mode)
}
</script>

<template>
<!-- Menu + mark + Feed|Flick (when a timeline is in view) -->
<header v-if="visible" class="mobile-header">
  <button
    class="mobile-header__btn"
    :class="{ 'chrome-hint': boardPortal === 'settings' || boardPortal === 'communities' }"
    @click="toggleMenu"
    aria-label="Menu"
    type="button"
    :aria-expanded="open"
    aria-controls="mobile-sidebar"
  >
    <NeoIcon name="menu" :size="20" :stroke="1.75" />
  </button>
  <NuxtLink
    to="/"
    class="mobile-header__logo"
    aria-label="NeoSpace home"
    @click="void goHome()"
  >
    <NeoMark :show-brand="false" :active="route.path === '/'" />
  </NuxtLink>
  <div
    v-if="showModeSwitch"
    class="mobile-header__mode"
    role="group"
    aria-label="How to move through this feed"
  >
    <button
      type="button"
      class="mobile-header__mode-opt"
      :class="{ 'is-on': !flickOn }"
      :aria-pressed="!flickOn"
      title="Feed — scroll a list"
      @click="setViewMode('flow')"
    >
      Feed
    </button>
    <button
      type="button"
      class="mobile-header__mode-opt"
      :class="{ 'is-on': flickOn }"
      :aria-pressed="flickOn"
      title="Flick — one post at a time"
      @click="setViewMode('flip')"
    >
      Flick
    </button>
  </div>
  <span v-else class="mobile-header__spacer" aria-hidden="true" />
</header>
</template>

<style lang="scss" scoped>
.mobile-header {
  // In-flow flex child of .neo-layout — fixed + overflow:hidden parent clips on iOS
  position: relative;
  flex-shrink: 0;
  width: 100%;
  height: calc(40px + var(--neo-safe-top, env(safe-area-inset-top, 0px)));
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--neo-safe-top, env(safe-area-inset-top, 0px)) max(0.35rem, env(safe-area-inset-right, 0px)) 0
    max(0.35rem, env(safe-area-inset-left, 0px));
  background: var(--neo-bg-primary);
  border-bottom: none;
  z-index: var(--neo-z-shell-header, 90);
  box-sizing: border-box;

  @media (min-width: 768px) {
    display: none;
  }

  @media (max-height: 500px) and (orientation: landscape) and (max-width: 1023px) {
    display: none;
  }

  &__spacer {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }

  &__btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--neo-text-primary);
    cursor: pointer;
    border-radius: var(--neo-radius-sm, 4px);
    text-decoration: none;
    transition: background-color var(--neo-transition-fast), color var(--neo-transition-fast);

    @media (hover: hover) {
      &:hover {
        background: var(--neo-bg-hover);
      }
    }

    &:active {
      background: var(--neo-bg-hover);
    }
  }

  &__logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    color: inherit;
    padding: 0 0.15rem;
    border-radius: var(--neo-radius-sm, 4px);
    position: absolute;
    left: 50%;
    transform: translateX(-50%);

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
    }

    :deep(.neo-mark__glyph) {
      width: 1.5rem;
      height: 1.5rem;
      font-size: 0.625rem;
    }
  }

  &__mode {
    display: grid;
    grid-template-columns: 1fr 1fr;
    flex-shrink: 0;
    gap: 0.12rem;
    margin-right: 0.1rem;
    padding: 0.12rem;
    border-radius: 8px;
    background: var(--neo-bg-tertiary);
  }

  &__mode-opt {
    min-width: 2.75rem;
    min-height: 28px;
    padding: 0 0.45rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--neo-text-tertiary);
    font: inherit;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    &.is-on {
      background: var(--neo-bg-primary);
      color: var(--neo-text-primary);
      box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--neo-accent) 70%, transparent);
    }

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 1px;
    }
  }
}
</style>
