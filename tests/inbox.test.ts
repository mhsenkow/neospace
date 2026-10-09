import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  buildDirectBody,
  normalizeRecipientAccts,
  safeHttpUrl,
  stripLeadingMentionText,
  textMentionsAcct,
} from '../app/utils/dmHelpers'
import { collapseConsecutiveNotifications } from '../app/utils/notifGroup'

const markerCreate = vi.fn()
const dismiss = vi.fn()

vi.mock('../app/composables/useMasto', () => ({
  activeClient: () => {
    throw new Error('not used')
  },
  clientFor: (instanceId: string) => ({
    v1: {
      markers: { create: (params: unknown) => markerCreate(instanceId, params) },
      notifications: { $select: (id: string) => ({ dismiss: () => dismiss(instanceId, id) }) },
    },
  }),
}))

describe('direct message payload', () => {
  it('prepends every recipient the text does not mention', () => {
    expect(buildDirectBody('hey there', ['alice', 'bob@remote.social'])).toBe(
      '@alice @bob@remote.social hey there',
    )
  })

  it('does not duplicate recipients already mentioned (any case, any position)', () => {
    expect(buildDirectBody('@Alice hi', ['alice'])).toBe('@Alice hi')
    expect(buildDirectBody('hi @bob@Remote.Social!', ['bob@remote.social'])).toBe(
      'hi @bob@Remote.Social!',
    )
  })

  it('treats a different account with the same prefix as not mentioned', () => {
    // @bobby, and a remote bob, are other people — local bob would be dropped
    expect(buildDirectBody('@bobby hi', ['bob'])).toBe('@bob @bobby hi')
    expect(buildDirectBody('@bob@other.host hi', ['bob'])).toBe('@bob @bob@other.host hi')
    expect(buildDirectBody('@bob@host.evil hi', ['bob@host'])).toBe('@bob@host @bob@host.evil hi')
  })

  it('ignores handles inside URLs and email addresses', () => {
    expect(buildDirectBody('see https://x.social/@bob', ['bob'])).toBe(
      '@bob see https://x.social/@bob',
    )
    expect(textMentionsAcct('mail me@bob.example', 'bob')).toBe(false)
  })

  it('sends mentions only when the text is empty (media-only message)', () => {
    expect(buildDirectBody('   ', ['alice', 'bob'])).toBe('@alice @bob')
    expect(buildDirectBody('', [])).toBe('')
  })

  it('normalizes recipients: strips @, trims, de-dupes case-insensitively, drops junk', () => {
    expect(normalizeRecipientAccts(['@Alice', 'alice', ' bob@x.social ', '', null, 'a b'])).toEqual([
      'Alice',
      'bob@x.social',
    ])
  })
})

describe('DM preview text', () => {
  it('drops leading participant mentions, including the username-only remote form', () => {
    expect(stripLeadingMentionText('@bob @me hello', ['bob@remote.social', 'me'])).toBe('hello')
  })

  it('keeps mentions of non-participants and mid-text mentions', () => {
    expect(stripLeadingMentionText('@carol hi @bob', ['bob'])).toBe('@carol hi @bob')
  })
})

describe('safeHttpUrl', () => {
  it('allows http(s) and rejects script/data URLs and junk', () => {
    expect(safeHttpUrl('https://a.social/@x/1')).toBe('https://a.social/@x/1')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,hi')).toBeNull()
    expect(safeHttpUrl('not a url')).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
  })
})

describe('notification grouping across pages', () => {
  const n = (id: string, type: string, statusId: string | null) => ({
    id,
    type,
    createdAt: '2026-10-01T00:00:00Z',
    status: statusId ? { id: statusId } : null,
    _instanceId: 'i',
    _key: `i:${id}`,
  })

  it('re-collapsing the merged list joins a group split by the page boundary', () => {
    const page1 = [n('120', 'favourite', '9'), n('119', 'favourite', '9')]
    const page2 = [n('99', 'favourite', '9'), n('98', 'follow', null), n('97', 'follow', null)]
    const rows = collapseConsecutiveNotifications([...page1, ...page2])
    expect(rows).toHaveLength(3)
    expect(rows[0]!._groupCount).toBe(3)
    expect(rows[0]!._groupedKeys).toEqual(['i:119', 'i:99'])
    // Follows have no status — never folded together
    expect(rows[1]!._groupCount).toBe(1)
    expect(rows[2]!._groupCount).toBe(1)
  })
})

describe('notifications store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    markerCreate.mockReset().mockResolvedValue({})
    dismiss.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
  })

  const tagged = (instanceId: string, id: string, ts: number, type = 'mention') => ({
    id,
    type,
    createdAt: new Date(ts).toISOString(),
    _key: `${instanceId}:${id}`,
    _instanceId: instanceId,
    _tsMs: ts,
  })

  it('marks read up to the highest id per account (string ids, not lexical)', async () => {
    const { useNotificationsStore } = await import('../app/stores/notifications')
    const store = useNotificationsStore()
    // Same timestamp — "100" must still win over "99"
    store.notifications = [
      tagged('a', '99', 1000),
      tagged('a', '100', 1000),
      tagged('b', '5', 900),
    ] as never
    await store.markAllRead()
    expect(markerCreate).toHaveBeenCalledWith('a', { notifications: { lastReadId: '100' } })
    expect(markerCreate).toHaveBeenCalledWith('b', { notifications: { lastReadId: '5' } })
    expect(store.lastReadByInstance).toEqual({ a: '100', b: '5' })
    expect(store.unreadCount).toBe(0)
  })

  it('never moves a read marker backwards and leaves the badge alone when nothing is loaded', async () => {
    const { useNotificationsStore } = await import('../app/stores/notifications')
    const store = useNotificationsStore()
    store.lastReadByInstance = { a: '200' }
    store.notifications = [tagged('a', '150', 1000)] as never
    await store.markAllRead()
    expect(markerCreate).not.toHaveBeenCalled()

    store.notifications = []
    store.unreadCount = 4
    await store.markAllRead()
    expect(store.unreadCount).toBe(4)
  })

  it('dismissing a grouped row restores only the rows the server refused', async () => {
    const { useNotificationsStore } = await import('../app/stores/notifications')
    const store = useNotificationsStore()
    store.notifications = [
      tagged('a', '3', 3000),
      tagged('a', '2', 2000),
      tagged('a', '1', 1000),
    ] as never
    dismiss.mockImplementation(async (_inst: string, id: string) => {
      if (id === '2') throw new Error('nope')
    })
    await expect(store.dismissNotifications(['a:3', 'a:2'])).rejects.toThrow('nope')
    expect(store.notifications.map((x) => x.id)).toEqual(['2', '1'])
  })
})
