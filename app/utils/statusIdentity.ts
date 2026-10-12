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

/**
 * Collapsed-row wrappers keyed by the first reblog in the run, so a recompute
 * with the same run hands cards the same object (no prop churn every poll).
 * Reused only while the source's `reblog` and the reblogger list are unchanged.
 */
const collapsedWrapperCache = new WeakMap<
  object,
  { reblog: unknown; rebloggers: readonly unknown[]; wrapper: object }
>()

function sameItems(a: readonly unknown[], b: readonly unknown[]) {
  if (a.length !== b.length) return false
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false
  return true
}

const REBLOG_COLLAPSE_WINDOW = 20

function mergeReblogIntoRow<T extends CollapsedReblogStatus>(
  anchor: T,
  rebloggers: NonNullable<T['_collapsedRebloggers']>,
): T {
  if (rebloggers.length <= 1) return anchor
  const cached = collapsedWrapperCache.get(anchor)
  if (cached && cached.reblog === anchor.reblog && sameItems(cached.rebloggers, rebloggers)) {
    return cached.wrapper as T
  }
  const wrapper = { ...anchor, _collapsedRebloggers: rebloggers }
  collapsedWrapperCache.set(anchor, { reblog: anchor.reblog, rebloggers, wrapper })
  return wrapper as T
}

/** Collapse reblogs of the same original within a sliding window ("A and N others reposted"). */
export function collapseDuplicateReblogs<T extends CollapsedReblogStatus>(statuses: T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < statuses.length; i++) {
    const current = statuses[i]!
    if (!current.reblog) {
      out.push(current)
      continue
    }
    const originalKey = statusIdentity(current.reblog)
    let mergeIdx = -1
    for (let k = Math.max(0, out.length - REBLOG_COLLAPSE_WINDOW); k < out.length; k++) {
      const row = out[k]!
      if (row.reblog && statusIdentity(row.reblog) === originalKey) {
        mergeIdx = k
        break
      }
    }
    if (mergeIdx >= 0) {
      const anchor = out[mergeIdx]!
      const rebloggers: NonNullable<T['_collapsedRebloggers']> = [
        ...(anchor._collapsedRebloggers ||
          (anchor.account ? [anchor.account] : [])),
      ]
      if (current.account) rebloggers.push(current.account)
      out[mergeIdx] = mergeReblogIntoRow(anchor, rebloggers)
      continue
    }
    out.push(current)
  }
  return out
}
