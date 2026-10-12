/**
 * Artifact budget for the service worker's install-time download.
 *
 *   node scripts/precache-budget.mjs        after `npm run generate`
 *
 * First install precaches every file listed in .output/public/sw.js. Optional font faces used to
 * be in that list (292 entries / 4.4 MB, 3.6 MB of it woff2 for chromes the reader may never pick);
 * fonts are now cached at runtime on first use. This fails when the precache grows past the budget
 * or a font file sneaks back in. Pass --json to print the numbers for a record.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Measured 2026-10-12 after the font change: 158 entries / 2,668 KiB (was 292 / 4,425 KiB). Headroom ~8%. */
export const BUDGET = { maxBytes: 2_950_000, maxEntries: 175 }

export function precacheUrls(swSource) {
  return [...swSource.matchAll(/\burl:\s*"([^"]+)"/g)].map((m) => m[1])
}

export function measure(dir) {
  const sw = join(dir, 'sw.js')
  if (!existsSync(sw)) throw new Error(`${sw} not found — run \`npm run generate\` first`)
  const urls = precacheUrls(readFileSync(sw, 'utf8'))
  let bytes = 0
  const fonts = []
  for (const url of urls) {
    const file = join(dir, url.split('?')[0])
    if (existsSync(file)) bytes += statSync(file).size
    if (/\.(woff2?|ttf|otf)$/i.test(url)) fonts.push(url)
  }
  return { entries: urls.length, bytes, fonts }
}

export function check(result, budget = BUDGET) {
  const problems = []
  if (result.fonts.length) problems.push(`${result.fonts.length} font file(s) are precached (e.g. ${result.fonts[0]})`)
  if (result.bytes > budget.maxBytes) problems.push(`precache is ${result.bytes} bytes, budget ${budget.maxBytes}`)
  if (result.entries > budget.maxEntries) problems.push(`precache has ${result.entries} entries, budget ${budget.maxEntries}`)
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const result = measure(resolve('.output/public'))
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...result, fonts: result.fonts.length }, null, 2))
  console.log(`precache: ${result.entries} entries, ${(result.bytes / 1024).toFixed(0)} KiB (budget ${BUDGET.maxEntries} / ${(BUDGET.maxBytes / 1024).toFixed(0)} KiB)`)
  const problems = check(result)
  if (problems.length) {
    console.error(`precache-budget: ${problems.join('; ')}`)
    process.exit(1)
  }
}
