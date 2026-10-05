/**
 * POST /api/feedback — create a GitHub issue from Leave-a-note.
 * Requires Pages secret: wrangler pages secret put GITHUB_TOKEN --project-name neospace
 */

interface Env {
  GITHUB_TOKEN?: string
}

interface PagesContext {
  request: Request
  env: Env
}

const GITHUB_REPO = 'mhsenkow/neospace'
const UA = 'NeoSpace-Feedback/1.0'

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
  let body = (payload.body || '(no description)').trim().slice(0, 50_000)
  const kind = (payload.kind || 'feedback').trim().slice(0, 40)
  const href = (payload.href || '').trim().slice(0, 500)

  const meta = [
    `**Kind:** ${kind}`,
    href ? `**Page:** ${href}` : null,
    `**Source:** neospace.ibm.io leave-a-note`,
  ]
    .filter(Boolean)
    .join('\n')

  body = `${body}\n\n---\n${meta}`

  if (payload.imageBase64 && payload.imageBase64.length < 400_000) {
    const dataUrl = payload.imageBase64.startsWith('data:')
      ? payload.imageBase64
      : `data:image/png;base64,${payload.imageBase64}`
    body += `\n\n![screenshot](${dataUrl})`
  }

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
