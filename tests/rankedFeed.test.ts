import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { useRankedFeed } from '../app/composables/useRankedFeed'

const trendList = vi.fn()

vi.mock('~/stores/groups', () => ({
  useGroupsStore: () => ({ initializeGroups: async () => {}, followedTags: [] }),
}))

vi.mock('~/composables/useMasto', () => {
  const emptyRaw = async () => ({ data: [], headers: new Headers() })
  const client = {
    v1: {
      accounts: { $select: () => ({ following: { list: { $raw: emptyRaw } }, followers: { list: { $raw: emptyRaw } } }) },
      favourites: { list: async () => [] },
      bookmarks: { list: async () => [] },
      trends: { statuses: { list: (p: unknown) => trendList(p) } },
      timelines: { tag: { $select: () => ({ list: async () => [] }) } },
    },
  }
  return { activeClient: () => client, publicClient: () => client, clientFor: () => client, activeCredentials: vi.fn() }
})

const post = (n: number) =>
  ({
    id: String(n),
    uri: `https://a.example/statuses/${n}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1000 - n)).toISOString(),
    content: `<p>post ${n}</p>`,
    account: { acct: `u${n}`, followersCount: 10 },
    tags: [],
    mentions: [],
    mediaAttachments: [],
  }) as never

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => post(from - i))

let instances: ReturnType<typeof useInstancesStore>
let home: ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  instances = useInstancesStore()
  instances.instances = [
    { id: 'a', url: 'https://a.example', accessToken: 'tok', user: { id: 'me', acct: 'me', username: 'me' } },
  ] as never
  instances.activeAccountId = 'a'
  home = vi.fn()
  ;(instances as unknown as Record<string, unknown>).fetchMergedHomeTimeline = home
  trendList.mockReset()
  trendList.mockResolvedValue([])
})

describe('useRankedFeed', () => {
  it('pages the home source by the previous page’s last id', async () => {
    home.mockResolvedValueOnce(range(100, 20)).mockResolvedValueOnce(range(80, 20)).mockResolvedValue([])
    const { nextPage } = useRankedFeed()
    await nextPage('x', true)
    // fresh start refills twice (deeper pool): 2nd call continues from the 1st page's last id
    expect(home).toHaveBeenNthCalledWith(1, 20, undefined)
    expect(home).toHaveBeenNthCalledWith(2, 20, { a: '81' })
  })

  it('reports exhaustion only once every source is dry and the queue is empty', async () => {
    home.mockResolvedValue([])
    const { nextPage } = useRankedFeed()
    const res = await nextPage('x', true)
    expect(res).toEqual({ statuses: [], exhausted: true })
  })

  it('serves a post once — later refills never move or repeat what was served', async () => {
    home.mockResolvedValueOnce(range(100, 20)).mockResolvedValueOnce(range(80, 20)).mockResolvedValueOnce(range(60, 20)).mockResolvedValue([])
    const { nextPage } = useRankedFeed()
    const first = await nextPage('x', true)
    const second = await nextPage('x', false)
    const ids1 = first.statuses.map((s) => s.id)
    const ids2 = second.statuses.map((s) => s.id)
    expect(ids1).toHaveLength(20)
    expect(ids2.filter((id) => ids1.includes(id))).toEqual([])
    expect(new Set([...ids1, ...ids2]).size).toBe(ids1.length + ids2.length)
  })

  it('a refresh during a refill supersedes it — the stale call returns an empty, non-final page', async () => {
    let release: (v: never[]) => void = () => {}
    home
      .mockImplementationOnce(() => new Promise<never[]>((r) => { release = r }))
      .mockResolvedValue(range(100, 20))
    const { nextPage } = useRankedFeed()
    const stale = nextPage('x', true)
    await vi.waitFor(() => expect(home).toHaveBeenCalledTimes(1))
    const fresh = nextPage('x', true)
    release(range(500, 20) as never)
    const [a, b] = await Promise.all([stale, fresh])
    expect(a).toEqual({ statuses: [], exhausted: false })
    expect(b.statuses.length).toBeGreaterThan(0)
    expect(b.statuses.some((s) => Number(s.id) >= 500)).toBe(false)
  })

  it('retires a source whose endpoint is permanently missing instead of retrying it', async () => {
    home.mockResolvedValue(range(100, 20))
    trendList.mockRejectedValue(Object.assign(new Error('nope'), { statusCode: 404 }))
    const { nextPage } = useRankedFeed()
    await nextPage('x', true)
    expect(trendList).toHaveBeenCalledTimes(1)
  })
})
