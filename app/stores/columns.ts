/**
 * LoomSpace Column Layout Store
 *
 * Multi-column TweetDeck-style layout configuration.
 * Persisted per-account in localStorage (device-local; not federated to profile).
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { logError } from '~/utils/log'
import { isNativeShell } from '~/utils/nativeShell'
import {
  MAX_PACKS,
  PACKS_STORAGE_KEY,
  defaultDailyPack,
  newPackId,
  type FeedPack,
  STARTER_PACKS,
  starterToPack,
} from '~/utils/packs'

export type ColumnFeedType =
  | 'home'
  | 'local'
  | 'federated'
  | 'group'
  | 'favourites'
  | 'bookmarks'
  | 'algorithm'
  | 'list'
  | 'rss'
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
  { type: 'list', label: 'List' },
  { type: 'rss', label: 'RSS' },
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
    type === 'algorithm' ||
    type === 'list' ||
    type === 'rss'
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
  /** Mastodon list id */
  listId?: string
  /** Cached list title for chrome labels */
  listTitle?: string
  /** Absolute RSS/Atom feed URL */
  rssUrl?: string
  /** Cached feed title for chrome labels */
  rssTitle?: string
  /** Device-local; not synced via profile field */
  viewMode?: ColumnViewMode
  /**
   * In-column profile peek (progressive disclosure).
   * When set with feedType profile, shows that account in the column first;
   * expand / “Open profile” goes to the full /profile route.
   */
  profileAcct?: string
  /** Restore this feed when leaving a profile peek */
  returnFeed?: {
    feedType: ColumnFeedType
    groupTag?: string
    algorithmId?: string
    listId?: string
    rssUrl?: string
  }
  /**
   * Pin this column to a connected instance id, or `'all'` for unified
   * multi-account Home. When unset, the column follows the global active account
   * (and `activeInstanceFilter` for Local/Federated).
   */
  instanceId?: string
  /**
   * Pin Local/Federated to any public hostname (e.g. `tech.lgbt`) even when the
   * server isn't a persisted watch/login row yet.
   */
  serverHost?: string
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
  /** Named boards (max MAX_PACKS); active pack mirrors `columns` */
  packs: FeedPack[]
  activePackId: string | null
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
  'list',
  'rss',
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
    if (part.startsWith('list:')) {
      const listId = part.slice(5).trim()
      if (!listId) continue
      columns.push({ id: generateId(), feedType: 'list', listId })
      continue
    }
    if (part.startsWith('rss:')) {
      const rssUrl = part.slice(4).trim()
      if (!rssUrl || !/^https?:\/\//i.test(rssUrl)) continue
      columns.push({ id: generateId(), feedType: 'rss', rssUrl })
      continue
    }
    // local@host:tech.lgbt / home@all / federated@<instanceId>
    const pinned = part.match(/^(local|federated|home)@(host:)?(.+)$/i)
    if (pinned) {
      const feedType = pinned[1]!.toLowerCase() as ColumnFeedType
      const hostPin = !!pinned[2]
      const value = pinned[3]!.trim()
      if (!value) continue
      const col: ColumnConfig = { id: generateId(), feedType }
      if (hostPin) col.serverHost = value.toLowerCase()
      else col.instanceId = value
      columns.push(col)
      continue
    }
    if (
      (FEED_TYPES as string[]).includes(part) &&
      part !== 'group' &&
      part !== 'algorithm' &&
      part !== 'list' &&
      part !== 'rss'
    ) {
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

function feedKey(
  c: Pick<
    ColumnConfig,
    'feedType' | 'groupTag' | 'algorithmId' | 'listId' | 'rssUrl' | 'instanceId' | 'serverHost'
  >,
) {
  if (c.feedType === 'group' && c.groupTag) return `group:${c.groupTag}`
  if (c.feedType === 'algorithm' && c.algorithmId) return `algo:${c.algorithmId}`
  if (c.feedType === 'list' && c.listId) return `list:${c.listId}`
  if (c.feedType === 'rss' && c.rssUrl) return `rss:${c.rssUrl}`
  const pin = c.instanceId || (c.serverHost ? `host:${c.serverHost.toLowerCase()}` : '')
  return pin ? `${c.feedType}@${pin}` : c.feedType
}

/** Public token used by pack share codecs */
export function columnFeedKey(c: ColumnConfig): string {
  return feedKey(c)
}

/** Sentinel instanceId: Home column merges every signed-in account */
export const ALL_ACCOUNTS_INSTANCE = 'all'

/** Keep Flow/Flip choice when profile sync regenerates column ids */
function mergeViewModes(incoming: ColumnConfig[], previous: ColumnConfig[]): ColumnConfig[] {
  const prevByFeed = new Map(previous.map((c) => [feedKey(c), c.viewMode || 'flow']))
  return incoming.map((c) => ({
    ...c,
    viewMode: c.viewMode || prevByFeed.get(feedKey(c)) || 'flow',
  }))
}

const optionalString = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/**
 * Stored layouts are untrusted (older builds, hand edits, other tabs): drop
 * entries without a known feed type, require the param a group / algorithm
 * needs, and give duplicate / missing ids a fresh one — ids are v-for keys.
 */
function normalizeColumns(cols: unknown[]): ColumnConfig[] {
  const out: ColumnConfig[] = []
  const ids = new Set<string>()
  for (const raw of cols) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as Record<string, unknown>
    const feedType = c.feedType as ColumnFeedType
    if (!FEED_TYPES.includes(feedType)) continue
    const groupTag = optionalString(c.groupTag)
    const algorithmId = optionalString(c.algorithmId)
    const listId = optionalString(c.listId)
    const rssUrl = optionalString(c.rssUrl)
    if (feedType === 'group' && !groupTag) continue
    if (feedType === 'algorithm' && !algorithmId) continue
    if (feedType === 'list' && !listId) continue
    if (feedType === 'rss' && (!rssUrl || !/^https?:\/\//i.test(rssUrl))) continue
    let id = optionalString(c.id)
    if (!id || ids.has(id)) id = generateId()
    ids.add(id)
    const col: ColumnConfig = {
      id,
      feedType,
      viewMode: c.viewMode === 'flip' ? 'flip' : 'flow',
    }
    if (feedType === 'group') col.groupTag = groupTag
    if (feedType === 'algorithm') col.algorithmId = algorithmId
    if (feedType === 'list') {
      col.listId = listId
      const listTitle = optionalString(c.listTitle)
      if (listTitle) col.listTitle = listTitle
    }
    if (feedType === 'rss' && rssUrl) {
      col.rssUrl = rssUrl
      const rssTitle = optionalString(c.rssTitle)
      if (rssTitle) col.rssTitle = rssTitle
    }
    const profileAcct = optionalString(c.profileAcct)
    if (feedType === 'profile' && profileAcct) col.profileAcct = profileAcct
    const instanceId = optionalString(c.instanceId)
    if (instanceId) col.instanceId = instanceId
    const serverHost = optionalString(c.serverHost)?.toLowerCase()
    if (serverHost && (feedType === 'local' || feedType === 'federated' || feedType === 'group')) {
      col.serverHost = serverHost
    }
    const back = c.returnFeed as Record<string, unknown> | undefined
    if (back && typeof back === 'object' && FEED_TYPES.includes(back.feedType as ColumnFeedType)) {
      col.returnFeed = {
        feedType: back.feedType as ColumnFeedType,
        groupTag: optionalString(back.groupTag),
        algorithmId: optionalString(back.algorithmId),
        listId: optionalString(back.listId),
        rssUrl: optionalString(back.rssUrl),
      }
    }
    out.push(col)
    if (out.length >= MAX_COLUMNS) break
  }
  return out
}

export function parseStoredLayout(raw: unknown): StoredLayoutMeta | null {
  let list: unknown[] | null = null
  let updatedAt = 0
  let dirty = false
  if (Array.isArray(raw)) {
    list = raw
  } else if (raw && typeof raw === 'object' && Array.isArray((raw as StoredLayoutMeta).columns)) {
    const entry = raw as StoredLayoutMeta
    list = entry.columns
    updatedAt = typeof entry.updatedAt === 'number' ? entry.updatedAt : 0
    dirty = !!entry.dirty
  }
  if (!list || !list.length || list.length > MAX_COLUMNS) return null
  const columns = normalizeColumns(list)
  if (!columns.length) return null
  return { columns, updatedAt, dirty }
}

type PacksBucket = {
  packs: FeedPack[]
  activePackId: string | null
}

function readPacksBucket(accountKey: string): PacksBucket | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PACKS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { byAccount?: Record<string, PacksBucket> }
    const bucket = parsed?.byAccount?.[accountKey || 'guest']
    if (!bucket || !Array.isArray(bucket.packs) || !bucket.packs.length) return null
    const packs = bucket.packs
      .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({
        id: p.id,
        name: String(p.name).slice(0, 48) || 'Pack',
        description: typeof p.description === 'string' ? p.description.slice(0, 160) : undefined,
        icon: typeof p.icon === 'string' ? p.icon : undefined,
        columns: normalizeColumns(Array.isArray(p.columns) ? p.columns : []),
        updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now(),
      }))
      .filter((p) => p.columns.length > 0)
      .slice(0, MAX_PACKS)
    if (!packs.length) return null
    const activePackId =
      typeof bucket.activePackId === 'string' && packs.some((p) => p.id === bucket.activePackId)
        ? bucket.activePackId
        : packs[0]!.id
    return { packs, activePackId }
  } catch {
    return null
  }
}

function writePacksBucket(accountKey: string, bucket: PacksBucket) {
  if (typeof window === 'undefined') return
  try {
    let byAccount: Record<string, PacksBucket> = {}
    try {
      const existing = localStorage.getItem(PACKS_STORAGE_KEY)
      if (existing) {
        const parsed = JSON.parse(existing)
        if (parsed?.byAccount && typeof parsed.byAccount === 'object') {
          byAccount = parsed.byAccount
        }
      }
    } catch {
      byAccount = {}
    }
    byAccount[accountKey || 'guest'] = {
      packs: bucket.packs.slice(0, MAX_PACKS),
      activePackId: bucket.activePackId,
    }
    localStorage.setItem(PACKS_STORAGE_KEY, JSON.stringify({ v: 1, byAccount }))
  } catch (e) {
    logError('Failed to save packs:', e)
  }
}

export const useColumnsStore = defineStore('columns', {
  state: (): ColumnsState => ({
    columns: defaultColumns(false),
    accountKey: 'guest',
    layoutDirty: false,
    layoutUpdatedAt: 0,
    packs: [],
    activePackId: null,
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
    activePack: (state): FeedPack | null =>
      state.packs.find((p) => p.id === state.activePackId) || state.packs[0] || null,
    canAddPack: (state): boolean => state.packs.length < MAX_PACKS,
    maxPacks: (): number => MAX_PACKS,
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
        logError('Failed to load columns config:', e)
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
        logError('Failed to save columns config:', e)
      }
    },

    persist() {
      this.saveToStorage({ markDirty: true })
      // Keep the active pack's columns in sync with the live board
      this.syncActivePackColumns()
      this.savePacks()
      // Profile-field sync disabled: it federated followed tags, corrupted other
      // metadata fields, and fired an Update on every reorder. Layout stays local.
    },

    syncActivePackColumns() {
      if (!this.activePackId || !this.packs.length) return
      const idx = this.packs.findIndex((p) => p.id === this.activePackId)
      if (idx < 0) return
      const pack = this.packs[idx]!
      this.packs[idx] = {
        ...pack,
        columns: this.columns.map((c) => ({ ...c })),
        updatedAt: Date.now(),
      }
    },

    savePacks() {
      writePacksBucket(this.accountKey, {
        packs: this.packs,
        activePackId: this.activePackId,
      })
    },

    ensurePacksHydrated() {
      if (this.packs.length) return
      const bucket = readPacksBucket(this.accountKey)
      if (bucket) {
        this.packs = bucket.packs
        this.activePackId = bucket.activePackId
        const active = this.packs.find((p) => p.id === this.activePackId) || this.packs[0]!
        this.columns = active.columns.map((c) => ({ ...c }))
        this.activePackId = active.id
        return
      }
      // Migrate current board into the first "Daily" pack
      const daily = defaultDailyPack(this.columns.map((c) => ({ ...c })))
      this.packs = [daily]
      this.activePackId = daily.id
      this.savePacks()
    },

    switchPack(packId: string) {
      if (packId === this.activePackId) return
      const next = this.packs.find((p) => p.id === packId)
      if (!next) return
      // Save current board into the pack we're leaving
      this.syncActivePackColumns()
      this.activePackId = next.id
      this.columns = next.columns.map((c) => ({ ...c }))
      this.focusedColumnId = null
      this.saveDeskLayout()
      this.persist()
    },

    createPack(name?: string, columns?: ColumnConfig[]): string | null {
      if (this.packs.length >= MAX_PACKS) return null
      this.syncActivePackColumns()
      const pack: FeedPack = {
        id: newPackId(),
        name: (name || `Pack ${this.packs.length + 1}`).trim().slice(0, 48) || 'Pack',
        columns: (columns?.length
          ? columns
          : defaultColumns(useInstancesStore().hasAuthenticatedInstance)
        ).map((c) => ({ ...c, id: generateId() })),
        updatedAt: Date.now(),
      }
      this.packs.push(pack)
      this.activePackId = pack.id
      this.columns = pack.columns.map((c) => ({ ...c }))
      this.focusedColumnId = null
      this.saveDeskLayout()
      this.persist()
      return pack.id
    },

    renamePack(packId: string, name: string) {
      const pack = this.packs.find((p) => p.id === packId)
      const clean = name.trim().slice(0, 48)
      if (!pack || !clean) return
      pack.name = clean
      pack.updatedAt = Date.now()
      this.savePacks()
    },

    duplicatePack(packId: string): string | null {
      if (this.packs.length >= MAX_PACKS) return null
      const src = this.packs.find((p) => p.id === packId)
      if (!src) return null
      this.syncActivePackColumns()
      const copy: FeedPack = {
        id: newPackId(),
        name: `${src.name} copy`.slice(0, 48),
        description: src.description,
        columns: src.columns.map((c) => ({ ...c, id: generateId() })),
        updatedAt: Date.now(),
      }
      this.packs.push(copy)
      this.savePacks()
      return copy.id
    },

    deletePack(packId: string) {
      if (this.packs.length <= 1) return
      const idx = this.packs.findIndex((p) => p.id === packId)
      if (idx < 0) return
      const wasActive = this.activePackId === packId
      this.packs.splice(idx, 1)
      if (wasActive) {
        const next = this.packs[Math.max(0, idx - 1)] || this.packs[0]!
        this.activePackId = next.id
        this.columns = next.columns.map((c) => ({ ...c }))
        this.focusedColumnId = null
        this.saveDeskLayout()
      }
      this.persist()
    },

    installPack(pack: FeedPack, switchTo = true): string | null {
      if (this.packs.length >= MAX_PACKS) return null
      this.syncActivePackColumns()
      const installed: FeedPack = {
        ...pack,
        id: pack.id || newPackId(),
        columns: pack.columns.slice(0, MAX_COLUMNS).map((c) => ({
          ...c,
          id: generateId(),
          viewMode: c.viewMode || 'flow',
        })),
        updatedAt: Date.now(),
      }
      this.packs.push(installed)
      if (switchTo) {
        this.activePackId = installed.id
        this.columns = installed.columns.map((c) => ({ ...c }))
        this.focusedColumnId = null
        this.saveDeskLayout()
      }
      this.persist()
      return installed.id
    },

    installStarterPack(starterId: string): string | null {
      const template = STARTER_PACKS.find((s) => s.id === starterId)
      if (!template) return null
      return this.installPack(starterToPack(template), true)
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

    /**
     * Locate an existing board column. Profile matches the own-profile
     * singleton only (peeks with profileAcct are ignored).
     * `feedParam` is groupTag / algorithmId, or `host:<domain>` / instance id
     * for local/federated/home pins.
     */
    findColumn(feedType: ColumnFeedType, feedParam?: string): ColumnConfig | undefined {
      return this.columns.find((c) => {
        if (feedType === 'group') return c.feedType === 'group' && c.groupTag === feedParam
        if (feedType === 'algorithm') {
          return c.feedType === 'algorithm' && c.algorithmId === feedParam
        }
        if (feedType === 'list') {
          return c.feedType === 'list' && c.listId === feedParam
        }
        if (feedType === 'rss') {
          return c.feedType === 'rss' && c.rssUrl === feedParam
        }
        if (feedType === 'profile') return c.feedType === 'profile' && !c.profileAcct
        if (
          (feedType === 'local' || feedType === 'federated' || feedType === 'home') &&
          feedParam
        ) {
          if (feedParam.startsWith('host:')) {
            return (
              c.feedType === feedType &&
              (c.serverHost || '').toLowerCase() === feedParam.slice(5).toLowerCase()
            )
          }
          return c.feedType === feedType && c.instanceId === feedParam
        }
        // Unpinned singleton: no instanceId / serverHost
        if (feedType === 'local' || feedType === 'federated' || feedType === 'home') {
          return c.feedType === feedType && !c.instanceId && !c.serverHost
        }
        return c.feedType === feedType
      })
    },

    /**
     * Focus a column that is already on the board. Returns its id, or null
     * when the view isn't in the user's column set (caller should route away).
     */
    focusExistingColumn(feedType: ColumnFeedType, feedParam?: string): string | null {
      const match = this.findColumn(feedType, feedParam)
      if (!match) return null
      this.setFocusedColumn(match.id)
      return match.id
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
     * `feedParam` is groupTag for groups, algorithmId for algorithms, or
     * `host:<domain>` / instance id / `all` for local/federated/home pins.
     */
    addColumn(feedType: ColumnFeedType = 'local', feedParam?: string) {
      // Own-profile / search / inbox are singletons; liked/saved stay per-account-pinable
      if (isPanelFeed(feedType)) {
        const existing = this.columns.find(
          (c) => c.feedType === feedType && !c.profileAcct,
        )
        if (existing) return existing.id
      }
      if ((feedType === 'favourites' || feedType === 'bookmarks') && !feedParam) {
        const existing = this.columns.find(
          (c) => c.feedType === feedType && !c.instanceId,
        )
        if (existing) return existing.id
      }
      if (feedType === 'algorithm' && feedParam) {
        const existing = this.columns.find(
          (c) => c.feedType === 'algorithm' && c.algorithmId === feedParam,
        )
        if (existing) return existing.id
      }
      if (feedType === 'list' && feedParam) {
        const existing = this.columns.find(
          (c) => c.feedType === 'list' && c.listId === feedParam,
        )
        if (existing) return existing.id
      }
      if (feedType === 'rss' && feedParam) {
        const existing = this.columns.find(
          (c) => c.feedType === 'rss' && c.rssUrl === feedParam,
        )
        if (existing) return existing.id
      }
      if (
        (feedType === 'local' || feedType === 'federated' || feedType === 'home') &&
        feedParam
      ) {
        const existing = this.findColumn(feedType, feedParam)
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
      if (feedType === 'list' && feedParam) col.listId = feedParam
      if (feedType === 'rss' && feedParam) col.rssUrl = feedParam
      if (
        (feedType === 'local' || feedType === 'federated' || feedType === 'home' ||
          feedType === 'favourites' ||
          feedType === 'bookmarks') &&
        feedParam
      ) {
        if (feedParam.startsWith('host:')) col.serverHost = feedParam.slice(5).toLowerCase()
        else col.instanceId = feedParam
      }
      this.columns.push(col)
      this.persist()
      return col.id
    },

    /** Open a Mastodon list on the board, remembering its title for chrome. */
    openListColumn(listId: string, title?: string): string | null {
      const id = this.ensureFocusedView('list', listId)
      if (!id || !title) return id
      const col = this.columns.find((c) => c.id === id)
      if (col && col.listTitle !== title) {
        col.listTitle = title
        this.persist()
      }
      return id
    },

    /** Open an RSS/Atom feed column, remembering its title for chrome. */
    openRssColumn(rssUrl: string, title?: string): string | null {
      const clean = rssUrl.trim()
      if (!clean || !/^https?:\/\//i.test(clean)) return null
      // ATS blocks cleartext HTTP in the Cap shell
      if (isNativeShell() && /^http:\/\//i.test(clean)) return null
      const id = this.ensureFocusedView('rss', clean)
      if (!id) return id
      if (title) this.setRssTitle(id, title)
      return id
    },

    setRssTitle(columnId: string, title: string) {
      const col = this.columns.find((c) => c.id === columnId)
      const clean = title.trim().slice(0, 80)
      if (!col || !clean || col.rssTitle === clean) return
      col.rssTitle = clean
      this.persist()
    },

    /**
     * Open (or focus) a Local column pinned to a public hostname — used by
     * Explore / InstancePreview "Add to board".
     */
    ensureServerColumn(host: string, feedType: 'local' | 'federated' = 'local'): string | null {
      const clean = host.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase()
      if (!clean) return null
      return this.ensureFocusedView(feedType, `host:${clean}`)
    },

    /** Pin / unpin which account or host a timeline column reads from. */
    setColumnPin(
      columnId: string,
      pin: { instanceId?: string | null; serverHost?: string | null },
    ) {
      const column = this.columns.find((c) => c.id === columnId)
      if (!column) return
      if (pin.instanceId === null) delete column.instanceId
      else if (typeof pin.instanceId === 'string' && pin.instanceId) column.instanceId = pin.instanceId
      if (pin.serverHost === null) delete column.serverHost
      else if (typeof pin.serverHost === 'string' && pin.serverHost) {
        column.serverHost = pin.serverHost.toLowerCase()
      }
      this.persist()
    },

    /**
     * Open a view on the board (add if needed) and focus it.
     * Always focuses (does not toggle off) — use clearColumnFocus / toggleColumnFocus to leave.
     * `feedParam` is groupTag for groups, algorithmId for algorithms.
     * When the board is full, returns null without mutating — callers offer replace or a route.
     */
    ensureFocusedView(feedType: ColumnFeedType, feedParam?: string): string | null {
      // Use findColumn so profile peeks (profileAcct set) aren't treated as own-profile
      const match = this.findColumn(feedType, feedParam)
      if (match) {
        if (this.focusedColumnId !== match.id) {
          this.focusedColumnId = match.id
          this.saveDeskLayout()
        }
        return match.id
      }
      if (this.columns.length >= MAX_COLUMNS) {
        return null
      }
      const id = this.addColumn(feedType, feedParam)
      if (id) {
        this.focusedColumnId = id
        this.saveDeskLayout()
      }
      return id ?? null
    },

    /**
     * Deliberately replace one column with a new feed view. Undo restores the
     * previous column (paired with removing the new one so the board stays ≤ max).
     */
    replaceColumnWithView(
      replaceId: string,
      feedType: ColumnFeedType,
      feedParam?: string,
    ): string | null {
      const match = this.findColumn(feedType, feedParam)
      if (match) {
        if (this.focusedColumnId !== match.id) {
          this.focusedColumnId = match.id
          this.saveDeskLayout()
        }
        return match.id
      }
      const index = this.columns.findIndex((c) => c.id === replaceId)
      if (index === -1 || this.columns.length <= 1) return null

      const removed = { ...this.columns[index]! }
      const removedFrom = this.accountKey
      this.columns.splice(index, 1)

      const id = this.addColumn(feedType, feedParam)
      if (!id) {
        // add failed — put the old column back
        this.columns.splice(index, 0, removed)
        this.persist()
        return null
      }
      this.focusedColumnId = id
      this.saveDeskLayout()

      if (typeof window === 'undefined') return id
      void import('./toast').then(({ useToastStore }) => {
        const label =
          removed.feedType === 'group' && removed.groupTag
            ? `#${removed.groupTag}`
            : removed.feedType === 'algorithm' && removed.algorithmId
              ? 'Algorithm'
              : FEED_LABELS[removed.feedType] || 'Column'
        useToastStore().show({
          message: `Replaced ${label}`,
          actionLabel: 'Undo',
          duration: 5000,
          onAction: () => {
            if (this.accountKey !== removedFrom) return
            const newIdx = this.columns.findIndex((c) => c.id === id)
            if (newIdx === -1) return
            this.columns.splice(newIdx, 1)
            if (this.columns.some((c) => c.id === removed.id)) return
            const insertAt = Math.min(index, this.columns.length)
            this.columns.splice(insertAt, 0, removed)
            this.focusedColumnId = removed.id
            this.saveDeskLayout()
            this.persist()
          },
        })
      })
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
      const removedFrom = this.accountKey
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
            // Switched account within the toast window — don't drop it into the new layout
            if (this.accountKey !== removedFrom) return
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

    updateColumnFeedType(
      columnId: string,
      feedType: ColumnFeedType,
      feedParam?: string,
      opts?: { listTitle?: string; rssTitle?: string },
    ) {
      const column = this.columns.find((c) => c.id === columnId)
      if (column) {
        column.feedType = feedType
        column.groupTag = feedType === 'group' ? feedParam : undefined
        column.algorithmId = feedType === 'algorithm' ? feedParam : undefined
        if (feedType === 'list' && feedParam) {
          column.listId = feedParam
          if (opts?.listTitle) column.listTitle = opts.listTitle
        } else {
          delete column.listId
          delete column.listTitle
        }
        if (feedType === 'rss' && feedParam) {
          column.rssUrl = feedParam
          if (opts?.rssTitle) column.rssTitle = opts.rssTitle
        } else {
          delete column.rssUrl
          delete column.rssTitle
        }
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
          listId: column.listId,
          rssUrl: column.rssUrl,
        }
      }
      column.feedType = 'profile'
      column.profileAcct = handle
      column.groupTag = undefined
      column.algorithmId = undefined
      delete column.listId
      // keep listTitle only while on a list feed — drop on peek
      delete column.listTitle
      delete column.rssUrl
      delete column.rssTitle
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
        if (back.feedType === 'list' && back.listId) {
          column.listId = back.listId
        } else {
          delete column.listId
          delete column.listTitle
        }
        if (back.feedType === 'rss' && back.rssUrl) {
          column.rssUrl = back.rssUrl
        } else {
          delete column.rssUrl
          delete column.rssTitle
        }
      } else {
        column.feedType = 'home'
        column.groupTag = undefined
        column.algorithmId = undefined
        delete column.listId
        delete column.listTitle
        delete column.rssUrl
        delete column.rssTitle
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
      const packsBucket = readPacksBucket(accountKey)

      const previous = this.columns
      const prevFocused = previous.find((c) => c.id === this.focusedColumnId)

      if (packsBucket) {
        this.packs = packsBucket.packs
        this.activePackId = packsBucket.activePackId
        const active = this.packs.find((p) => p.id === this.activePackId) || this.packs[0]!
        this.columns = active.columns.map((c) => ({ ...c }))
        this.activePackId = active.id
        this.layoutDirty = fromLocal?.dirty || false
        this.layoutUpdatedAt = fromLocal?.updatedAt || active.updatedAt
      } else if (fromLocal?.dirty && fromLocal.columns.length) {
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

      if (!this.packs.length) {
        const daily = defaultDailyPack(this.columns.map((c) => ({ ...c })))
        this.packs = [daily]
        this.activePackId = daily.id
        this.savePacks()
      }

      // Profile decode regenerates column ids — rematch focus by feed, don't drop it
      if (this.focusedColumnId && !this.columns.some((c) => c.id === this.focusedColumnId)) {
        // feedKey: an algorithm column must rematch its own recipe, not the first algorithm
        const rematch = prevFocused
          ? this.columns.find((c) => feedKey(c) === feedKey(prevFocused))
          : null
        this.focusedColumnId = rematch?.id ?? null
        this.saveDeskLayout()
      }
    },
  },
})
