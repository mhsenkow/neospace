/**
 * Compare Mastodon snowflake IDs. Lexical string compare breaks when lengths differ
 * ("99" > "100"). Compare by digit length first, then lexicographically.
 */
export function compareId(a: string | null | undefined, b: string | null | undefined): number {
  const left = a == null ? '' : String(a)
  const right = b == null ? '' : String(b)
  if (left === right) return 0
  if (!left) return -1
  if (!right) return 1
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return left < right ? -1 : 1
}

export function idGreater(a: string | null | undefined, b: string | null | undefined): boolean {
  return compareId(a, b) > 0
}

export function idLess(a: string | null | undefined, b: string | null | undefined): boolean {
  return compareId(a, b) < 0
}
