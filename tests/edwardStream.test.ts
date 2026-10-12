import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useInstancesStore, type ExtendedStatus } from '../app/stores/instances'
import { useEdwardStore } from '../app/stores/edward'
import { useComposeSheetStore } from '../app/stores/composeSheet'
import { useEdwardStream } from '../app/composables/useEdwardStream'
import { useEdwardRecessRestore } from '../app/composables/useEdwardRecess'
import { buildDeletedStatusEvent } from '../app/utils/deletedStatus'

const homeList = vi.fn()
const publicList = vi.fn()

vi.mock('~/stores/groups', () => ({
  useGroupsStore: () => ({
    followedTags: [],
    joinedGroups: [],
    initializeGroups: async () => {},
    fetchFollowedTags: async () => {},
  }),
}))

vi.mock('~/composables/useMasto', () => {
  const client = {
    v1: {
      timelines: {
        home: { list: (p: unknown) => homeList(p) },
        public: { list: (p: unknown) => publicList(p) },
        tag: { $select: () => ({ list: async () => [] }) },
      },
      trends: { statuses: { list: async () => [] } },
      accounts: { $select: () => ({ following: { list: async () => [] } }) },
    },
  }
  return { clientFor: () => client, activeClient: () => client, publicClient: () => client, activeCredentials: vi.fn() }
})

const status = (n: number, acct = `u${n}`) =>
  ({
    id: String(n),
    uri: `https://a.example/@${acct}/${n}`,
    url: `https://a.example/@${acct}/${n}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + n * 1000).toISOString(),
    content: `<p>post ${n}</p>`,
    account: { id: `acc-${acct}`, acct, username: acct, displayName: acct },
    mediaAttachments: [],
    tags: [],
    mentions: [],
  }) as unknown as ExtendedStatus

const batch = (from: number, count: number, acct?: (n: number) => string) =>
  Array.from({ length: count }, (_, i) => status(from + i, acct?.(from + i)))

let edward: ReturnType<typeof useEdwardStore>

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  const instances = useInstancesStore()
  instances.instances = [
    { id: 'a', name: 'a', url: 'https://a.example', accessToken: 'tok', user: { id: 'me', acct: 'me', username: 'me' } },
  ] as never
  instances.activeAccountId = 'a'
  edward = useEdwardStore()
  edward.enter()
  homeList.mockReset()
  publicList.mockReset()
  publicList.mockResolvedValue([])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useEdwardStream backpack', () => {
  it('seeds the stage from the home feed', async () => {
    homeList.mockResolvedValue(batch(1, 30))
    const stream = useEdwardStream()
    await stream.start()
    expect(edward.statuses).toHaveLength(30)
    expect(edward.backpack).toBe(0)
    stream.stop()
  })

  it('releases queued posts one at a time at the stream pace', async () => {
    homeList.mockResolvedValue(batch(1, 120))
    const stream = useEdwardStream()
    await stream.start()
    const onStage = edward.statuses.length
    const queued = edward.backpack
    expect(queued).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(2700)
    expect(edward.backpack).toBe(queued - 1)
    expect(edward.statuses.length).toBeGreaterThanOrEqual(Math.min(onStage + 1, 280))
    stream.stop()
    expect(edward.backpack).toBe(0)
  })

  it('a ghosted author is purged from the queue and never drips onto the stage', async () => {
    homeList.mockResolvedValue(batch(1, 150, (n) => (n % 2 ? 'ghosty' : `u${n}`)))
    const stream = useEdwardStream()
    await stream.start()
    const queuedBefore = edward.backpack
    expect(queuedBefore).toBeGreaterThan(0)
    edward.dropAuthor('ghosty')
    await nextTick()
    expect(edward.backpack).toBeLessThan(queuedBefore)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(edward.statuses.some((s) => s.account.acct === 'ghosty')).toBe(false)
    stream.stop()
  })

  it('a deleted post leaves the stage and the queue', async () => {
    homeList.mockResolvedValue(batch(1, 150))
    const stream = useEdwardStream()
    await stream.start()
    const victim = edward.statuses[0]!
    const event = buildDeletedStatusEvent(victim, { id: 'a', url: 'https://a.example' })
    const { emitDeletedStatus } = await import('../app/composables/useDeletedStatus')
    emitDeletedStatus(event)
    expect(edward.statuses.some((s) => s.id === victim.id)).toBe(false)
    stream.stop()
  })
})

describe('useEdwardStream re-seed backoff', () => {
  it('waits longer between re-seeds while the server keeps rate-limiting', async () => {
    homeList.mockRejectedValue(Object.assign(new Error('429'), { statusCode: 429 }))
    publicList.mockRejectedValue(Object.assign(new Error('429'), { statusCode: 429 }))
    const stream = useEdwardStream()
    await stream.start()
    expect(edward.error).toMatch(/rate-limiting/i)
    const afterSeed = homeList.mock.calls.length
    // one strike: the next try is 2× the calm interval (24s), not the calm 12s
    await vi.advanceTimersByTimeAsync(12_500)
    expect(homeList.mock.calls.length).toBe(afterSeed)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(homeList.mock.calls.length).toBeGreaterThan(afterSeed)
    stream.stop()
  })
})

describe('edward store mergeNewer', () => {
  it('keeps the selected post when newer posts push the oldest out', () => {
    const batchStatuses = batch(1, 3)
    edward.replaceStatuses(batchStatuses)
    const selected = edward.statuses[1]!
    const identity = selected.uri!
    edward.selectedIdentity = identity
    edward.mergeNewer(batch(10, 5))
    expect(edward.selectedStatus?.id).toBe(selected.id)
  })
})

describe('useEdwardRecessRestore', () => {
  it('un-recesses Edward whenever the compose sheet closes, however it closed', async () => {
    const sheet = useComposeSheetStore()
    const stop = useEdwardRecessRestore()
    sheet.open = true
    edward.setRecessed(true)
    await nextTick()
    expect(edward.recessed).toBe(true)
    sheet.open = false
    await nextTick()
    expect(edward.recessed).toBe(false)
    stop()
  })
})
