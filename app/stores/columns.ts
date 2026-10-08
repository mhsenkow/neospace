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
  | 'favourites'
  | 'bookmarks'
  | 'algorithm'
  | 'profile'
  | 'search'
  | 'notifications'
  | 'messages'

/** Desktop board: packed strip · roomy strip · focused tab (one wide column + tabs) */
export type DeskDensity = 'packed' | 'roomy' | 'tabs'

const DESK_DENSITY_ORDER: DeskDensity[] = ['packed', 'roomy', 'tabs']

function normalizeDeskDensity(value: unknown): DeskDensity {
  if (value === 'roomy' || value === 'tabs' || value === 'focused') {
    // "focused" accepted as legacy alias if anything wrote it
    return value === 'focused' ? 'tabs' : value
  }
  return 'packed'
}

/** Mobile reading mode — flow = Threads list, flip = full-bleed snap */
export type ColumnViewMode = 'flow' | 'flip'

/** Single source for feed labels (board menus, tabs, TimelineColumn). */
export const FEED_CATALOG: { type: ColumnFeedType; label: string }[] = [
  { type: 'home', label: 'For You' },
  { type: 'local', label: 'Local' },
  { type: 'federated', label: 'Federated' },
  { type: 'group', label: 'Group' },
  { type: 'favourites', label: 'Liked' },
  { type: 'bookmarks', label: 'Saved' },
  { type: 'algorithm', label: 'Algorithm' },
  { type: 'profile', label: 'Profile' },
  { type: 'search', label: 'Search' },
  { type: 'notifications', label: 'Notifications' },
  { type: 'messages', label: 'Messages' },
]

export const FEED_LABELS: Record<ColumnFeedType, string> = FEED_CATALOG.reduce(
  (acc, item) => {
    acc[item.type] = item.label
    return acc
  },
  {} as Record<ColumnFeedType, string>,
)

export function isTimelineFeed(type: ColumnFeedType): boolean {
  return (
    type === 'home' ||
    type === 'local' ||
    type === 'federated' ||
    type === 'group' ||
    type === 'favourites' ||
    type === 'bookmarks' ||
    type === 'algorithm'
  )
}

export function isPanelFeed(type: ColumnFeedType): boolean {
  return type === 'profile' || type === 'search' || type === 'notifications' || type === 'messages'
}

export interface ColumnConfig {
  id: string
  feedType: ColumnFeedType
  groupTag?: string
  /** Custom / shared algorithm recipe id */
  algorithmId?: string
  /** Device-local; not synced via profile field */
  viewMode?: ColumnViewMode
  /**
   * In-column profile peek (progressive disclosure).
   * When set with feedType profile, shows that account in the column first;
   * expand / “Open profile” goes to the full /profile route.
   */
  profileAcct?: string
  /** Restore this feed when leaving a profile peek */
  returnFeed?: { feedType: ColumnFeedType; groupTag?: string; algorithmId?: string }
}

type StoredLayoutMeta = {
  columns: ColumnConfig[]
  updatedAt: number
  dirty: boolean
}

interface ColumnsState {
  columns: ColumnConfig[]
  /** Storage / sync key for the active identity (acct@host or guest) */
  accountKey: string
  /** True when local edits haven't been reconciled with profile field */
  layoutDirty: boolean
  layoutUpdatedAt: number
  /** Device-local: packed / roomy strip, or tabs = one focused feed */
  deskDensity: DeskDensity
  /** Device-local: when set, only this column is shown (desktop); required in tabs mode */
  focusedColumnId: string | null
}

const STORAGE_KEY = 'neospace_columns_v2'
const LEGACY_STORAGE_KEY = 'neospace_columns'
const DESK_LAYOUT_KEY = 'neospace_desk_layout'
const STORAGE_VERSION = 1
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
  'favourites',
  'bookmarks',
  'algorithm',
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
      deskDensity: normalizeDeskDensity(parsed.deskDensity),
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

export function decodeColumns(raw: string): ColumnConfig[] | null {
  const plain = stripHtml(raw)
  if (!plain) return null
  const parts = plain.split('|').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return null

  const columns: ColumnConfig[] = []
  for (const part of parts) {
    if (columns.length >= MAX_COLUMNS) break
    if (part.startsWith('group:')) {
      const tag = part.slice(6).trim()
      if (!tag) continue
      columns.push({ id: generateId(), feedType: 'group', groupTag: tag })
      continue
    }
    if (part.startsWith('algo:')) {
      const algorithmId = part.slice(5).trim()
      if (!algorithmId) continue
      columns.push({ id: generateId(), feedType: 'algorithm', algorithmId })
      continue
    }
    if ((FEED_TYPES as string[]).includes(part) && part !== 'group' && part !== 'algorithm') {
      columns.push({ id: generateId(), feedType: part as ColumnFeedType })
      continue
    }
    // Skip unknown parts so one bad token doesn't reject the whole layout
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

function feedKey(c: Pick<ColumnConfig, 'feedType' | 'groupTag' | 'algorithmId'>) {
  if (c.feedType === 'group' && c.groupTag) return `group:${c.groupTag}`
  if (c.feedType === 'algorithm' && c.algorithmId) return `algo:${c.algorithmId}`
  return c.feedType
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

function parseStoredLayout(raw: unknown): StoredLayoutMeta | null {
  if (Array.isArray(raw) && raw.length > 0 && raw.length <= MAX_COLUMNS) {
    return {
      columns: normalizeColumns(raw as ColumnConfig[]),
      updatedAt: 0,
      dirty: false,
    }
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as StoredLayoutMeta).columns)) {
    const entry = raw as StoredLayoutMeta
    if (!entry.columns.length || entry.columns.length > MAX_COLUMNS) return null
    return {
      columns: normalizeColumns(entry.columns),
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
      dirty: !!entry.dirty,
    }
  }
  return null
}

export const useColumnsStore = defineStore('columns', {
  state: (): ColumnsState => ({
    columns: defaultColumns(false),
    accountKey: 'guest',
    layoutDirty: false,
    layoutUpdatedAt: 0,
    ...readDeskLayout(),
  }),

  getters: {
    columnCount: (state): number => state.columns.length,
    maxColumns: (): number => MAX_COLUMNS,
    canAddColumn: (state): boolean => state.columns.length < MAX_COLUMNS,
    canRemoveColumn: (state): boolean => state.columns.length > 1,
    isMultiColumn: (state): boolean => state.columns.length > 1,
    isTabsDensity: (state): boolean => state.deskDensity === 'tabs',
    focusedColumn: (state): ColumnConfig | null =>
      state.columns.find((c) => c.id === state.focusedColumnId) || null,
  },

  actions: {
    storageBucketKey(accountKey: string) {
      return accountKey || 'guest'
    },

    loadLocal(accountKey: string): StoredLayoutMeta | null {
      if (typeof window === 'undefined') return null
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as {
            v?: number
            byAccount?: Record<string, unknown>
          }
          const data =
            typeof parsed?.v === 'number'
              ? parsed
              : (parsed as { byAccount?: Record<string, unknown> })
          const entry = parseStoredLayout(data.byAccount?.[this.storageBucketKey(accountKey)])
          if (entry) return entry
        }

        // Migrate legacy single-bucket layout into the current account once
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacy) {
          const data = JSON.parse(legacy)
          const entry = parseStoredLayout(data.columns)
          if (entry) return entry
        }
      } catch (e) {
        console.error('Failed to load columns config:', e)
      }
      return null
    },

    saveToStorage(opts?: { markDirty?: boolean }) {
      if (typeof window === 'undefined') return
      const markDirty = opts?.markDirty !== false
      if (markDirty) {
        this.layoutDirty = true
        this.layoutUpdatedAt = Date.now()
      }
      try {
        const key = this.storageBucketKey(this.accountKey)
        let byAccount: Record<string, StoredLayoutMeta> = {}
        try {
          const existing = localStorage.getItem(STORAGE_KEY)
          if (existing) {
            const parsed = JSON.parse(existing)
            if (parsed?.byAccount && typeof parsed.byAccount === 'object') {
              for (const [k, v] of Object.entries(parsed.byAccount)) {
                const entry = parseStoredLayout(v)
                if (entry) byAccount[k] = entry
              }
            }
          }
        } catch {
          /* replace corrupt blob */
        }
        byAccount[key] = {
          columns: this.columns,
          updatedAt: this.layoutUpdatedAt || Date.now(),
          dirty: this.layoutDirty,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, byAccount }))
        // Clear legacy so we don't keep resurrecting old single-device layout
        localStorage.removeItem(LEGACY_STORAGE_KEY)
      } catch (e) {
        console.error('Failed to save columns config:', e)
      }
    },

    persist() {
      this.saveToStorage({ markDirty: true })
      // Profile-field sync disabled: it federated followed tags, corrupted other
      // metadata fields, and fired an Update on every reorder. Layout stays local.
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

    ensureTabsFocus() {
      if (this.deskDensity !== 'tabs') return
      if (this.focusedColumnId && this.columns.some((c) => c.id === this.focusedColumnId)) return
      this.focusedColumnId = this.columns[0]?.id ?? null
      this.saveDeskLayout()
    },

    toggleDeskDensity() {
      const i = DESK_DENSITY_ORDER.indexOf(this.deskDensity)
      const next = DESK_DENSITY_ORDER[(i + 1) % DESK_DENSITY_ORDER.length]!
      this.deskDensity = next
      if (next === 'tabs') {
        this.focusedColumnId =
          (this.focusedColumnId && this.columns.some((c) => c.id === this.focusedColumnId)
            ? this.focusedColumnId
            : null) ||
          this.columns[0]?.id ||
          null
      } else {
        this.focusedColumnId = null
      }
      this.saveDeskLayout()
    },

    setFocusedColumn(columnId: string) {
      if (!this.columns.some((c) => c.id === columnId)) return
      if (this.focusedColumnId === columnId) return
      this.focusedColumnId = columnId
      this.saveDeskLayout()
    },

    toggleColumnFocus(columnId: string) {
      if (this.deskDensity === 'tabs') {
        // Tabs mode: pin switches feeds; pressing again on the active tab exits to Roomy
        if (this.focusedColumnId === columnId) {
          this.deskDensity = 'roomy'
          this.focusedColumnId = null
        } else {
          this.focusedColumnId = columnId
        }
        this.saveDeskLayout()
        return
      }
      this.focusedColumnId = this.focusedColumnId === columnId ? null : columnId
      this.saveDeskLayout()
    },

    clearColumnFocus() {
      if (this.deskDensity === 'tabs') {
        // Keep a focused feed while in tabs density (Home nav shouldn't blank the board)
        this.ensureTabsFocus()
        return
      }
      if (!this.focusedColumnId) return
      this.focusedColumnId = null
      this.saveDeskLayout()
    },

    /**
     * Add a column, or return the existing one for singleton views.
     * `feedParam` is groupTag for groups, algorithmId for algorithms.
     */
    addColumn(feedType: ColumnFeedType = 'local', feedParam?: string) {
      // Own-profile / search / inbox / liked / saved are singletons; profile peeks are not
      if (isPanelFeed(feedType) || feedType === 'favourites' || feedType === 'bookmarks') {
        const existing = this.columns.find(
          (c) => c.feedType === feedType && !c.profileAcct,
        )
        if (existing) return existing.id
      }
      if (feedType === 'algorithm' && feedParam) {
        const existing = this.columns.find(
          (c) => c.feedType === 'algorithm' && c.algorithmId === feedParam,
        )
        if (existing) return existing.id
      }
      if (this.columns.length >= MAX_COLUMNS) return
      const col: ColumnConfig = {
        id: generateId(),
        feedType,
        // Always start in Flow — Flip is an intentional reading mode, not a feed default.
        // (Local/Federated used to open Flip and felt “broken” on mobile.)
        viewMode: 'flow',
      }
      if (feedType === 'group' && feedParam) col.groupTag = feedParam
      if (feedType === 'algorithm' && feedParam) col.algorithmId = feedParam
      this.columns.push(col)
      this.persist()
      return col.id
    },

    /**
     * Open a view on the board (add if needed) and focus it.
     * Always focuses (does not toggle off) — use clearColumnFocus / toggleColumnFocus to leave.
     * `feedParam` is groupTag for groups, algorithmId for algorithms.
     */
    ensureFocusedView(feedType: ColumnFeedType, feedParam?: string) {
      const match = this.columns.find((c) => {
        if (feedType === 'group') return c.feedType === 'group' && c.groupTag === feedParam
        if (feedType === 'algorithm') {
          return c.feedType === 'algorithm' && c.algorithmId === feedParam
        }
        return c.feedType === feedType
      })
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
      const id = this.addColumn(feedType, feedParam)
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
      if (index === -1) return

      const removed = { ...this.columns[index]! }
      const restoredFocus = this.focusedColumnId === columnId
      this.columns.splice(index, 1)
      if (restoredFocus) {
        this.focusedColumnId = null
        this.saveDeskLayout()
      }
      this.persist()

      if (typeof window === 'undefined') return
      void import('./toast').then(({ useToastStore }) => {
        const label =
          removed.feedType === 'group' && removed.groupTag
            ? `#${removed.groupTag}`
            : removed.feedType === 'algorithm' && removed.algorithmId
              ? 'Algorithm'
              : FEED_LABELS[removed.feedType] || 'Column'
        useToastStore().show({
          message: `${label} removed`,
          actionLabel: 'Undo',
          duration: 5000,
          onAction: () => {
            if (this.columns.some((c) => c.id === removed.id)) return
            if (this.columns.length >= MAX_COLUMNS) return
            this.columns.splice(Math.min(index, this.columns.length), 0, removed)
            if (restoredFocus) {
              this.focusedColumnId = removed.id
              this.saveDeskLayout()
            }
            this.persist()
          },
        })
      })
    },

    updateColumnFeedType(columnId: string, feedType: ColumnFeedType, feedParam?: string) {
      const column = this.columns.find((c) => c.id === columnId)
      if (column) {
        column.feedType = feedType
        column.groupTag = feedType === 'group' ? feedParam : undefined
        column.algorithmId = feedType === 'algorithm' ? feedParam : undefined
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
          algorithmId: column.algorithmId,
        }
      }
      column.feedType = 'profile'
      column.profileAcct = handle
      column.groupTag = undefined
      column.algorithmId = undefined
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
        column.algorithmId = back.feedType === 'algorithm' ? back.algorithmId : undefined
      } else {
        column.feedType = 'home'
        column.groupTag = undefined
        column.algorithmId = undefined
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

      if (fromLocal?.dirty && fromLocal.columns.length) {
        this.columns = fromLocal.columns
        this.layoutDirty = true
        this.layoutUpdatedAt = fromLocal.updatedAt
      } else if (fromProfile?.length) {
        this.columns = mergeViewModes(fromProfile, fromLocal?.columns || previous)
        this.layoutDirty = false
        this.layoutUpdatedAt = fromLocal?.updatedAt || Date.now()
        this.saveToStorage({ markDirty: false })
      } else if (fromLocal?.columns.length) {
        this.columns = fromLocal.columns
        this.layoutDirty = fromLocal.dirty
        this.layoutUpdatedAt = fromLocal.updatedAt
      } else {
        this.columns = defaultColumns(preferHome)
        this.layoutDirty = false
        this.layoutUpdatedAt = Date.now()
        this.saveToStorage({ markDirty: false })
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
