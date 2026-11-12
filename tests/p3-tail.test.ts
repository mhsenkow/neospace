import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  formatNameList,
  isNoteToSelf,
  participantLabel,
  shouldShowBubbleMeta,
} from '../app/utils/dmHelpers'
import { collapseConsecutiveNotifications } from '../app/utils/notifGroup'
import { notifIconName, notifLabel } from '../app/utils/notifHelpers'
import { localDayKey } from '../app/utils/calendarDay'
import { useInstancesStore } from '../app/stores/instances'
import { useNotificationsStore } from '../app/stores/notifications'

const listRaw = vi.fn()
const markersFetch = vi.fn()

vi.mock('~/composables/useMasto', () => ({
  clientFor: () => ({
    v1: {
      notifications: {
        list: { $raw: (...args: unknown[]) => listRaw(...args) },
      },
      markers: { fetch: (...args: unknown[]) => markersFetch(...args) },
    },
  }),
  activeClient: vi.fn(),
  activeCredentials: vi.fn(),
  publicClient: vi.fn(),
}))

const account = (id: string) =>
  ({ id, url: `https://${id}.example`, accessToken: `tok-${id}`, user: { id, acct: id } }) as never

describe('participant labels (NS-669/684/685)', () => {
  it('joins two names with a locale list, and compact-truncates 3+', () => {
    const two = formatNameList(['Ada', 'Bea'])
    expect(two).toContain('Ada')
    expect(two).toContain('Bea')
    expect(formatNameList(['Ada', 'Bea', 'Cam'])).toBe('Ada +2')
    expect(formatNameList(['Ada'])).toBe('Ada')
    expect(formatNameList([])).toBe('')
  })

  it('labels an empty-accounts conversation as Note to self', () => {
    expect(isNoteToSelf({ accounts: [] })).toBe(true)
    expect(participantLabel({ accounts: [] } as never)).toBe('Note to self')
    expect(participantLabel({ accounts: [{ displayName: 'Ada', username: 'ada' }] } as never)).toBe(
      'Ada',
    )
  })
})

describe('DM bubble meta (NS-671)', () => {
  it('re-shows meta after a day break or a 1h+ gap', () => {
    expect(
      shouldShowBubbleMeta({
        mine: false,
        isFirst: false,
        dayChanged: true,
        prevSameSpeaker: true,
        gapMs: 1000,
      }),
    ).toBe(true)
    expect(
      shouldShowBubbleMeta({
        mine: false,
        isFirst: false,
        dayChanged: false,
        prevSameSpeaker: true,
        gapMs: 61 * 60_000,
      }),
    ).toBe(true)
    expect(
      shouldShowBubbleMeta({
        mine: false,
        isFirst: false,
        dayChanged: false,
        prevSameSpeaker: true,
        gapMs: 10 * 60_000,
      }),
    ).toBe(false)
    expect(
      shouldShowBubbleMeta({
        mine: true,
        isFirst: true,
        dayChanged: true,
        prevSameSpeaker: false,
        gapMs: 0,
      }),
    ).toBe(false)
  })
})

describe('notif grouping + copy (NS-686/689/700)', () => {
  it('collapses consecutive follows from the same instance', () => {
    const rows = collapseConsecutiveNotifications([
      { type: 'follow', createdAt: 't', _key: 'i:1', _instanceId: 'i' },
      { type: 'follow', createdAt: 't', _key: 'i:2', _instanceId: 'i' },
      { type: 'follow', createdAt: 't', _key: 'j:3', _instanceId: 'j' },
      { type: 'follow_request', createdAt: 't', _key: 'i:4', _instanceId: 'i' },
    ])
    expect(rows).toHaveLength(3)
    expect(rows[0]!._groupCount).toBe(2)
    expect(rows[1]!._groupCount).toBe(1)
    expect(rows[2]!.type).toBe('follow_request')
  })

  it('labels quoted_update and actorless server notices', () => {
    expect(notifLabel('quoted_update')).toBe('edited a post you quoted')
    expect(notifIconName('quoted_update')).toBe('edit')
    expect(notifLabel('severed_relationships')).toMatch(/severed/i)
    expect(notifLabel('moderation_warning')).toMatch(/moderation/i)
    expect(notifLabel('annual_report')).toMatch(/annual report/i)
  })
})

describe('notifications store P3 tail (NS-687/688/700)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [account('a')]
    instances.activeAccountId = 'a'
    listRaw.mockReset()
    markersFetch.mockReset()
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
  })

  const tagged = (id: string, ts: number, type = 'mention') => ({
    id,
    type,
    createdAt: new Date(ts).toISOString(),
    _key: `a:${id}`,
    _instanceId: 'a',
    _tsMs: ts,
  })

  it('groupedByTime with oldest keeps calendar buckets and orders rows oldest-first', () => {
    const store = useNotificationsStore()
    const now = Date.now()
    store.sortOrder = 'oldest'
    store.notifications = [
      tagged('3', now, 'mention'),
      tagged('2', now - 3600_000, 'mention'),
      tagged('1', now - 10 * 86_400_000, 'mention'),
    ] as never
    const groups = store.groupedByTime
    expect(Object.keys(groups)).toEqual(expect.arrayContaining(['Today', 'Older']))
    const today = groups.Today || []
    expect(today.map((n) => n.id)).toEqual(['2', '3'])
    expect(groups.Older?.map((n) => n.id)).toEqual(['1'])
  })

  it('first fetch without a server marker leaves last-read unset', async () => {
    listRaw.mockResolvedValue({
      data: [
        {
          id: '99',
          type: 'mention',
          createdAt: '2026-11-12T12:00:00Z',
          account: { id: 'u', username: 'u', acct: 'u' },
        },
      ],
      headers: new Headers(),
    })
    markersFetch.mockResolvedValue(null)
    const store = useNotificationsStore()
    await store.fetchNotifications()
    expect(store.lastReadByInstance.a).toBeUndefined()
    expect(store.notifications).toHaveLength(1)
    expect(store.isUnread(store.notifications[0]!)).toBe(true)
  })

  it('localDayKey is stable within a local calendar day', () => {
    const d = new Date(2026, 10, 12, 23, 50)
    expect(localDayKey(d)).toBe(localDayKey(new Date(2026, 10, 12, 0, 5)))
    expect(localDayKey(d)).not.toBe(localDayKey(new Date(2026, 10, 13, 0, 5)))
  })
})

describe('prepaint rail (NS-615)', () => {
  it('does not write an inline --neo-sidebar-width', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../public/boot/prepaint.js'), 'utf8')
    expect(src).not.toContain('--neo-sidebar-width')
    expect(src).toContain("root.setAttribute('data-rail'")
  })
})
