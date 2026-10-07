/**
 * Fan-out freshly composed statuses to every listening timeline column.
 * Compose UI may live in one column (or a sheet); Home / matching tag columns insert.
 */

import type { mastodon } from 'masto'

type Handler = (status: mastodon.v1.Status) => void

const handlers = new Set<Handler>()

export function emitComposedStatus(status: mastodon.v1.Status) {
  for (const handler of handlers) handler(status)
}

export function onComposedStatus(handler: Handler) {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}
