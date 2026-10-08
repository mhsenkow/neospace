/**
 * Mastodon Link-header pagination helpers.
 *
 * Account lists (followers/following, mutes, blocks) and followed tags are
 * paginated by internal ids exposed only through the `Link` header — the
 * last entity's `id` is NOT a valid `max_id` for them.
 */

/** Minimal shape of masto's `$raw` response (HttpResponse isn't re-exported). */
export interface RawPage<T> {
  headers: Headers
  data: T
}

export interface CursorPage<T> {
  items: T[]
  /** `max_id` for the next page, or null when the server reports no next link. */
  nextMaxId: string | null
}

/** Pull the `max_id` cursor from a `Link: <…>; rel="next"` header value. */
export function nextMaxIdFromLink(link: string | null | undefined): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/)
    if (!match || match[2] !== 'next') continue
    try {
      return new URL(match[1]!).searchParams.get('max_id')
    } catch {
      return null
    }
  }
  return null
}

/** Await a masto `.list.$raw(...)` page and return items + next cursor. */
export async function cursorPage<T>(raw: PromiseLike<RawPage<T[]>>): Promise<CursorPage<T>> {
  const res = await raw
  return {
    items: Array.isArray(res.data) ? res.data : [],
    nextMaxId: nextMaxIdFromLink(res.headers?.get('link')),
  }
}
