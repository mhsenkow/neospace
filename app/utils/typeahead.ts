/**
 * Menu / list typeahead (APG): index of the next label starting with `query`,
 * searching after `from` and wrapping. A repeated single letter cycles matches.
 * Returns -1 when nothing matches.
 */
export function typeaheadMatch(labels: string[], query: string, from: number): number {
  const q = query.trim().toLowerCase()
  const n = labels.length
  if (!q || !n) return -1
  // "aaa" → keep cycling items that start with "a"
  const needle = [...q].every((c) => c === q[0]) ? q[0]! : q
  // Multi-char queries extend the current match first; a single char moves on
  const start = needle.length > 1 ? Math.max(from, 0) : from + 1
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    if (labels[i]!.trim().toLowerCase().startsWith(needle)) return i
  }
  return -1
}
