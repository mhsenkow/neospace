<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const { boardPortal } = useBoardPortal()
const { openFeedOrRoute, boardColumnIs, goHome } = useBoardNav()
const route = useRoute()

const toggleMenu = () => {
  open.value = !open.value
}

const searchActive = computed(
  () => route.path === '/explore' || boardColumnIs('search'),
)

const openSearch = () => {
  void openFeedOrRoute('search', '/explore')
}
</script>

<template>
<header class="mobile-header">
  <div class="mobile-header__start">
    <button
      class="mobile-header__btn"
      :class="{ 'chrome-hint': boardPortal === 'settings' || boardPortal === 'communities' }"
      @click="toggleMenu"
      aria-label="Menu"
      type="button"
      :aria-expanded="open"
      aria-controls="mobile-sidebar"
    >
      <NeoIcon name="menu" :size="22" :stroke="1.75" />
    </button>
    <NuxtLink to="/" class="mobile-header__logo" @click="void goHome()">neospace</NuxtLink>
  </div>
  <div class="mobile-header__actions">
    <button
      type="button"
      class="mobile-header__btn"
      :class="{
        'mobile-header__btn--active': searchActive,
        'chrome-hint': boardPortal === 'search',
      }"
      aria-label="Search"
      :aria-current="searchActive ? 'page' : undefined"
      @click="openSearch"
    >
      <NeoIcon name="search" :size="20" :stroke="searchActive || boardPortal === 'search' ? 2 : 1.75" />
    </button>
  </div>
</header>
</template>

<style lang="scss" scoped>
.mobile-header {
  // In-flow flex child of .neo-layout — fixed + overflow:hidden parent clips on iOS
  position: relative;
  flex-shrink: 0;
  width: 100%;
  height: calc(52px + env(safe-area-inset-top, 0px));
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: env(safe-area-inset-top, 0px) 0.5rem 0;
  // Solid fill — translucent + backdrop-filter flashes black on iOS while translating
  background: var(--neo-bg-primary);
  border-bottom: 1px solid var(--neo-border-color);
  z-index: var(--neo-z-shell-header, 90);
  box-sizing: border-box;
  @media (min-width: 1024px) {
    display: none;
  }

  &__start {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    min-width: 0;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    margin-left: auto;
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

    &:hover {
      background: var(--neo-bg-hover);
    }

    &--active {
      color: var(--neo-accent);
      background: var(--neo-accent-soft);
    }
  }

  &__logo {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    letter-spacing: -0.02em;
    text-transform: lowercase;
    line-height: 1;
    padding-bottom: 1px;
    text-decoration: none;
  }

  &__theme-swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 30%, var(--neo-accent) 0 35%, transparent 36%),
      linear-gradient(135deg, var(--neo-bg-card) 45%, var(--neo-text-primary) 46%);
    border: 1.5px solid var(--neo-border-color-dark);
  }
}
</style>
