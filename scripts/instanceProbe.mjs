/**
 * Pure helpers for scripts/probe-instances.mjs (kept free of I/O so tests can cover them).
 *
 * The curated server catalog (app/composables/useCuratedInstances.ts) feeds Featured / Explore /
 * login. Every entry carries `software` and `verifiedAt`; the probe re-checks them against
 * each server's own /api/v2/instance so a dead or non-Mastodon-API server can't sit in Featured.
 */

export const KNOWN_SOFTWARE = [
  'mastodon',
  'glitch',
  'hometown',
  'pleroma',
  'akkoma',
  'iceshrimp',
  'sharkey',
  'gotosocial',
  'other',
]

/** Domains (and their blocks) from the CATALOG array source */
export function catalogBlocks(source) {
  const start = source.indexOf('const CATALOG')
  const end = source.indexOf('\n]', start)
  if (start === -1 || end === -1) throw new Error('could not find `const CATALOG` in the catalog source')
  const body = source.slice(start, end)
  const blocks = []
  for (const m of body.matchAll(/\n  \{\n([\s\S]*?)\n  \},/g)) {
    const domain = /\n?\s*domain: '([^']+)'/.exec(m[1])?.[1]
    if (domain) blocks.push({ domain, text: m[0], index: start + m.index })
  }
  return blocks
}

/** Map an /api/v2/instance payload to a software id, or null when it isn't a Mastodon-API server */
export function classifyInstance(info) {
  if (!info || typeof info !== 'object' || typeof info.domain !== 'string') return null
  const version = String(info.version || '').toLowerCase()
  const source = String(info.source_url || '').toLowerCase()
  if (version.includes('glitch') || source.includes('glitch-soc')) return 'glitch'
  if (version.includes('hometown') || source.includes('hometown')) return 'hometown'
  if (version.includes('akkoma') || source.includes('akkoma')) return 'akkoma'
  if (version.includes('pleroma') || source.includes('pleroma')) return 'pleroma'
  if (version.includes('iceshrimp') || source.includes('iceshrimp')) return 'iceshrimp'
  if (version.includes('sharkey') || source.includes('sharkey')) return 'sharkey'
  if (version.includes('gotosocial') || source.includes('gotosocial')) return 'gotosocial'
  if (source.includes('mastodon/mastodon') || /^\d+\.\d+/.test(version)) return 'mastodon'
  return 'other'
}

/** Set (or add) `software` and `verifiedAt` inside one entry block */
export function patchBlock(text, { software, verifiedAt }) {
  let out = text
  const setLine = (key, value) => {
    const re = new RegExp(`(\\n\\s*)${key}: '[^']*',`)
    if (re.test(out)) out = out.replace(re, `$1${key}: '${value}',`)
    else out = out.replace(/(\n\s*)color: /, `$1${key}: '${value}',$1color: `)
  }
  if (verifiedAt) setLine('verifiedAt', verifiedAt)
  if (software) setLine('software', software)
  return out
}

/** Apply probe results to the catalog source; results: Map<domain, { software, verifiedAt }> */
export function patchCatalog(source, results) {
  let out = source
  // Patch back-to-front so earlier indexes stay valid
  for (const block of catalogBlocks(source).reverse()) {
    const r = results.get(block.domain)
    if (!r) continue
    const next = patchBlock(block.text, r)
    out = out.slice(0, block.index) + next + out.slice(block.index + block.text.length)
  }
  return out
}
