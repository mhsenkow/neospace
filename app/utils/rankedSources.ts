/**
 * Failure policy for ranked-feed candidate sources.
 *
 * Some servers simply lack an endpoint (no `/trends/statuses` on GoToSocial or
 * Akkoma, auth-gated local timelines): retrying every refill wastes a request
 * each time, so those sources are retired for the session. Anything else
 * (network blip, 429, 5xx) backs off instead.
 */

const PERMANENT_STATUSES = new Set([401, 403, 404, 501])

/** The endpoint will never work for this session */
export const isPermanentSourceFailure = (status: number | null | undefined) =>
  status != null && PERMANENT_STATUSES.has(status)

/** 5s, 10s, 20s … capped at 60s */
export const sourceBackoffMs = (failures: number) => Math.min(60_000, 5_000 * 2 ** Math.max(0, failures - 1))

/** Ranked posts read "Algo · why · why"; a ranker with no reasons gets a neutral fallback, not a dangling separator */
export function rankWhyLabel(short: string, why: string[]): string {
  const parts = why.map((w) => w.trim()).filter(Boolean)
  return `${short} · ${parts.length ? parts.join(' · ') : 'Something new'}`
}
