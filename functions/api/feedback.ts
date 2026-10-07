/**
 * POST /api/feedback — create a GitHub issue from Leave-a-note.
 * Requires Pages secret: wrangler pages secret put GITHUB_TOKEN --project-name neospace
 */

import { allowRequest, clientIp } from '../utils/rateLimit'

interface Env {
  GITHUB_TOKEN?: string
}

interface PagesContext {
  request: Request
  env: Env
}

const GITHUB_REPO = 'mhsenkow/neospace'
const UA = 'NeoSpace-Feedback/1.0'

/** Feedback submissions per IP per hour */
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 60 * 1000

const ALLOWED_ORIGINS = new Set([
  'https://neospace.ibm.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

function originAllowed(origin: string | null): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const host = new URL(origin).hostname
    // Only this Pages project’s preview hosts — not every *.pages.dev app
    return host === 'neospace-dc4.pages.dev' || host.endsWith('.neospace-dc4.pages.dev')
  } catch {
    return false
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export const onRequestPost = async (context: PagesContext) => {
  const { request, env } = context

  const origin = request.headers.get('Origin')
  if (!originAllowed(origin)) {
    return json({ error: 'Forbidden origin' }, 403)
  }

  const ip = clientIp(request)
  if (!allowRequest(`feedback:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return json({ error: 'Too many notes — try again later' }, 429)
  }

  if (!env.GITHUB_TOKEN) {
    return json(
      {
        error:
          'Feedback API not configured. Set GITHUB_TOKEN on the Pages project (wrangler pages secret put GITHUB_TOKEN --project-name neospace).',
      },
      503,
    )
  }

  let payload: {
    title?: string
    body?: string
    imageBase64?: string | null
    href?: string
    kind?: string
  }

  try {
    payload = (await request.json()) as typeof payload
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const title = (payload.title || 'NeoSpace feedback').trim().slice(0, 200)
  // Escape @mentions so public issues don't spam random accounts
  const escapeMd = (s: string) => s.replace(/(^|[^a-zA-Z0-9_])@/g, '$1&#64;')
  let body = escapeMd((payload.body || '(no description)').trim()).slice(0, 8_000)
  const kind = (payload.kind || 'feedback').trim().slice(0, 40)

  // Strip path/query that may include DM / status ids from public issues
  let pageLabel = ''
  try {
    const raw = (payload.href || '').trim().slice(0, 500)
    if (raw) {
      const u = new URL(raw, 'https://neospace.ibm.io')
      pageLabel = u.pathname.split('/').filter(Boolean)[0] || 'home'
    }
  } catch {
    pageLabel = 'unknown'
  }

  const meta = [
    `**Kind:** ${kind}`,
    pageLabel ? `**Area:** \`${pageLabel}\`` : null,
    `**Source:** neospace.ibm.io leave-a-note`,
  ]
    .filter(Boolean)
    .join('\n')

  body = `${body}\n\n---\n${meta}`

  // GitHub issue body soft limit ~65k; keep screenshots small or omit
  const GITHUB_BODY_BUDGET = 60_000
  if (payload.imageBase64 && payload.imageBase64.length < 45_000) {
    const dataUrl = payload.imageBase64.startsWith('data:')
      ? payload.imageBase64
      : `data:image/png;base64,${payload.imageBase64}`
    const withShot = `${body}\n\n![screenshot](${dataUrl})`
    if (withShot.length <= GITHUB_BODY_BUDGET) {
      body = withShot
    } else {
      body += `\n\n_(screenshot omitted — too large for GitHub issue body)_`
    }
  } else if (payload.imageBase64) {
    body += `\n\n_(screenshot omitted — too large for GitHub issue body)_`
  }
  body = body.slice(0, GITHUB_BODY_BUDGET)

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      body,
      labels: ['feedback'],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    // Retry without labels if the label doesn't exist yet
    if (res.status === 422 && text.includes('label')) {
      const retry = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': UA,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body }),
      })
      if (!retry.ok) {
        const retryText = await retry.text()
        return json({ error: `GitHub ${retry.status}: ${retryText.slice(0, 400)}` }, 502)
      }
      const issue = (await retry.json()) as { html_url?: string }
      if (!issue.html_url) return json({ error: 'No issue URL returned' }, 502)
      return json({ url: issue.html_url })
    }
    return json({ error: `GitHub ${res.status}: ${text.slice(0, 400)}` }, 502)
  }

  const issue = (await res.json()) as { html_url?: string }
  if (!issue.html_url) return json({ error: 'No issue URL returned' }, 502)
  return json({ url: issue.html_url })
}
