/**
 * Prefer jumping to an existing home-board column over navigating to a
 * standalone route (messages / notifications / profile / search / group).
 */

import type { RouteLocationRaw } from 'vue-router'
import { useColumnsStore, type ColumnFeedType } from '~/stores/columns'

/** Always re-set so index can re-park even when focusedColumnId is unchanged. */
export function usePendingColumnJump() {
  return useState<string | null>('neo-pending-column-jump', () => null)
}

/** Which board column is currently in view (home carousel / strip). */
export function useActiveBoardColumnId() {
  return useState<string | null>('neo-active-board-column-id', () => null)
}

export function useBoardNav() {
  const columnsStore = useColumnsStore()
  const router = useRouter()
  const route = useRoute()
  const pendingColumnJump = usePendingColumnJump()
  const activeBoardColumnId = useActiveBoardColumnId()

  const requestColumnJump = (columnId: string) => {
    pendingColumnJump.value = columnId
  }

  const boardColumnIs = (feedType: ColumnFeedType, feedParam?: string) => {
    if (route.path !== '/') return false
    const id = activeBoardColumnId.value || columnsStore.focusedColumnId
    if (!id) return false
    const col = columnsStore.columns.find((c) => c.id === id)
    if (!col || col.feedType !== feedType) return false
    if (feedType === 'group') return col.groupTag === feedParam
    if (feedType === 'algorithm') return col.algorithmId === feedParam
    if (feedType === 'profile') return !col.profileAcct
    return true
  }

  /**
   * Park on a column without shelf-focus (packed/roomy keep siblings visible).
   * Tabs density still pins the focused feed — that's how the mode works.
   */
  const parkOnColumn = (columnId: string) => {
    if (columnsStore.deskDensity === 'tabs') {
      columnsStore.setFocusedColumn(columnId)
    }
    requestColumnJump(columnId)
  }

  /** Focus + request park on home for a column id that already exists. */
  const jumpToColumnId = async (columnId: string) => {
    parkOnColumn(columnId)
    if (route.path !== '/') await router.push('/')
  }

  /**
   * If the board already has this feed, jump to it on home.
   * Otherwise navigate to `fallback`. Returns true when a column was used.
   */
  const openFeedOrRoute = async (
    feedType: ColumnFeedType,
    fallback: RouteLocationRaw,
    feedParam?: string,
  ): Promise<boolean> => {
    const match = columnsStore.findColumn(feedType, feedParam)
    if (!match) {
      await router.push(fallback)
      return false
    }
    parkOnColumn(match.id)
    if (route.path !== '/') await router.push('/')
    return true
  }

  /** Algorithms / Local / etc. — add if needed, then park on home. */
  const openBoardFeed = async (feedType: ColumnFeedType, feedParam?: string) => {
    const id = columnsStore.ensureFocusedView(feedType, feedParam)
    if (id) requestColumnJump(id)
    if (route.path !== '/') await router.push('/')
  }

  /** Home chrome: leave shelf-focus and park on the primary feed. */
  const goHome = async () => {
    columnsStore.clearColumnFocus()
    const home =
      columnsStore.findColumn('home') ||
      columnsStore.columns[0]
    if (home) requestColumnJump(home.id)
    if (route.path !== '/') await router.push('/')
  }

  const openGroup = async (tag: string) => {
    const normalized = tag.replace(/^#/, '').toLowerCase()
    const used = await openFeedOrRoute('group', `/groups/${normalized}`, normalized)
    return used
  }

  return {
    pendingColumnJump,
    activeBoardColumnId,
    requestColumnJump,
    boardColumnIs,
    jumpToColumnId,
    openFeedOrRoute,
    openBoardFeed,
    openGroup,
    goHome,
  }
}
