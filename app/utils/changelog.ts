/**
 * In-app release notes for Settings → What's new.
 * Keep entries short (TLDR). Newest first.
 */

export type ChangelogEntry = {
  /** ISO date or YYYY-MM-DD */
  date: string
  /** Short title shown as the release heading */
  title: string
  /** One-line summary */
  summary: string
  /** Bullet TLDR — user-facing, not eng jargon */
  highlights: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-12',
    title: 'Big safety & polish day',
    summary:
      'Safer cross-server actions, stronger compose, quieter Edward, and a clearer Settings experience — plus this What’s new feed.',
    highlights: [
      'Mute, block, report, and reply use full @user@host identities — no more lookalike mix-ups',
      'Content warnings hide previews, polls, and media until you expand them',
      'Busy timelines catch up correctly; a banner appears if anything may still be missing',
      'Board full? You’re asked before a column is replaced (with Undo)',
      'Drafts are per-account — Save draft & close, drafts list, reply/group restore',
      'Compose: polls (including hide vote counts), schedule queue, upload progress/cancel, @ / # / :emoji: autocomplete',
      'Own posts: delete, delete & redraft, and pin/unpin — bound to the right account',
      'Notifications stay unread until you mark them; mobile chat Enter inserts a newline',
      'Fonts are self-hosted (no Google Fonts calls); Settings panels are clearer to navigate',
      'PWA updates wait politely instead of hijacking mid-session',
      'Edward: less GPU drain when idle/recessed, clearer hover cards, Restart 3D if the scene glitches',
      'Leave-a-note feedback hardened; stronger CI (browser + a11y + real lint)',
      'Shared feed menus, shell polish, and lots of small UX fixes across groups and ranked feeds',
    ],
  },
  {
    date: '2026-10-08',
    title: 'Feed and shell polish',
    summary: 'Faster boards, clearer focus modes, and a cleaner mobile shell.',
    highlights: [
      'Shallower timeline memory use and smarter polling',
      'Focused desktop media can go full-bleed while text stays readable',
      'Activity and ranked-feed clarifications on mobile',
    ],
  },
]

/** Newest entry — useful for a badge or “since you last looked” later */
export function latestChangelogEntry(): ChangelogEntry | null {
  return CHANGELOG[0] ?? null
}
