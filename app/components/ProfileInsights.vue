<script setup lang="ts">
/**
 * Own-profile Insights — Threads-style panel with better substance:
 * engagement from real Mastodon status fields + Loom export.
 */

import { useInsightsStore } from '~/stores/insights'
import type { mastodon } from 'masto'
import {
  formatCompact,
  type InsightsWindowDays,
} from '~/utils/insights'
import { downloadInsightsCsv, exportInsightsToLoom } from '~/utils/loomExport'

const props = defineProps<{
  account: mastodon.v1.Account
}>()

const insights = useInsightsStore()
const exportBusy = ref(false)
const exportNote = ref('')

const windows: { days: InsightsWindowDays; label: string }[] = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
]

const report = computed(() => insights.report)

const load = async (days?: InsightsWindowDays) => {
  exportNote.value = ''
  await insights.fetchInsights(props.account, days)
}

onMounted(async () => {
  await Promise.all([load(), insights.fetchAnnualReports()])
})

onBeforeUnmount(() => {
  insights.abortInFlight()
})

watch(
  () => props.account.id,
  async (id, prev) => {
    if (!id || id === prev) return
    insights.clear()
    await Promise.all([load(), insights.fetchAnnualReports()])
  },
)

const setWindow = async (days: InsightsWindowDays) => {
  if (insights.windowDays === days && report.value) return
  await load(days)
}

const onExportLoom = async () => {
  if (!report.value || exportBusy.value) return
  exportBusy.value = true
  exportNote.value = ''
  try {
    const result = await exportInsightsToLoom(report.value)
    exportNote.value =
      result === 'posted'
        ? 'Opened Loom with your insight datasets.'
        : 'Loom didn’t acknowledge — CSVs downloaded instead.'
  } catch {
    exportNote.value = 'Export failed — try Download CSV.'
  } finally {
    exportBusy.value = false
  }
}

const onDownload = () => {
  if (!report.value) return
  downloadInsightsCsv(report.value)
  exportNote.value = 'CSVs downloaded.'
}

/** Area chart path for daily engagement */
const areaPath = computed(() => {
  const days = report.value?.byDay || []
  if (!days.length) return { line: '', area: '', max: 0 }
  const w = 320
  const h = 96
  const pad = 4
  const max = Math.max(1, ...days.map((d) => d.engagement))
  const pts = days.map((d, i) => {
    const x = pad + (i / Math.max(1, days.length - 1)) * (w - pad * 2)
    const y = h - pad - (d.engagement / max) * (h - pad * 2)
    return [x, y] as const
  })
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)},${h - pad} L${pts[0]![0].toFixed(1)},${h - pad} Z`
  return { line, area, max, w, h }
})

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const
const TYPE_KINDS = new Set(['original', 'reply', 'boost'])
const ATTR_KINDS = new Set(['media', 'poll', 'cw'])
const TYPE_LABELS: Record<string, string> = {
  original: 'Original',
  reply: 'Reply',
  boost: 'Boost',
  media: 'With media',
  poll: 'Poll',
  cw: 'Content warning',
}

/** Precomputed 7×24 matrix — avoid Array.find per cell */
const heatMatrix = computed(() => {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const c of report.value?.heatmap || []) {
    if (c.weekday >= 0 && c.weekday < 7 && c.hour >= 0 && c.hour < 24) {
      grid[c.weekday]![c.hour] = c.posts
    }
  }
  return grid
})

const heatMax = computed(() => {
  let max = 0
  for (const row of heatMatrix.value) {
    for (const n of row) if (n > max) max = n
  }
  return Math.max(1, max)
})

const heatCell = (weekday: number, hour: number) =>
  heatMatrix.value[weekday]?.[hour] || 0

const heatSummary = computed(() => {
  let peakPosts = 0
  let peakDay = 0
  let peakHour = 0
  let activeCells = 0
  let totalPosts = 0
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const n = heatCell(w, h)
      if (n > 0) {
        activeCells++
        totalPosts += n
      }
      if (n > peakPosts) {
        peakPosts = n
        peakDay = w
        peakHour = h
      }
    }
  }
  if (!peakPosts) return 'No posts in this window yet.'
  return `Most active: ${DAY_NAMES[peakDay]} ${String(peakHour).padStart(2, '0')}:00 (${peakPosts} post${peakPosts === 1 ? '' : 's'}) · ${activeCells} active slots · ${totalPosts} posts`
})

const heatTableRows = computed(() => {
  const rows: { day: string; hour: number; posts: number }[] = []
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const posts = heatCell(w, h)
      if (posts > 0) rows.push({ day: DAY_NAMES[w]!, hour: h, posts })
    }
  }
  return rows.sort((a, b) => b.posts - a.posts || a.day.localeCompare(b.day) || a.hour - b.hour)
})

const typeMix = computed(() =>
  (report.value?.mix || []).filter((m) => TYPE_KINDS.has(m.kind)),
)

const attrMix = computed(() =>
  (report.value?.mix || []).filter((m) => ATTR_KINDS.has(m.kind)),
)

const typeMixTotal = computed(() =>
  typeMix.value.reduce((s, m) => s + m.count, 0) || 1,
)

const waffleCells = computed(() => {
  const mix = typeMix.value
  const total = 100
  const cells: { kind: string; i: number }[] = []
  let used = 0
  for (const m of mix) {
    const n = Math.max(0, Math.round((m.count / typeMixTotal.value) * total))
    for (let i = 0; i < n && used < total; i++) {
      cells.push({ kind: m.kind, i: used++ })
    }
  }
  while (cells.length < total) cells.push({ kind: 'empty', i: cells.length })
  return cells.slice(0, total)
})

const heatCellStyle = (posts: number) => {
  if (posts <= 0) return undefined
  return { opacity: String(0.22 + (posts / heatMax.value) * 0.78) }
}

const kpi = computed(() => {
  const t = report.value?.totals
  if (!t) return []
  return [
    { label: 'Posts', value: formatCompact(t.posts) },
    { label: 'Engagement', value: formatCompact(t.engagement) },
    { label: 'Avg / post', value: formatCompact(t.avgEngagement) },
    { label: 'Favourites', value: formatCompact(t.favourites) },
    { label: 'Boosts', value: formatCompact(t.reblogs) },
    { label: 'Replies', value: formatCompact(t.repliesRecv) },
  ]
})
</script>

<template>
  <section class="insights" aria-label="Profile insights">
    <header class="insights__head">
      <div>
        <h2 class="insights__title">Insights</h2>
        <p class="insights__sub">
          Known engagement from your posts — favourites, boosts, replies, quotes.
          Mastodon does not expose views or reach.
        </p>
      </div>
      <div class="insights__windows" role="group" aria-label="Time window">
        <button
          v-for="w in windows"
          :key="w.days"
          type="button"
          class="insights__chip"
          :class="{ 'insights__chip--on': insights.windowDays === w.days }"
          :aria-pressed="insights.windowDays === w.days"
          @click="setWindow(w.days)"
        >
          {{ w.label }}
        </button>
      </div>
    </header>

    <div v-if="insights.isLoading && !report" class="insights__loading" aria-busy="true">
      <FunLoader fill label="Loading insights" />
    </div>

    <div v-else-if="insights.error" class="insights__error" role="alert">
      <p>{{ insights.error }}</p>
      <button type="button" class="neo-btn neo-btn--secondary" @click="load()">Retry</button>
    </div>

    <template v-else-if="report">
      <div class="insights__actions">
        <button
          type="button"
          class="neo-btn neo-btn--primary"
          :disabled="exportBusy || !report.posts.length"
          @click="onExportLoom"
        >
          {{ exportBusy ? 'Opening Loom…' : 'Open in Loom' }}
        </button>
        <button
          type="button"
          class="neo-btn neo-btn--secondary"
          :disabled="!report.posts.length"
          @click="onDownload"
        >
          Download CSV
        </button>
        <p v-if="exportNote" class="insights__note" role="status">{{ exportNote }}</p>
      </div>

      <div class="insights__kpis" role="list">
        <div v-for="item in kpi" :key="item.label" class="insights__kpi" role="listitem">
          <span class="insights__kpi-val">{{ item.value }}</span>
          <span class="insights__kpi-label">{{ item.label }}</span>
        </div>
      </div>

      <p v-if="report.truncated" class="insights__caveat">
        Sample capped at recent posts — older activity in this window may be missing.
      </p>
      <p v-else-if="!report.posts.length" class="insights__caveat">
        No posts in this window yet.
      </p>

      <div v-if="report.byDay.some((d) => d.engagement || d.posts)" class="insights__card">
        <h3 class="insights__card-title">Engagement over time</h3>
        <p class="insights__card-sub">Daily favourites + boosts + replies + quotes</p>
        <p class="insights__card-summary">
          Peak {{ formatCompact(areaPath.max) }} engagement
          · {{ report.byDay.filter((d) => d.engagement || d.posts).length }} active days
          · total {{ formatCompact(report.totals.engagement) }}
        </p>
        <svg
          class="insights__area"
          :viewBox="`0 0 ${areaPath.w || 320} ${areaPath.h || 96}`"
          role="img"
          :aria-label="`Engagement chart, peak ${formatCompact(areaPath.max)}`"
          aria-describedby="insights-area-data"
        >
          <path :d="areaPath.area" class="insights__area-fill" />
          <path :d="areaPath.line" class="insights__area-line" fill="none" />
        </svg>
        <details class="insights__data-table">
          <summary>View data</summary>
          <table id="insights-area-data">
            <caption class="sr-only">Daily engagement values</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Posts</th>
                <th scope="col">Engagement</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in report.byDay" :key="d.date">
                <td>{{ d.date }}</td>
                <td>{{ d.posts }}</td>
                <td>{{ d.engagement }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </div>

      <div v-if="report.posts.length" class="insights__card">
        <h3 class="insights__card-title">When you post</h3>
        <p class="insights__card-sub">Hour × weekday heatmap</p>
        <p class="insights__card-summary" id="insights-heat-summary">{{ heatSummary }}</p>
        <div
          class="insights__heat"
          role="img"
          :aria-label="heatSummary"
          aria-describedby="insights-heat-summary insights-heat-legend"
        >
          <div class="insights__heat-corner" />
          <div
            v-for="h in 24"
            :key="'h-' + (h - 1)"
            class="insights__heat-hour"
          >
            {{ (h - 1) % 6 === 0 ? String(h - 1).padStart(2, '0') : '' }}
          </div>
          <template v-for="w in 7" :key="'w-' + (w - 1)">
            <div class="insights__heat-day">
              <abbr :title="DAY_NAMES[w - 1]">{{ DAY_LETTERS[w - 1] }}</abbr>
            </div>
            <div
              v-for="h in 24"
              :key="`${w}-${h}`"
              class="insights__heat-cell"
              :class="{ 'insights__heat-cell--empty': heatCell(w - 1, h - 1) === 0 }"
              :title="`${DAY_NAMES[w - 1]} ${h - 1}:00 — ${heatCell(w - 1, h - 1)} posts`"
              :style="heatCellStyle(heatCell(w - 1, h - 1))"
            />
          </template>
        </div>
        <div id="insights-heat-legend" class="insights__heat-legend" aria-hidden="true">
          <span class="insights__heat-legend-swatch insights__heat-legend-swatch--empty" /> None
          <span class="insights__heat-legend-swatch insights__heat-legend-swatch--low" /> Low
          <span class="insights__heat-legend-swatch insights__heat-legend-swatch--high" /> High
        </div>
        <details class="insights__data-table">
          <summary>View heatmap data</summary>
          <table id="insights-heat-data">
            <caption class="sr-only">Posts by weekday and hour</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Hour</th>
                <th scope="col">Posts</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in heatTableRows" :key="`${row.day}-${row.hour}`">
                <td>{{ row.day }}</td>
                <td>{{ String(row.hour).padStart(2, '0') }}:00</td>
                <td>{{ row.posts }}</td>
              </tr>
              <tr v-if="!heatTableRows.length">
                <td colspan="3">No posts in this window</td>
              </tr>
            </tbody>
          </table>
        </details>
      </div>

      <div v-if="typeMix.length && report.posts.length" class="insights__card">
        <h3 class="insights__card-title">Post types</h3>
        <p class="insights__card-sub">Exclusive mix — each post counts once</p>
        <div class="insights__waffle" aria-hidden="true">
          <span
            v-for="cell in waffleCells"
            :key="cell.i"
            class="insights__waffle-cell"
            :data-kind="cell.kind"
          />
        </div>
        <ul class="insights__legend">
          <li v-for="m in typeMix" :key="m.kind">
            <span class="insights__swatch" :data-kind="m.kind" />
            {{ TYPE_LABELS[m.kind] || m.kind }} · {{ m.count }}
            ({{ Math.round((m.count / typeMixTotal) * 100) }}%)
          </li>
        </ul>
      </div>

      <div v-if="attrMix.length && report.posts.length" class="insights__card">
        <h3 class="insights__card-title">Attributes</h3>
        <p class="insights__card-sub">Overlapping flags — a post can have several</p>
        <ul class="insights__attrs">
          <li v-for="m in attrMix" :key="m.kind" class="insights__attr">
            <div class="insights__attr-head">
              <span>{{ TYPE_LABELS[m.kind] || m.kind }}</span>
              <span class="insights__attr-count">
                {{ m.count }}
                ({{ Math.round((m.count / Math.max(1, report.totals.posts)) * 100) }}%)
              </span>
            </div>
            <div
              class="insights__attr-bar"
              role="presentation"
              :style="{
                width: `${Math.min(100, Math.round((m.count / Math.max(1, report.totals.posts)) * 100))}%`,
              }"
              :data-kind="m.kind"
            />
          </li>
        </ul>
      </div>

      <div v-if="report.topPosts.length" class="insights__card">
        <h3 class="insights__card-title">Top posts</h3>
        <ol class="insights__tops">
          <li v-for="post in report.topPosts" :key="post.id">
            <a
              v-if="post.url"
              :href="post.url"
              class="insights__top-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span class="insights__top-score">{{ formatCompact(post.engagement) }}</span>
              <span class="insights__top-preview">{{ post.preview || '(no text)' }}</span>
            </a>
            <div v-else class="insights__top-link">
              <span class="insights__top-score">{{ formatCompact(post.engagement) }}</span>
              <span class="insights__top-preview">{{ post.preview || '(no text)' }}</span>
            </div>
          </li>
        </ol>
      </div>

      <div v-if="report.topTags.length" class="insights__card">
        <h3 class="insights__card-title">Hashtags</h3>
        <ul class="insights__tags">
          <li v-for="tag in report.topTags" :key="tag.name">
            <span class="insights__tag-name">#{{ tag.name }}</span>
            <span class="insights__tag-meta">
              {{ tag.count }} · {{ formatCompact(tag.engagement) }} eng
            </span>
          </li>
        </ul>
      </div>

      <div v-if="insights.annual.length" class="insights__card">
        <h3 class="insights__card-title">Wrapstodon</h3>
        <p class="insights__card-sub">Yearly reports from your instance</p>
        <ul class="insights__annual">
          <li v-for="yr in insights.annual" :key="yr.year">
            <strong>{{ yr.year }}</strong>
            <span v-if="yr.archetype"> · {{ yr.archetype }}</span>
            <a
              v-if="yr.shareUrl"
              :href="yr.shareUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="insights__annual-link"
            >
              Open report
            </a>
          </li>
        </ul>
      </div>

      <p class="insights__foot">
        Lifetime ·
        {{ formatCompact(report.account.followers) }} followers ·
        {{ formatCompact(report.account.statuses) }} statuses
        <template v-if="report.account.lastStatusAt">
          · last active {{ new Date(report.account.lastStatusAt).toLocaleDateString() }}
        </template>
      </p>
    </template>
  </section>
</template>

<style lang="scss" scoped>
.insights {
  padding: 0.75rem 1rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.insights__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.insights__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 650;
  color: var(--neo-text-primary);
}

.insights__sub {
  margin: 0.35rem 0 0;
  max-width: 42ch;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-muted);
}

.insights__windows {
  display: flex;
  gap: 0.35rem;
}

.insights__chip {
  min-width: 2.75rem;
  min-height: 2.25rem;
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--neo-border-color);
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;

  &--on {
    background: var(--neo-text-primary);
    border-color: var(--neo-text-primary);
    color: var(--neo-bg-primary);
  }
}

.insights__loading {
  min-height: min(48dvh, 22rem);
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
}

.insights__error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
  color: var(--neo-text-muted);
}

.insights__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.insights__note {
  margin: 0;
  width: 100%;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.insights__kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.insights__kpi {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.65rem 0.5rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--neo-text-primary) 4%, transparent);
}

.insights__kpi-val {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--neo-text-primary);
  font-variant-numeric: tabular-nums;
}

.insights__kpi-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--neo-text-muted);
}

.insights__caveat {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.insights__card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem 0 0.25rem;
  border-top: 1px solid var(--neo-border-color);
}

.insights__card-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 650;
  color: var(--neo-text-primary);
}

.insights__card-summary {
  margin: 0 0 0.65rem;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
}

.insights__data-table {
  margin-top: 0.75rem;
  font-size: 0.75rem;
  color: var(--neo-text-secondary);

  summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  table {
    width: 100%;
    margin-top: 0.5rem;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 0.25rem 0.4rem;
    border-bottom: 1px solid var(--neo-border-color);
    text-align: left;
  }
}

.insights__card-sub {
  margin: 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.insights__area {
  width: 100%;
  height: auto;
  display: block;
}

.insights__area-fill {
  fill: color-mix(in srgb, var(--neo-accent) 22%, transparent);
}

.insights__area-line {
  stroke: var(--neo-accent);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.insights__heat {
  display: grid;
  grid-template-columns: 1.1rem repeat(24, minmax(0, 1fr));
  gap: 2px;
  align-items: center;
}

.insights__heat-corner {
  width: 1.1rem;
}

.insights__heat-hour {
  font-size: 0.5625rem;
  color: var(--neo-text-tertiary);
  text-align: center;
  line-height: 1;
  min-height: 0.7rem;
}

.insights__heat-day {
  font-size: 0.625rem;
  color: var(--neo-text-muted);
  font-weight: 600;
}

.insights__heat-cell {
  aspect-ratio: 1;
  border-radius: 2px;
  background: var(--neo-accent);
  min-height: 0.45rem;

  &--empty {
    background: color-mix(in srgb, var(--neo-text-primary) 8%, var(--neo-bg-primary));
    opacity: 1;
  }
}

.insights__heat-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.75rem;
  margin-top: 0.35rem;
  font-size: 0.6875rem;
  color: var(--neo-text-muted);
}

.insights__heat-legend-swatch {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 2px;
  display: inline-block;
  vertical-align: middle;
  margin-right: 0.2rem;

  &--empty {
    background: color-mix(in srgb, var(--neo-text-primary) 8%, var(--neo-bg-primary));
    box-shadow: inset 0 0 0 1px var(--neo-border-color);
  }

  &--low {
    background: var(--neo-accent);
    opacity: 0.28;
  }

  &--high {
    background: var(--neo-accent);
    opacity: 1;
  }
}

.insights__heat-day abbr {
  text-decoration: none;
}

.insights__waffle {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 3px;
}

.insights__waffle-cell {
  aspect-ratio: 1;
  border-radius: 2px;
  background: color-mix(in srgb, var(--neo-text-primary) 12%, transparent);

  &[data-kind='original'] {
    background: var(--neo-accent);
  }
  &[data-kind='reply'] {
    background: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-text-primary));
  }
  &[data-kind='boost'] {
    background: color-mix(in srgb, var(--neo-accent) 30%, var(--neo-text-muted));
  }
}

.insights__attrs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.insights__attr-head {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
  margin-bottom: 0.25rem;
}

.insights__attr-count {
  font-variant-numeric: tabular-nums;
  color: var(--neo-text-muted);
}

.insights__attr-bar {
  height: 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-text-muted));
  min-width: 0.35rem;

  &[data-kind='media'] {
    background: color-mix(in srgb, var(--neo-accent) 70%, var(--neo-success, #2a6));
  }
  &[data-kind='poll'] {
    background: color-mix(in srgb, var(--neo-accent) 50%, var(--neo-info, #26a));
  }
  &[data-kind='cw'] {
    background: color-mix(in srgb, var(--neo-text-muted) 70%, var(--neo-accent));
  }
}

.insights__legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.85rem;
  font-size: 0.75rem;
  color: var(--neo-text-secondary);

  li {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
}

.insights__swatch {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 2px;
  background: var(--neo-accent);

  &[data-kind='reply'] {
    background: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-text-primary));
  }
  &[data-kind='boost'] {
    background: color-mix(in srgb, var(--neo-accent) 30%, var(--neo-text-muted));
  }
}

.insights__tops {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.insights__top-link {
  display: grid;
  grid-template-columns: 3.25rem 1fr;
  gap: 0.65rem;
  align-items: start;
  text-decoration: none;
  color: inherit;
  padding: 0.35rem 0;
  border-radius: 0.35rem;

  &:hover .insights__top-preview {
    color: var(--neo-text-primary);
  }
}

.insights__top-score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--neo-accent);
  font-size: 0.9375rem;
}

.insights__top-preview {
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--neo-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.insights__tags {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.insights__tag-name {
  font-weight: 600;
  color: var(--neo-text-primary);
  margin-right: 0.5rem;
}

.insights__tag-meta {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  font-variant-numeric: tabular-nums;
}

.insights__annual {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--neo-text-secondary);
}

.insights__annual-link {
  margin-left: 0.5rem;
  color: var(--neo-accent);
}

.insights__foot {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--neo-text-tertiary);
}

@media (max-width: 420px) {
  .insights__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
