/**
 * NeoSpace Column Layout Store
 *
 * Multi-column TweetDeck-style layout configuration.
 * - Persisted per-account in localStorage
 * - Synced to the signed-in Mastodon profile field `neospace_columns`
 *   so phone/desktop share the same feeds (when a profile field slot is free)
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient } from '~/composables/useMasto'

export type ColumnFeedType = 'home' | 'local' | 'federated' | 'group'

export interface ColumnConfig {
  id: string
  feedType: ColumnFeedType
  groupTag?: string
}

interface ColumnsState {
  columns: ColumnConfig[]
  /** Storage / sync key for the active identity (acct@host or guest) */
  accountKey: string
  syncing: boolean
  lastSyncError: string | null
}

const STORAGE_KEY = 'neospace_columns_v2'
const LEGACY_STORAGE_KEY = 'neospace_columns'
/** Profile metadata field name (visible on profile; compact value) */
export const COLUMNS_PROFILE_FIELD = 'neospace_columns'
/** Max independent timeline columns (desktop strip + mobile swipe) */
export const MAX_COLUMNS = 8

const generateId = () => Math.random().toString(36).substring(2, 10)

const FEED_TYPES: ColumnFeedType[] = ['home', 'local', 'federated', 'group']

function normalizeFieldName(name: string) {
  return name.toLowerCase().replace(/[^a-z_]/g, '')
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, '').trim()
}

/** Compact wire format: home|local|federated|group:tag */
export function encodeColumns(columns: ColumnConfig[]): string {
  return columns
    .map((c) => {
      if (c.feedType === 'group' && c.groupTag) {
        return `group:${c.groupTag.replace(/[|:]/g, '')}`
      }
      return c.feedType
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
  return [{ id: generateId(), feedType: preferHome ? 'home' : 'local' }]
}

let profileSyncTimer: ReturnType<typeof setTimeout> | null = null

export const useColumnsStore = defineStore('columns', {
  state: (): ColumnsState => ({
    columns: defaultColumns(false),
    accountKey: 'guest',
    syncing: false,
    lastSyncError: null,
  }),

  getters: {
    columnCount: (state): number => state.columns.length,
    maxColumns: (): number => MAX_COLUMNS,
    canAddColumn: (state): boolean => state.columns.length < MAX_COLUMNS,
    canRemoveColumn: (state): boolean => state.columns.length > 1,
    isMultiColumn: (state): boolean => state.columns.length > 1,
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
            return cols
          }
        }

        // Migrate legacy single-bucket layout into the current account once
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacy) {
          const data = JSON.parse(legacy)
          if (Array.isArray(data.columns) && data.columns.length > 0 && data.columns.length <= MAX_COLUMNS) {
            return data.columns as ColumnConfig[]
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
      this.scheduleProfileSync()
    },

    scheduleProfileSync() {
      if (typeof window === 'undefined') return
      if (profileSyncTimer) clearTimeout(profileSyncTimer)
      profileSyncTimer = setTimeout(() => {
        profileSyncTimer = null
        void this.syncToProfile()
      }, 600)
    },

    /**
     * Upsert compact column layout onto the active account's profile fields.
     * No-ops for guests, or when all 4 field slots are taken by something else.
     */
    async syncToProfile() {
      const instancesStore = useInstancesStore()
      const account = instancesStore.activeAccount
      if (!account?.user || !account.accessToken) return

      const encoded = encodeColumns(this.columns)
      if (encoded.length > 255) {
        this.lastSyncError = 'Column layout too long to sync to profile'
        return
      }

      const existing = (account.user.fields || []).map((f) => ({
        name: f.name,
        value: stripHtml(f.value || ''),
      }))
      const idx = existing.findIndex(
        (f) => normalizeFieldName(f.name) === normalizeFieldName(COLUMNS_PROFILE_FIELD),
      )

      if (idx >= 0) {
        if (existing[idx]!.value === encoded) return
        existing[idx]!.value = encoded
      } else if (existing.length < 4) {
        existing.push({ name: COLUMNS_PROFILE_FIELD, value: encoded })
      } else {
        this.lastSyncError = 'Profile fields full — columns stay on this device'
        return
      }

      this.syncing = true
      this.lastSyncError = null
      try {
        const client = activeClient()
        const updated = await client.v1.accounts.updateCredentials({
          fieldsAttributes: existing.map((f) => ({
            name: f.name,
            value: f.value,
          })),
        })
        instancesStore.updateActiveAccount(updated)
      } catch (e: any) {
        this.lastSyncError = e?.message || 'Failed to sync columns to profile'
        console.warn('Column profile sync failed:', this.lastSyncError)
      } finally {
        this.syncing = false
      }
    },

    addColumn(feedType: ColumnFeedType = 'local', groupTag?: string) {
      if (this.columns.length >= MAX_COLUMNS) return
      const col: ColumnConfig = { id: generateId(), feedType }
      if (groupTag) col.groupTag = groupTag
      this.columns.push(col)
      this.persist()
    },

    removeColumn(columnId: string) {
      if (this.columns.length <= 1) return
      const index = this.columns.findIndex((c) => c.id === columnId)
      if (index !== -1) {
        this.columns.splice(index, 1)
        this.persist()
      }
    },

    updateColumnFeedType(columnId: string, feedType: ColumnFeedType, groupTag?: string) {
      const column = this.columns.find((c) => c.id === columnId)
      if (column) {
        column.feedType = feedType
        column.groupTag = feedType === 'group' ? groupTag : undefined
        this.persist()
      }
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

      if (fromProfile?.length) {
        this.columns = fromProfile
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
    },
  },
})
