/**
 * NeoSpace → Loom insights export (CSV + preferred chart via postMessage).
 */

import { LOOM_ORIGINS } from '~/utils/loomHandoff'
import {
  insightDaysToCsv,
  insightHeatmapToCsv,
  insightPostsToCsv,
  type InsightsReport,
} from '~/utils/insights'

export const LOOM_HOME = 'https://loom.ibm.io/'
export const LOOM_DEV = 'https://loom-storyteller.mhsenkow.workers.dev/'

export type LoomExportFile = {
  name: string
  csv: string
}

export type LoomPreferredChart = {
  file: string
  kind: string
  xField: string
  yField?: string
  colorField?: string
  title?: string
  subtitle?: string
}

export type NeoSpaceLoomDataMessage = {
  type: 'neospace-loom-data'
  v: 1
  files: LoomExportFile[]
  preferred?: LoomPreferredChart
  source?: { label: string; acct?: string }
}

export function buildInsightsExport(report: InsightsReport): {
  files: LoomExportFile[]
  preferred: LoomPreferredChart
} {
  const acct = report.account.acct || 'account'
  const slug = acct.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)
  const files: LoomExportFile[] = [
    {
      name: `neospace-insights-daily-${slug}.csv`,
      csv: insightDaysToCsv(report.byDay),
    },
    {
      name: `neospace-insights-posts-${slug}.csv`,
      csv: insightPostsToCsv(report.posts),
    },
    {
      name: `neospace-insights-heatmap-${slug}.csv`,
      csv: insightHeatmapToCsv(report.heatmap),
    },
  ]
  return {
    files,
    preferred: {
      file: files[0]!.name,
      kind: 'area',
      xField: 'date',
      yField: 'engagement',
      title: `Engagement · @${acct}`,
      subtitle: `Last ${report.windowDays} days · NeoSpace insights`,
    },
  }
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadInsightsCsv(report: InsightsReport) {
  const { files } = buildInsightsExport(report)
  for (const f of files) downloadCsv(f.csv, f.name)
}

function loomOriginForOpen(): string {
  if (typeof window === 'undefined') return LOOM_HOME
  // Prefer production Loom; workers origin is accepted as postMessage target too.
  return LOOM_HOME
}

/**
 * Open Loom and hand off insight CSVs + preferred chart.
 * Falls back to downloading CSVs if the popup is blocked.
 */
export async function exportInsightsToLoom(report: InsightsReport): Promise<'posted' | 'downloaded'> {
  const { files, preferred } = buildInsightsExport(report)
  const payload: NeoSpaceLoomDataMessage = {
    type: 'neospace-loom-data',
    v: 1,
    files,
    preferred,
    source: {
      label: 'NeoSpace insights',
      acct: report.account.acct || undefined,
    },
  }

  const dest = new URL(loomOriginForOpen())
  dest.searchParams.set('from', 'neospace')
  dest.searchParams.set('dataset', 'insights')

  const child = window.open(dest.toString(), 'loom_neospace_insights')
  if (!child) {
    downloadInsightsCsv(report)
    return 'downloaded'
  }

  const targetOrigin = dest.origin
  let posted = false

  const send = () => {
    if (posted) return
    posted = true
    try {
      child.postMessage(payload, targetOrigin)
    } catch {
      /* ignore */
    }
  }

  const onMessage = (event: MessageEvent) => {
    if (!LOOM_ORIGINS.has(event.origin)) return
    const data = event.data
    if (!data || typeof data !== 'object') return
    if ((data as { type?: string }).type === 'loom-neospace-ready') {
      send()
      window.removeEventListener('message', onMessage)
    }
  }

  window.addEventListener('message', onMessage)
  // Also try after a short delay in case ready fired before listener attached
  window.setTimeout(send, 900)
  window.setTimeout(() => window.removeEventListener('message', onMessage), 12_000)

  return 'posted'
}
