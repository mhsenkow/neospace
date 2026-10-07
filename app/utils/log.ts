/** Quiet production logs — keep warn/error noise out of hot timeline paths. */

const isDev = import.meta.dev

export function logWarn(...args: unknown[]) {
  if (isDev) console.warn(...args)
}

export function logError(...args: unknown[]) {
  if (isDev) console.error(...args)
  else if (typeof console !== 'undefined') console.error(...args)
}
