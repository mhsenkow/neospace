<script setup lang="ts">
/** Signal inspector panel for a post card (opened from the post menu). */
import { formatSignalNumber, type StatusSignals } from '~/utils/signalInspector'

defineProps<{
  signals: StatusSignals
  /** Transient copy feedback ("Copied" / "Couldn’t copy"); empty when idle */
  copied: string
}>()

const emit = defineEmits<{
  copy: []
  close: []
}>()
</script>

<template>
  <aside class="status-inspector" aria-label="Post signal inspector">
    <header class="status-inspector__head">
      <strong>Signals</strong>
      <button type="button" class="status-inspector__copy" @click="emit('copy')">
        {{ copied || 'Copy JSON' }}
      </button>
      <button type="button" class="status-inspector__close" aria-label="Close inspector" @click="emit('close')">
        ×
      </button>
    </header>
    <dl class="status-inspector__grid">
      <div>
        <dt>Local id</dt>
        <dd>{{ signals.localId }}</dd>
      </div>
      <div>
        <dt>Origin</dt>
        <dd>{{ signals.originHost || '—' }}</dd>
      </div>
      <div>
        <dt>Browsing</dt>
        <dd>{{ signals.browsingHint || '—' }}</dd>
      </div>
      <div>
        <dt>Client</dt>
        <dd>{{ signals.application || '—' }}</dd>
      </div>
      <div>
        <dt>Language</dt>
        <dd>{{ signals.language || '—' }}</dd>
      </div>
      <div>
        <dt>Visibility</dt>
        <dd>{{ signals.visibility }}</dd>
      </div>
      <div>
        <dt>Length</dt>
        <dd>{{ signals.charCount }} chars · {{ signals.wordCount }} words · ~{{ formatSignalNumber(signals.readingMinutes, 1) }} min</dd>
      </div>
      <div>
        <dt>Density</dt>
        <dd>
          {{ signals.tagCount }} tags · {{ signals.mentionCount }} mentions ·
          {{ signals.linkCount }} links
          <template v-if="signals.hasCard"> · card</template>
          <template v-if="signals.hasCw"> · CW</template>
        </dd>
      </div>
      <div>
        <dt>Snowflake</dt>
        <dd>
          {{ signals.snowflakeIso || '—' }}
          <template v-if="signals.snowflakeDeltaMs != null">
            · Δ {{ signals.snowflakeDeltaMs }} ms
          </template>
        </dd>
      </div>
      <div>
        <dt>createdAt</dt>
        <dd>{{ signals.createdAtIso }}</dd>
      </div>
      <div v-if="signals.media.length">
        <dt>Media</dt>
        <dd>{{ signals.media.map((m) => `${m.count}× ${m.type}`).join(', ') }}</dd>
      </div>
      <div>
        <dt>Engagement</dt>
        <dd>
          {{ signals.engagement.favs }} fav ·
          {{ signals.engagement.boosts }} boost ·
          {{ signals.engagement.replies }} reply
        </dd>
      </div>
    </dl>
  </aside>
</template>

<style lang="scss" scoped>
.status-inspector {
  margin: 0.55rem 0 0.15rem;
  padding: 0.65rem 0.7rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  background: var(--neo-bg-secondary);
}

.status-inspector__head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.5rem;

  strong {
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--neo-text-muted);
  }
}

.status-inspector__copy,
.status-inspector__close {
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-primary);
  color: var(--neo-text-secondary);
  font: inherit;
  font-size: 0.6875rem;
  font-weight: 650;
  cursor: pointer;
}

.status-inspector__copy {
  margin-left: auto;
  padding: 0.2rem 0.55rem;
}

.status-inspector__close {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  font-size: 1rem;
  line-height: 1;
}

.status-inspector__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.4rem;
  margin: 0;

  div {
    display: grid;
    grid-template-columns: 5.5rem 1fr;
    gap: 0.4rem;
    min-width: 0;
  }

  dt {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--neo-text-tertiary);
  }

  dd {
    margin: 0;
    font-size: 0.75rem;
    color: var(--neo-text-secondary);
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
}
</style>
