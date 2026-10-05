/**
 * Ensure SPA fallback assets exist after `nuxt generate`.
 * Cloudflare Pages serves 404.html for unknown paths; keep it identical to index.html
 * so deep links boot the client router even if _redirects 200 rewrites are ignored.
 */
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const out = resolve('.output/public')
const index = resolve(out, 'index.html')
const notFound = resolve(out, '404.html')
const ok = resolve(out, '200.html')

if (!existsSync(index)) {
  console.error('spa-fallback: missing .output/public/index.html')
  process.exit(1)
}

copyFileSync(index, notFound)
copyFileSync(index, ok)
console.log('spa-fallback: synced 404.html and 200.html to index.html')
