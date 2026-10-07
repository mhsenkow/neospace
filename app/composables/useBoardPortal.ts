/**
 * Which mobile home edge-portal is in view — layout uses this to highlight
 * related chrome (menu/theme, search, Inbox, Activity, You, Groups).
 */
export type BoardPortal =
  | 'settings'
  | 'profile'
  | 'search'
  | 'inbox'
  | 'activity'
  | 'communities'
  | null

/** Right-edge order after the last feed column */
export const BOARD_RIGHT_PORTALS = ['search', 'inbox', 'activity', 'communities'] as const
export type BoardRightPortal = (typeof BOARD_RIGHT_PORTALS)[number]

export const useBoardPortal = () => {
  const portal = useState<BoardPortal>('neo-board-portal', () => null)

  const setBoardPortal = (next: BoardPortal) => {
    portal.value = next
  }

  return { boardPortal: portal, setBoardPortal }
}
