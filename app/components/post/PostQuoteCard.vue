<script setup lang="ts">
/** Incoming quote embed shown under a post's text. */
defineProps<{
  quote: {
    name: string
    handle: string
    avatar?: string | null
    text: string
  }
}>()

const emit = defineEmits<{
  open: []
}>()
</script>

<template>
  <button
    type="button"
    class="status-quote-card"
    :aria-label="`Quoted post by @${quote.handle}`"
    @click.stop="emit('open')"
  >
    <img
      v-if="quote.avatar"
      :src="quote.avatar"
      alt=""
      class="status-quote-card__avatar"
      loading="lazy"
      decoding="async"
    />
    <span class="status-quote-card__body">
      <span class="status-quote-card__meta">
        <strong>{{ quote.name }}</strong>
        <span>@{{ quote.handle }}</span>
      </span>
      <span class="status-quote-card__text">{{ quote.text }}</span>
    </span>
  </button>
</template>

<style lang="scss" scoped>
.status-quote-card {
  display: flex;
  gap: 0.55rem;
  width: 100%;
  margin-top: 0.45rem;
  padding: 0.65rem 0.7rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  background: var(--neo-bg-secondary);
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;

  &:hover,
  &:focus-visible {
    background: var(--neo-bg-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }

  &__avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  &__body {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  &__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    font-size: 0.8125rem;
    color: var(--neo-text-muted);

    strong {
      color: var(--neo-text-primary);
      font-weight: 600;
    }
  }

  &__text {
    font-size: 0.875rem;
    line-height: 1.35;
    color: var(--neo-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
}
</style>
