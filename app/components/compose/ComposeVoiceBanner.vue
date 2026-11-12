<script setup lang="ts">
/**
 * Compose — "Recording 0:07" strip with Stop & attach / Cancel.
 */
defineProps<{
  elapsedLabel: string
}>()

const emit = defineEmits<{
  stop: []
  cancel: []
}>()
</script>

<template>
  <div
    class="compose-voice"
    role="status"
    aria-live="polite"
    @click.stop
  >
    <span class="compose-voice__dot" aria-hidden="true" />
    <span class="compose-voice__label">Recording {{ elapsedLabel }}</span>
    <button type="button" class="compose-voice__stop" @click="emit('stop')">
      Stop &amp; attach
    </button>
    <button type="button" class="compose-voice__cancel" @click="emit('cancel')">
      Cancel
    </button>
  </div>
</template>

<style lang="scss" scoped>
.compose-voice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-top: 0.5rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--neo-radius-md, 8px);
  background: color-mix(in srgb, var(--neo-danger, #dc2626) 12%, var(--neo-bg-tertiary));
  border: 1px solid color-mix(in srgb, var(--neo-danger, #dc2626) 35%, var(--neo-border-color));
}

.compose-voice__dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--neo-danger, #dc2626);
  animation: compose-voice-pulse 1s ease-in-out infinite;
}

.compose-voice__label {
  flex: 1;
  min-width: 0;
  font-size: 0.875rem;
  font-weight: 650;
  color: var(--neo-text-primary);
}

.compose-voice__stop,
.compose-voice__cancel {
  border: none;
  background: transparent;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 650;
  cursor: pointer;
  min-height: 2.25rem;
  padding: 0 0.35rem;
}

.compose-voice__stop {
  color: var(--neo-accent);
}

.compose-voice__cancel {
  color: var(--neo-text-muted);
}

@keyframes compose-voice-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.85);
  }
}
</style>
