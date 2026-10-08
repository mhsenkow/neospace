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

export function isBruhShare(data: unknown): data is BruhShareMessage {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return d.type === 'bruh-neospace-share' && d.v === 1 && typeof d.text === 'string'
}

/** Compose text for a bruh share — make sure the page link rides along. */
export function bruhShareText(msg: BruhShareMessage): string {
  const text = msg.text.trim()
  const doc = typeof msg.doc === 'string' ? msg.doc.trim() : ''
  if (!doc || text.includes(doc)) return text
  return text ? `${text}\n\n${doc}` : doc
}
