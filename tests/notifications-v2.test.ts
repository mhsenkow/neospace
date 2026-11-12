import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { useNotificationsStore } from '../app/stores/notifications'
import { collapseConsecutiveNotifications, groupActorLabel } from '../app/utils/notifGroup'
import { localDayKey } from '../app/utils/calendarDay'
import {
  notificationRowsFromGroups,
  notificationsV2IsUnsupported,
  notifLabel,
  resetNotificationsV2Support,
} from '../app/utils/notifHelpers'

const listRaw = vi.fn()
const markersFetch = vi.fn()
const v1Dismiss = vi.fn()

vi.mock('~/composables/useMasto', () => ({
  clientFor: () => ({
    v1: {
      notifications: {
        list: { $raw: (...args: unknown[]) => listRaw(...args) },
        $select: (id: string) => ({ dismiss: () => v1Dismiss(id) }),
        unreadCount: { fetch: async () => ({ count: 0 }) },
      },
      markers: { fetch: (...args: unknown[]) => markersFetch(...args) },
    },
  }),
  activeClient: vi.fn(),
  activeCredentials: vi.fn(),
  credentialsFor: vi.fn(),
  publicClient: vi.fn(),
}))

const account = (id: string) =>
  ({ id, url: `https://${id}.example`, accessToken: `tok-${id}`, user: { id, acct: id } }) as never

function favouriteGroup(count = 5) {
  return {
    notification_groups: [
      {
        group_key: 'favourite-99',
        notifications_count: count,
        type: 'favourite',
        most_recent_notification_id: '500',
        page_min_id: '400',
        page_max_id: '500',
        latest_page_notification_at: new Date().toISOString(),
        sample_account_ids: ['alice', 'bob'],
        status_id: '99',
      },
    ],
    accounts: [
      {
        id: 'alice',
        username: 'alice',
        acct: 'alice',
        display_name: 'Alice',
        avatar: 'https://cdn.example/alice.png',
        url: 'https://a.example/@alice',
      },
      {
        id: 'bob',
        username: 'bob',
        acct: 'bob',
        display_name: 'Bob',
        avatar: 'https://cdn.example/bob.png',
      },
    ],
    statuses: [
      {
        id: '99',
        content: '<p>hello post</p>',
        url: 'https://a.example/@me/99',
        uri: 'https://a.example/users/me/statuses/99',
        in_reply_to_id: null,
        media_attachments: [
          {
            id: 'm',
            type: 'image',
            url: 'https://cdn.example/full.jpg',
            preview_url: 'https://cdn.example/prev.jpg',
          },
        ],
      },
    ],
  }
}

describe('v2 notification groups', () => {
  it('collapses a favourite group to one row and leaves the count alone', () => {
    const rows = notificationRowsFromGroups(favouriteGroup(5))
    expect(rows).toHaveLength(1)
    expect(rows![0]).toMatchObject({
      id: '500',
      type: 'favourite',
      groupKey: 'favourite-99',
      _groupKey: 'favourite-99',
      _serverGroupCount: 5,
      _pageMinId: '400',
      account: { displayName: 'Alice', avatar: 'https://cdn.example/alice.png' },
    })
    const status = rows![0]!.status as { mediaAttachments?: { previewUrl?: string }[] }
    expect(status.mediaAttachments?.[0]?.previewUrl).toBe('https://cdn.example/prev.jpg')

    const collapsed = collapseConsecutiveNotifications([
      { ...rows![0], _instanceId: 'a', _key: 'a:500' },
      {
        type: 'favourite',
        createdAt: rows![0]!.createdAt,
        status: { id: '99' },
        _instanceId: 'a',
        _key: 'a:1',
      },
    ])
    expect(collapsed).toHaveLength(2)
    expect(collapsed[0]!._groupCount).toBe(5)
    expect(collapsed[0]!._groupedKeys).toEqual([])
    expect(groupActorLabel('Alice', collapsed[0]!._groupCount)).toBe('Alice and 4 others')
    expect(notifLabel('favourite')).toBe('liked your post')
  })

  it('still folds consecutive ungrouped rows of the same post', () => {
    const rows = notificationRowsFromGroups({
      notification_groups: [
        {
          group_key: 'ungrouped-2',
          notifications_count: 1,
          type: 'favourite',
          most_recent_notification_id: '2',
          sample_account_ids: ['1'],
          status_id: '9',
          latest_page_notification_at: '2026-11-12T12:00:00Z',
        },
        {
          group_key: 'ungrouped-1',
          notifications_count: 1,
          type: 'favourite',
          most_recent_notification_id: '1',
          sample_account_ids: ['1'],
          status_id: '9',
          latest_page_notification_at: '2026-11-12T12:00:00Z',
        },
      ],
      accounts: [{ id: '1', username: 'alice', display_name: 'Alice' }],
      statuses: [{ id: '9', content: 'x' }],
    })
    expect(rows).toHaveLength(2)
    expect(rows!.every((row) => row._groupKey === undefined)).toBe(true)
    const collapsed = collapseConsecutiveNotifications(
      rows!.map((row) => ({ ...row, _instanceId: 'a', _key: `a:${row.id}` })),
    )
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]!._groupCount).toBe(2)
    expect(collapsed[0]!._groupedKeys).toEqual(['a:1'])
  })
})

describe('notifications store v2', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [account('a')]
    instances.activeAccountId = 'a'
    listRaw.mockReset()
    markersFetch.mockReset().mockResolvedValue(null)
    v1Dismiss.mockReset().mockResolvedValue(undefined)
    resetNotificationsV2Support()
  })

  afterEach(() => {
    resetNotificationsV2Support()
    vi.unstubAllGlobals()
  })

  it('shows one grouped row and dismisses it with a single request', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(null, { status: 200 })
      return new Response(JSON.stringify(favouriteGroup(5)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useNotificationsStore()
    store.setFilter('favourite')
    await store.fetchNotifications()

    expect(listRaw).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const listUrl = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(listUrl.pathname).toBe('/api/v2/notifications')
    expect(listUrl.searchParams.get('limit')).toBe('30')
    expect(listUrl.searchParams.getAll('types[]')).toEqual(['favourite'])
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok-a',
    })

    expect(store.notifications).toHaveLength(1)
    const row = store.collapsedNotifications[0]!
    expect(store.collapsedNotifications).toHaveLength(1)
    expect(row._groupCount).toBe(5)
    expect(row.account.displayName).toBe('Alice')
    expect(groupActorLabel(row.account.displayName, row._groupCount)).toBe('Alice and 4 others')
    expect(store.isUnread(row)).toBe(true)
    store.syncDayAnchor()
    expect(store.dayAnchor).toBe(localDayKey())
    expect(store.groupedByTime.Today?.map((n) => n.id)).toEqual(['500'])

    await store.dismissNotifications([row._key, ...(row._groupedKeys || [])])

    const posts = fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(String(posts[0]![0])).toBe('https://a.example/api/v2/notifications/favourite-99/dismiss')
    expect((posts[0]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-a' })
    expect(v1Dismiss).not.toHaveBeenCalled()
    expect(store.notifications).toHaveLength(0)
  })

  it('pages older groups with page_min_id / Link max_id', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(String(input))
      if (url.searchParams.get('max_id')) {
        return new Response(JSON.stringify({ notification_groups: [], accounts: [], statuses: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(favouriteGroup(5)), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          Link: '<https://a.example/api/v2/notifications?max_id=400>; rel="next"',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useNotificationsStore()
    await store.fetchNotifications()
    expect(store.hasMore).toBe(true)
    expect(store.cursors.a).toBe('400')

    await store.loadMore()
    const second = new URL(String(fetchMock.mock.calls[1]![0]))
    expect(second.searchParams.get('max_id')).toBe('400')
    expect(listRaw).not.toHaveBeenCalled()
    expect(store.hasMore).toBe(false)
  })

  it.each([404, 501])('HTTP %s falls back to v1 and is not retried', async (status) => {
    const fetchMock = vi.fn(async () => new Response('missing', { status }))
    vi.stubGlobal('fetch', fetchMock)
    listRaw.mockResolvedValue({
      data: [
        {
          id: '7',
          type: 'mention',
          createdAt: '2026-11-12T12:00:00.000Z',
          account: { id: 'u', username: 'u', acct: 'u', displayName: 'U' },
        },
      ],
      headers: new Headers(),
    })

    const store = useNotificationsStore()
    await store.fetchNotifications()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(listRaw).toHaveBeenCalledTimes(1)
    expect(listRaw.mock.calls[0]![0]).toEqual({ limit: 30 })
    expect(store.notifications.map((n) => n.id)).toEqual(['7'])
    expect(store.notifications[0]!._groupKey).toBeUndefined()
    expect(notificationsV2IsUnsupported('https://a.example')).toBe(true)
    expect(notificationsV2IsUnsupported('https://a.example/')).toBe(true)

    await store.fetchNotifications()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(listRaw).toHaveBeenCalledTimes(2)
  })

  it('a transient v2 failure falls back to v1 but is tried again next time', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    listRaw.mockResolvedValue({ data: [], headers: new Headers() })

    const store = useNotificationsStore()
    await store.fetchNotifications()
    await store.fetchNotifications()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(listRaw).toHaveBeenCalledTimes(2)
    expect(notificationsV2IsUnsupported('https://a.example')).toBe(false)
  })
})
