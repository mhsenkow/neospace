import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { useConversationsStore } from '../app/stores/conversations'

const list = vi.fn()
const readFn = vi.fn()

vi.mock('~/composables/useMasto', () => {
  const client = {
    v1: {
      conversations: {
        list: (params: unknown) => list(params),
        $select: (id: string) => ({ read: () => readFn(id), remove: vi.fn() }),
      },
    },
  }
  return { clientFor: () => client, activeClient: () => client, publicClient: vi.fn(), activeCredentials: vi.fn() }
})

const account = (id: string) =>
  ({ id, url: `https://${id}.example`, accessToken: `tok-${id}`, user: { id, acct: id } }) as never

const convo = (id: string, opts: { unread?: boolean; accounts?: string[]; last?: string } = {}) =>
  ({
    id,
    unread: !!opts.unread,
    accounts: (opts.accounts ?? ['x']).map((a) => ({ id: a })),
    lastStatus: opts.last ? { id: opts.last } : null,
  }) as never

const page = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => convo(String(from - i)))

describe('conversations store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [account('a'), account('b')]
    instances.activeAccountId = 'a'
    list.mockReset()
    readFn.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('page-1 refresh keeps the already-loaded older tail', async () => {
    const store = useConversationsStore()
    list.mockResolvedValueOnce(page(200, 40))
    await store.fetchConversations({ force: true })
    list.mockResolvedValueOnce(page(300, 40)) // loadMore
    store.hasMore = true
    await store.loadMore()
    expect(store.conversations).toHaveLength(80)

    // refresh: newest page replaces its own rows, the tail stays
    list.mockResolvedValueOnce([convo('250'), ...page(200, 39)])
    await store.fetchConversations({ force: true })
    expect(store.conversations[0]!.id).toBe('250')
    expect(store.conversations.some((c) => c.id === '161')).toBe(true)
  })

  it('switching accounts clears the previous inbox before showing the new one', async () => {
    const store = useConversationsStore()
    list.mockResolvedValueOnce([convo('1'), convo('2')])
    await store.fetchConversations({ force: true })
    expect(store.conversations).toHaveLength(2)

    useInstancesStore().activeAccountId = 'b'
    list.mockResolvedValueOnce([convo('9')])
    await store.fetchConversations({ force: true })
    expect(store.conversations.map((c) => c.id)).toEqual(['9'])
  })

  it('markReadForThread marks only the exact participant set unread conversation read', async () => {
    const store = useConversationsStore()
    store.conversations = [
      convo('g', { unread: true, accounts: ['alice', 'bob'] }),
      convo('o', { unread: true, accounts: ['alice'] }),
    ]
    readFn.mockResolvedValue({ ...store.conversations[1], unread: false })
    await store.markReadForThread({ statusIds: [], accountIds: ['alice'] })
    expect(readFn).toHaveBeenCalledTimes(1)
    expect(readFn).toHaveBeenCalledWith('o')
    expect(store.conversations.find((c) => c.id === 'g')!.unread).toBe(true)
  })

  it('markReadForThread prefers the conversation whose last message is in the thread', async () => {
    const store = useConversationsStore()
    store.conversations = [
      convo('one', { unread: true, accounts: ['alice'] }),
      convo('two', { unread: true, accounts: ['carol'], last: 's2' }),
    ]
    readFn.mockResolvedValue({ ...store.conversations[1], unread: false })
    await store.markReadForThread({ statusIds: ['s1', 's2'], accountIds: ['alice'] })
    expect(readFn).toHaveBeenCalledWith('two')
  })

  it('findDirectWith never returns a group thread', () => {
    const store = useConversationsStore()
    store.conversations = [convo('g', { accounts: ['alice', 'bob'] })]
    expect(store.findDirectWith('alice')).toBeNull()
    store.conversations = [convo('d', { accounts: ['alice'] })]
    expect(store.findDirectWith('alice')?.id).toBe('d')
  })

  it('remove drops the row optimistically', async () => {
    const store = useConversationsStore()
    store.conversations = [convo('1'), convo('2'), convo('3')]
    const c = store as unknown as { remove(id: string): Promise<void> }
    await c.remove('2')
    expect(store.conversations.map((x) => x.id)).toEqual(['1', '3'])
  })
})
