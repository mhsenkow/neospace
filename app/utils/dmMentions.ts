/**
 * DM bubbles drop the leading "@alice @bob" addressing — it's implied by the
 * chat — but only when every leading mention is a participant, so text like
 * "@home tonight" or a mention of someone new stays visible.
 */

// Mastodon wraps mentions as <span class="h-card"><a class="mention">@<span>user</span></a></span>
const LEADING_MENTIONS =
  /^(?:\s*<p>)?(?:\s*(?:<span[^>]*class="[^"]*h-card[^"]*"[^>]*>)?\s*<a[^>]*class="[^"]*mention[^"]*"[^>]*>.*?<\/a>\s*(?:<\/span>)?\s*)+/i

export function stripParticipantMentions(
  html: string,
  /** Participant accts as the viewer's server reports them ("alice", "bob@remote.social") */
  participantAccts: readonly string[],
  /** status.mentions — maps each link's href to its exact acct */
  mentions: readonly { url?: string | null; acct: string }[] = [],
): string {
  if (!html || !participantAccts.length) return html
  const participants = new Set(participantAccts.map((a) => a.replace(/^@/, '').toLowerCase()))
  const acctByUrl = new Map<string, string>()
  for (const m of mentions) {
    if (m.url) acctByUrl.set(m.url, m.acct.toLowerCase())
  }

  return html.replace(LEADING_MENTIONS, (lead) => {
    const anchors = [...lead.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gi)]
    const allParticipants = anchors.every((match) => {
      const href = /\bhref="([^"]*)"/i.exec(match[1] || '')?.[1] || ''
      const text = (match[2] || '').replace(/<[^>]*>/g, '').replace(/^@/, '').toLowerCase()
      // Prefer the exact acct; bare link text ("@alice") only identifies local accounts
      return participants.has(acctByUrl.get(href) ?? text)
    })
    if (!allParticipants) return lead
    return /^\s*<p>/i.exec(lead)?.[0] ?? ''
  })
}
