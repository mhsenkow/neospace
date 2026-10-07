<script setup lang="ts">
defineProps<{
  title: string
  titleId?: string
}>()

defineEmits<{
  cancel: []
}>()
</script>

<template>
  <header class="neo-sheet-header">
    <button
      type="button"
      class="neo-sheet-header__cancel neo-btn neo-btn--tertiary"
      @click="$emit('cancel')"
    >
      Cancel
    </button>
    <h2 :id="titleId" class="neo-sheet-header__title">{{ title }}</h2>
    <span class="neo-sheet-header__spacer" aria-hidden="true" />
  </header>
</template>

<style lang="scss" scoped>
.neo-sheet-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--neo-border-color);
  flex-shrink: 0;
}

.neo-sheet-header__cancel {
  min-width: auto;
  min-height: 40px;
  padding: 0.35rem 0.65rem;
  font-weight: 600;
}

.neo-sheet-header__title {
  flex: 1;
  margin: 0;
  text-align: center;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--neo-text-primary);
}

.neo-sheet-header__spacer {
  width: 4.5rem;
}
</style>
