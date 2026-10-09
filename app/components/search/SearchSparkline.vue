<script setup lang="ts">
/**
 * Tiny 7-day usage trend for a hashtag (Mastodon history is newest-first).
 */
import type { mastodon } from 'masto'

const props = withDefaults(
  defineProps<{ history?: mastodon.v1.TagHistory[] | null; width?: number; height?: number }>(),
  { history: null, width: 56, height: 18 },
)

const points = computed(() => {
  const days = [...(props.history || [])].reverse().map((d) => Number(d.uses) || 0)
  if (days.length < 2 || !days.some(Boolean)) return ''
  const max = Math.max(...days, 1)
  const stepX = props.width / (days.length - 1)
  const pad = 2
  return days
    .map((v, i) => `${(i * stepX).toFixed(1)},${(pad + (props.height - pad * 2) * (1 - v / max)).toFixed(1)}`)
    .join(' ')
})

/** Rising if the latest two days beat the earlier average */
const rising = computed(() => {
  const days = [...(props.history || [])].reverse().map((d) => Number(d.uses) || 0)
  if (days.length < 4) return false
  const recent = (days.at(-1)! + days.at(-2)!) / 2
  const earlier = days.slice(0, -2).reduce((a, b) => a + b, 0) / (days.length - 2)
  return recent > earlier * 1.25 && recent >= 3
})
</script>

<template>
  <svg
    v-if="points"
    class="search-sparkline"
    :class="{ 'search-sparkline--rising': rising }"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    aria-hidden="true"
    focusable="false"
  >
    <polyline :points="points" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
  </svg>
</template>

<style scoped>
.search-sparkline {
  flex-shrink: 0;
  color: var(--neo-text-tertiary);
}

.search-sparkline--rising {
  color: var(--neo-accent);
}
</style>
