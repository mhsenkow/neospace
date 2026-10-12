import { compareId } from './compareId'

/**
 * Timeline catch-up that never skips arrivals.
 *
 * Mastodon's `since_id` returns the NEWEST `limit` statuses above the bound, so
 * advancing it to the newest result of a page silently drops everything between
 * the old bound and that page. `min_id` pages forward instead: it returns the
 * `limit` statuses immediately above the cursor, so moving the cursor to the
 * newest id of each page walks the whole interval exactly once.
 * https://docs.joinmastodon.org/methods/timelines/#view-public-timeline
 */

/** A source (one server / account timeline) that can be paged forward from a cursor. */
export interface CatchUpSource<T extends { id: string }> {
  /** Cursor key — the instance id, or `_default` for an origin-less browse feed. */
  key: string
  /** Newest id already held for this source. */
  cursor: string
  /** One `min_id` page: statuses immediately newer than `minId`, newest first. */
  fetchPage: (minId: string, limit: number) => Promise<T[]>
}

export interface CatchUpResult<T> {
  items: T[]
  /** Advanced cursors for sources that returned anything (caller commits when the feed is still current). */
  cursors: Record<string, string>
  /** Sources that stopped at the page cap with more waiting — recoverable by the next poll. */
  capped: string[]
  /** Sources that caught up completely (short or empty page). */
  settled: string[]
  /** Sources whose request failed; their cursor is untouched, so the next poll retries. */
  failed: string[]
  /** First failure, for callers that want to surface "everything failed". */
  firstError?: unknown
}

function newestId<T extends { id: string }>(page: readonly T[]): string {
  let best = ''
  for (const s of page) if (!best || compareId(s.id, best) > 0) best = s.id
  return best
}

/**
 * Walk every source forward from its cursor. Sources are independent: a busy
 * server can hit the page cap while a quiet one settles, and one failing server
 * doesn't discard another's posts. Pure — no component state is touched.
 */
export async function catchUpForward<T extends { id: string }>(
  sources: readonly CatchUpSource<T>[],
  opts: { pageLimit: number; maxPages: number },
): Promise<CatchUpResult<T>> {
  const result: CatchUpResult<T> = {
    items: [],
    cursors: {},
    capped: [],
    settled: [],
    failed: [],
  }

  await Promise.all(
    sources.map(async (source) => {
      let cursor = source.cursor
      const collected: T[] = []
      let outcome: 'capped' | 'settled' | 'failed' = 'capped'
      for (let page = 0; page < opts.maxPages; page++) {
        let batch: T[]
        try {
          batch = await source.fetchPage(cursor, opts.pageLimit)
        } catch (e) {
          outcome = 'failed'
          if (result.firstError === undefined) result.firstError = e
          break
        }
        if (!batch.length) {
          outcome = 'settled'
          break
        }
        collected.push(...batch)
        const next = newestId(batch)
        // A page that doesn't move the cursor would loop forever on a broken server
        if (!next || compareId(next, cursor) <= 0) {
          outcome = 'settled'
          break
        }
        cursor = next
        if (batch.length < opts.pageLimit) {
          outcome = 'settled'
          break
        }
      }

      result.items.push(...collected)
      if (cursor !== source.cursor) result.cursors[source.key] = cursor
      result[outcome].push(source.key)
    }),
  )

  // Items arrive page-ascending per source; ids aren't comparable across servers,
  // so ordering (createdAt) is the caller's job.
  return result
}

/**
 * Cursor map after merging newly seen ids (never moves a cursor backwards).
 * Returns a new object — callers decide when to commit it.
 */
export function mergeCursors(
  current: Record<string, string>,
  next: Record<string, string>,
): Record<string, string> {
  const merged = { ...current }
  for (const [key, id] of Object.entries(next)) {
    if (!merged[key] || compareId(id, merged[key]) > 0) merged[key] = id
  }
  return merged
}

/** Gap bookkeeping across polls: a source stays flagged until it settles. */
export function nextGapSources(
  previous: readonly string[],
  result: Pick<CatchUpResult<unknown>, 'capped' | 'settled'>,
): string[] {
  const kept = previous.filter((key) => !result.settled.includes(key))
  return [...new Set([...kept, ...result.capped])]
}
