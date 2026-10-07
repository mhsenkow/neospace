<script setup lang="ts">
defineProps<{
  label?: string
}>()
</script>

<template>
  <span
    class="theme-swatch"
    :aria-label="label || 'Theme'"
    role="img"
  />
</template>

<style lang="scss" scoped>
.theme-swatch {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 30%, var(--neo-accent) 0 35%, transparent 36%),
    linear-gradient(135deg, var(--neo-bg-card) 45%, var(--neo-text-primary) 46%);
  border: 1.5px solid var(--neo-border-color-dark, var(--neo-border-color));
  flex-shrink: 0;
}
</style>
