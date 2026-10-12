/**
 * Recent Explore searches — local to this device, scoped per account.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useInstancesStore } from '~/stores/instances'
import type { ExploreSearchTab } from '~/composables/useFediverseSearch'

const STORAGE_KEY = 'neospace_recent_searches_v1'
const REMEMBER_KEY = 'neospace_remember_searches'
const MAX = 10

export type RecentSearch = { q: string; tab: ExploreSearchTab; at: number }

type Stored = Record<string, RecentSearch[]>

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {}
  } catch {
    return {}
  }
}

function write(data: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // private mode / quota — recents are a convenience
  }
}

export function rememberSearchHistoryEnabled(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0'
  } catch {
    return true
  }
}

export function setRememberSearchHistory(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(REMEMBER_KEY)
    else localStorage.setItem(REMEMBER_KEY, '0')
  } catch {
    /* ignore */
  }
}

/** Drop one account's history when they sign out of this device */
export function purgeRecentSearches(accountId: string) {
  const data = read()
  if (!(accountId in data)) return
  delete data[accountId]
  write(data)
}

export function useRecentSearches() {
  const instancesStore = useInstancesStore()
  const bucket = computed(() => instancesStore.activeAccount?.id || 'guest')
  const all = ref<Stored>(typeof window === 'undefined' ? {} : read())

  const syncFromStorage = () => {
    all.value = read()
  }

  const items = computed(() => all.value[bucket.value] || [])

  const save = (list: RecentSearch[]) => {
    const fresh = read()
    fresh[bucket.value] = list
    all.value = fresh
    write(fresh)
  }

  const record = (q: string, tab: ExploreSearchTab) => {
    if (!rememberSearchHistoryEnabled()) return
    const clean = q.trim()
    if (clean.length < 2) return
    const current = read()[bucket.value] || []
    const rest = current.filter((r) => r.q.toLowerCase() !== clean.toLowerCase())
    save([{ q: clean, tab, at: Date.now() }, ...rest].slice(0, MAX))
  }

  const remove = (q: string) => {
    const needle = q.toLowerCase()
    const current = read()[bucket.value] || []
    save(current.filter((r) => r.q.toLowerCase() !== needle))
  }
  const clear = () => save([])

  onMounted(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('storage', syncFromStorage)
  })
  onUnmounted(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('storage', syncFromStorage)
  })

  return { items, record, remove, clear }
}
