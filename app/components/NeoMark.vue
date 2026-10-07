<script setup lang="ts">
withDefaults(
  defineProps<{
    showBrand?: boolean
    active?: boolean
  }>(),
  {
    showBrand: true,
    active: false,
  },
)
</script>

<template>
  <span class="neo-mark" :class="{ 'neo-mark--on': active }">
    <span class="neo-mark__glyph">ns</span>
    <span v-if="showBrand" class="neo-mark__brand">neospace</span>
  </span>
</template>

<style lang="scss" scoped>
.neo-mark {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  text-decoration: none;
  color: inherit;

  &__glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--neo-radius-sm, 4px);
    background: var(--neo-accent);
    color: var(--neo-text-on-accent, #fff);
    font-size: 0.6875rem;
    font-weight: 800;
    letter-spacing: -0.04em;
    text-transform: lowercase;
    flex-shrink: 0;
  }

  &__brand {
    font-size: 0.9375rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    text-transform: lowercase;
    line-height: 1;
  }

  &--on &__glyph {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--neo-accent) 35%, transparent);
  }
}
</style>
