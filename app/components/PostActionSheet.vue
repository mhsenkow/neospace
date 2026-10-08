<script setup lang="ts">
export interface PostActionItem {
  id: string
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
}

const props = defineProps<{
  open: boolean
  title?: string
  actions: PostActionItem[]
}>()

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

const sheetRef = ref<HTMLElement | null>(null)
const titleId = computed(() => (props.title ? 'action-sheet-title' : undefined))
const isOpen = computed(() => props.open)

useFocusTrap(sheetRef, isOpen, {
  onEscape: () => emit('close'),
  initialFocus: '.action-sheet__item:not(:disabled), .action-sheet__cancel',
})
</script>

<template>
  <Teleport to="body">
    <Transition name="action-sheet">
      <div
        v-if="open"
        ref="sheetRef"
        class="action-sheet"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-label="title ? undefined : 'Actions'"
      >
        <button
          type="button"
          class="action-sheet__backdrop"
          tabindex="-1"
          aria-hidden="true"
          @click="emit('close')"
        />
        <div class="action-sheet__panel">
          <p v-if="title" :id="titleId" class="action-sheet__title">{{ title }}</p>
          <button
            v-for="action in actions"
            :key="action.id"
            type="button"
            class="action-sheet__item"
            :class="{ 'action-sheet__item--danger': action.danger }"
            :disabled="action.disabled"
            @click="emit('select', action.id)"
          >
            <span class="action-sheet__label">{{ action.label }}</span>
            <span v-if="action.hint" class="action-sheet__hint">{{ action.hint }}</span>
          </button>
          <button type="button" class="action-sheet__cancel" @click="emit('close')">Cancel</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.action-sheet {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.action-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--neo-bg-overlay);
  cursor: pointer;
}

.action-sheet__panel {
  position: relative;
  z-index: 1;
  margin: 0 0.5rem calc(0.5rem + env(safe-area-inset-bottom, 0px));
  padding: 0.4rem 0.4rem 0.5rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 16px;
  box-shadow: 0 16px 40px color-mix(in srgb, var(--neo-text-primary) 18%, transparent);
  // Landscape phones: scroll rather than cut off the top rows
  max-height: calc(100dvh - 1rem - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  overscroll-behavior: contain;

  @media (min-width: 640px) {
    align-self: center;
    width: 100%;
    max-width: 22rem;
    margin-bottom: 1.5rem;
  }
}

.action-sheet__title {
  margin: 0.35rem 0.75rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.action-sheet__item,
.action-sheet__cancel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  width: 100%;
  min-height: 48px;
  padding: 0.7rem 0.85rem;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--neo-text-primary);
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--neo-bg-hover);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.action-sheet__item--danger {
  color: var(--neo-danger);
}

.action-sheet__label {
  font-size: 1rem;
  font-weight: 600;
}

.action-sheet__hint {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.action-sheet__cancel {
  margin-top: 0.2rem;
  align-items: center;
  font-weight: 600;
  color: var(--neo-text-secondary);
}

.action-sheet-enter-active,
.action-sheet-leave-active {
  transition: opacity 0.18s ease;

  .action-sheet__panel {
    transition: transform 0.22s cubic-bezier(0.2, 0, 0, 1);
  }
}

.action-sheet-enter-from,
.action-sheet-leave-to {
  opacity: 0;

  .action-sheet__panel {
    transform: translateY(18px);
  }
}
</style>
