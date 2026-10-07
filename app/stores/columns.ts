/**
 * NeoSpace Column Layout Store
 *
 * Multi-column TweetDeck-style layout configuration.
 * Persisted per-account in localStorage (device-local; not federated to profile).
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'

export type ColumnFeedType =
  | 'home'
  | 'local'
  | 'federated'
  | 'group'
  | 'profile'
  | 'search'
  | 'notifications'
  | 'messages'

/** Desktop board: squish all (up to 8) vs ~4 visible + horizontal scroll */
export type DeskDensity = 'packed' | 'roomy'

/** Mobile reading mode — flow = Threads list, flip = full-bleed snap */
export type ColumnViewMode = 'flow' | 'flip'

export const TIMELINE_FEED_TYPES: ColumnFeedType[] = ['home', 'local', 'federated', 'group']
export const PANEL_FEED_TYPES: ColumnFeedType[] = ['profile', 'search', 'notifications', 'messages']

export function isTimelineFeed(type: ColumnFeedType): boolean {
  return type === 'home' || type === 'local' || type === 'federated' || type === 'group'
}

export function isPanelFeed(type: ColumnFeedType): boolean {
  return type === 'profile' || type === 'search' || type === 'notifications' || type === 'messages'
}

export interface ColumnConfig {
  id: string
  feedType: ColumnFeedType
  groupTag?: string
  /** Device-local; not synced via profile field */
  viewMode?: ColumnViewMode
  /**
   * In-column profile peek (progressive disclosure).
   * When set with feedType profile, shows that account in the column first;
   * expand / “Open profile” goes to the full /profile route.
   */
  profileAcct?: string
  /** Restore this feed when leaving a profile peek */
  returnFeed?: { feedType: ColumnFeedType; groupTag?: string }
}

interface ColumnsState {
  columns: ColumnConfig[]
  /** Storage / sync key for the active identity (acct@host or guest) */
  accountKey: string
  syncing: boolean
  lastSyncError: string | null
  /** Device-local: packed = all columns share the viewport; roomy ≈ 4 + scroll */
  deskDensity: DeskDensity
  /** Device-local: when set, only this column is shown (desktop) */
  focusedColumnId: string | null
}

const STORAGE_KEY = 'neospace_columns_v2'
const LEGACY_STORAGE_KEY = 'neospace_columns'
const DESK_LAYOUT_KEY = 'neospace_desk_layout'
/** Profile metadata field name (visible on profile; compact value) */
export const COLUMNS_PROFILE_FIELD = 'neospace_columns'
/** Max independent timeline columns (desktop strip + mobile swipe) */
export const MAX_COLUMNS = 8

const generateId = () => Math.random().toString(36).substring(2, 10)

const FEED_TYPES: ColumnFeedType[] = [
  'home',
  'local',
  'federated',
  'group',
  'profile',
  'search',
  'notifications',
  'messages',
]

function readDeskLayout(): { deskDensity: DeskDensity; focusedColumnId: string | null } {
  if (typeof window === 'undefined') {
    return { deskDensity: 'packed', focusedColumnId: null }
  }
  try {
    const raw = localStorage.getItem(DESK_LAYOUT_KEY)
    if (!raw) return { deskDensity: 'packed', focusedColumnId: null }
    const parsed = JSON.parse(raw) as { deskDensity?: string; focusedColumnId?: string | null }
    return {
      deskDensity: parsed.deskDensity === 'roomy' ? 'roomy' : 'packed',
      focusedColumnId: typeof parsed.focusedColumnId === 'string' ? parsed.focusedColumnId : null,
    }
  } catch {
    return { deskDensity: 'packed', focusedColumnId: null }
  }
}

function normalizeFieldName(name: string) {
  return name.toLowerCase().replace(/[^a-z_]/g, '')
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, '').trim()
}

/** Compact wire format: home|local|federated|group:tag — peeks encode their return feed */
export function encodeColumns(columns: ColumnConfig[]): string {
  return columns
    .map((c) => {
      const feed =
        c.feedType === 'profile' && c.profileAcct && c.returnFeed
          ? c.returnFeed
          : c
      if (feed.feedType === 'group' && feed.groupTag) {
        return `group:${feed.groupTag.replace(/[|:]/g, '')}`
      }
      if (feed.feedType === 'profile' && (feed as ColumnConfig).profileAcct) {
        return 'home'
      }
      return feed.feedType
    })
    .join('|')
}

export function decodeColumns(raw: string): ColumnConfig[] | null {
  const plain = stripHtml(raw)
  if (!plain) return null
  const parts = plain.split('|').map((p) => p.trim()).filter(Boolean)
  if (!parts.length || parts.length > MAX_COLUMNS) return null

  const columns: ColumnConfig[] = []
  for (const part of parts) {
    if (part.startsWith('group:')) {
      const tag = part.slice(6).trim()
      if (!tag) return null
      columns.push({ id: generateId(), feedType: 'group', groupTag: tag })
      continue
    }
    if ((FEED_TYPES as string[]).includes(part) && part !== 'group') {
      columns.push({ id: generateId(), feedType: part as ColumnFeedType })
      continue
    }
    return null
  }
  return columns.length ? columns : null
}

function readColumnsFromFields(
  fields: mastodon.v1.AccountField[] | undefined | null,
): ColumnConfig[] | null {
  if (!fields?.length) return null
  const field = fields.find(
    (f) => normalizeFieldName(f.name) === normalizeFieldName(COLUMNS_PROFILE_FIELD),
  )
  if (!field?.value) return null
  return decodeColumns(field.value)
}

function defaultColumns(preferHome: boolean): ColumnConfig[] {
  return [{ id: generateId(), feedType: preferHome ? 'home' : 'local', viewMode: 'flow' }]
}

function feedKey(c: Pick<ColumnConfig, 'feedType' | 'groupTag'>) {
  return c.feedType === 'group' && c.groupTag ? `group:${c.groupTag}` : c.feedType
}

/** Keep Flow/Flip choice when profile sync regenerates column ids */
function mergeViewModes(incoming: ColumnConfig[], previous: ColumnConfig[]): ColumnConfig[] {
  const prevByFeed = new Map(previous.map((c) => [feedKey(c), c.viewMode || 'flow']))
  return incoming.map((c) => ({
    ...c,
    viewMode: c.viewMode || prevByFeed.get(feedKey(c)) || 'flow',
  }))
}

function normalizeColumns(cols: ColumnConfig[]): ColumnConfig[] {
  return cols.map((c) => ({
    ...c,
    viewMode: c.viewMode === 'flip' ? 'flip' : 'flow',
  }))
}

let profileSyncTimer: ReturnType<typeof setTimeout> | null = null

export const useColumnsStore = defineStore('columns', {
  state: (): ColumnsState => ({
    columns: defaultColumns(false),
    accountKey: 'guest',
    syncing: false,
    lastSyncError: null,
    ...readDeskLayout(),
  }),

  getters: {
    columnCount: (state): number => state.columns.length,
    maxColumns: (): number => MAX_COLUMNS,
    canAddColumn: (state): boolean => state.columns.length < MAX_COLUMNS,
    canRemoveColumn: (state): boolean => state.columns.length > 1,
    isMultiColumn: (state): boolean => state.columns.length > 1,
    focusedColumn: (state): ColumnConfig | null =>
      state.columns.find((c) => c.id === state.focusedColumnId) || null,
  },

  actions: {
    storageBucketKey(accountKey: string) {
      return accountKey || 'guest'
    },

    loadLocal(accountKey: string): ColumnConfig[] | null {
      if (typeof window === 'undefined') return null
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const data = JSON.parse(raw) as { byAccount?: Record<string, ColumnConfig[]> }
          const cols = data.byAccount?.[this.storageBucketKey(accountKey)]
          if (Array.isArray(cols) && cols.length > 0 && cols.length <= MAX_COLUMNS) {
            return normalizeColumns(cols)
          }
        }

        // Migrate legacy single-bucket layout into the current account once
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacy) {
          const data = JSON.parse(legacy)
          if (Array.isArray(data.columns) && data.columns.length > 0 && data.columns.length <= MAX_COLUMNS) {
            return normalizeColumns(data.columns as ColumnConfig[])
          }
        }
      } catch (e) {
        console.error('Failed to load columns config:', e)
      }
      return null
    },

    saveToStorage() {
      if (typeof window === 'undefined') return
      try {
        const key = this.storageBucketKey(this.accountKey)
        let byAccount: Record<string, ColumnConfig[]> = {}
        try {
          const existing = localStorage.getItem(STORAGE_KEY)
          if (existing) {
            const parsed = JSON.parse(existing)
            if (parsed?.byAccount && typeof parsed.byAccount === 'object') {
              byAccount = parsed.byAccount
            }
          }
        } catch {
          /* replace corrupt blob */
        }
        byAccount[key] = this.columns
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ byAccount }))
        // Clear legacy so we don't keep resurrecting old single-device layout
        localStorage.removeItem(LEGACY_STORAGE_KEY)
      } catch (e) {
        console.error('Failed to save columns config:', e)
      }
    },

    persist() {
      this.saveToStorage()
      // Profile-field sync disabled: it federated followed tags, corrupted other
      // metadata fields, and fired an Update on every reorder. Layout stays local.
    },

    scheduleProfileSync() {
      /* no-op — see persist() */
    },

    /**
     * @deprecated Column layout is device-local only (see persist).
     */
    async syncToProfile() {
      return
    },

    saveDeskLayout() {
      if (typeof window === 'undefined') return
      try {
        localStorage.setItem(
          DESK_LAYOUT_KEY,
          JSON.stringify({
            deskDensity: this.deskDensity,
            focusedColumnId: this.focusedColumnId,
          }),
        )
      } catch {
        /* ignore quota */
      }
    },

    toggleDeskDensity() {
      this.deskDensity = this.deskDensity === 'packed' ? 'roomy' : 'packed'
      this.focusedColumnId = null
      this.saveDeskLayout()
    },

    toggleColumnFocus(columnId: string) {
      this.focusedColumnId = this.focusedColumnId === columnId ? null : columnId
      this.saveDeskLayout()
    },

    clearColumnFocus() {
      if (!this.focusedColumnId) return
      this.focusedColumnId = null
      this.saveDeskLayout()
    },

    /** Add a column, or return the existing one for singleton panel views. */
    addColumn(feedType: ColumnFeedType = 'local', groupTag?: string) {
      // Own-profile / search / inbox are singletons; profile peeks (profileAcct) are not
      if (isPanelFeed(feedType)) {
        const existing = this.columns.find(
          (c) => c.feedType === feedType && !c.profileAcct,
        )
        if (existing) return existing.id
      }
      if (this.columns.length >= MAX_COLUMNS) return
      const col: ColumnConfig = {
        id: generateId(),
        feedType,
        viewMode: feedType === 'home' || isPanelFeed(feedType) ? 'flow' : 'flip',
      }
      if (groupTag) col.groupTag = groupTag
      this.columns.push(col)
      this.persist()
      return col.id
    },

    /**
     * Open a view on the board (add if needed) and focus it.
     * Always focuses (does not toggle off) — use clearColumnFocus / toggleColumnFocus to leave.
     */
    ensureFocusedView(feedType: ColumnFeedType, groupTag?: string) {
      const match = this.columns.find((c) =>
        feedType === 'group'
          ? c.feedType === 'group' && c.groupTag === groupTag
          : c.feedType === feedType,
      )
      if (match) {
        if (this.focusedColumnId !== match.id) {
          this.focusedColumnId = match.id
          this.saveDeskLayout()
        }
        return match.id
      }
      // Board full — free a panel slot or the last column so nav still works
      if (this.columns.length >= MAX_COLUMNS) {
        const disposable =
          this.columns.find((c) => isPanelFeed(c.feedType) && c.feedType !== feedType) ||
          this.columns[this.columns.length - 1]
        if (disposable && this.columns.length > 1) {
          this.removeColumn(disposable.id)
        }
      }
      const id = this.addColumn(feedType, groupTag)
      if (id) {
        this.focusedColumnId = id
        this.saveDeskLayout()
      }
      return id
    },

    setColumnViewMode(columnId: string, viewMode: ColumnViewMode) {
      const column = this.columns.find((c) => c.id === columnId)
      if (!column || column.viewMode === viewMode) return
      column.viewMode = viewMode
      this.persist()
    },

    toggleColumnViewMode(columnId: string) {
      const column = this.columns.find((c) => c.id === columnId)
      if (!column) return
      column.viewMode = column.viewMode === 'flip' ? 'flow' : 'flip'
      this.persist()
    },

    removeColumn(columnId: string) {
      if (this.columns.length <= 1) return
      const index = this.columns.findIndex((c) => c.id === columnId)
      if (index !== -1) {
        this.columns.splice(index, 1)
        if (this.focusedColumnId === columnId) {
          this.focusedColumnId = null
          this.saveDeskLayout()
        }
        this.persist()
      }
    },

    updateColumnFeedType(columnId: string, feedType: ColumnFeedType, groupTag?: string) {
      const column = this.columns.find((c) => c.id === columnId)
      if (column) {
        column.feedType = feedType
        column.groupTag = feedType === 'group' ? groupTag : undefined
        column.profileAcct = undefined
        column.returnFeed = undefined
        this.persist()
      }
    },

    /**
     * Progressive disclosure: peel this column into an in-board profile peek.
     * Expand focuses the column; expand again (or Open profile) opens /profile.
     */
    peekProfileInColumn(columnId: string, acct: string) {
      const column = this.columns.find((c) => c.id === columnId)
      const handle = acct.replace(/^@/, '').trim()
      if (!column || !handle) return
      if (column.feedType === 'profile' && column.profileAcct === handle) return

      if (!column.returnFeed) {
        column.returnFeed = {
          feedType: column.feedType,
          groupTag: column.groupTag,
        }
      }
      column.feedType = 'profile'
      column.profileAcct = handle
      column.groupTag = undefined
      // Stay on the board: clear another column's focus so this peel is visible
      if (this.focusedColumnId && this.focusedColumnId !== columnId) {
        this.focusedColumnId = null
        this.saveDeskLayout()
      }
      this.persist()
    },

    /** Leave a profile peek and restore the prior feed in this column. */
    exitProfilePeek(columnId: string) {
      const column = this.columns.find((c) => c.id === columnId)
      if (!column?.returnFeed && !column?.profileAcct) return
      const back = column.returnFeed
      column.profileAcct = undefined
      column.returnFeed = undefined
      if (back) {
        column.feedType = back.feedType
        column.groupTag = back.feedType === 'group' ? back.groupTag : undefined
      } else {
        column.feedType = 'home'
        column.groupTag = undefined
      }
      if (this.focusedColumnId === columnId) {
        this.focusedColumnId = null
        this.saveDeskLayout()
      }
      this.persist()
    },

    moveColumn(fromIndex: number, toIndex: number) {
      const len = this.columns.length
      if (len < 2) return
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= len ||
        toIndex >= len
      ) {
        return
      }
      const next = [...this.columns]
      const [col] = next.splice(fromIndex, 1)
      if (!col) return
      next.splice(toIndex, 0, col)
      this.columns = next
      this.persist()
    },

    moveColumnById(columnId: string, toIndex: number) {
      const fromIndex = this.columns.findIndex((c) => c.id === columnId)
      if (fromIndex === -1) return
      this.moveColumn(fromIndex, toIndex)
    },

    resolveAccountKey(): string {
      const instancesStore = useInstancesStore()
      const account = instancesStore.activeAccount
      if (account?.user?.acct && account.url) {
        try {
          const host = new URL(account.url).hostname
          return `${account.user.acct}@${host}`.toLowerCase()
        } catch {
          return `${account.user.acct}`.toLowerCase()
        }
      }
      return 'guest'
    },

    /**
     * Load columns for the current identity.
     * Prefer profile field (cross-device), else per-account localStorage, else defaults.
     */
    initialize() {
      const instancesStore = useInstancesStore()
      const accountKey = this.resolveAccountKey()
      this.accountKey = accountKey

      const fromProfile = readColumnsFromFields(instancesStore.activeAccount?.user?.fields)
      const fromLocal = this.loadLocal(accountKey)
      const preferHome = instancesStore.hasAuthenticatedInstance

      const previous = this.columns
      const prevFocused = previous.find((c) => c.id === this.focusedColumnId)

      if (fromProfile?.length) {
        this.columns = mergeViewModes(fromProfile, fromLocal || previous)
        this.saveToStorage()
      } else if (fromLocal?.length) {
        this.columns = fromLocal
        // Push local layout up so other devices can pick it up
        this.scheduleProfileSync()
      } else {
        this.columns = defaultColumns(preferHome)
        this.saveToStorage()
        this.scheduleProfileSync()
      }

      // Profile decode regenerates column ids — rematch focus by feed, don't drop it
      if (this.focusedColumnId && !this.columns.some((c) => c.id === this.focusedColumnId)) {
        const rematch = prevFocused
          ? this.columns.find((c) =>
              prevFocused.feedType === 'group'
                ? c.feedType === 'group' && c.groupTag === prevFocused.groupTag
                : c.feedType === prevFocused.feedType,
            )
          : null
        this.focusedColumnId = rematch?.id ?? null
        this.saveDeskLayout()
      }
    },
  },
})
