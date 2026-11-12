/**
 * OAuth session helpers for the instances store (PKCE/app-registration live in
 * `~/utils/oauthPkce` and `~/utils/oauthApp`).
 */

import { oauthFetch } from '~/utils/oauthApp'
import { httpStatusFrom } from '~/utils/friendlyError'

export const APP_NAME = 'LoomSpace'
export const SCOPES = 'read write follow push'

/** Tokens verified by completeAuth moments ago — the OAuth callback's follow-up initialize() skips them */
export const RECENT_VERIFY_MS = 60_000
export const recentlyVerified = new Map<string, { token: string; at: number }>()

/** Message from an unknown thrown value (Error or error-like), if it carries one */
export function messageOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' ? message : undefined
}

/** POST /oauth/revoke — callers decide whether a failure matters */
export async function revokeAccessToken(
  instanceUrl: string,
  clientId: string,
  clientSecret: string,
  token: string,
): Promise<void> {
  await oauthFetch(`${instanceUrl}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      token,
    }),
  })
}

/**
 * Classify a failed verifyCredentials: expired sessions drop the token, everything else
 * only records a message.
 */
export function classifyVerifyFailure(err: unknown): { expired: boolean; message: string } {
  const status = httpStatusFrom(err)
  if (status === 401 || status === 403) {
    return { expired: true, message: 'Session expired — sign in again' }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { expired: false, message: 'Offline — couldn’t verify your session' }
  }
  if (status !== null && status >= 500) {
    return { expired: false, message: 'Server error — try again later' }
  }
  return { expired: false, message: 'Couldn’t verify your session' }
}
