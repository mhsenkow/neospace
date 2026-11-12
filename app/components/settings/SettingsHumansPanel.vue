<script setup lang="ts">
/**
 * Settings → Humans — product north star (not a monetization page).
 */
import { useSettingsStore } from '~/stores/settings'

const settingsStore = useSettingsStore()
</script>

<template>
  <section class="settings-section">
    <SettingsSectionHeader :category="settingsStore.currentCategory" />

    <div class="settings-form">
      <div class="settings-humans">
        <p class="settings-humans__lede">
          LoomSpace is here so <strong>humans</strong> can find each other, understand
          each other, and stay in control of their attention. Not to farm engagement.
          Not to capitalize the commons.
        </p>

        <h3 class="settings-subheading">Keep in the frame</h3>
        <ul class="settings-humans__list">
          <li>Tools that help people connect and be better to each other</li>
          <li>Affinity toward people you know — not anonymous scoreboards</li>
          <li>
            AI only as an optional helper for clarity, discovery, and accessibility —
            never a stand-in for the person on the other end
          </li>
          <li>Edward Mode as a human radar, not an engagement funnel</li>
        </ul>

        <h3 class="settings-subheading">Keep out of the frame</h3>
        <ul class="settings-humans__list">
          <li>Ads, pay-to-boost, or selling your attention</li>
          <li>Dark patterns that rack up dopamine for metrics</li>
          <li>Ranking who “deserves” to be seen</li>
        </ul>

        <div class="settings-divider" />

        <h3 class="settings-subheading">Already in motion</h3>
        <p class="settings-hint">
          Edward’s <strong>no bots</strong> chip hides accounts marked as bots (and
          obvious self-marks). That’s a start — not a finished proof of humanity.
        </p>

        <div class="settings-divider" />

        <h3 class="settings-subheading">Where this is headed</h3>
        <p class="settings-hint">
          Someday: optional <strong>proofs of reality</strong> — short, weird,
          real-world photo challenges that are easy for a person and expensive for a
          farm. Think “hand doing something odd in front of a mushroom,” not a
          passport scan. Fresh prompts, hard to script at scale, always voluntary.
        </p>
        <p class="settings-hint">
          Those proofs (and other hard-for-bots goods — real yaps, neighbor care,
          teaching newcomers) land as <strong>Verified human</strong> badges on your
          profile’s <strong>Human</strong> tab. A shelf of good things a farm can’t
          cheaply fake — not a blue check for sale.
        </p>
        <p class="settings-hint">
          The point isn’t surveillance. It’s raising the cost of pretending to be
          human when you’re a warehouse of scripts — so the timeline stays a place
          for people.
        </p>
        <p class="settings-humans__soon" role="status">
          Not built yet — the Human tab is the empty shelf, written so the intent
          stays honest.
        </p>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
@use '~/assets/css/settingsPanel' as panel;

@include panel.shared;

.settings-humans {
  max-width: 54ch;
}

.settings-humans__lede {
  margin: 0 0 1.15rem;
  font-size: 0.9375rem;
  line-height: 1.55;
  color: var(--neo-text-primary);

  strong {
    font-weight: 650;
  }
}

.settings-humans__list {
  margin: 0 0 1rem;
  padding: 0 0 0 1.15rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--neo-text-secondary);
  max-width: 52ch;

  li + li {
    margin-top: 0.35rem;
  }
}

.settings-humans__soon {
  margin: 0.75rem 0 0;
  padding: 0.65rem 0.85rem;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  line-height: 1.4;
  color: var(--neo-text-muted);
  border: 1px dashed var(--neo-border-color);
  border-radius: 6px;
  background: var(--neo-bg-tertiary);
}
</style>
