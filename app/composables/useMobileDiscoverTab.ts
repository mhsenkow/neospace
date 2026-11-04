/**
 * Which destination owns the mobile tab next to Home: Search or Messages.
 * Last choice from the hamburger (or the tab itself) sticks across sessions.
 */
export type MobileDiscoverTab = 'search' | 'messages'

const STORAGE_KEY = 'neo-mobile-discover-tab'

function readStored(): MobileDiscoverTab {
  if (import.meta.client) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'messages' || stored === 'search') return stored
    } catch {
      /* private mode */
    }
  }
  return 'search'
}

export function useMobileDiscoverTab() {
  const discoverTab = useState<MobileDiscoverTab>('neo-mobile-discover-tab', readStored)

  const preferDiscoverTab = (next: MobileDiscoverTab) => {
    discoverTab.value = next
    if (!import.meta.client) return
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* private mode */
    }
  }

  return { discoverTab, preferDiscoverTab }
}
