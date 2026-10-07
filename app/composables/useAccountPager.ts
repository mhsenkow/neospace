/**
 * Account status pager — shared dedupe + page sizing for profile timelines.
 */

import type { mastodon } from 'masto'
import { usePager } from '~/composables/usePager'

export const ACCOUNT_STATUS_PAGE_SIZE = 20

export function dedupeStatusPage(
  existing: mastodon.v1.Status[],
  page: mastodon.v1.Status[],
  replace: boolean,
): mastodon.v1.Status[] {
  if (replace) {
    const seen = new Set<string>()
    const next: mastodon.v1.Status[] = []
    for (const s of page) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      next.push(s)
    }
    return next
  }
  const seen = new Set(existing.map((s) => s.id))
  const next = [...existing]
  for (const s of page) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    next.push(s)
  }
  return next
}

export function accountStatusHasMore(pageLength: number, pageSize = ACCOUNT_STATUS_PAGE_SIZE) {
  return pageLength >= pageSize
}

export type AccountPageFetcher = (opts: {
  maxId?: string
  signal: AbortSignal
}) => Promise<mastodon.v1.Status[]>

export function useAccountPager(fetchPage: AccountPageFetcher, pageSize = ACCOUNT_STATUS_PAGE_SIZE) {
  const pager = usePager<mastodon.v1.Status>(fetchPage)

  const loadInitial = async () => {
    await pager.loadInitial()
    pager.hasMore.value =
      pager.items.value.length > 0 &&
      accountStatusHasMore(pager.items.value.length, pageSize)
  }

  const loadMore = async () => {
    const before = pager.items.value.length
    await pager.loadMore()
    const added = pager.items.value.length - before
    if (added === 0 || added < pageSize) pager.hasMore.value = false
  }

  return {
    ...pager,
    loadInitial,
    loadMore,
  }
}
