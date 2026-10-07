/**
 * Map thrown errors / HTTP statuses to user-facing copy.
 */

export type FriendlyError = {
  title: string
  detail: string
  retryable: boolean
}

function statusFrom(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null
  const e = err as Record<string, unknown>
  if (typeof e.status === 'number') return e.status
  if (typeof e.statusCode === 'number') return e.statusCode
  const res = e.response as { status?: number } | undefined
  if (typeof res?.status === 'number') return res.status
  const msg = typeof e.message === 'string' ? e.message : ''
  const m = msg.match(/\b([45]\d{2})\b/)
  return m ? Number(m[1]) : null
}

function isOffline(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string; code?: string }
  if (e.name === 'TypeError' && /fetch|network|failed/i.test(e.message || '')) return true
  if (e.code === 'NETWORK_ERROR') return true
  return false
}

export function mapErrorToMessage(err: unknown): FriendlyError {
  if (isOffline(err)) {
    return {
      title: 'You appear to be offline',
      detail: 'Check your connection and try again.',
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
      title: 'Slow down',
      detail: 'Too many requests. Wait a moment and try again.',
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

  const detail =
    err instanceof Error && err.message
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
