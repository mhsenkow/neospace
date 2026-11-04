/**
 * One-shot first-run coach for the phone board (~30s of orientation).
 */
const STORAGE_KEY = 'neo-board-coach-v1'

export type BoardCoachStep = {
  id: string
  title: string
  body: string
}

export const BOARD_COACH_STEPS: BoardCoachStep[] = [
  {
    id: 'modes',
    title: 'Feed or Flick',
    body: 'Feed scrolls a list. Flick is one post at a time — same switch in the header and in landscape.',
  },
  {
    id: 'pills',
    title: 'Feeds on the board',
    body: 'Swipe between columns, or open the menu to add Local, Federated, Lists, Liked, and algorithms.',
  },
  {
    id: 'servers',
    title: 'Multi-server ready',
    body: 'Add more Mastodon accounts anytime. Explore finds people across servers; Home can merge them.',
  },
]

export function useBoardCoach() {
  const open = useState('neo-board-coach-open', () => false)
  const step = useState('neo-board-coach-step', () => 0)
  const seen = useState('neo-board-coach-seen', () => false)

  const refresh = () => {
    if (!import.meta.client) return
    try {
      seen.value = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      seen.value = false
    }
  }

  const markSeen = () => {
    seen.value = true
    open.value = false
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  const startIfNeeded = () => {
    refresh()
    if (seen.value) return
    step.value = 0
    open.value = true
  }

  const next = () => {
    if (step.value >= BOARD_COACH_STEPS.length - 1) {
      markSeen()
      return
    }
    step.value += 1
  }

  const skip = () => markSeen()

  if (import.meta.client) refresh()

  return { open, step, seen, startIfNeeded, next, skip, markSeen, steps: BOARD_COACH_STEPS }
}
