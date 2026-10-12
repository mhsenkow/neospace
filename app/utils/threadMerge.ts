/**
 * A DM chat opened on one message only gets that message's parent chain from the
 * server. In a group conversation where two people answered the same message the
 * other branch never shows up. Re-reading the *root's* context returns the whole tree.
 */

type Node = { id: string; createdAt: string }

const time = (s: Node) => {
  const t = Date.parse(s.createdAt)
  return Number.isFinite(t) ? t : 0
}

/** Same id and length → numeric-string order (Mastodon ids are snowflakes) */
const byTime = (a: Node, b: Node) =>
  time(a) - time(b) ||
  (a.id.length !== b.id.length ? a.id.length - b.id.length : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Merge the root's whole tree with what the focus post's own context returned and
 * split it chronologically around the focus: everything older is "ancestors", the rest
 * "descendants". De-duplicated by id; the focus post itself appears in neither list.
 */
export function mergeThreadBranches<T extends Node>(
  focus: T,
  parts: { root: T; rootDescendants: T[]; ancestors: T[]; descendants: T[] },
): { ancestors: T[]; descendants: T[] } {
  const seen = new Map<string, T>()
  for (const s of [
    parts.root,
    ...parts.rootDescendants,
    ...parts.ancestors,
    ...parts.descendants,
  ]) {
    if (s && s.id !== focus.id && !seen.has(s.id)) seen.set(s.id, s)
  }
  const all = [...seen.values()].sort(byTime)
  const ancestors: T[] = []
  const descendants: T[] = []
  for (const s of all) (byTime(s, focus) < 0 ? ancestors : descendants).push(s)
  return { ancestors, descendants }
}
