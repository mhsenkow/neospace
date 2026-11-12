/**
 * Mastodon `POST /api/v1/statuses/:id/translate`.
 * Offered only when the server reports translation enabled and the post
 * language isn't the reader's posting language.
 */

export type StatusTranslation = {
  content: string
  spoilerText: string
  detectedSourceLanguage: string
  provider: string
}

export function languagePrimary(code: string | null | undefined): string {
  return (code || '').trim().toLowerCase().split(/[-_]/)[0] || ''
}

/** True when both languages are known and they aren't the same language. */
export function languagesDiffer(
  postLanguage: string | null | undefined,
  uiLanguage: string | null | undefined,
): boolean {
  const post = languagePrimary(postLanguage)
  const ui = languagePrimary(uiLanguage)
  if (!post || !ui) return false
  return post !== ui
}

export async function fetchStatusTranslation(
  statusId: string,
  creds: { url: string; accessToken: string; lang?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<StatusTranslation> {
  const id = statusId.trim()
  if (!id || /[/\\?#\s]/.test(id)) throw new Error('Bad status id')
  const endpoint = `${creds.url.replace(/\/+$/, '')}/api/v1/statuses/${encodeURIComponent(id)}/translate`
  const lang = (creds.lang || '').trim()
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      Accept: 'application/json',
      ...(lang ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(lang ? { body: JSON.stringify({ lang }) } : {}),
  })
  if (!res.ok) throw new Error(`Translate failed (${res.status})`)
  const data = (await res.json()) as {
    content?: unknown
    spoiler_text?: unknown
    detected_source_language?: unknown
    provider?: unknown
  }
  if (typeof data.content !== 'string' || !data.content.trim()) throw new Error('Empty translation')
  return {
    content: data.content,
    spoilerText: typeof data.spoiler_text === 'string' ? data.spoiler_text : '',
    detectedSourceLanguage: typeof data.detected_source_language === 'string' ? data.detected_source_language : '',
    provider: typeof data.provider === 'string' ? data.provider : '',
  }
}
