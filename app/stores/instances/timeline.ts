/**
 * Merged-timeline helpers: tagging statuses with their source, ordering, cursor params,
 * and the failure copy shown when every source fails.
 */

import type { mastodon } from 'masto'
import type { ExtendedStatus } from './types'

export const LOGIN_REQUIRED_TIMELINE_MESSAGE =
  'This instance requires login to view timelines. Connect an account or add a different instance.'

export function tagStatuses(
  statuses: mastodon.v1.Status[],
  instanceId: string,
  instanceUrl: string,
): ExtendedStatus[] {
  return statuses.map((s) => ({
    ...s,
    _instanceId: instanceId,
    _instanceUrl: instanceUrl,
  }))
}

/** `sinceId` pages forward from the cursor, `maxId` pages back; no cursor → no param */
export function cursorParams(
  cursor: string | undefined,
  since: boolean | undefined,
): { sinceId: string } | { maxId: string } | Record<string, never> {
  return cursor ? (since ? { sinceId: cursor } : { maxId: cursor }) : {}
}

/** Newest first (in place) */
export function sortStatusesNewestFirst<T extends { createdAt: string }>(statuses: T[]): T[] {
  return statuses.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

/** Error surfaced when no source returned statuses */
export function mergedTimelineFailureMessage(firstError: string | undefined): string {
  return firstError?.includes('requires login') ||
    firstError?.includes('authenticated') ||
    firstError?.includes('authenticated user')
    ? LOGIN_REQUIRED_TIMELINE_MESSAGE
    : firstError || 'Failed to fetch timeline'
}
