/**
 * Friendly copy for OAuth / sign-in failures shown on /auth/callback.
 */

export function friendlyAuthError(raw: string): string {
  const lower = (raw || '').toLowerCase()
  if (lower.includes('access_denied') || lower.includes('denied')) {
    return 'Sign-in was cancelled. No worries — you can try again whenever you’re ready.'
  }
  if (lower.includes('no pending') || lower.includes('no authorization')) {
    return 'This sign-in link expired. Please start again from the sign-in page.'
  }
  if (lower.includes('missing oauth') || lower.includes('credentials')) {
    return 'Something interrupted sign-in. Please try again from the beginning.'
  }
  if (raw && raw.length < 140) return raw
  return 'We couldn’t finish signing you in. Please try again.'
}
