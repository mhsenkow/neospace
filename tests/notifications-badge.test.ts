import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { parseUnreadCount, useNotificationsStore } from '../app/stores/notifications'

const counts: Record<string, () => unknown> = {}

vi.mock('~/composables/useMasto', () => ({
  clientFor: (id: string) => ({
    v1: { notifications: { unreadCount: { fetch: async () => counts[id]!() } } },
  }),
  activeClient: vi.fn(),
  activeCredentials: vi.fn(),
  publicClient: vi.fn(),
}))

const account = (id: string) =>
  ({ id, url: `https://${id}.example`, accessToken: `tok-${id}`, user: { id, acct: id } }) as never

describe('parseUnreadCount', () => {
  it('accepts only finite non-negative integers', () => {
    expect(parseUnreadCount(0)).toBe(0)
    expect(parseUnreadCount(12)).toBe(12)
    for (const bad of [NaN, Infinity, -Infinity, -1, 1.5, '3', null, undefined, {}, [3]]) {
      expect(parseUnreadCount(bad)).toBeNull()
    }
  })
})

describe('notifications unread badge', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [account('a'), account('b')]
    instances.activeAccountId = 'a'
    for (const k of Object.keys(counts)) delete counts[k]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('sums healthy accounts', async () => {
    counts.a = () => ({ count: 2 })
    counts.b = () => ({ count: 3 })
    const store = useNotificationsStore()
    await store.refreshUnreadBadge()
    expect(store.unreadCount).toBe(5)
    expect(store.badgeLabel).toBe('5')
  })

  it.each([
    ['missing', {}],
    ['string', { count: '4' }],
    ['NaN', { count: NaN }],
    ['negative', { count: -3 }],
    ['infinite', { count: Infinity }],
    ['null body', null],
  ])('a %s count from one account never reaches the badge', async (_name, bad) => {
    counts.a = () => ({ count: 2 })
    counts.b = () => bad
    const store = useNotificationsStore()
    await store.refreshUnreadBadge()
    expect(store.unreadCount).toBe(2)
    expect(store.badgeLabel).toBe('2')
  })

  it('keeps an account’s last good count when a later response is malformed', async () => {
    counts.a = () => ({ count: 2 })
    counts.b = () => ({ count: 3 })
    const store = useNotificationsStore()
    await store.refreshUnreadBadge()

    counts.b = () => ({ count: NaN })
    await store.refreshUnreadBadge()
    expect(store.unreadCount).toBe(5)

    // …but a valid answer (even zero) replaces it
    counts.b = () => ({ count: 0 })
    await store.refreshUnreadBadge()
    expect(store.unreadCount).toBe(2)
  })

  it('never renders NaN, even if the count is corrupted elsewhere', () => {
    const store = useNotificationsStore()
    store.unreadCount = NaN
    expect(store.badgeLabel).toBe('')
  })
})
