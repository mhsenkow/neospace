<script setup lang="ts">
/**
 * Minimal sheet chrome — icon close + short title.
 * Mobile: icon-only close. Desktop (≥1024px): icon + “Cancel”.
 */
withDefaults(
  defineProps<{
    title: string
    titleId?: string
    /** Hide the title visually (still exposed to AT via the dialog name). */
    titleSrOnly?: boolean
  }>(),
  {
    titleSrOnly: false,
  },
)

defineEmits<{
  cancel: []
}>()
</script>

<template>
  <header class="neo-sheet-header" :class="{ 'neo-sheet-header--title-sr': titleSrOnly }">
    <button
      type="button"
      class="neo-sheet-header__close"
      aria-label="Cancel"
      title="Cancel"
      @click="$emit('cancel')"
    >
      <NeoIcon name="x" :size="20" :stroke="2" />
      <span class="neo-sheet-header__close-label">Cancel</span>
    </button>
    <h2
      :id="titleId"
      class="neo-sheet-header__title"
      :class="{ 'sr-only': titleSrOnly }"
    >
      {{ title }}
    </h2>
  </header>
</template>

<style lang="scss" scoped>
.neo-sheet-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 44px;
  padding: 0.2rem 0.4rem 0.2rem 0.2rem;
  border-bottom: 1px solid var(--neo-border-color);
  flex-shrink: 0;
}

.neo-sheet-header--title-sr {
  min-height: 44px;
  border-bottom-color: color-mix(in srgb, var(--neo-border-color) 55%, transparent);
}

.neo-sheet-header__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: var(--neo-radius-sm, 4px);
  background: transparent;
  color: var(--neo-text-primary);
  cursor: pointer;
  flex-shrink: 0;
  touch-action: manipulation;

  &:hover {
    background: var(--neo-bg-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }
}

.neo-sheet-header__close-label {
  display: none;
  font-size: 0.875rem;
  font-weight: 600;
}

@media (min-width: 1024px) {
  .neo-sheet-header__close {
    width: auto;
    min-width: 44px;
    padding: 0 0.7rem;
  }

  .neo-sheet-header__close-label {
    display: inline;
  }
}

.neo-sheet-header__title {
  flex: 1;
  margin: 0;
  min-width: 0;
  text-align: left;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
