<script setup lang="ts">
/**
 * Heading block shared by every Settings panel (icon + title + description).
 */
defineProps<{
  category?: { icon?: string; label?: string; description?: string } | null
}>()
</script>

<template>
  <div class="settings-section__header">
    <h2>
      <NeoIcon
        v-if="category?.icon"
        :name="(category.icon as any)"
        :size="18"
        :stroke="1.75"
      />
      {{ category?.label }}
    </h2>
    <p>{{ category?.description }}</p>
  </div>
</template>

<style lang="scss" scoped>
.settings-section__header {
  margin-bottom: 1.25rem;

  h2 {
    margin: 0 0 0.375rem;
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  p {
    margin: 0;
    color: var(--neo-text-secondary);
    font-size: 0.875rem;
  }
}

@media (max-width: 768px) {
  .settings-section__header {
    margin-bottom: 1rem;

    h2 { font-size: 1.25rem; }
    p { font-size: 0.875rem; }
  }
}

@media (max-width: 480px) {
  .settings-section__header {
    h2 { font-size: 1.125rem; }
    p { font-size: 0.8125rem; }
  }
}
</style>
