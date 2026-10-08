<script setup lang="ts">
/**
 * Profile “Human” tab — verified-human badge shelf (intent / coming soon).
 */

import type { mastodon } from 'masto'
import { HUMAN_BADGE_DEFS } from '~/utils/humanBadges'
import { accountLooksBot } from '~/utils/edwardSemantics'
import { useSettingsStore } from '~/stores/settings'
import NeoIcon from '~/components/NeoIcon.vue'

const props = defineProps<{
  account: mastodon.v1.Account
  isOwn?: boolean
}>()

const settingsStore = useSettingsStore()
const isBot = computed(() => accountLooksBot(props.account))

const openHumansSettings = () => {
  settingsStore.open('humans')
}
</script>

<template>
  <section class="human-badges" aria-label="Verified human badges">
    <header class="human-badges__head">
      <h2 class="human-badges__title">
        <NeoIcon name="heart" :size="18" :stroke="1.85" />
        Verified human
      </h2>
      <p class="human-badges__lede">
        Badges for things that are easy for a person and expensive for a bot farm —
        weird reality snaps, real conversations, showing up for neighbors. Not a
        passport. Not a paywall. Not for sale.
      </p>
    </header>

    <p v-if="isBot" class="human-badges__bot" role="status">
      This account is marked as a bot (or looks like one). Human badges are for
      people — that’s the point.
    </p>

    <ul class="human-badges__grid">
      <li
        v-for="badge in HUMAN_BADGE_DEFS"
        :key="badge.id"
        class="human-badges__card"
      >
        <div class="human-badges__card-top">
          <span class="human-badges__label">{{ badge.label }}</span>
          <span class="human-badges__lock">soon</span>
        </div>
        <p class="human-badges__how">{{ badge.how }}</p>
        <p class="human-badges__why">{{ badge.why }}</p>
      </li>
    </ul>

    <p class="human-badges__foot">
      <template v-if="isOwn">
        Nothing to earn yet — this shelf is the promise. When reality challenges
        ship, they’ll land here.
      </template>
      <template v-else>
        No human badges issued yet. When they exist, they’ll show up on this
        shelf.
      </template>
    </p>
    <p class="human-badges__hint">
      <button type="button" class="human-badges__link" @click="openHumansSettings">
        Settings → Humans first
      </button>
      — why this exists.
    </p>
  </section>
</template>

<style lang="scss" scoped>
.human-badges {
  padding: 0.25rem 0 1.5rem;
  max-width: 40rem;
}

.human-badges__head {
  margin-bottom: 1rem;
}

.human-badges__title {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--neo-text-primary);
}

.human-badges__lede {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--neo-text-secondary);
  max-width: 52ch;
}

.human-badges__bot {
  margin: 0 0 1rem;
  padding: 0.65rem 0.85rem;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 8px;
  background: var(--neo-bg-tertiary);
}

.human-badges__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
  gap: 0.65rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.human-badges__card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.75rem 0.8rem;
  border: 1px dashed var(--neo-border-color);
  border-radius: 10px;
  background: color-mix(in srgb, var(--neo-bg-secondary) 88%, transparent);
  opacity: 0.92;
}

.human-badges__card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.human-badges__label {
  font-size: 0.8125rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--neo-text-primary);
}

.human-badges__lock {
  flex-shrink: 0;
  font-size: 0.625rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  padding: 0.12rem 0.4rem;
}

.human-badges__how {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--neo-text-secondary);
}

.human-badges__why {
  margin: 0;
  font-size: 0.6875rem;
  line-height: 1.4;
  color: var(--neo-text-muted);
}

.human-badges__foot {
  margin: 1.15rem 0 0.35rem;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
  max-width: 48ch;
}

.human-badges__hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.human-badges__link {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: inherit;
  color: var(--neo-accent, var(--neo-text-primary));
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--neo-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--neo-focus-ring, currentColor);
    outline-offset: 2px;
  }
}
</style>
