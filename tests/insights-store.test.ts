import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { useInsightsStore } from '../app/stores/insights'

const listStatuses = vi.fn()
const listAnnual = vi.fn()

vi.mock('~/composables/useMasto', () => ({
  activeClient: () => ({
    v1: {
      accounts: {
        $select: (id: string) => ({
          statuses: {
            list: (opts: unknown) => listStatuses(id, opts),
          },
        }),
      },
      annualReports: {
        list: () => listAnnual(),
      },
    },
  }),
}))

const account = {
  id: '42',
  acct: 'neo',
  displayName: 'Neo',
  followersCount: 10,
  followingCount: 5,
  statusesCount: 3,
} as never

const status = (id: string, visibility: string, favs = 1) =>
  ({
    id,
    createdAt: new Date().toISOString(),
    visibility,
    favouritesCount: favs,
    reblogsCount: 0,
    repliesCount: 0,
    content: 'x',
    account,
  }) as never

describe('insights store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listStatuses.mockReset()
    listAnnual.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const instances = useInstancesStore()
    instances.instances = [
      { id: 'a', url: 'https://home.example', accessToken: 'tok', user: account },
    ] as never
    instances.activeAccountId = 'a'
  })

  it('builds on-screen and export reports, excluding DMs from both and private from export', async () => {
    listStatuses.mockResolvedValue([
      status('1', 'public', 3),
      status('2', 'private', 2),
      status('3', 'direct', 9),
    ])
    const insights = useInsightsStore()
    await insights.fetchInsights(account, 30)
    expect(insights.isLoading).toBe(false)
    expect(insights.error).toBeNull()
    expect(insights.report).not.toBeNull()
    expect(insights.exportReport).not.toBeNull()
    // Direct never counts; private is on-screen only
    expect(insights.report!.totals.posts).toBe(2)
    expect(insights.exportReport!.totals.posts).toBe(1)
  })

  it('abortInFlight clears loading flags mid-fetch', async () => {
    let resolveList!: (v: unknown) => void
    listStatuses.mockImplementation(
      () =>
        new Promise((r) => {
          resolveList = r
        }),
    )
    const insights = useInsightsStore()
    // Avoid the previous test's warm cache short-circuiting before await
    insights.accountId = null
    const pending = insights.fetchInsights({ ...account, id: 'fresh-abort' } as never, 7)
    await Promise.resolve()
    expect(insights.isLoading).toBe(true)
    insights.abortInFlight()
    expect(insights.isLoading).toBe(false)
    resolveList([])
    await pending
  })

  it('setWindow updates the selected window', () => {
    const insights = useInsightsStore()
    insights.setWindow(90)
    expect(insights.windowDays).toBe(90)
  })
})
