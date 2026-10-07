<script setup lang="ts">
/**
 * Segmented control (radiogroup) for settings-style choices.
 */

export type NeoRadioOption = { value: string; label: string }

const props = defineProps<{
  options: NeoRadioOption[]
  modelValue: string
  ariaLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function select(value: string) {
  if (value === props.modelValue) return
  emit('update:modelValue', value)
}

function onKeydown(e: KeyboardEvent, index: number) {
  const n = props.options.length
  if (!n) return
  let next = index
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    next = (index + 1) % n
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    next = (index - 1 + n) % n
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    select(props.options[index]!.value)
    return
  } else {
    return
  }
  const opt = props.options[next]
  if (opt) select(opt.value)
}
</script>

<template>
  <div class="neo-radio-group" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="(opt, i) in options"
      :key="opt.value"
      type="button"
      class="neo-radio-group__btn"
      role="radio"
      :aria-checked="opt.value === modelValue"
      :tabindex="opt.value === modelValue ? 0 : -1"
      @click="select(opt.value)"
      @keydown="onKeydown($event, i)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.neo-radio-group {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-chrome, var(--neo-radius-sm));
}

.neo-radio-group__btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--neo-text-tertiary);
  font-family: var(--neo-font-family-ui, inherit);
  font-size: var(--neo-font-size-sm);
  font-weight: var(--neo-chrome-btn-weight, var(--neo-font-weight-medium, 500));
  letter-spacing: var(--neo-chrome-btn-tracking, 0.01em);
  padding: var(--neo-spacing-2, 0.35rem) var(--neo-spacing-4, 0.75rem);
  border-radius: calc(var(--neo-radius-chrome, var(--neo-radius-sm)) - 1px);
  cursor: pointer;
  transition: background-color var(--neo-transition-fast, 100ms), color var(--neo-transition-fast, 100ms);

  &[aria-checked='true'] {
    background: var(--neo-bg-card, var(--neo-bg-primary));
    color: var(--neo-text-primary);
    box-shadow: 0 0 0 1px var(--neo-border-color);
  }

  &:hover:not([aria-checked='true']) {
    color: var(--neo-text-secondary);
  }
}
</style>
