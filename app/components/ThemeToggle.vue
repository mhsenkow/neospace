<script setup lang="ts">
/**
 * ThemeToggle Component
 * 
 * The sacred button that unleashes chaos upon the DOM.
 * Handle with care. Or don't. It's chaos.
 */

import { useThemeStore } from '~/stores/theme'
import { useMockData } from '~/composables/useMockData'

const themeStore = useThemeStore()
const { currentUser } = useMockData()

// Load user's custom CSS when component mounts
onMounted(() => {
  if (currentUser.customCSS) {
    themeStore.setUserCustomCSS(currentUser.customCSS)
  }
})

const handleToggle = () => {
  themeStore.toggleMode()
}
</script>

<template>
  <button 
    class="theme-toggle"
    :class="{ 'theme-toggle--chaos': themeStore.isChaosMode }"
    @click="handleToggle"
    :aria-label="themeStore.toggleButtonText"
  >
    <span class="theme-toggle__icon">
      {{ themeStore.isChaosMode ? '👩' : '🌀' }}
    </span>
    <span class="theme-toggle__text">
      {{ themeStore.toggleButtonText }}
    </span>
    <span class="theme-toggle__indicator" />
  </button>
</template>

<style lang="scss" scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1.25rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  background-color: var(--neo-bg-secondary);
  border: 2px solid var(--neo-border-color);
  border-radius: var(--neo-radius-lg);
  cursor: pointer;
  transition: all var(--neo-transition);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, transparent 40%, rgba(255, 255, 255, 0.1) 50%, transparent 60%);
    transform: translateX(-100%);
    transition: transform 0.6s ease;
  }

  &:hover {
    border-color: var(--neo-accent);
    transform: translateY(-2px);
    box-shadow: var(--neo-shadow-md);

    &::before {
      transform: translateX(100%);
    }
  }

  &:active {
    transform: translateY(0);
  }

  // Chaos mode styling
  &--chaos {
    background: linear-gradient(135deg, #1a0533, #4a1942);
    border-color: #ff00ff;
    color: #00ff41;
    box-shadow: 0 0 15px rgba(255, 0, 255, 0.4);
    animation: chaos-button-pulse 2s ease-in-out infinite alternate;

    &:hover {
      box-shadow: 0 0 25px rgba(255, 0, 255, 0.6), 0 0 50px rgba(0, 255, 65, 0.3);
    }
  }

  &__icon {
    font-size: 1.25rem;
    line-height: 1;
  }

  &__text {
    white-space: nowrap;
  }

  &__indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--neo-accent);
    transition: all var(--neo-transition);

    .theme-toggle--chaos & {
      background-color: #00ff41;
      box-shadow: 0 0 10px #00ff41;
      animation: indicator-blink 1s ease-in-out infinite;
    }
  }
}

@keyframes chaos-button-pulse {
  from {
    box-shadow: 0 0 15px rgba(255, 0, 255, 0.4);
  }
  to {
    box-shadow: 0 0 25px rgba(255, 0, 255, 0.7), 0 0 40px rgba(0, 255, 65, 0.3);
  }
}

@keyframes indicator-blink {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>

