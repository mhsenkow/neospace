/**
 * Explore — live server lookup, board open, search scope helpers.
 */

import type { InstanceApiInfo } from '~/utils/instanceInfo'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import { useBoardNav } from '~/composables/useBoardNav'
import { normalizeServer } from '~/utils/instances'
import { detectIntent, hostSearchText, suggestTwinHost } from '~/utils/searchQuery'
import type { CuratedInstance } from '~/composables/useCuratedInstances'

export type ExploreTab = 'all' | 'people' | 'posts' | 'tags' | 'servers'

export function useExploreServers(opts: {
  searchScope: Ref<'everywhere' | string>
  tab: Ref<ExploreTab>
  query: Ref<string>
  curatedInstances: Ref<CuratedInstance[]> | ComputedRef<CuratedInstance[]>
  setTab: (next: ExploreTab) => void
  applyQuery: (q: string, nextTab?: ExploreTab) => void
  trimmedQuery: ComputedRef<string>
}) {
  const instancesStore = useInstancesStore()
  const toastStore = useToastStore()
  const { openServerOnBoard } = useBoardNav()

  const showToast = (msg: string) => toastStore.show({ message: msg, duration: 3200 })

  const liveServer = ref<{ host: string; info: InstanceApiInfo | null; busy: boolean } | null>(null)
  let liveTimer: ReturnType<typeof setTimeout> | null = null

  const intent = computed(() => detectIntent(opts.query.value))

  const liveHostCandidate = computed(() => {
    if (opts.tab.value !== 'all' && opts.tab.value !== 'servers') return null
    const i = intent.value
    if (i.kind === 'host') return i.host
    if (opts.tab.value === 'servers' && i.kind === 'url')
      return normalizeServer(i.url)?.replace(/^https:\/\//, '') ?? null
    return null
  })

  watch(liveHostCandidate, (host) => {
    if (liveTimer) clearTimeout(liveTimer)
    if (!host) {
      liveServer.value = null
      return
    }
    liveServer.value = { host, info: null, busy: true }
    liveTimer = setTimeout(async () => {
      const info = await instancesStore.fetchInstanceInfo(host).catch(() => null)
      if (liveHostCandidate.value !== host) return
      liveServer.value = { host, info, busy: false }
    }, 450)
  })

  const liveServerJoinUrl = computed(() => {
    const s = liveServer.value
    if (!s?.info?.registrations) return null
    return s.info.registrationsUrl || `https://${s.host}/auth/sign_up`
  })

  const twinSuggestion = computed(() => {
    const host = liveHostCandidate.value
    if (!host) return null
    if (liveServer.value?.busy) return null
    if (liveServer.value?.info) return null
    return suggestTwinHost(unref(opts.curatedInstances), host)
  })

  const scopeChoices = computed(() => {
    const rows: { id: string; label: string }[] = [{ id: 'everywhere', label: 'All my servers' }]
    for (const inst of instancesStore.authenticatedInstances) {
      const host = inst.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const acct = inst.user?.acct || inst.user?.username || host
      rows.push({
        id: inst.id,
        label: acct.includes('@') ? `@${acct}` : `@${acct}@${host}`,
      })
    }
    for (const inst of instancesStore.watchingInstances) {
      const host = inst.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
      if (!rows.some((r) => r.label === host || r.id === `host:${host}`)) {
        rows.push({ id: `host:${host}`, label: host })
      }
    }
    return rows
  })

  const setSearchScope = (id: string) => {
    opts.searchScope.value = id
  }

  const addHostToBoard = async (host: string) => {
    try {
      if (!instancesStore.instances.some((i) => i.url.includes(host))) {
        try {
          await instancesStore.addInstance(`https://${host}`)
          showToast(`Watching ${host} — browse public posts anytime`)
        } catch {
          /* still open the column */
        }
      }
      await openServerOnBoard(host, 'local')
      showToast(`Opened Local · ${host} on your board`)
    } catch {
      toastStore.show({ message: 'Couldn’t open that server on the board' })
    }
  }

  const searchOnHost = (host: string) => {
    opts.searchScope.value = `host:${host}`
    opts.setTab('all')
    if (!opts.trimmedQuery.value || detectIntent(opts.trimmedQuery.value).kind === 'host') {
      const text = hostSearchText(host)
      if (text && text !== opts.trimmedQuery.value) opts.applyQuery(text)
    }
  }

  const browsePeopleOnHost = (host: string) => {
    opts.searchScope.value = `host:${host}`
    opts.setTab('people')
    if (!opts.trimmedQuery.value.trim()) opts.applyQuery(host.split('.')[0] || host, 'people')
  }

  const disposeExploreServers = () => {
    if (liveTimer) clearTimeout(liveTimer)
  }

  return {
    liveServer,
    liveServerJoinUrl,
    twinSuggestion,
    liveHostCandidate,
    scopeChoices,
    setSearchScope,
    addHostToBoard,
    searchOnHost,
    browsePeopleOnHost,
    showToast,
    disposeExploreServers,
  }
}
