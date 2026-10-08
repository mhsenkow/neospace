<script setup lang="ts">
/**
 * Install promo for Android / iOS.
 * Uses native beforeinstallprompt when Chrome offers it; otherwise shows
 * Add-to-Home-screen steps (Chrome won’t always put “Install app” in ⋮).
 */

const {
  isAndroid,
  isIos,
  canNativeInstall,
  showPromo,
  installNative,
  dismissPromo,
} = useInstallApp()

const showHowTo = ref(false)

const onInstallClick = async () => {
  if (canNativeInstall.value) {
    await installNative()
    return
  }
  showHowTo.value = !showHowTo.value
}

const subtitle = computed(() => {
  if (canNativeInstall.value) return 'Add to your home screen for a full-screen app.'
  if (isAndroid.value) return 'Chrome may hide Install in the menu — tap below for steps.'
  if (isIos.value) return 'Add NeoSpace to your Home Screen from Safari Share.'
  return 'Install NeoSpace on this device.'
})
</script>

<template>
  <Transition name="install-banner">
    <aside
      v-if="showPromo"
      class="install-banner"
      role="region"
      aria-labelledby="install-banner-title"
    >
      <div class="install-banner__copy">
        <strong id="install-banner-title">Install NeoSpace</strong>
        <span>{{ subtitle }}</span>
      </div>
      <div class="install-banner__actions">
        <button
          type="button"
          class="neo-btn neo-btn--primary neo-btn--sm"
          :aria-expanded="canNativeInstall ? undefined : showHowTo"
          @click="onInstallClick"
        >
          {{ canNativeInstall ? 'Install' : showHowTo ? 'Hide steps' : 'How to install' }}
        </button>
        <button type="button" class="neo-btn neo-btn--ghost neo-btn--sm" @click="dismissPromo">
          Not now
        </button>
      </div>
      <ol v-if="showHowTo && isAndroid" class="install-banner__steps">
        <li>Open this site in the <strong>Chrome</strong> app (not inside another app).</li>
        <li>Tap <strong>⋮</strong> (top right).</li>
        <li>
          Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>
          (sometimes under <strong>Add to…</strong>).
        </li>
        <li>Confirm — NeoSpace appears as an icon.</li>
      </ol>
      <ol v-else-if="showHowTo && isIos" class="install-banner__steps">
        <li>Open in <strong>Safari</strong>.</li>
        <li>Tap the <strong>Share</strong> button.</li>
        <li>Tap <strong>Add to Home Screen</strong>, then Add.</li>
      </ol>
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

  &__steps {
    flex: 1 1 100%;
    margin: 0;
    padding: 0.15rem 0 0 1.15rem;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--neo-text-secondary);

    li + li {
      margin-top: 0.25rem;
    }

    strong {
      color: var(--neo-text-primary);
      font-weight: 650;
    }
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
