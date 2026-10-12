/**
 * Media upload transport helpers — phases, real byte progress, typed aborts.
 */

export type UploadPhase = 'uploading' | 'processing' | 'ready' | 'error'

/** User (or caller) aborted the upload */
export class UploadCancelledError extends Error {
  constructor(message = 'Upload cancelled') {
    super(message)
    this.name = 'UploadCancelledError'
  }
}

/** Upload exceeded its time budget (not a user action) */
export class UploadTimeoutError extends Error {
  constructor(message = 'Upload timed out') {
    super(message)
    this.name = 'UploadTimeoutError'
  }
}

export const isUploadCancelled = (e: unknown): e is UploadCancelledError =>
  e instanceof UploadCancelledError ||
  (!!e && typeof e === 'object' && (e as { name?: string }).name === 'UploadCancelledError')

export const isUploadTimeout = (e: unknown): e is UploadTimeoutError =>
  e instanceof UploadTimeoutError ||
  (!!e && typeof e === 'object' && (e as { name?: string }).name === 'UploadTimeoutError')

/** 0..1, or null when the transport can't tell (never invent a percentage). */
export function uploadFraction(loaded: number, total: number, computable = true): number | null {
  if (!computable || !Number.isFinite(total) || total <= 0 || !Number.isFinite(loaded)) return null
  return Math.min(1, Math.max(0, loaded / total))
}

export interface UploadHttpResult {
  status: number
  body: Record<string, unknown>
}

export interface UploadHttpOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  /** Called with 0..1 while bytes are sent; null when the browser can't compute it */
  onProgress?: (fraction: number | null) => void
  /** Request body fully sent — the server is now working on it */
  onSent?: () => void
}

function parseBody(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * POST a FormData body. XHR is used because fetch() can't report upload
 * progress; falls back to fetch (progress stays null) where XHR is missing.
 */
export function postFormWithProgress(
  url: string,
  form: FormData,
  opts: UploadHttpOptions = {},
): Promise<UploadHttpResult> {
  const { headers = {}, signal, timeoutMs, onProgress, onSent } = opts

  if (typeof XMLHttpRequest === 'undefined') {
    return fetchFallback(url, form, opts)
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadCancelledError())
      return
    }
    const xhr = new XMLHttpRequest()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        xhr.abort()
      }, timeoutMs)
    }

    xhr.open('POST', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)

    xhr.upload.onprogress = (e) => {
      onProgress?.(uploadFraction(e.loaded, e.total, e.lengthComputable))
    }
    xhr.upload.onload = () => onSent?.()
    xhr.onload = () => {
      cleanup()
      resolve({ status: xhr.status, body: parseBody(xhr.responseText) })
    }
    xhr.onerror = () => {
      cleanup()
      reject(new Error('Network error — check your connection'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(timedOut ? new UploadTimeoutError() : new UploadCancelledError())
    }
    xhr.send(form)
  })
}

async function fetchFallback(
  url: string,
  form: FormData,
  opts: UploadHttpOptions,
): Promise<UploadHttpResult> {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  if (opts.signal?.aborted) throw new UploadCancelledError()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true
        controller.abort()
      }, opts.timeoutMs)
    : null
  try {
    opts.onProgress?.(null)
    const res = await fetch(url, {
      method: 'POST',
      headers: opts.headers,
      body: form,
      signal: controller.signal,
    })
    opts.onSent?.()
    return { status: res.status, body: parseBody(await res.text()) }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw timedOut ? new UploadTimeoutError() : new UploadCancelledError()
    }
    throw e
  } finally {
    if (timer) clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
