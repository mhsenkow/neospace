/**
 * Probe every curated server against its own /api/v2/instance.
 *
 *   node scripts/probe-instances.mjs            report only; exit 1 if any entry is dead / not Mastodon-API
 *   node scripts/probe-instances.mjs --write    also rewrite `software` + `verifiedAt` in the catalog
 *
 * Run weekly by .github/workflows/probe-instances.yml. A failing entry should be removed (or
 * fixed) before it ships in Featured; `verifiedAt` only advances for entries that answered.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { catalogBlocks, classifyInstance, patchCatalog } from './instanceProbe.mjs'

const FILE = resolve('app/composables/useCuratedInstances.ts')
const write = process.argv.includes('--write')
const TIMEOUT_MS = 10_000
const CONCURRENCY = 6

async function probe(domain) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    for (const path of ['/api/v2/instance', '/api/v1/instance']) {
      const res = await fetch(`https://${domain}${path}`, {
        signal: ctl.signal,
        headers: { accept: 'application/json', 'user-agent': 'neospace-instance-probe' },
        redirect: 'follow',
      })
      if (!res.ok) continue
      const json = await res.json().catch(() => null)
      // v1 uses `uri` where v2 uses `domain`
      const info = json && !json.domain && json.uri ? { ...json, domain: json.uri } : json
      const software = classifyInstance(info)
      if (software) return { ok: true, software }
    }
    return { ok: false, reason: 'no Mastodon-API /instance answer' }
  } catch (e) {
    return { ok: false, reason: e?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS / 1000}s` : String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

const source = readFileSync(FILE, 'utf8')
const domains = catalogBlocks(source).map((b) => b.domain)
const results = new Map()
const failures = []
const today = new Date().toISOString().slice(0, 10)

let next = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < domains.length) {
      const domain = domains[next++]
      const r = await probe(domain)
      if (r.ok) {
        results.set(domain, { software: r.software, verifiedAt: today })
        console.log(`ok    ${domain}  (${r.software})`)
      } else {
        failures.push(`${domain}: ${r.reason}`)
        console.log(`FAIL  ${domain}  ${r.reason}`)
      }
    }
  }),
)

if (write) {
  writeFileSync(FILE, patchCatalog(source, results))
  console.log(`\nUpdated ${results.size} entries (verifiedAt ${today}); ${failures.length} left untouched.`)
}
if (failures.length) {
  console.error(`\n${failures.length} entr${failures.length === 1 ? 'y' : 'ies'} failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
