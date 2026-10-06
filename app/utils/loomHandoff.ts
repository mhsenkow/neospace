/**
 * Pure Loom → NeoSpace handoff helpers (story URLs, lineage, chart alt).
 * Kept free of Pinia / browser APIs so smoke tests can run in Node.
 */

export const LOOM_ORIGINS = new Set([
  'https://loom.ibm.io',
  'https://loom-storyteller.mhsenkow.workers.dev',
])

export const LOOM_STORY_RE =
  /^https:\/\/(loom\.ibm\.io|loom-storyteller\.mhsenkow\.workers\.dev)\/s\/([a-z0-9]{8,16})\/?$/i

/** Mastodon media description soft limit (common default). */
export const CHART_ALT_MAX = 1500

export function storyIdFromUrl(url: string): string | null {
  const m = url.trim().match(LOOM_STORY_RE)
  return m?.[2] ?? null
}

export function storyBase(url: string): string | null {
  const id = storyIdFromUrl(url)
  if (!id) return null
  try {
    const u = new URL(url)
    return `${u.origin}/s/${id}`
  } catch {
    return null
  }
}

export function lineageBlurb(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const source = o.source as { label?: string; url?: string } | undefined
  const cols = Array.isArray(o.columns) ? o.columns.length : 0
  const rows =
    typeof o.totalRows === 'number' ? o.totalRows : Array.isArray(o.rows) ? o.rows.length : 0
  const truncated = !!o.truncated
  const captured = typeof o.capturedAt === 'string' ? o.capturedAt.slice(0, 10) : null
  const bits: string[] = []
  if (source?.label) bits.push(`Source: ${source.label}`)
  if (rows) bits.push(`${rows.toLocaleString()} rows${truncated ? ' (sample)' : ''}`)
  if (cols) bits.push(`${cols} columns`)
  if (captured) bits.push(`captured ${captured}`)
  return bits.length ? `Data lineage · ${bits.join(' · ')}` : null
}

/**
 * Suggested image alt for a Loom chart — title + optional lineage summary.
 * Callers may let the user edit before/after upload.
 */
export function suggestedChartAlt(opts: {
  caption?: string | null
  lineage?: string | null
  title?: string | null
}): string {
  const fromCaption = (opts.caption || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('http') && !l.startsWith('Data lineage'))
  const title = (opts.title || fromCaption || 'Chart').trim().slice(0, 120)
  const bits = [`Chart: ${title}`]
  const lineage = (opts.lineage || '').replace(/^Data lineage ·\s*/i, '').trim()
  if (lineage) bits.push(lineage)
  return bits.join('. ').slice(0, CHART_ALT_MAX)
}

/** Privacy copy for story links (image + lineage JSON). */
export const STORY_PUBLIC_NOTICE =
  'Story links are public for 7 days (chart image + data lineage). Don’t share private or PII datasets.'
