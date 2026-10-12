/**
 * NeoSpace → Loom insights export (CSV + preferred chart via postMessage).
 */

import { LOOM_ORIGINS } from '~/utils/loomHandoff'
import { buildZip } from '~/utils/zip'
import {
  insightDaysToCsv,
  insightHeatmapToCsv,
  insightPostsToCsv,
  type InsightsReport,
} from '~/utils/insights'

export const LOOM_HOME = 'https://loom.ibm.io/'

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

/** One .zip of three valid CSVs — a stacked "bundle" CSV mixes headers and opens as garbage in Excel */
function downloadZip(files: LoomExportFile[], filename: string) {
  const bytes = buildZip(files.map((f) => ({ name: f.name, data: f.csv })))
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadInsightsCsv(report: InsightsReport) {
  const { files } = buildInsightsExport(report)
  const slug = (report.account.acct || 'account').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)
  downloadZip(files, `neospace-insights-${slug}.zip`)
}

/**
 * Open Loom and hand off insight CSVs + preferred chart.
 * Only reports 'posted' after Loom acks ready (or echoes an ack).
 * Falls back to downloading CSVs if the popup is blocked or no ack arrives.
 */
export async function exportInsightsToLoom(
  report: InsightsReport,
): Promise<'posted' | 'downloaded' | 'slow'> {
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

  const dest = new URL(LOOM_HOME)
  dest.searchParams.set('from', 'neospace')
  dest.searchParams.set('dataset', 'insights')

  const child = window.open(dest.toString(), 'loom_neospace_insights')
  if (!child) {
    downloadInsightsCsv(report)
    return 'downloaded'
  }

  const targetOrigin = dest.origin
  let sent = false

  const send = () => {
    if (sent) return
    sent = true
    try {
      child.postMessage(payload, targetOrigin)
    } catch {
      /* ignore */
    }
  }

  return await new Promise<'posted' | 'downloaded' | 'slow'>((resolve) => {
    let settled = false
    const finish = (result: 'posted' | 'downloaded' | 'slow') => {
      if (settled) return
      settled = true
      if (result !== 'slow') {
        window.removeEventListener('message', onMessage)
      }
      window.clearTimeout(deadlineTimer)
      resolve(result)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== child) return
      if (!LOOM_ORIGINS.has(event.origin)) return
      const data = event.data
      if (!data || typeof data !== 'object') return
      const type = (data as { type?: string }).type
      if (type === 'loom-neospace-ready') {
        send()
        finish('posted')
        return
      }
      if (type === 'neospace-loom-ack') {
        send()
        finish('posted')
      }
    }

    window.addEventListener('message', onMessage)
    const deadlineTimer = window.setTimeout(() => {
      finish('slow')
    }, 8_000)
  })
}
