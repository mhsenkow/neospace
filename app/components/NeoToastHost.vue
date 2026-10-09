<script setup lang="ts">
import { useToastStore } from '~/stores/toast'

const toast = useToastStore()

/** Hover and focus each hold the timer; it resumes only when both are gone */
const holds = new Map<number, Set<'hover' | 'focus'>>()

function hold(id: number, why: 'hover' | 'focus') {
  let set = holds.get(id)
  if (!set) holds.set(id, (set = new Set()))
  set.add(why)
  toast.pause(id)
}

function release(id: number, why: 'hover' | 'focus') {
  const set = holds.get(id)
  set?.delete(why)
  if (set && set.size) return
  holds.delete(id)
  toast.resume(id)
}

function onFocusOut(id: number, e: FocusEvent) {
  const el = e.currentTarget as HTMLElement | null
  if (el && e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return
  release(id, 'focus')
}

function onAction(id: number, fn?: () => void) {
  try {
    fn?.()
  } finally {
    toast.dismiss(id)
  }
}
</script>

<template>
  <Teleport to="body">
    <!-- One always-mounted polite region; toasts inside carry no role of their own -->
    <div class="neo-toast-host" aria-live="polite" aria-relevant="additions">
      <TransitionGroup name="neo-toast">
        <div
          v-for="t in toast.toasts"
          :key="t.id"
          class="neo-toast"
          @mouseenter="hold(t.id, 'hover')"
          @mouseleave="release(t.id, 'hover')"
          @focusin="hold(t.id, 'focus')"
          @focusout="onFocusOut(t.id, $event)"
        >
          <span class="neo-toast__msg">{{ t.message }}</span>
          <button
            v-if="t.actionLabel"
            type="button"
            class="neo-btn neo-btn--ghost neo-toast__action"
            @click="onAction(t.id, t.onAction)"
          >
            {{ t.actionLabel }}
          </button>
          <button
            type="button"
            class="neo-toast__dismiss"
            aria-label="Dismiss"
            @click="toast.dismiss(t.id)"
          >
            ×
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.neo-toast-host {
  position: fixed;
  inset: auto var(--neo-spacing-4, 1rem) var(--neo-spacing-4, 1rem) auto;
  z-index: var(--neo-z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--neo-spacing-2, 0.35rem);
  max-width: min(22rem, calc(100vw - 2rem));
  pointer-events: none;

  // Mobile: sit above the tab bar (and home indicator) instead of on top of it
  @media (max-width: 1023px) {
    left: max(0.75rem, env(safe-area-inset-left));
    right: max(0.75rem, env(safe-area-inset-right));
    // Tab bar + home feed pills (0 when those strips aren’t shown)
    bottom: calc(
      var(--neo-bottom-chrome-h, var(--neo-mobile-nav-h, 56px)) + var(--neo-feed-tabs-h, 0px) +
        env(safe-area-inset-bottom, 0px) + 0.75rem
    );
    max-width: none;
  }
}

.neo-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--neo-spacing-3, 0.5rem);
  padding: var(--neo-spacing-3, 0.5rem) var(--neo-spacing-4, 0.75rem);
  background: var(--neo-bg-card, var(--neo-bg-primary));
  color: var(--neo-text-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md, var(--neo-radius-sm));
  box-shadow: var(--neo-chrome-card-shadow, 0 8px 24px rgba(0, 0, 0, 0.14));
  font-size: var(--neo-font-size-sm);
}

.neo-toast__msg {
  flex: 1;
  min-width: 0;
}

.neo-toast__action {
  flex-shrink: 0;
  padding: var(--neo-spacing-1, 0.15rem) var(--neo-spacing-3, 0.5rem);
}

.neo-toast__dismiss {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--neo-text-tertiary);
  border-radius: var(--neo-radius-chrome, var(--neo-radius-sm));
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;

  @media (pointer: coarse) {
    width: 40px;
    height: 40px;
  }

  &:hover {
    background: var(--neo-bg-hover, var(--neo-bg-tertiary));
    color: var(--neo-text-secondary);
  }
}

.neo-toast-enter-active,
.neo-toast-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.neo-toast-enter-from,
.neo-toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
