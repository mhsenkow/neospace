import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEdwardStore } from '../app/stores/edward'
import { useGroupsStore } from '../app/stores/groups'
import { buildDeletedStatusEvent } from '../app/utils/deletedStatus'
import type { ExtendedStatus } from '../app/stores/instances'

const status = (id: string, host = 'a.example') =>
  ({
    id,
    uri: `https://${host}/statuses/${id}`,
    url: `https://${host}/@u/${id}`,
    createdAt: new Date(2026, 0, 1, 0, 0, Number(id)).toISOString(),
    content: `<p>${id}</p>`,
    account: { id: 'x', acct: 'u', username: 'u', displayName: 'u' },
    mediaAttachments: [],
    tags: [],
    mentions: [],
  }) as unknown as ExtendedStatus

const event = (id: string) =>
  buildDeletedStatusEvent(status(id), { id: 'a', url: 'https://a.example' })

describe('deleted posts leave every surface', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('Edward: drops the post from the stage and clears the selection', () => {
    const edward = useEdwardStore()
    edward.replaceStatuses([status('1'), status('2'), status('3')])
    edward.selectedIdentity = edward.statuses[1]!.uri!
    edward.removeDeletedStatus(event('2'))
    expect(edward.statuses.map((s) => s.id)).toEqual(['1', '3'])
    expect(edward.selectedIdentity).toBeNull()
  })

  it('Edward: leaves everything alone when the copy is not on stage', () => {
    const edward = useEdwardStore()
    edward.replaceStatuses([status('1')])
    const before = edward.statuses
    edward.removeDeletedStatus(event('9'))
    expect(edward.statuses).toBe(before)
  })

  it('Groups: drops it from the open group timeline, but not a same-id post on another server', () => {
    const groups = useGroupsStore()
    groups.groupTimeline = [status('1'), status('2'), status('2', 'b.example')] as never
    groups.removeDeletedStatus(event('2'))
    expect(groups.groupTimeline.map((s) => `${s.id}@${new URL(s.uri!).host}`)).toEqual([
      '1@a.example',
      '2@b.example',
    ])
  })
})
