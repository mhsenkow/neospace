/**
 * Cross-instance status identity — same post can have different local ids.
 */
export function statusIdentity(
  status: {
    id: string
    uri?: string | null
    url?: string | null
    _instanceUrl?: string | null
  },
): string {
  const raw = status.uri || status.url
  if (raw) {
    try {
      const u = new URL(raw)
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`
    } catch {
      /* fall through */
    }
  }

  const id = status.id?.trim()
  if (!id) return ''

  const instance = status._instanceUrl?.replace(/\/+$/, '') || ''
  if (instance) {
    try {
      const host = new URL(instance).host.toLowerCase()
      return `${host}#${id}`
    } catch {
      return `${instance.toLowerCase()}#${id}`
    }
  }

  return id
}

/** Stable list key — computed once when statuses enter the column store. */
export function statusListKey(
  status: {
    id: string
    uri?: string | null
    url?: string | null
    _instanceUrl?: string | null
  },
): string {
  const identity = statusIdentity(status)
  return identity || `id:${status.id}`
}

/** Keep first occurrence; preserves merge sort order when applied after sort. */
export function dedupeStatusesByIdentity<
  T extends { id: string; uri?: string | null; url?: string | null; _instanceUrl?: string | null },
>(statuses: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const status of statuses) {
    const key = statusIdentity(status)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(status)
  }
  return out
}
