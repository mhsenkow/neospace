/**
 * Tiny offline outbox for likes (and later posts). Flushes when back online.
 */
import { useInstancesStore } from '~/stores/instances'
import { logWarn } from '~/utils/log'

export type OfflineQueueItem = {
  id: string
  kind: 'favourite' | 'unfavourite'
  statusId: string
  instanceId: string
  createdAt: number
}

const STORAGE_KEY = 'neo-offline-queue-v1'

function readQueue(): OfflineQueueItem[] {
  if (!import.meta.client) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as OfflineQueueItem[]
    return Array.isArray(parsed) ? parsed.slice(0, 40) : []
  } catch {
    return []
  }
}

function writeQueue(items: OfflineQueueItem[]) {
  if (!import.meta.client) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 40)))
  } catch {
    /* ignore */
  }
}

export function useOfflineQueue() {
  const items = useState<OfflineQueueItem[]>('neo-offline-queue', () => [])
  const flushing = useState('neo-offline-queue-flushing', () => false)

  const hydrate = () => {
    items.value = readQueue()
  }

  const enqueue = (item: Omit<OfflineQueueItem, 'id' | 'createdAt'>) => {
    const row: OfflineQueueItem = {
      ...item,
      id: `${item.kind}:${item.statusId}:${Date.now()}`,
      createdAt: Date.now(),
    }
    // Drop opposing action for same status
    const next = items.value.filter(
      (i) => !(i.statusId === item.statusId && i.instanceId === item.instanceId),
    )
    next.push(row)
    items.value = next
    writeQueue(next)
    return row
  }

  const flush = async () => {
    if (!import.meta.client || flushing.value || !navigator.onLine) return
    if (!items.value.length) return
    flushing.value = true
    const instances = useInstancesStore()
    const remaining: OfflineQueueItem[] = []
    try {
      for (const item of items.value) {
        try {
          const client = instances.getClient(item.instanceId)
          if (item.kind === 'favourite') {
            await client.v1.statuses.$select(item.statusId).favourite()
          } else {
            await client.v1.statuses.$select(item.statusId).unfavourite()
          }
        } catch (e) {
          logWarn('offline queue item failed', e)
          remaining.push(item)
        }
      }
      items.value = remaining
      writeQueue(remaining)
    } finally {
      flushing.value = false
    }
  }

  if (import.meta.client) {
    hydrate()
    window.addEventListener('online', () => {
      void flush()
    })
    if (navigator.onLine) void flush()
  }

  return { items, enqueue, flush, hydrate, flushing }
}
