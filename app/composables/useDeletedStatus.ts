/**
 * Fan-out of post deletions to every mounted surface (timeline columns, profile,
 * thread). Events are account-scoped and carry the canonical identity — see
 * utils/deletedStatus.ts for how consumers match their copies.
 */

import type { DeletedStatusEvent } from '~/utils/deletedStatus'
import { logError } from '~/utils/log'

type Handler = (event: DeletedStatusEvent) => void

const handlers = new Set<Handler>()

export function emitDeletedStatus(event: DeletedStatusEvent) {
  for (const handler of handlers) {
    try {
      handler(event)
    } catch (e) {
      // One surface failing to prune must not stop the others
      logError('deleted-status handler failed:', e)
    }
  }
}

export function onDeletedStatus(handler: Handler) {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}
