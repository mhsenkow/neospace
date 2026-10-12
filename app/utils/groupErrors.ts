import { httpStatusFrom } from '~/utils/friendlyError'

/**
 * Honest copy for a failed Join. "Couldn't join · Retry" is wrong when Retry can
 * never work (a server without hashtag following) or only works later (rate limit).
 */
export function joinGroupFailure(err: unknown): { message: string; retryable: boolean } {
  const status = httpStatusFrom(err)
  if (status === 404 || status === 501) {
    return { message: 'Your server doesn’t support following hashtags', retryable: false }
  }
  if (status === 429) return { message: 'Slow down — try again in a minute', retryable: false }
  if (status === 401 || status === 403) return { message: 'Sign in again to join groups', retryable: false }
  if (status === 422) return { message: 'This hashtag can’t be followed', retryable: false }
  return { message: 'Couldn’t join group', retryable: true }
}
