/**
 * Map thrown errors / HTTP statuses to user-facing copy.
 */

export type FriendlyError = {
  title: string
  detail: string
  retryable: boolean
}

/** Prefer explicit HTTP status fields; avoid treating bare "not found" text as 404. */
export function httpStatusFrom(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null
  const e = err as Record<string, unknown>
  if (typeof e.status === 'number') return e.status
  if (typeof e.statusCode === 'number') return e.statusCode
  const res = e.response as { status?: number } | undefined
  if (typeof res?.status === 'number') return res.status
  const msg = typeof e.message === 'string' ? e.message : ''
  // Only scrape a status code when the message looks like an HTTP error line
  const m = msg.match(/\b(?:HTTP\/\d(?:\.\d)?\s+|status(?:Code)?[:=]\s*)([45]\d{2})\b/i)
    || msg.match(/\b([45]\d{2})\s+(?:Not Found|Unprocessable|Too Many|Forbidden|Unauthorized)\b/i)
  if (m) return Number(m[1])
  // Stores often keep only err.message — Mastodon's 429 body is exactly this phrase
  if (/^too many requests\b/i.test(msg.trim())) return 429
  return null
}

function statusFrom(err: unknown): number | null {
  return httpStatusFrom(err)
}

/** Only the browser's own offline signal counts — a failed fetch alone can be CORS, DNS or TLS on a dead remote */
function isOffline(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (!err || typeof err !== 'object') return false
  return (err as { code?: string }).code === 'NETWORK_ERROR'
}

/** fetch() rejected while the browser is online: the server (not the user's connection) is the problem */
function isUnreachable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string }
  return e.name === 'TypeError' && /fetch|network|failed|load failed/i.test(e.message || '')
}

function errorName(err: unknown): string {
  return err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string'
    ? (err as { name: string }).name
    : ''
}

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : ''

/** masto / transport failures whose raw wording must never reach the user */
export function isTimeoutError(err: unknown): boolean {
  const name = errorName(err)
  return (
    name === 'MastoTimeoutError' ||
    name === 'TimeoutError' ||
    /timed? ?out|signal timed out/i.test(errorMessage(err))
  )
}

export function isUnexpectedResponseError(err: unknown): boolean {
  return errorName(err) === 'MastoUnexpectedError' || /unknown encoding/i.test(errorMessage(err))
}

/** Transport-layer errors raised by the API client (masto) rather than authored by this app */
export const isClientError = (err: unknown) => errorName(err).startsWith('Masto') || /unsafe api path/i.test(errorMessage(err))

export function mapErrorToMessage(err: unknown): FriendlyError {
  if (isOffline(err)) {
    return {
      title: 'You appear to be offline',
      detail: 'Check your connection and try again.',
      retryable: true,
    }
  }
  if (isTimeoutError(err)) {
    return {
      title: 'Took too long',
      detail: 'The server took too long to respond. Try again in a moment.',
      retryable: true,
    }
  }
  if (isUnexpectedResponseError(err)) {
    return {
      title: 'Unexpected response',
      detail: 'The server sent an unexpected response. It may be down or not Mastodon-compatible.',
      retryable: true,
    }
  }
  if (isUnreachable(err)) {
    return {
      title: 'Couldn’t reach the server',
      detail: 'It may be down or blocking requests from this site. Try again in a bit.',
      retryable: true,
    }
  }

  const status = statusFrom(err)

  if (status === 401) {
    return {
      title: 'Sign in required',
      detail: 'Your session expired or isn’t authorized. Sign in again.',
      retryable: false,
    }
  }
  if (status === 403) {
    return {
      title: 'Not allowed',
      detail: 'You don’t have permission to do that.',
      retryable: false,
    }
  }
  if (status === 404) {
    return {
      title: 'Not found',
      detail: 'This content may have been deleted or moved.',
      retryable: false,
    }
  }
  if (status === 422) {
    return {
      title: 'Couldn’t save that',
      detail: 'Something in the request wasn’t accepted. Check and try again.',
      retryable: true,
    }
  }
  if (status === 429) {
    return {
      title: 'Taking a breather',
      detail: 'Your server is limiting requests for a moment. Try again in a minute.',
      retryable: true,
    }
  }
  if (status != null && status >= 500) {
    return {
      title: 'Server error',
      detail: 'The server hit a problem. Try again in a bit.',
      retryable: true,
    }
  }

  // App-authored messages ("Poll options must be different") are safe and useful; raw
  // client/transport wording ("Unsafe API path segment") is never echoed
  const detail = isClientError(err)
    ? 'The server couldn’t complete that. Try again in a moment.'
    : err instanceof Error && err.message
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Something went wrong.'

  return {
    title: 'Something went wrong',
    detail,
    retryable: true,
  }
}

/** Compose / DM post failures — match status + context, never regex alone. */
export function mapComposeError(
  err: unknown,
  ctx?: {
    inReplyToId?: string | null
    quotedStatusId?: string | null
    hasMedia?: boolean
  },
): string {
  const status = httpStatusFrom(err)
  const friendly = mapErrorToMessage(err)
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: string }).message || '')
        : ''

  if (status === 404) {
    if (ctx?.inReplyToId) {
      return 'That post isn’t on your account’s server — try opening the thread and replying there.'
    }
    if (ctx?.quotedStatusId) {
      return 'Couldn’t attach that quote on your server. Try again — the link will still be included.'
    }
    return friendly.detail
  }
  if (status === 422) {
    if (ctx?.hasMedia || /media|processing|attachment/i.test(raw)) {
      return 'Media is still processing — wait a moment and try again.'
    }
    return friendly.detail
  }
  if (status === 429) {
    return 'Your server is limiting requests for a moment. Try again in a minute.'
  }
  return friendly.detail || friendly.title || raw || 'Failed to post'
}
