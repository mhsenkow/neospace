/**
 * Recent Explore searches — local to this device, scoped per account.
 */

import { computed, ref } from 'vue'
import { useInstancesStore } from '~/stores/instances'
import type { ExploreSearchTab } from '~/composables/useFediverseSearch'

const STORAGE_KEY = 'neospace_recent_searches_v1'
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

export function useRecentSearches() {
  const instancesStore = useInstancesStore()
  const bucket = computed(() => instancesStore.activeAccount?.id || 'guest')
  const all = ref<Stored>(typeof window === 'undefined' ? {} : read())

  const items = computed(() => all.value[bucket.value] || [])

  const save = (list: RecentSearch[]) => {
    all.value = { ...all.value, [bucket.value]: list }
    write(all.value)
  }

  const record = (q: string, tab: ExploreSearchTab) => {
    const clean = q.trim()
    if (clean.length < 2) return
    const rest = items.value.filter((r) => r.q.toLowerCase() !== clean.toLowerCase())
    save([{ q: clean, tab, at: Date.now() }, ...rest].slice(0, MAX))
  }

  const remove = (q: string) => save(items.value.filter((r) => r.q !== q))
  const clear = () => save([])

  return { items, record, remove, clear }
}
