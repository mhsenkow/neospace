/**
 * Large suite-handoff images (Loom charts sent by postMessage) can't ride in sessionStorage:
 * a 400 KB+ PNG as a data URL blows the quota, so the saved share used to lose its image and a
 * signed-out reader came back from OAuth to a caption with no chart. The raw bytes live in
 * IndexedDB instead, keyed by the share, and are picked up (then deleted) when the share is ingested.
 */

export interface StoredBuffer {
  buffer: ArrayBuffer
  type: string
  name: string
  /** ms since epoch — entries older than the TTL are ignored and pruned */
  at: number
}

export interface BufferBackend {
  put(key: string, value: StoredBuffer): Promise<void>
  get(key: string): Promise<StoredBuffer | null>
  delete(key: string): Promise<void>
  /** Remove every entry older than `before` (ms epoch) */
  prune(before: number): Promise<void>
}

/** A handoff is only worth resuming for a short while (login / OAuth round trip) */
export const HANDOFF_BUFFER_TTL_MS = 30 * 60_000

export function memoryBackend(): BufferBackend {
  const map = new Map<string, StoredBuffer>()
  return {
    async put(key, value) {
      map.set(key, value)
    },
    async get(key) {
      return map.get(key) ?? null
    },
    async delete(key) {
      map.delete(key)
    },
    async prune(before) {
      for (const [k, v] of map) if (v.at < before) map.delete(k)
    },
  }
}

const DB_NAME = 'neospace-handoff'
const STORE = 'buffers'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** IndexedDB backend, or null where it is unavailable (SSR, locked-down private modes) */
export function idbBackend(): BufferBackend | null {
  if (typeof indexedDB === 'undefined') return null
  let dbPromise: Promise<IDBDatabase> | null = null
  const open = () =>
    (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))
  const store = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE)
  return {
    async put(key, value) {
      await request((await store('readwrite')).put(value, key))
    },
    async get(key) {
      return ((await request((await store('readonly')).get(key))) as StoredBuffer | undefined) ?? null
    },
    async delete(key) {
      await request((await store('readwrite')).delete(key))
    },
    async prune(before) {
      const os = await store('readwrite')
      await new Promise<void>((resolve, reject) => {
        const cursor = os.openCursor()
        cursor.onsuccess = () => {
          const c = cursor.result
          if (!c) return resolve()
          if ((c.value as StoredBuffer).at < before) c.delete()
          c.continue()
        }
        cursor.onerror = () => reject(cursor.error)
      })
    },
  }
}

let defaultBackend: BufferBackend | null = null
const backend = (): BufferBackend => (defaultBackend ??= idbBackend() ?? memoryBackend())

/** Test hook: swap (or reset with null) the shared backend */
export function setHandoffBufferBackend(b: BufferBackend | null) {
  defaultBackend = b
}

/** Keep a large image for a share. Returns false when nothing could be stored (caller keeps its in-memory copy). */
export async function stashHandoffBuffer(
  key: string,
  value: Omit<StoredBuffer, 'at'>,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const b = backend()
    await b.prune(now - HANDOFF_BUFFER_TTL_MS)
    await b.put(key, { ...value, at: now })
    return true
  } catch {
    return false
  }
}

/** The stored image for a share (null when missing, expired or unreadable). Does not delete. */
export async function readHandoffBuffer(key: string, now: number = Date.now()): Promise<StoredBuffer | null> {
  try {
    const found = await backend().get(key)
    if (!found || now - found.at > HANDOFF_BUFFER_TTL_MS) return null
    return found
  } catch {
    return null
  }
}

export async function dropHandoffBuffer(key: string): Promise<void> {
  try {
    await backend().delete(key)
  } catch {
    /* nothing to clean up */
  }
}
