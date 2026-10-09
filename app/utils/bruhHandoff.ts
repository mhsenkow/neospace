/**
 * bruh → NeoSpace handoff (sibling of the Loom contract).
 * bruh is the paper-first writing room in the suite; it opens NeoSpace with
 * `?compose=bruh&text=…` and, when the opener survives, posts
 * `bruh-neospace-share` (v1: { text, doc }) after our `neospace-bruh-ready` ping.
 * Text only — never tokens, never files.
 */

export const BRUH_ORIGINS = new Set([
  'https://bruh.ibm.io',
  'https://bruh.mhsenkow.workers.dev',
  'https://bruh-15b.pages.dev',
])

export type BruhShareMessage = {
  type: 'bruh-neospace-share'
  v: 1
  text: string
  /** Share URL that carries the page; appended if the text doesn't already include it */
  doc?: string
}

/** Pages projects whose preview subdomains (`<hash>.<project>.pages.dev`) we trust */
const BRUH_PAGES_PROJECTS = ['bruh-15b.pages.dev', 'bruh.pages.dev']
/** workers.dev account that hosts the suite's preview builds */
const SUITE_WORKERS_SUFFIX = '.mhsenkow.workers.dev'

/**
 * True for allowlisted bruh hosts + local/preview siblings. Anyone can register
 * `*bruh*.pages.dev` / `*bruh*.workers.dev`, so only our projects/account count.
 */
export function isBruhOrigin(origin: string): boolean {
  if (BRUH_ORIGINS.has(origin)) return true
  try {
    const { protocol, hostname: host } = new URL(origin)
    if (host === 'localhost' || host === '127.0.0.1') return true
    if (protocol !== 'https:') return false
    if (BRUH_PAGES_PROJECTS.some((p) => host === p || host.endsWith(`.${p}`))) return true
    if (host.endsWith(SUITE_WORKERS_SUFFIX) && host.includes('bruh')) return true
  } catch {
    /* ignore */
  }
  return false
}

export function isBruhShare(data: unknown): data is BruhShareMessage {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return d.type === 'bruh-neospace-share' && d.v === 1 && typeof d.text === 'string'
}

/** Compose text for a bruh share — make sure the page link rides along. */
export function bruhShareText(msg: BruhShareMessage): string {
  const text = typeof msg.text === 'string' ? msg.text.trim() : ''
  const doc = typeof msg.doc === 'string' ? msg.doc.trim() : ''
  if (!doc) return text
  if (!text) return doc
  if (text.includes(doc)) return text
  return `${text}\n\n${doc}`
}
