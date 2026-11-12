/**
 * Home board column management: tab labels + active-feed title, the Add feed
 * menu (feeds / RSS / groups), drag + keyboard reorder, and per-column view mode.
 * Scroller / carousel mechanics stay in useBoardShell.
 */

import type { Ref } from 'vue'
import { computed, nextTick, ref, watch } from 'vue'
import {
  useColumnsStore,
  MAX_COLUMNS,
  FEED_LABELS,
  isTimelineFeed,
  type ColumnFeedType,
} from '~/stores/columns'
import { useAlgorithmsStore } from '~/stores/algorithms'
import { useGroupsStore } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import { hostnameOf, resolvePublicInstanceUrl } from '~/utils/instances'
import { isNativeShell } from '~/utils/nativeShell'
import { useBoardPortal } from '~/composables/useBoardPortal'
import { useRequestAddFeed } from '~/composables/useBoardNav'
import { useMastodonLists } from '~/composables/useMastodonLists'
import type { useBoardShell } from '~/composables/useBoardShell'

export function useBoardColumns({
  isMobileUi,
  shell,
}: {
  isMobileUi: Ref<boolean>
  shell: Pick<
    ReturnType<typeof useBoardShell>,
    | 'activeColumnIndex'
    | 'columnsContainer'
    | 'getColumnEls'
    | 'scrollToColumn'
    | 'isDeskTabs'
    | 'scrollActiveFeedToTop'
  >
}) {
  const instancesStore = useInstancesStore()
  const columnsStore = useColumnsStore()
  const groupsStore = useGroupsStore()
  const toastStore = useToastStore()
  const algorithmsStore = useAlgorithmsStore()
  algorithmsStore.hydrate()
  const { boardPortal } = useBoardPortal()
  const requestAddFeed = useRequestAddFeed()
  const {
    activeColumnIndex,
    columnsContainer,
    getColumnEls,
    scrollToColumn,
    isDeskTabs,
    scrollActiveFeedToTop,
  } = shell

  const addMenuOpen = ref(false)
  watch(requestAddFeed, (want) => {
    if (!want) return
    requestAddFeed.value = false
    if (!columnsStore.canAddColumn) return
    addMenuOpen.value = true
  })
  const boardFullLabel = `Board full (${MAX_COLUMNS}/${MAX_COLUMNS}) — remove a feed to add another`
  const addAlgorithmsExpanded = ref(true)
  const addGroupsExpanded = ref(true)
  const addGroupQuery = ref('')

  const draggingColumnId = ref<string | null>(null)
  const dropTargetColumnId = ref<string | null>(null)

  const localHostLabel = computed(() => {
    const filteredId = instancesStore.activeInstanceFilter
    const filtered = filteredId
      ? instancesStore.instances.find((i) => i.id === filteredId)
      : null
    const preferred =
      filtered?.url ||
      instancesStore.activeAccount?.url ||
      instancesStore.instances[0]?.url ||
      resolvePublicInstanceUrl()
    return hostnameOf(preferred) || 'this server'
  })

  const columnTabLabels = computed(() =>
    columnsStore.columns.map((column) => {
      if (column.feedType === 'group' && column.groupTag) {
        const group = groupsStore.getGroup(column.groupTag)
        return group ? `${group.icon} ${group.name}` : `#${column.groupTag}`
      }
      if (column.feedType === 'algorithm' && column.algorithmId) {
        return algorithmsStore.getRecipe(column.algorithmId)?.name || 'Algorithm'
      }
      if (column.feedType === 'list') {
        return column.listTitle || 'List'
      }
      if (column.feedType === 'rss') {
        return column.rssTitle || 'RSS'
      }
      if (column.feedType === 'local') {
        return `Local (${localHostLabel.value})`
      }
      return FEED_LABELS[column.feedType] ?? column.feedType
    }),
  )

  const feedTabs = computed(() =>
    columnsStore.columns.map((column, idx) => ({
      id: column.id,
      label: columnTabLabels.value[idx] || column.feedType,
    })),
  )

  /** Top chrome title — feed name, or the edge portal you’re parked on */
  const activeFeedChromeTitle = computed(() => {
    switch (boardPortal.value) {
      case 'settings':
        return 'Settings'
      case 'profile':
        return 'Profile'
      case 'search':
        return 'Search'
      case 'inbox':
        return 'Messages'
      case 'activity':
        return 'Activity'
      case 'communities':
        return 'Groups'
      default:
        return columnTabLabels.value[activeColumnIndex.value] || 'Feed'
    }
  })

  const activeFeedTabId = computed({
    get: () => {
      if (isDeskTabs.value && columnsStore.focusedColumnId) {
        return columnsStore.focusedColumnId
      }
      return columnsStore.columns[activeColumnIndex.value]?.id || feedTabs.value[0]?.id || ''
    },
    set: (id: string) => {
      const idx = columnsStore.columns.findIndex((c) => c.id === id)
      if (idx < 0) return
      const same = columnsStore.columns[activeColumnIndex.value]?.id === id
      activeColumnIndex.value = idx
      if (isDeskTabs.value) {
        columnsStore.setFocusedColumn(id)
        if (same) scrollActiveFeedToTop()
        return
      }
      // Always re-park — same-id taps recover Android desync; use auto on mobile
      scrollToColumn(idx, isMobileUi.value ? 'auto' : 'smooth')
      // Native-app pattern: tap the already-active feed pill → jump to top
      if (same && isMobileUi.value) scrollActiveFeedToTop()
    },
  })

  /** Keep the active mobile feed glued to the same column id across reorders */
  const withActivePreserved = (fn: () => void) => {
    const activeId = columnsStore.columns[activeColumnIndex.value]?.id
    fn()
    if (!activeId) return
    const next = columnsStore.columns.findIndex(c => c.id === activeId)
    if (next !== -1) activeColumnIndex.value = next
  }

  const reorderToIndex = (fromColumnId: string, toIndex: number) => {
    withActivePreserved(() => {
      columnsStore.moveColumnById(fromColumnId, toIndex)
    })
  }

  const onColumnDragStart = (columnId: string) => {
    draggingColumnId.value = columnId
  }

  const onColumnDragEnd = () => {
    draggingColumnId.value = null
    dropTargetColumnId.value = null
  }

  const onColumnDragOver = (columnId: string) => {
    if (draggingColumnId.value && draggingColumnId.value !== columnId) {
      dropTargetColumnId.value = columnId
    }
  }

  const onColumnDrop = (fromColumnId: string, toColumnId: string) => {
    const toIndex = columnsStore.columns.findIndex(c => c.id === toColumnId)
    if (toIndex === -1) return
    reorderToIndex(fromColumnId, toIndex)
    onColumnDragEnd()
  }

  /** Polite status for keyboard reorders (drag-and-drop is visual on its own) */
  const columnMoveAnnounce = ref('')

  /**
   * The keyed v-for moves column DOM nodes on reorder, which drops focus from the
   * Move / drag-handle button that was pressed — and Move left/right disables at
   * the ends. Put focus back (or on its enabled sibling) and say where it landed.
   */
  const afterColumnMove = (columnId: string | undefined, prevFocus: Element | null) => {
    columnMoveAnnounce.value = ''
    nextTick(() => {
      const idx = columnsStore.columns.findIndex((c) => c.id === columnId)
      if (idx < 0) return
      columnMoveAnnounce.value = `Moved ${columnTabLabels.value[idx] || 'column'} to position ${idx + 1} of ${columnsStore.columns.length}`
      if (!(prevFocus instanceof HTMLElement) || !prevFocus.isConnected) return
      if (!columnsContainer.value?.contains(prevFocus)) return
      let target: HTMLElement | null = prevFocus
      if ((prevFocus as HTMLButtonElement).disabled) {
        target = prevFocus.parentElement?.querySelector<HTMLElement>('button:not(:disabled)') ?? null
      }
      if (target && document.activeElement !== target) target.focus({ preventScroll: true })
    })
  }

  const moveColumnLeft = (index: number) => {
    if (index <= 0) return
    const id = columnsStore.columns[index]?.id
    const prevFocus = document.activeElement
    withActivePreserved(() => columnsStore.moveColumn(index, index - 1))
    afterColumnMove(id, prevFocus)
  }

  const moveColumnRight = (index: number) => {
    if (index >= columnsStore.columns.length - 1) return
    const id = columnsStore.columns[index]?.id
    const prevFocus = document.activeElement
    withActivePreserved(() => columnsStore.moveColumn(index, index + 1))
    afterColumnMove(id, prevFocus)
  }

  /**
   * Column close button: its column (and the focused button) is gone — land
   * focus on the neighbouring column's header instead of dropping to <body>.
   */
  const removeColumnAt = (columnId: string) => {
    const idx = columnsStore.columns.findIndex((c) => c.id === columnId)
    const hadFocus = !!columnsContainer.value?.contains(document.activeElement)
    columnsStore.removeColumn(columnId)
    if (!hadFocus || idx < 0) return
    nextTick(() => {
      const col = getColumnEls()[Math.min(idx, columnsStore.columns.length - 1)]
      const target =
        col?.querySelector<HTMLElement>('.column-feed-title') ||
        col?.querySelector<HTMLElement>('.column-header button:not(:disabled)')
      target?.focus({ preventScroll: true })
    })
  }

  const { lists: mastodonLists } = useMastodonLists()

  const parkNewColumn = (id: string | null | undefined) => {
    addMenuOpen.value = false
    addGroupQuery.value = ''
    nextTick(() => {
      const idx = id
        ? columnsStore.columns.findIndex((c) => c.id === id)
        : columnsStore.columns.length - 1
      if (idx < 0) return
      if (isDeskTabs.value && id) {
        columnsStore.setFocusedColumn(id)
        activeColumnIndex.value = idx
        return
      }
      scrollToColumn(idx)
    })
  }

  const addColumn = (feedType: ColumnFeedType, feedParam?: string) => {
    let id: string | undefined | null
    if (feedType === 'list' && feedParam) {
      const title = mastodonLists.value.find((l) => l.id === feedParam)?.title
      id = columnsStore.openListColumn(feedParam, title)
    } else if (feedType === 'rss' && feedParam) {
      id = columnsStore.openRssColumn(feedParam)
    } else {
      id = columnsStore.addColumn(feedType, feedParam)
    }
    parkNewColumn(id)
  }

  const promptAddRss = () => {
    const raw = window.prompt(
      'Paste an RSS or Atom feed URL\n(e.g. https://example.com/feed.xml or https://mastodon.social/@user.rss)',
    )
    if (!raw) return
    const url = raw.trim()
    if (!/^https?:\/\//i.test(url)) {
      toastStore.show({ message: 'Feed URL must start with http:// or https://' })
      return
    }
    // App Transport Security blocks cleartext HTTP inside the Cap shell
    if (isNativeShell() && /^http:\/\//i.test(url)) {
      toastStore.show({ message: 'On iOS, feed URLs must use https://' })
      return
    }
    const id = columnsStore.openRssColumn(url)
    if (!id) {
      toastStore.show({ message: 'Board is full — remove a feed first' })
      return
    }
    parkNewColumn(id)
    toastStore.show({ message: 'RSS feed added', duration: 2400 })
  }

  const onDeskPackChange = (event: Event) => {
    const el = event.target as HTMLSelectElement | null
    const id = el?.value
    if (id) columnsStore.switchPack(id)
  }

  /** Joined first, then featured (News, etc.) — filterable so the list isn’t a dead end. */
  const addableGroups = computed(() => {
    const seen = new Set<string>()
    const out: typeof groupsStore.joinedGroups = []
    for (const g of [...groupsStore.joinedGroups, ...groupsStore.featuredGroups]) {
      const key = g.tag.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(g)
    }
    const q = addGroupQuery.value.trim().toLowerCase().replace(/^#/, '')
    if (!q) return out
    return out.filter(
      (g) => g.tag.toLowerCase().includes(q) || g.name.toLowerCase().includes(q),
    )
  })

  const addGroupCustomTag = computed(() => {
    const q = addGroupQuery.value.trim().toLowerCase().replace(/^#/, '')
    // Any script, like Mastodon: #café, #日本語, #ÜberTag
    if (!q || !/^[\p{L}\p{N}_]+$/u.test(q)) return null
    if (addableGroups.value.some((g) => g.tag.toLowerCase() === q)) return null
    return q
  })

  const addGroupAsColumn = (tag: string) => {
    addColumn('group', tag.replace(/^#/, '').toLowerCase())
  }

  watch(addMenuOpen, (open) => {
    if (!open) {
      addGroupQuery.value = ''
      addAlgorithmsExpanded.value = true
      addGroupsExpanded.value = true
    }
  })

  const removeActiveColumn = () => {
    const col = columnsStore.columns[activeColumnIndex.value]
    if (!col || !columnsStore.canRemoveColumn) return
    const nextIdx = Math.min(activeColumnIndex.value, columnsStore.columnCount - 2)
    columnsStore.removeColumn(col.id)
    nextTick(() => {
      if (nextIdx >= 0) scrollToColumn(nextIdx)
    })
  }

  const activeViewMode = computed(
    () => columnsStore.columns[activeColumnIndex.value]?.viewMode || 'flow',
  )

  /** Flick only means something for post lists — panels (Notifications, Messages, Search, Profile) ignore it */
  const activeColumnIsTimeline = computed(() => {
    const col = columnsStore.columns[activeColumnIndex.value]
    return !col || isTimelineFeed(col.feedType)
  })

  const toggleActiveViewMode = () => {
    const col = columnsStore.columns[activeColumnIndex.value]
    if (!col || !isTimelineFeed(col.feedType)) return
    columnsStore.toggleColumnViewMode(col.id)
  }

  const setActiveViewMode = (mode: 'flow' | 'flip') => {
    const col = columnsStore.columns[activeColumnIndex.value]
    if (!col || !isTimelineFeed(col.feedType)) return
    columnsStore.setColumnViewMode(col.id, mode)
  }

  return {
    addMenuOpen,
    boardFullLabel,
    addAlgorithmsExpanded,
    addGroupsExpanded,
    addGroupQuery,
    draggingColumnId,
    dropTargetColumnId,
    localHostLabel,
    columnTabLabels,
    feedTabs,
    activeFeedChromeTitle,
    activeFeedTabId,
    columnMoveAnnounce,
    onColumnDragStart,
    onColumnDragEnd,
    onColumnDragOver,
    onColumnDrop,
    moveColumnLeft,
    moveColumnRight,
    removeColumnAt,
    mastodonLists,
    addColumn,
    promptAddRss,
    onDeskPackChange,
    addableGroups,
    addGroupCustomTag,
    addGroupAsColumn,
    removeActiveColumn,
    activeViewMode,
    activeColumnIsTimeline,
    toggleActiveViewMode,
    setActiveViewMode,
  }
}
