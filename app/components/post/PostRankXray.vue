<script setup lang="ts">
/**
 * Ranked-feed "why" chip + score X-Ray for a post card (For You / algorithm feeds).
 * The parent owns the open state so it can reset it when the card swaps posts.
 */
import type { RankBreakdown } from '~/utils/rankers'

const props = defineProps<{
  rankWhy: string
  rankBreakdown: RankBreakdown | null
  cardLabelId: string
}>()

const rankXrayOpen = defineModel<boolean>('open', { default: false })

const rankTermMax = computed(() => {
  const terms = props.rankBreakdown?.terms || []
  return Math.max(0.001, ...terms.map((t) => Math.abs(t.contribution)))
})
const formatRankScore = (n: number) => {
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) >= 100) return n.toFixed(1)
  if (Math.abs(n) >= 10) return n.toFixed(2)
  return n.toFixed(3)
}
</script>

<template>
  <div class="status-rank">
    <button
      type="button"
      class="status-rank-why"
      :aria-expanded="rankXrayOpen"
      :aria-controls="rankBreakdown ? `rank-xray-${cardLabelId}` : undefined"
      @click.stop="rankBreakdown && (rankXrayOpen = !rankXrayOpen)"
    >
      <NeoIcon name="sort" :size="12" :stroke="1.85" />
      <span>{{ rankWhy }}</span>
      <svg
        v-if="rankBreakdown"
        class="status-rank-why__chevron"
        :class="{ 'status-rank-why__chevron--open': rankXrayOpen }"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    <div
      v-if="rankBreakdown && rankXrayOpen"
      :id="`rank-xray-${cardLabelId}`"
      class="status-rank-xray"
      role="region"
      aria-label="Ranking score breakdown"
    >
      <p class="status-rank-xray__head">
        <strong>{{ formatRankScore(rankBreakdown.finalScore) }}</strong>
        <span>
          {{ rankBreakdown.ranker === 'home' ? 'For You' : `${rankBreakdown.ranker}-style` }}
          · {{ rankBreakdown.source }}
          · reach {{ formatRankScore(rankBreakdown.reach) }}
          · age {{ formatRankScore(rankBreakdown.ageHours) }}h
        </span>
      </p>
      <ul class="status-rank-xray__terms">
        <li v-for="term in rankBreakdown.terms" :key="term.label">
          <div class="status-rank-xray__term-head">
            <span>{{ term.label }}</span>
            <span class="status-rank-xray__term-val">{{ formatRankScore(term.contribution) }}</span>
          </div>
          <div class="status-rank-xray__bar" aria-hidden="true">
            <span
              class="status-rank-xray__bar-fill"
              :class="{ 'status-rank-xray__bar-fill--neg': term.contribution < 0 }"
              :style="{
                width: `${Math.min(100, (Math.abs(term.contribution) / rankTermMax) * 100)}%`,
              }"
            />
          </div>
          <p class="status-rank-xray__raw">{{ term.rawSignal }} · w={{ term.weight }}</p>
        </li>
      </ul>
      <p class="status-rank-xray__mods">
        Recency ×{{ formatRankScore(rankBreakdown.recencyMultiplier) }}
        · Network ×{{ formatRankScore(rankBreakdown.networkMultiplier) }}
        · Diversity ×{{ formatRankScore(rankBreakdown.diversityMultiplier) }}
        <template v-if="rankBreakdown.interestMultiplier != null">
          · Interest ×{{ formatRankScore(rankBreakdown.interestMultiplier) }}
        </template>
      </p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.status-rank {
  margin: 0 0 0.45rem;
  min-width: 0;
}

.status-rank-why {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  margin: 0;
  padding: 0.15rem 0.45rem 0.15rem 0.35rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  font: inherit;
  font-size: 0.75rem;
  color: var(--neo-text-tertiary);
  cursor: pointer;
  text-align: left;

  &:hover,
  &[aria-expanded='true'] {
    color: var(--neo-text-secondary);
    background: color-mix(in srgb, var(--neo-text-primary) 5%, transparent);
    border-color: var(--neo-border-color);
  }

  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__chevron {
    flex-shrink: 0;
    transition: transform var(--neo-dur-quick, 160ms) var(--neo-ease-out);

    &--open {
      transform: rotate(180deg);
    }
  }
}

.status-rank-xray {
  margin: 0.4rem 0 0.15rem;
  padding: 0.65rem 0.7rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  background: color-mix(in srgb, var(--neo-bg-secondary) 88%, var(--neo-accent) 12%);
}

.status-rank-xray__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.65rem;
  margin: 0 0 0.55rem;
  font-size: 0.75rem;
  color: var(--neo-text-muted);

  strong {
    font-size: 0.9375rem;
    font-variant-numeric: tabular-nums;
    color: var(--neo-text-primary);
  }
}

.status-rank-xray__terms {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.status-rank-xray__term-head {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
}

.status-rank-xray__term-val {
  font-variant-numeric: tabular-nums;
  color: var(--neo-text-primary);
}

.status-rank-xray__bar {
  height: 0.35rem;
  margin-top: 0.2rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--neo-text-primary) 8%, transparent);
  overflow: hidden;
}

.status-rank-xray__bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--neo-accent);

  &--neg {
    background: var(--neo-danger, #e11d48);
  }
}

.status-rank-xray__raw {
  margin: 0.15rem 0 0;
  font-size: 0.6875rem;
  color: var(--neo-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.status-rank-xray__mods {
  margin: 0.55rem 0 0;
  font-size: 0.6875rem;
  line-height: 1.4;
  color: var(--neo-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
