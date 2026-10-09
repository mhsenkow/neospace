/** Structured logging with an in-memory ring buffer for feedback attachments. */

const isDev = import.meta.dev
const RING_SIZE = 80
/** One stringified store/response shouldn't pin megabytes in the ring */
const MAX_MESSAGE_CHARS = 4_000

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  level: LogLevel
  ts: number
  message: string
}

const ring: LogEntry[] = []

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

const SECRET_PARAM =
  /([?&#;](?:access_token|refresh_token|id_token|token|code|code_verifier|client_secret|state)=)[^&#\s"'<>]+/gi
const SECRET_JSON_KEY =
  /("(?:access_?token|accessToken|refresh_?token|refreshToken|token|client_?secret|clientSecret|code_?verifier|codeVerifier|authorization|password)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi

/**
 * Scrub credentials before a message enters the ring — it is attached to
 * public GitHub issues by Leave-a-note. Streaming URLs carry `?access_token=`,
 * the OAuth callback carries `?code=`, and stores get JSON-stringified.
 */
export function redactSecrets(message: string): string {
  return message
    .replace(SECRET_PARAM, '$1[redacted]')
    .replace(SECRET_JSON_KEY, '$1"[redacted]"')
    .replace(BEARER, '$1 [redacted]')
}

function sink(level: LogLevel, args: unknown[]) {
  // Redact before clipping so a cut can't leave half a token behind
  const message = redactSecrets(formatArgs(args)).slice(0, MAX_MESSAGE_CHARS)
  ring.push({ level, ts: Date.now(), message })
  if (ring.length > RING_SIZE) ring.shift()

  if (typeof console === 'undefined') return

  if (level === 'warn') {
    if (isDev) console.warn(...args)
    return
  }
  if (level === 'error') {
    console.error(...args)
    return
  }
  if (isDev) {
    if (level === 'info') console.info(...args)
    else console.debug(...args)
  }
}

export function logDebug(...args: unknown[]) {
  sink('debug', args)
}

export function logInfo(...args: unknown[]) {
  sink('info', args)
}

export function logWarn(...args: unknown[]) {
  sink('warn', args)
}

export function logError(...args: unknown[]) {
  sink('error', args)
}

export function getLogRing(): readonly LogEntry[] {
  return ring
}

/** Recent client logs for feedback notes (newest last, capped). */
export function formatLogRingForFeedback(maxEntries = 40): string {
  const slice = ring.slice(-maxEntries)
  if (!slice.length) return ''
  return slice
    .map((e) => {
      const t = new Date(e.ts).toISOString()
      return `[${t}] ${e.level.toUpperCase()}: ${e.message}`
    })
    .join('\n')
}

export function clearLogRing() {
  ring.length = 0
}
