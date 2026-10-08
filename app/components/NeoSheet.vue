<script setup lang="ts">
/**
 * Shared bottom-sheet shell for ComposeSheet, ComposeGroupPicker, etc.
 */

const props = withDefaults(
  defineProps<{
    open: boolean
    zIndex?: number
    /** Panel max-height — default matches compose sheet */
    maxHeight?: string
    /** Wider desktop panel (compose) vs compact (group picker) */
    desktopWidth?: 'compose' | 'compact'
    /**
     * useKeyboardViewport() box — pins the sheet to the visual viewport so the
     * soft keyboard (iOS / Android overlay mode) can't cover the panel.
     */
    viewportStyle?: Record<string, string>
  }>(),
  {
    zIndex: 200,
    maxHeight: 'min(92dvh, 100%)',
    desktopWidth: 'compose',
  },
)

const emit = defineEmits<{
  close: []
}>()

/** When pinned to visualViewport, cap with % of that box — not layout dvh. */
const pinnedToViewport = computed(
  () => !!(props.viewportStyle && (props.viewportStyle.height || props.viewportStyle.top)),
)

const panelStyle = computed(() => ({
  maxHeight: pinnedToViewport.value ? '100%' : props.maxHeight,
  zIndex: props.zIndex + 1,
}))

const rootStyle = computed(() => ({
  ...props.viewportStyle,
  zIndex: props.zIndex,
}))
</script>

<template>
  <Teleport to="body">
    <Transition name="neo-sheet">
      <div
        v-if="open"
        class="neo-sheet"
        :class="{
          'neo-sheet--compact': desktopWidth === 'compact',
          'neo-sheet--vv': pinnedToViewport,
        }"
        :style="rootStyle"
        role="presentation"
      >
        <button
          type="button"
          class="neo-sheet__backdrop"
          tabindex="-1"
          aria-hidden="true"
          @click="emit('close')"
        />
        <div class="neo-sheet__panel" :style="panelStyle">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.neo-sheet {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  box-sizing: border-box;

  @media (min-width: 1024px) and (hover: hover) and (pointer: fine) {
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
  }
}

.neo-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--neo-bg-overlay);
  cursor: pointer;
}

.neo-sheet__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  // Cap with 100% so a vv-pinned parent can't overflow under the keyboard
  min-height: min(56dvh, 420px, 100%);
  background: var(--neo-bg-primary);
  border-radius: 16px 16px 0 0;
  border: 1px solid var(--neo-border-color);
  border-bottom: none;
  box-shadow: var(--neo-shadow-xl);
  padding-bottom: env(safe-area-inset-bottom, 0);
  overflow: hidden;

  .neo-sheet--vv & {
    // Fill the visual viewport box; shrink gracefully as the keyboard rises
    flex: 1 1 auto;
    min-height: 0;
    max-height: 100%;
    height: 100%;
    border-radius: 12px 12px 0 0;
    // vv pin already clears the home indicator / keyboard — don't double-pad
    padding-bottom: 0;
  }

  .neo-sheet--compact & {
    min-height: 0;
    max-height: min(78dvh, 560px);
  }

  .neo-sheet--compact.neo-sheet--vv & {
    max-height: 100%;
    height: auto;
  }

  @media (min-width: 1024px) and (hover: hover) and (pointer: fine) {
    max-width: 560px;
    max-height: min(80vh, 720px);
    min-height: min(70vh, 560px);
    border-radius: 12px;
    border-bottom: 1px solid var(--neo-border-color);
    padding-bottom: 0;

    .neo-sheet--compact & {
      max-width: 420px;
      min-height: 0;
    }
  }
}

.neo-sheet-enter-active,
.neo-sheet-leave-active {
  transition: opacity 0.2s ease;

  .neo-sheet__panel {
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  }
}

.neo-sheet-enter-from,
.neo-sheet-leave-to {
  opacity: 0;

  .neo-sheet__panel {
    transform: translateY(18px);

    @media (min-width: 1024px) and (hover: hover) and (pointer: fine) {
      transform: translateY(8px) scale(0.98);
    }
  }
}
</style>
