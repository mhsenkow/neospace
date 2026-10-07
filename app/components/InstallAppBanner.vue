<script setup lang="ts">
/**
 * Android / Chrome install prompt — “Add to Home screen” for Pixel etc.
 * Uses @vite-pwa/nuxt $pwa when beforeinstallprompt is available.
 */

import { useMediaQuery } from '~/composables/useBreakpoint'

const { $pwa } = useNuxtApp()

const pwa = computed(() => $pwa as {
  showInstallPrompt?: boolean
  isPWAInstalled?: boolean
  install?: () => Promise<unknown>
  cancelInstall?: () => void
} | undefined)

const isStandalone = useMediaQuery('(display-mode: standalone)')

const show = computed(() => {
  if (!pwa.value) return false
  if (pwa.value.isPWAInstalled) return false
  if (isStandalone.value) return false
  return !!pwa.value.showInstallPrompt
})

const install = async () => {
  try {
    await pwa.value?.install?.()
  } catch {
    /* user cancelled sheet */
  }
}

const dismiss = () => {
  pwa.value?.cancelInstall?.()
}
</script>

<template>
  <Transition name="install-banner">
    <aside
      v-if="show"
      class="install-banner"
      role="region"
      aria-labelledby="install-banner-title"
    >
      <div class="install-banner__copy">
        <strong id="install-banner-title">Install NeoSpace</strong>
        <span>Add to your home screen for a full-screen app.</span>
      </div>
      <div class="install-banner__actions">
        <button type="button" class="neo-btn neo-btn--primary neo-btn--sm" @click="install">
          Install
        </button>
        <button type="button" class="neo-btn neo-btn--ghost neo-btn--sm" @click="dismiss">
          Not now
        </button>
      </div>
    </aside>
  </Transition>
</template>

<style lang="scss" scoped>
/* Positioning comes from .neo-bottom-dock in the layout */
.install-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  max-width: 22rem;
  padding: 0.85rem 1rem;
  border-radius: var(--neo-radius-md, 12px);
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  box-shadow: 0 12px 32px color-mix(in srgb, var(--neo-text-primary) 16%, transparent);
  pointer-events: auto;

  @media (max-width: 1023px) {
    max-width: none;
  }

  &__copy {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;

    strong {
      font-size: 0.875rem;
      color: var(--neo-text-primary);
    }

    span {
      font-size: 0.75rem;
      line-height: 1.35;
      color: var(--neo-text-muted);
    }
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.35rem;
  }
}

.install-banner-enter-active,
.install-banner-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.install-banner-enter-from,
.install-banner-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
