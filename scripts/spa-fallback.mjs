/**
 * After `nuxt generate`:
 * 1. Sync SPA fallbacks (404.html / 200.html = index.html)
 * 2. Add sha256 hashes for the remaining inline scripts (Nuxt's importmap and
 *    window.__NUXT__ config; boot scripts are external under /boot/) to the
 *    enforced CSP in .output/public/_headers.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const out = resolve('.output/public')
const index = resolve(out, 'index.html')
const notFound = resolve(out, '404.html')
const headersSrc = resolve('public/_headers')
const headersOut = resolve(out, '_headers')

if (!existsSync(index)) {
  console.error('spa-fallback: missing .output/public/index.html')
  process.exit(1)
}

copyFileSync(index, notFound)
console.log('spa-fallback: synced 404.html to index.html (Cloudflare Pages SPA fallback)')

/** Every prerendered route page, so a per-page inline script can't be missed. */
function htmlFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name)
    if (statSync(p).isDirectory()) htmlFiles(p, found)
    else if (name.endsWith('.html')) found.push(p)
  }
  return found
}

const hashes = new Set()
for (const file of htmlFiles(out)) {
  const html = readFileSync(file, 'utf8')
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    // JSON data blocks never execute, so CSP doesn't apply to them
    if (/\btype=["']?application\/(?:ld\+)?json/i.test(m[1]) || !m[2].trim()) continue
    hashes.add(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`)
  }
}

let headers = existsSync(headersOut)
  ? readFileSync(headersOut, 'utf8')
  : existsSync(headersSrc)
    ? readFileSync(headersSrc, 'utf8')
    : ''

// Hashes go into the ENFORCED policy. CSP2+ browsers ignore 'unsafe-inline'
// once a hash is present, so the importmap + __NUXT__ config stay allowed and
// any injected inline script is blocked; CSP1-only browsers keep the fallback.
let applied = false
headers = headers.replace(
  /^(\s*Content-Security-Policy:[^\n]*?script-src )([^;\n]*)/m,
  (_m, head, sources) => {
    applied = true
    const kept = sources.split(/\s+/).filter((s) => s && !s.startsWith("'sha256-"))
    return `${head}${[...kept, ...hashes].join(' ')}`
  },
)
if (hashes.size && !applied) {
  console.error('spa-fallback: no Content-Security-Policy script-src to extend in _headers')
  process.exit(1)
}

writeFileSync(headersOut, headers)
console.log(`spa-fallback: CSP script-src += ${hashes.size} inline script hash(es)`)
