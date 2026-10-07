/** NeoSpace leave-a-note → GitHub issues */

import { formatLogRingForFeedback } from '~/utils/log'
import {
  FEEDBACK_GITHUB_REPO,
  FEEDBACK_SCREENSHOT_CLIENT_MAX,
  GITHUB_NEW_ISSUE_URL_MAX,
  type FeedbackKind,
} from '../../shared/feedbackConstants'

export type { FeedbackKind }
export {
  FEEDBACK_GITHUB_REPO,
  FEEDBACK_TITLE_MAX,
  FEEDBACK_BODY_MAX,
} from '../../shared/feedbackConstants'

export class FeedbackError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'FeedbackError'
  }
}

export async function getGitHubNewIssueUrl(
  title: string,
  body: string,
): Promise<string> {
  const fullTitle = title.trim()
  const fullBody = body.trim()
  const params = new URLSearchParams()
  if (fullTitle) params.set('title', fullTitle)
  if (fullBody) params.set('body', fullBody)
  let url = `https://github.com/${FEEDBACK_GITHUB_REPO}/issues/new?${params.toString()}`

  if (url.length <= GITHUB_NEW_ISSUE_URL_MAX) return url

  const note = '\n\n[Full text copied to clipboard — URL truncated]'
  const room = GITHUB_NEW_ISSUE_URL_MAX - note.length - 80
  const truncatedBody = `${fullBody.slice(0, Math.max(0, room - fullTitle.length))}${note}`
  const fallbackParams = new URLSearchParams()
  if (fullTitle) fallbackParams.set('title', fullTitle)
  if (truncatedBody) fallbackParams.set('body', truncatedBody)
  url = `https://github.com/${FEEDBACK_GITHUB_REPO}/issues/new?${fallbackParams.toString()}`

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(
        `# ${fullTitle}\n\n${fullBody}`,
      )
    } catch {
      /* clipboard optional */
    }
  }

  return url.slice(0, GITHUB_NEW_ISSUE_URL_MAX)
}

export async function createGitHubIssue(
  title: string,
  body: string,
  options?: {
    kind?: FeedbackKind
    imageBase64?: string | null
    href?: string
    turnstileToken?: string | null
  },
): Promise<string> {
  const logRing = formatLogRingForFeedback()
  const bodyWithLogs = logRing
    ? `${body.trim()}\n\n<details><summary>Recent client logs</summary>\n\n\`\`\`\n${logRing}\n\`\`\`\n</details>`
    : body

  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      body: bodyWithLogs,
      kind: options?.kind || 'other',
      imageBase64: options?.imageBase64 ?? null,
      href:
        options?.href ??
        (typeof window !== 'undefined' ? window.location.pathname : ''),
      turnstileToken: options?.turnstileToken ?? null,
    }),
  })

  const contentType = res.headers.get('Content-Type') || ''
  let data: { url?: string; error?: string; code?: string }

  if (contentType.includes('application/json')) {
    data = (await res.json()) as typeof data
  } else {
    const text = await res.text()
    throw new FeedbackError(
      text.slice(0, 120) || `Feedback failed (${res.status})`,
      res.status,
      'BAD_RESPONSE',
    )
  }

  if (!res.ok || !data.url) {
    throw new FeedbackError(
      data.error || `Feedback failed (${res.status})`,
      res.status,
      data.code,
    )
  }
  return data.url
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export async function shrinkImageDataUrl(
  dataUrl: string,
  maxChars: number = FEEDBACK_SCREENSHOT_CLIENT_MAX,
): Promise<string | null> {
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode'))
      img.src = dataUrl
    })

    const canvas = document.createElement('canvas')
    let w = img.width
    let h = img.height
    const maxSide = 1280
    if (Math.max(w, h) > maxSide) {
      const s = maxSide / Math.max(w, h)
      w = Math.round(w * s)
      h = Math.round(h * s)
    }
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)

    let quality = 0.72
    let out = canvas.toDataURL('image/jpeg', quality)
    while (out.length > maxChars && quality > 0.35) {
      quality -= 0.1
      out = canvas.toDataURL('image/jpeg', quality)
    }
    return out.length <= maxChars ? out : null
  } catch {
    return null
  }
}

export async function prepareScreenshot(file: File): Promise<string> {
  let dataUrl = await readFileAsDataUrl(file)
  if (dataUrl.length > FEEDBACK_SCREENSHOT_CLIENT_MAX) {
    const smaller = await shrinkImageDataUrl(dataUrl)
    if (!smaller) {
      throw new Error('Screenshot too large — try a smaller image.')
    }
    dataUrl = smaller
  }
  return dataUrl
}
