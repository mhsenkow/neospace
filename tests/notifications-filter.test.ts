import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import {
  badgePollDelay,
  typesForFilter,
  useNotificationsStore,
} from '../app/stores/notifications'

const listCalls: Record<string, unknown>[] = []
const unread = { count: 0, fail: false }

vi.mock('~/composables/useMasto', () => ({
  clientFor: () => ({
    v1: {
      notifications: {
        list: Object.assign(async () => [], {
          $raw: async (params: Record<string, unknown>) => {
            listCalls.push(params)
            return { data: [], headers: new Headers() }
          },
        }),
        unreadCount: {
          fetch: async () => {
            if (unread.fail) throw new Error('down')
            return { count: unread.count }
          },
        },
      },
      markers: { fetch: async () => ({}) },
    },
  }),
  activeClient: vi.fn(),
  activeCredentials: vi.fn(),
  publicClient: vi.fn(),
}))

const account = (id: string) =>
  ({ id, url: `https://${id}.example`, accessToken: `tok-${id}`, user: { id, acct: id } }) as never

describe('notification filters go to the server', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [account('a')]
    instances.activeAccountId = 'a'
    listCalls.length = 0
    unread.count = 0
    unread.fail = false
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('maps tabs to types[]', () => {
    expect(typesForFilter('all')).toBeUndefined()
    expect(typesForFilter('mention')).toEqual(['mention'])
    expect(typesForFilter('follow')).toEqual(['follow', 'follow_request'])
  })

  it('sends the active filter as types[] and omits it for All', async () => {
    const store = useNotificationsStore()
    store.setFilter('mention')
    await store.fetchNotifications(true)
    expect(listCalls.at(-1)).toMatchObject({ limit: 30, types: ['mention'] })
    store.setFilter('all')
    await store.fetchNotifications(true)
    expect(listCalls.at(-1)).not.toHaveProperty('types')
  })

  it('a filtered list never replaces the server unread badge', async () => {
    unread.count = 7
    const store = useNotificationsStore()
    await store.refreshUnreadBadge()
    store.setFilter('poll')
    await store.fetchNotifications(true)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(store.unreadCount).toBe(7)
  })
})

describe('badge poll backoff', () => {
  it('stays at one minute while healthy, doubles when failing, and is capped', () => {
    expect(badgePollDelay(0)).toBe(60_000)
    expect(badgePollDelay(1)).toBe(120_000)
    expect(badgePollDelay(2)).toBe(240_000)
    expect(badgePollDelay(10)).toBe(300_000)
  })

  it('reports failure so the poll can back off', async () => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [account('a')]
    instances.activeAccountId = 'a'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useNotificationsStore()
    unread.fail = false
    unread.count = 1
    expect(await store.refreshUnreadBadge()).toBe(true)
    unread.fail = true
    expect(await store.refreshUnreadBadge()).toBe(false)
  })
})
