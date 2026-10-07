/**
 * Cross-instance status identity — same post can have different local ids.
 */
export function statusIdentity(
  status: { id: string; uri?: string | null; url?: string | null },
): string {
  return (status.uri || status.url || status.id || '').toLowerCase()
}

/** Keep first occurrence; preserves merge sort order when applied after sort. */
export function dedupeStatusesByIdentity<
  T extends { id: string; uri?: string | null; url?: string | null },
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
