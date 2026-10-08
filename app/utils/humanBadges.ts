/**
 * Verified-human badge catalog — intent layer only.
 * These are things that are easy for a person and expensive for a bot farm.
 * Nothing here is issued yet; the profile tab shows the path.
 */

export type HumanBadgeId =
  | 'reality'
  | 'weird-snap'
  | 'yap'
  | 'neighbor'
  | 'care'
  | 'teach'
  | 'present'
  | 'hand'

export type HumanBadgeDef = {
  id: HumanBadgeId
  /** Short label on the chip */
  label: string
  /** One-line why this is hard for a farm */
  why: string
  /** What a human actually does */
  how: string
}

/** Ordered showcase — profile tab renders these as locked intent chips */
export const HUMAN_BADGE_DEFS: HumanBadgeDef[] = [
  {
    id: 'reality',
    label: 'Reality',
    why: 'Needs a fresh photo of the physical world, not a scraped avatar.',
    how: 'Pass a short, rotating proof-of-reality challenge.',
  },
  {
    id: 'weird-snap',
    label: 'Weird snap',
    why: 'Prompts are odd on purpose — farms can’t pre-stage “hand + mushroom + 200pts.”',
    how: 'Shoot the day’s absurd prompt. New ask every round.',
  },
  {
    id: 'yap',
    label: 'Yap',
    why: 'Real back-and-forth with people beats blast-and-ghost scripts.',
    how: 'Sustained conversations — replies that actually go somewhere.',
  },
  {
    id: 'neighbor',
    label: 'Neighbor',
    why: 'Mutual care over time is slow; sock farms hate slow.',
    how: 'Show up for people you know across weeks, not minutes.',
  },
  {
    id: 'care',
    label: 'Care',
    why: 'Content warnings, accessibility, and gentleness don’t look like engagement bait.',
    how: 'Habit of CW, alt text, and not dunking for points.',
  },
  {
    id: 'teach',
    label: 'Teach',
    why: 'Helping a newcomer is a human move, not a growth loop.',
    how: 'Explain something patiently when someone is lost.',
  },
  {
    id: 'present',
    label: 'Present',
    why: 'Being in the room (live, Edward, a call) beats scheduled spam.',
    how: 'Join a live human moment — not a cron job.',
  },
  {
    id: 'hand',
    label: 'Hand',
    why: 'A living hand in frame is still a high bar for bulk fakes.',
    how: 'Include your hand in a reality prompt when asked.',
  },
]
