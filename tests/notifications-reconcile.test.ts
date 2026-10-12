import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { useNotificationsStore } from '../app/stores/notifications'

const clearResult: Record<string, () => Promise<void>> = {}

vi.mock('~/composables/useMasto', () => ({
  clientFor: (id: string) => ({
    v1: { notifications: { clear: () => clearResult[id]!() } },
  }),
  activeClient: vi.fn(),
  activeCredentials: vi.fn(),
  publicClient: vi.fn(),
}))

const account = (id: string) =>
  ({ id, url: `https://${id}.example`, accessToken: `tok-${id}`, user: { id, acct: id } }) as never

const row = (id: string, instance: string) =>
  ({ id, type: 'mention', _instanceId: instance, createdAt: '2026-01-01T00:00:00Z' }) as never

describe('notifications unread reconciliation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [account('a'), account('b')]
    instances.activeAccountId = 'a'
    for (const k of Object.keys(clearResult)) delete clearResult[k]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('counts unread rows per account', () => {
    const store = useNotificationsStore()
    store.notifications = [row('5', 'a'), row('6', 'a'), row('7', 'b')]
    store.lastReadByInstance = { a: '5' }
    expect(store.localUnreadFor('a')).toBe(1)
    expect(store.localUnreadFor('b')).toBe(1)
  })

  it('keeps the server count when it exceeds the loaded rows', () => {
    const store = useNotificationsStore()
    store.filter = 'all'
    store.notifications = [row('5', 'a'), row('6', 'b')]
    store.badgeByInstance = { a: 120, b: 30 }
    store.reconcileUnreadWithList()
    expect(store.unreadCount).toBe(150)
  })

  it('falls back to counting rows when the server count is unknown', () => {
    const store = useNotificationsStore()
    store.filter = 'all'
    store.notifications = [row('5', 'a'), row('6', 'b')]
    store.badgeByInstance = {}
    store.reconcileUnreadWithList()
    expect(store.unreadCount).toBe(2)
  })

  it('shifts the badge when unread rows leave and come back', () => {
    const store = useNotificationsStore()
    store.filter = 'all'
    store.badgeByInstance = { a: 40, b: 10 }
    store.unreadCount = 50
    const gone = [row('5', 'a')]
    store.adjustUnread(gone, -1)
    expect(store.unreadCount).toBe(49)
    expect(store.badgeByInstance.a).toBe(39)
    store.adjustUnread(gone, 1)
    expect(store.unreadCount).toBe(50)
    expect(store.badgeByInstance.a).toBe(40)
  })
})

describe('clearAll', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [account('a'), account('b')]
    instances.activeAccountId = 'a'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reports which hosts failed and keeps their rows', async () => {
    clearResult.a = async () => {}
    clearResult.b = async () => {
      throw new Error('nope')
    }
    const store = useNotificationsStore()
    store.notifications = [row('1', 'a'), row('2', 'b')]
    const res = await store.clearAll()
    expect(res.failedHosts).toEqual(['b.example'])
    expect(store.notifications.map((n) => n._instanceId)).toEqual(['b'])
  })

  it('restores everything and throws when every account fails', async () => {
    clearResult.a = async () => {
      throw new Error('x')
    }
    clearResult.b = async () => {
      throw new Error('y')
    }
    const store = useNotificationsStore()
    store.notifications = [row('1', 'a'), row('2', 'b')]
    await expect(store.clearAll()).rejects.toThrow()
    expect(store.notifications).toHaveLength(2)
  })
})
