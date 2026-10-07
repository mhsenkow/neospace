/**
 * POST /api/feedback — create a GitHub issue from Leave-a-note.
 * Requires Pages secret: wrangler pages secret put GITHUB_TOKEN --project-name neospace
 * Optional bot protection: wrangler pages secret put TURNSTILE_SECRET_KEY --project-name neospace
 */

import {
  FEEDBACK_GITHUB_REPO,
  FEEDBACK_JSON_MAX_BYTES,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_SCREENSHOT_SERVER_MAX,
  FEEDBACK_TITLE_MAX,
  FEEDBACK_BODY_MAX,
  GITHUB_ISSUE_BODY_BUDGET,
  isFeedbackKind,
} from '../../shared/feedbackConstants'
import { allowRequest, clientIp } from '../utils/rateLimit'

interface Env {
  GITHUB_TOKEN?: string
  TURNSTILE_SECRET_KEY?: string
}

type PagesFunction<E = unknown> = (context: {
  request: Request
  env: E
}) => Response | Promise<Response>

const UA = 'NeoSpace-Feedback/1.0'
const GITHUB_FETCH_TIMEOUT_MS = 30_000

const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 60 * 1000

const ALLOWED_ORIGINS = new Set([
  'https://neospace.ibm.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

const ALLOWED_HOSTS = new Set([
  'neospace.ibm.io',
  'localhost',
  '127.0.0.1',
  'neospace-dc4.pages.dev',
])

function originAllowed(origin: string | null): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const host = new URL(origin).hostname
    return host === 'neospace-dc4.pages.dev' || host.endsWith('.neospace-dc4.pages.dev')
  } catch {
    return false
  }
}

function hostAllowed(hostname: string): boolean {
  if (ALLOWED_HOSTS.has(hostname)) return true
  return hostname.endsWith('.neospace-dc4.pages.dev')
}

function json(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string,
): Promise<boolean> {
  const form = new URLSearchParams()
  form.set('secret', secret)
  form.set('response', token)
  if (ip) form.set('remoteip', ip)

  const res = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!res.ok) return false
  const data = (await res.json()) as { success?: boolean }
  return !!data.success
}

/** Path-only page area — same-origin paths; strip query/hash */
function normalizeHref(href: string): string {
  const raw = href.trim().slice(0, 500)
  if (!raw) return ''
  try {
    const u = raw.startsWith('/')
      ? new URL(raw, 'https://neospace.ibm.io')
      : new URL(raw)
    if (!hostAllowed(u.hostname)) return ''
    return u.pathname
  } catch {
    return ''
  }
}

type GitHubIssueResult =
  | { ok: true; url: string }
  | { ok: false; code: string }

async function createIssue(
  token: string,
  title: string,
  body: string,
  labels?: string[],
): Promise<GitHubIssueResult> {
  const res = await fetch(
    `https://api.github.com/repos/${FEEDBACK_GITHUB_REPO}/issues`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': UA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(labels?.length ? { title, body, labels } : { title, body }),
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    },
  )

  const text = await res.text()

  if (res.ok) {
    const issue = JSON.parse(text) as { html_url?: string }
    if (!issue.html_url) return { ok: false, code: 'GITHUB_NO_URL' }
    return { ok: true, url: issue.html_url }
  }

  let parsed: { errors?: Array<{ field?: string; code?: string; message?: string }> } =
    {}
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    /* non-JSON error body */
  }

  const labelRejected =
    labels?.length &&
    res.status === 422 &&
    (parsed.errors?.some((e) => e.field === 'labels') || /label/i.test(text))

  if (labelRejected) {
    return createIssue(token, title, body)
  }

  if (res.status === 401 || res.status === 403) return { ok: false, code: 'GITHUB_AUTH' }
  if (res.status === 422) return { ok: false, code: 'GITHUB_VALIDATION' }
  if (res.status >= 500) return { ok: false, code: 'GITHUB_UNAVAILABLE' }
  return { ok: false, code: 'GITHUB_ERROR' }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  const origin = request.headers.get('Origin')
  if (!originAllowed(origin)) {
    return json({ error: 'Forbidden origin', code: 'FORBIDDEN_ORIGIN' }, 403)
  }

  const ip = clientIp(request)
  const rateKey = ip ? `feedback:${ip}` : `feedback:local:${origin}`
  const rate = allowRequest(rateKey, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rate.allowed) {
    const headers: Record<string, string> = {}
    if (rate.retryAfterSec) headers['Retry-After'] = String(rate.retryAfterSec)
    return json(
      { error: 'Too many notes — try again later', code: 'RATE_LIMITED' },
      429,
      headers,
    )
  }

  if (!env.GITHUB_TOKEN) {
    return json(
      { error: 'Feedback is temporarily unavailable', code: 'NOT_CONFIGURED' },
      503,
    )
  }

  const contentLength = request.headers.get('Content-Length')
  if (contentLength && Number(contentLength) > FEEDBACK_JSON_MAX_BYTES) {
    return json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }, 413)
  }

  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.includes('application/json')) {
    return json({ error: 'Expected application/json', code: 'UNSUPPORTED_MEDIA_TYPE' }, 415)
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return json({ error: 'Invalid body', code: 'INVALID_BODY' }, 400)
  }

  if (rawBody.length > FEEDBACK_JSON_MAX_BYTES) {
    return json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }, 413)
  }

  let payload: {
    title?: string
    body?: string
    imageBase64?: string | null
    href?: string
    kind?: string
    turnstileToken?: string
  }

  try {
    payload = JSON.parse(rawBody) as typeof payload
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400)
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const token = (payload.turnstileToken || '').trim()
    if (!token) {
      return json(
        { error: 'Verification required', code: 'TURNSTILE_REQUIRED' },
        403,
      )
    }
    const ok = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip)
    if (!ok) {
      return json({ error: 'Verification failed', code: 'TURNSTILE_FAILED' }, 403)
    }
  }

  const title = (payload.title || 'NeoSpace feedback').trim().slice(0, FEEDBACK_TITLE_MAX)
  const escapeMd = (s: string) =>
    s
      .replace(/(^|[^a-zA-Z0-9_])@/g, '$1&#64;')
      .replace(/(^|[^a-zA-Z0-9_])#(\d+)/g, '$1&#35;$2')
  const rawUserBody = escapeMd((payload.body || '(no description)').trim()).slice(
    0,
    FEEDBACK_BODY_MAX,
  )
  const fencedBody = ['```text', rawUserBody.replace(/```/g, "'''"), '```'].join('\n')

  const kindRaw = (payload.kind || 'other').trim().toLowerCase()
  const kind = isFeedbackKind(kindRaw) ? kindRaw : 'other'
  const kindLabel = FEEDBACK_KIND_LABELS[kind]

  const pathname = normalizeHref(payload.href || '')
  const pageLabel = pathname ? pathname.split('/').filter(Boolean)[0] || 'home' : ''

  const meta = [
    '```meta',
    `kind: ${kind}`,
    pageLabel ? `area: ${pageLabel}` : null,
    pathname ? `path: ${pathname}` : null,
    'source: neospace.ibm.io leave-a-note',
    '```',
  ]
    .filter(Boolean)
    .join('\n')

  let body = `${fencedBody}\n\n${meta}`

  if (payload.imageBase64 && payload.imageBase64.length < FEEDBACK_SCREENSHOT_SERVER_MAX) {
    const dataUrl = payload.imageBase64.startsWith('data:')
      ? payload.imageBase64
      : `data:image/png;base64,${payload.imageBase64}`
    const withShot = `${body}\n\n![screenshot](${dataUrl})`
    if (withShot.length <= GITHUB_ISSUE_BODY_BUDGET) {
      body = withShot
    } else {
      body += `\n\n_(screenshot omitted — too large for GitHub issue body)_`
    }
  } else if (payload.imageBase64) {
    body += `\n\n_(screenshot omitted — too large for GitHub issue body)_`
  }
  body = body.slice(0, GITHUB_ISSUE_BODY_BUDGET)

  const labels = ['feedback', kindLabel]
  const result = await createIssue(env.GITHUB_TOKEN, title, body, labels)

  if (!result.ok) {
    return json({ error: 'Could not file note', code: result.code }, 502)
  }

  return json({ url: result.url })
}
