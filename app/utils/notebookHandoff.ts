/**
 * Throughline (notebook) → NeoSpace handoff (sibling of the bruh contract).
 * Opens NeoSpace with `?compose=notebook&text=…` and, when the opener survives,
 * posts `notebook-neospace-share` (v1: { text }) after our ready ping.
 * Text only — never tokens, never files. AI stays in Throughline.
 */

export const NOTEBOOK_ORIGINS = new Set([
  'https://ibm.io',
  'https://www.ibm.io',
])

export type NotebookShareMessage = {
  type: 'notebook-neospace-share'
  v: 1
  text: string
}

/** Suite preview workers — subdomains of our account, not anyone's `*.workers.dev` */
const SUITE_WORKERS_SUFFIX = '.mhsenkow.workers.dev'

/**
 * True for allowlisted notebook hosts + local/preview siblings. Bare
 * `*.pages.dev` / `*.workers.dev` name matching would trust anyone who
 * registers e.g. `evil-notebook.pages.dev`.
 */
export function isNotebookOrigin(origin: string): boolean {
  if (NOTEBOOK_ORIGINS.has(origin)) return true
  try {
    const { protocol, hostname: host } = new URL(origin)
    if (host === 'localhost' || host === '127.0.0.1') return true
    if (protocol !== 'https:') return false
    if (host.endsWith(SUITE_WORKERS_SUFFIX) && (host.includes('notebook') || host.includes('throughline'))) {
      return true
    }
    // ibm.io/notebook/ is served from the ibm.io origin
    if (host === 'ibm.io' || host.endsWith('.ibm.io')) return true
  } catch {
    /* ignore */
  }
  return false
}

export function isNotebookShare(data: unknown): data is NotebookShareMessage {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return d.type === 'notebook-neospace-share' && d.v === 1 && typeof d.text === 'string'
}

export function notebookShareText(msg: NotebookShareMessage): string {
  return typeof msg.text === 'string' ? msg.text.trim() : ''
}
