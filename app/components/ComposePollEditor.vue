<script setup lang="ts">
/**
 * Poll option editor for compose — options, duration, multi-choice, totals.
 */
const options = defineModel<string[]>('options', { required: true })
const duration = defineModel<number>('duration', { required: true })
const multiple = defineModel<boolean>('multiple', { required: true })
const hideTotals = defineModel<boolean>('hideTotals', { required: true })

const props = defineProps<{
  disabled?: boolean
  minOptions: number
  maxOptions: number
  maxCharactersPerOption: number
  durations: { seconds: number; label: string }[]
  canHideTotals: boolean
  error?: string
  hint?: string
}>()

const inputRefs = ref<HTMLInputElement[]>([])

const setInputRef = (el: unknown, idx: number) => {
  if (el) inputRefs.value[idx] = el as HTMLInputElement
}

const addOption = () => {
  if (options.value.length >= props.maxOptions) return
  options.value = [...options.value, '']
  nextTick(() => {
    inputRefs.value[options.value.length - 1]?.focus()
  })
}

const removeOption = (idx: number) => {
  if (options.value.length <= props.minOptions) return
  options.value = options.value.filter((_, i) => i !== idx)
}

/** Enter advances to the next option (or adds one); avoids posting accidentally. */
const onOptionKeydown = (e: KeyboardEvent, idx: number) => {
  if (e.key !== 'Enter' || e.isComposing) return
  e.preventDefault()
  e.stopPropagation()
  if (idx < options.value.length - 1) {
    inputRefs.value[idx + 1]?.focus()
    return
  }
  if (options.value.length < props.maxOptions) addOption()
}

defineExpose({
  focusFirst: () => inputRefs.value[0]?.focus(),
  firstInput: () => inputRefs.value[0] ?? null,
})
</script>

<template>
  <fieldset class="compose-poll" :disabled="disabled" @click.stop>
    <legend class="compose-poll__legend">Poll</legend>
    <p class="compose-poll__lead">Ask a question above, then add the choices here.</p>
    <div v-for="(_, idx) in options" :key="idx" class="compose-poll__row">
      <input
        :ref="(el) => setInputRef(el, idx)"
        v-model="options[idx]"
        type="text"
        class="compose-poll__input neo-input"
        :maxlength="maxCharactersPerOption"
        :placeholder="`Option ${idx + 1}`"
        :aria-label="`Poll option ${idx + 1}`"
        enterkeyhint="next"
        @keydown="onOptionKeydown($event, idx)"
      />
      <button
        v-if="options.length > minOptions"
        type="button"
        class="compose-poll__remove"
        :aria-label="`Remove option ${idx + 1}`"
        @click="removeOption(idx)"
      >
        ×
      </button>
    </div>
    <div class="compose-poll__settings">
      <button
        v-if="options.length < maxOptions"
        type="button"
        class="compose-poll__add"
        @click="addOption"
      >
        + Add option
      </button>
      <label class="compose-poll__field">
        <span>Ends in</span>
        <select v-model.number="duration" class="compose-poll__select" aria-label="Poll duration">
          <option v-for="d in durations" :key="d.seconds" :value="d.seconds">{{ d.label }}</option>
        </select>
      </label>
      <label class="compose-poll__field">
        <input v-model="multiple" type="checkbox" />
        <span>Allow multiple choices</span>
      </label>
      <label v-if="canHideTotals" class="compose-poll__field compose-poll__field--wrap">
        <input v-model="hideTotals" type="checkbox" />
        <span>Hide vote counts until the poll closes</span>
      </label>
      <p v-if="canHideTotals && hideTotals" class="compose-poll__hint">
        Totals stay hidden on Mastodon until voting ends; other clients may show them differently.
      </p>
    </div>
    <p v-if="error" class="compose-poll__error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="compose-poll__hint" aria-live="polite">{{ hint }}</p>
  </fieldset>
</template>

<style lang="scss" scoped>
.compose-poll {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
  margin: 0.35rem 0 0;
  padding: 0.7rem 0.75rem;
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md, 8px);
  background: var(--neo-bg-tertiary);
}

.compose-poll__legend {
  padding: 0 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-muted);
}

.compose-poll__lead {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
  line-height: 1.35;
}

.compose-poll__row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.compose-poll__input {
  flex: 1;
  min-width: 0;
  min-height: 2.75rem;
  font-size: max(16px, 1rem);
  padding: 0.55rem 0.7rem;
}

.compose-poll__remove,
.compose-poll__add {
  border: none;
  background: transparent;
  color: var(--neo-text-muted);
  font: inherit;
  cursor: pointer;

  &:hover {
    color: var(--neo-accent);
  }
}

.compose-poll__remove {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  font-size: 1.25rem;
  line-height: 1;
  border-radius: var(--neo-radius-sm, 6px);

  &:hover {
    background: var(--neo-bg-secondary);
  }
}

.compose-poll__add {
  min-height: 2.75rem;
  padding: 0 0.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--neo-link);
}

.compose-poll__settings {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 1rem;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
}

.compose-poll__field {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.5rem;
}

.compose-poll__field--wrap {
  flex: 1 1 100%;
}

.compose-poll__hint {
  margin: 0;
  flex: 1 1 100%;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.compose-poll__select {
  min-height: 2.5rem;
  padding: 0.35rem 0.5rem;
  font: inherit;
  font-size: max(16px, 0.875rem);
  background-color: var(--neo-bg-primary);
  color: var(--neo-text-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm);
}

.compose-poll__error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-danger, #dc2626);
}
</style>
