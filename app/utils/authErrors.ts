/**
 * Friendly copy for OAuth / sign-in failures shown on /auth/callback.
 * Only maps known error codes — never echo arbitrary error_description text.
 */

const KNOWN: Record<string, string> = {
  access_denied:
    'Sign-in was cancelled. No worries — you can try again whenever you’re ready.',
  invalid_state:
    'This sign-in link expired or was opened in the wrong tab. Please start again from the sign-in page.',
  invalid_grant:
    'That authorization code expired. Please start sign-in again from the beginning.',
  invalid_client:
    'NeoSpace couldn’t connect to this server. Try again, or contact your server admin.',
  invalid_request:
    'Something interrupted sign-in. Please try again from the beginning.',
  unauthorized_client:
    'This server rejected the NeoSpace app. Try again or pick a different server.',
  server_error:
    'The server had a temporary problem. Wait a moment and try again.',
  temporarily_unavailable:
    'The server is temporarily unavailable. Try again in a few minutes.',
}

export function friendlyAuthError(raw: string): string {
  const lower = (raw || '').toLowerCase().trim()
  for (const [code, message] of Object.entries(KNOWN)) {
    if (lower.includes(code)) return message
  }
  if (lower.includes('no pending') || lower.includes('no authorization')) {
    return 'This sign-in link expired. Please start again from the sign-in page.'
  }
  if (lower.includes('missing oauth') || lower.includes('missing pkce')) {
    return 'Something interrupted sign-in. Please try again from the beginning.'
  }
  if (lower.includes('invalid oauth state')) {
    return KNOWN.invalid_state!
  }
  if (lower.includes('instance not found') || lower.includes('server not found')) {
    return 'We couldn’t find that server in NeoSpace. Start sign-in again and pick your server.'
  }
  if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('offline')) {
    return 'Couldn’t reach the server. Check your connection and try again.'
  }
  return 'We couldn’t finish signing you in. Please try again.'
}
