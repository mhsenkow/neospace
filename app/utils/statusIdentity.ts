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

export type CollapsedReblogStatus = {
  id: string
  uri?: string | null
  url?: string | null
  _instanceUrl?: string | null
  reblog?: { id: string; uri?: string | null; url?: string | null } | null
  account?: { displayName?: string | null; username?: string | null; acct?: string | null }
  /** When set, consecutive reblogs of the same post were collapsed. */
  _collapsedRebloggers?: Array<{ displayName?: string | null; username?: string | null; acct?: string | null }>
}

/** Collapse consecutive reblogs of the same original into one row ("A and N others reposted"). */
export function collapseDuplicateReblogs<T extends CollapsedReblogStatus>(statuses: T[]): T[] {
  const out: T[] = []
  let i = 0
  while (i < statuses.length) {
    const current = statuses[i]!
    if (!current.reblog) {
      out.push(current)
      i++
      continue
    }
    const originalKey = statusIdentity(current.reblog)
    const rebloggers: NonNullable<T['_collapsedRebloggers']> = []
    if (current.account) rebloggers.push(current.account)
    let j = i + 1
    while (j < statuses.length) {
      const next = statuses[j]!
      if (!next.reblog || statusIdentity(next.reblog) !== originalKey) break
      if (next.account) rebloggers.push(next.account)
      j++
    }
    if (rebloggers.length <= 1) {
      out.push(current)
    } else {
      out.push({ ...current, _collapsedRebloggers: rebloggers })
    }
    i = j
  }
  return out
}
