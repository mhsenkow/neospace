/**
 * NeoSpace Column Layout Store
 *
 * Manages the multi-column TweetDeck-style layout configuration.
 * Persisted to localStorage so columns survive page reloads.
 */

import { defineStore } from 'pinia'

export type ColumnFeedType = 'home' | 'local' | 'federated' | 'group'

export interface ColumnConfig {
  id: string
  feedType: ColumnFeedType
  groupTag?: string
}

interface ColumnsState {
  columns: ColumnConfig[]
}

const STORAGE_KEY = 'neospace_columns'
const MAX_COLUMNS = 4

const generateId = () => Math.random().toString(36).substring(2, 10)

export const useColumnsStore = defineStore('columns', {
  state: (): ColumnsState => ({
    columns: [{ id: generateId(), feedType: 'local' }],
  }),

  getters: {
    columnCount: (state): number => state.columns.length,
    canAddColumn: (state): boolean => state.columns.length < MAX_COLUMNS,
    canRemoveColumn: (state): boolean => state.columns.length > 1,
    isMultiColumn: (state): boolean => state.columns.length > 1,
  },

  actions: {
    loadFromStorage() {
      if (typeof window === 'undefined') return
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const data = JSON.parse(saved)
          if (Array.isArray(data.columns) && data.columns.length > 0 && data.columns.length <= MAX_COLUMNS) {
            this.columns = data.columns
          }
        }
      } catch (e) {
        console.error('Failed to load columns config:', e)
      }
    },

    saveToStorage() {
      if (typeof window === 'undefined') return
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns: this.columns }))
      } catch (e) {
        console.error('Failed to save columns config:', e)
      }
    },

    addColumn(feedType: ColumnFeedType = 'local', groupTag?: string) {
      if (this.columns.length >= MAX_COLUMNS) return
      const col: ColumnConfig = { id: generateId(), feedType }
      if (groupTag) col.groupTag = groupTag
      this.columns.push(col)
      this.saveToStorage()
    },

    removeColumn(columnId: string) {
      if (this.columns.length <= 1) return
      const index = this.columns.findIndex(c => c.id === columnId)
      if (index !== -1) {
        this.columns.splice(index, 1)
        this.saveToStorage()
      }
    },

    updateColumnFeedType(columnId: string, feedType: ColumnFeedType, groupTag?: string) {
      const column = this.columns.find(c => c.id === columnId)
      if (column) {
        column.feedType = feedType
        column.groupTag = feedType === 'group' ? groupTag : undefined
        this.saveToStorage()
      }
    },

    initialize() {
      this.loadFromStorage()
    },
  },
})
