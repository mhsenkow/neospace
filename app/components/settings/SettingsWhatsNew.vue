<script setup lang="ts">
/**
 * Settings → What's new — short TLDR of shipped updates.
 */
import { CHANGELOG } from '~/utils/changelog'

const formatDate = (iso: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')))
  } catch {
    return iso
  }
}
</script>

<template>
  <div class="settings-group settings-whats-new">
    <p class="settings-hint">
      Short notes on what changed in NeoSpace. Full engineering checklists live in the repo docs.
    </p>

    <article
      v-for="entry in CHANGELOG"
      :key="entry.date + entry.title"
      class="settings-whats-new__entry"
    >
      <header class="settings-whats-new__head">
        <h3 class="settings-whats-new__title">{{ entry.title }}</h3>
        <time class="settings-whats-new__date" :datetime="entry.date">
          {{ formatDate(entry.date) }}
        </time>
      </header>
      <p class="settings-whats-new__summary">{{ entry.summary }}</p>
      <ul class="settings-whats-new__list">
        <li v-for="(line, i) in entry.highlights" :key="i">{{ line }}</li>
      </ul>
    </article>
  </div>
</template>

<style lang="scss" scoped>
@use '~/assets/css/settingsPanel' as panel;

@include panel.shared;

.settings-whats-new__entry {
  padding: 1rem 0;
  border-bottom: 1px solid var(--neo-border-color);

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  &:first-of-type {
    padding-top: 0;
  }
}

.settings-whats-new__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 1rem;
  margin-bottom: 0.35rem;
}

.settings-whats-new__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
  color: var(--neo-text-primary);
}

.settings-whats-new__date {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.settings-whats-new__summary {
  margin: 0 0 0.65rem;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
  max-width: 52ch;
}

.settings-whats-new__list {
  margin: 0;
  padding-left: 1.15rem;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--neo-text-primary);
  max-width: 56ch;

  li + li {
    margin-top: 0.35rem;
  }
}
</style>
