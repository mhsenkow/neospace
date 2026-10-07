<script setup lang="ts">
/**
 * Shared circular chrome control — SubviewChrome actions and similar headers.
 */
withDefaults(
  defineProps<{
    title?: string
    ariaLabel?: string
    disabled?: boolean
    to?: string
  }>(),
  {
    title: '',
    ariaLabel: '',
    disabled: false,
  },
)
</script>

<template>
  <NuxtLink
    v-if="to"
    :to="to"
    class="chrome-btn"
    :class="{ 'neo-tip': !!(ariaLabel || title) }"
    :title="title || undefined"
    :aria-label="ariaLabel || title || undefined"
  >
    <slot />
  </NuxtLink>
  <button
    v-else
    type="button"
    class="chrome-btn"
    :class="{ 'neo-tip': !!(ariaLabel || title) }"
    :title="title || undefined"
    :aria-label="ariaLabel || title || undefined"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style lang="scss" scoped>
.chrome-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-primary);
  cursor: pointer;
  flex-shrink: 0;
  text-decoration: none;

  &:hover:not(:disabled) {
    background: var(--neo-bg-hover, var(--neo-bg-tertiary));
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
</style>
