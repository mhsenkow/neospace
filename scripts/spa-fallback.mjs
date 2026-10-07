/**
 * After `nuxt generate`:
 * 1. Sync SPA fallbacks (404.html / 200.html = index.html)
 * 2. Emit Content-Security-Policy-Report-Only with sha256 hashes for any
 *    leftover inline scripts (boot scripts are external under /boot/).
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const out = resolve('.output/public')
const index = resolve(out, 'index.html')
const notFound = resolve(out, '404.html')
const ok = resolve(out, '200.html')
const headersSrc = resolve('public/_headers')
const headersOut = resolve(out, '_headers')

if (!existsSync(index)) {
  console.error('spa-fallback: missing .output/public/index.html')
  process.exit(1)
}

copyFileSync(index, notFound)
copyFileSync(index, ok)
console.log('spa-fallback: synced 404.html and 200.html to index.html')

const html = readFileSync(index, 'utf8')
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
  (m) => m[1],
)
const hashes = inlineScripts
  .filter((s) => s.trim())
  .map((s) => {
    const digest = createHash('sha256').update(s, 'utf8').digest('base64')
    return `'sha256-${digest}'`
  })

const scriptSrc = ["'self'", ...hashes].join(' ')
const reportOnly =
  `Content-Security-Policy-Report-Only: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src ${scriptSrc}; connect-src 'self' https:; worker-src 'self' blob:; manifest-src 'self'`

let headers = existsSync(headersOut)
  ? readFileSync(headersOut, 'utf8')
  : existsSync(headersSrc)
    ? readFileSync(headersSrc, 'utf8')
    : ''

// Strip prior Report-Only line, then append under /*
headers = headers
  .split('\n')
  .filter((line) => !line.includes('Content-Security-Policy-Report-Only:'))
  .join('\n')

if (headers.includes('Content-Security-Policy:')) {
  headers = headers.replace(
    /(Content-Security-Policy:[^\n]+)/,
    `$1\n  ${reportOnly}`,
  )
} else {
  headers = `/*\n  ${reportOnly}\n` + headers
}

writeFileSync(headersOut, headers)
console.log(
  `spa-fallback: CSP-Report-Only with ${hashes.length} inline script hash(es)`,
)
