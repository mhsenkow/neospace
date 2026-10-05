/** NeoSpace GitHub repo for leave-a-note → issues */
export const FEEDBACK_GITHUB_REPO = 'mhsenkow/neospace'

export type FeedbackKind = 'ux' | 'bug' | 'idea' | 'other'

export function getGitHubNewIssueUrl(title: string, body: string): string {
  const params = new URLSearchParams()
  if (title.trim()) params.set('title', title.trim())
  if (body.trim()) params.set('body', body.trim())
  return `https://github.com/${FEEDBACK_GITHUB_REPO}/issues/new?${params.toString()}`
}

export async function createGitHubIssue(
  title: string,
  body: string,
  options?: {
    kind?: FeedbackKind
    imageBase64?: string | null
    href?: string
  },
): Promise<string> {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      body,
      kind: options?.kind || 'feedback',
      imageBase64: options?.imageBase64 ?? null,
      href: options?.href ?? (typeof window !== 'undefined' ? window.location.href : ''),
    }),
  })

  const json = (await res.json()) as { url?: string; error?: string }
  if (!res.ok || !json.url) {
    throw new Error(json.error || `Feedback failed (${res.status})`)
  }
  return json.url
}

const MAX_SHOT_CHARS = 350_000

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
  maxChars: number = MAX_SHOT_CHARS,
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
  if (dataUrl.length > MAX_SHOT_CHARS) {
    const smaller = await shrinkImageDataUrl(dataUrl)
    if (!smaller) {
      throw new Error('Screenshot too large — try a smaller image.')
    }
    dataUrl = smaller
  }
  return dataUrl
}
