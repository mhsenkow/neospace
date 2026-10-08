<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOverlayStore } from '~/stores/overlay'

const overlay = useOverlayStore()
const dialogRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => overlay.confirm.open)

useFocusTrap(dialogRef, isOpen, {
  onEscape: () => overlay.resolveConfirm(false),
  initialFocus: '.neo-confirm__cancel',
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="overlay.confirm.open"
      class="neo-confirm-root"
      @click.self="overlay.resolveConfirm(false)"
    >
      <div
        ref="dialogRef"
        class="neo-confirm"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="'neo-confirm-title'"
        :aria-describedby="'neo-confirm-body'"
      >
        <h2 id="neo-confirm-title" class="neo-confirm__title">
          {{ overlay.confirm.title }}
        </h2>
        <p id="neo-confirm-body" class="neo-confirm__body">
          {{ overlay.confirm.body }}
        </p>
        <div class="neo-confirm__actions">
          <button
            type="button"
            class="neo-btn neo-btn--secondary neo-confirm__cancel"
            @click="overlay.resolveConfirm(false)"
          >
            Cancel
          </button>
          <button
            type="button"
            class="neo-btn"
            :class="overlay.confirm.danger ? 'neo-btn--danger' : 'neo-btn--primary'"
            @click="overlay.resolveConfirm(true)"
          >
            {{ overlay.confirm.confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.neo-confirm-root {
  position: fixed;
  inset: 0;
  z-index: var(--neo-z-dialog-top, 1065);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--neo-spacing-6, 1.25rem);
  background: color-mix(in srgb, var(--neo-bg-primary) 35%, rgba(0, 0, 0, 0.45));
}

.neo-confirm {
  width: min(22rem, 100%);
  padding: var(--neo-spacing-6, 1.25rem);
  background: var(--neo-bg-card, var(--neo-bg-primary));
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md);
  box-shadow: var(--neo-chrome-card-shadow, 0 12px 40px rgba(0, 0, 0, 0.2));
}

.neo-confirm__title {
  margin: 0 0 var(--neo-spacing-3, 0.5rem);
  font-size: var(--neo-font-size-lg, 1.1rem);
  font-weight: var(--neo-font-weight-semibold, 600);
  color: var(--neo-text-primary);
}

.neo-confirm__body {
  margin: 0 0 var(--neo-spacing-6, 1.25rem);
  font-size: var(--neo-font-size-sm);
  color: var(--neo-text-secondary);
  line-height: var(--neo-leading-body, 1.45);
}

.neo-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--neo-spacing-3, 0.5rem);
}

.neo-btn--danger {
  background-color: var(--neo-danger, #dc2626);
  color: var(--neo-text-on-accent, #fff);

  &:hover {
    filter: brightness(1.05);
  }
}
</style>
