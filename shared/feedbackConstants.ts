/** Shared leave-a-note limits — keep client + Pages Function in sync */

export const FEEDBACK_GITHUB_REPO = 'mhsenkow/neospace'

export const FEEDBACK_KINDS = ['ux', 'bug', 'idea', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FEEDBACK_TITLE_MAX = 200
export const FEEDBACK_BODY_MAX = 8_000

/** Client JPEG shrink target (room for title + metadata in GitHub body) */
export const FEEDBACK_SCREENSHOT_CLIENT_MAX = 40_000
/** Server omits screenshots larger than this in the issue body */
export const FEEDBACK_SCREENSHOT_SERVER_MAX = 45_000

/** GitHub issue body soft cap */
export const GITHUB_ISSUE_BODY_BUDGET = 60_000

/** Max JSON POST body for /api/feedback */
export const FEEDBACK_JSON_MAX_BYTES = 512_000

/** GitHub “new issue” prefilled URL length guard */
export const GITHUB_NEW_ISSUE_URL_MAX = 7_000

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  ux: 'ux',
  bug: 'bug',
  idea: 'idea',
  other: 'other',
}

export function isFeedbackKind(value: string): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly string[]).includes(value)
}
