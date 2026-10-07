/**
 * Which mobile home edge-portal is in view — layout uses this to highlight
 * related chrome (menu/theme, You tab, Groups).
 */
export type BoardPortal = 'settings' | 'profile' | 'communities' | null

export const useBoardPortal = () => {
  const portal = useState<BoardPortal>('neo-board-portal', () => null)

  const setBoardPortal = (next: BoardPortal) => {
    portal.value = next
  }

  return { boardPortal: portal, setBoardPortal }
}
