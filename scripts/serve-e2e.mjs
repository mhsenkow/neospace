/**
 * Repo-owned static server for browser tests (no registry download, no extra dependency).
 * Serves `.output/public` from `npm run generate` with the same SPA fallback Cloudflare
 * Pages applies: a path with no file answers with index.html (200) so client routes work.
 *
 *   node scripts/serve-e2e.mjs            # E2E_PORT or 4173
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const root = resolve('.output/public')
const port = Number(process.env.E2E_PORT || 4173)

if (!existsSync(join(root, 'index.html'))) {
  console.error('serve-e2e: missing .output/public/index.html — run `npm run generate` first')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const isFile = (p) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Map a URL path to a file under root: exact, dir/index.html, then name.html */
function resolveFile(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const target = normalize(join(root, decoded))
  // Path traversal guard
  if (target !== root && !target.startsWith(root + sep)) return null
  for (const candidate of [target, join(target, 'index.html'), `${target}.html`]) {
    if (isFile(candidate)) return candidate
  }
  return null
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  let file = resolveFile(url.pathname)
  let status = 200

  if (!file) {
    // A missing asset is a real 404; a missing page is a client route
    if (extname(url.pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }
    file = join(root, 'index.html')
    status = 200
  }

  res.writeHead(status, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`serve-e2e: http://127.0.0.1:${port} -> ${root}`)
})
