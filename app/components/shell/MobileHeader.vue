<script setup lang="ts">
import { usePhoneLandscape, useSidebarShell } from '~/composables/useBreakpoint'

const open = defineModel<boolean>('open', { default: false })

const { boardPortal } = useBoardPortal()
const { goHome } = useBoardNav()
const route = useRoute()
const isPhoneLandscape = usePhoneLandscape()
const isSidebarShell = useSidebarShell()

const toggleMenu = () => {
  open.value = !open.value
}

/** Hidden in phone landscape (rail owns menu/search) and tablet+ (sidebar). */
const visible = computed(() => !isPhoneLandscape.value && !isSidebarShell.value)
</script>

<template>
<!-- Threads-clean top: menu + mark only. Search lives in the bottom tab bar. -->
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
  <span class="mobile-header__spacer" aria-hidden="true" />
</header>
</template>

<style lang="scss" scoped>
.mobile-header {
  // In-flow flex child of .neo-layout — fixed + overflow:hidden parent clips on iOS
  position: relative;
  flex-shrink: 0;
  width: 100%;
  height: calc(44px + var(--neo-safe-top, env(safe-area-inset-top, 0px)));
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--neo-safe-top, env(safe-area-inset-top, 0px)) max(0.35rem, env(safe-area-inset-right, 0px)) 0
    max(0.35rem, env(safe-area-inset-left, 0px));
  // Threads-quiet top — no hard rule; solid fill (backdrop-filter blacks out iOS)
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
}
</style>
