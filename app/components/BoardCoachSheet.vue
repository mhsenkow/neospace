<script setup lang="ts">
import { useBoardCoach } from '~/composables/useBoardCoach'

const { open, step, next, skip, steps } = useBoardCoach()
const current = computed(() => steps[step.value] || steps[0]!)
</script>

<template>
  <NeoSheet
    :open="open"
    desktop-width="compact"
    max-height="min(70dvh, 100%)"
    @close="skip"
  >
    <div class="board-coach" role="dialog" aria-modal="true" aria-labelledby="board-coach-title">
      <p class="board-coach__eyebrow">Quick tour · {{ step + 1 }} / {{ steps.length }}</p>
      <h2 id="board-coach-title" class="board-coach__title">{{ current.title }}</h2>
      <p class="board-coach__body">{{ current.body }}</p>
      <div class="board-coach__actions">
        <button type="button" class="neo-btn neo-btn--ghost neo-btn--sm" @click="skip">
          Skip
        </button>
        <button type="button" class="neo-btn neo-btn--primary neo-btn--sm" @click="next">
          {{ step >= steps.length - 1 ? 'Got it' : 'Next' }}
        </button>
      </div>
    </div>
  </NeoSheet>
</template>

<style lang="scss" scoped>
.board-coach {
  padding: 1.1rem 1.15rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.board-coach__eyebrow {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--neo-text-tertiary);
}

.board-coach__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 750;
  letter-spacing: -0.02em;
  color: var(--neo-text-primary);
}

.board-coach__body {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
}

.board-coach__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.65rem;
}
</style>
