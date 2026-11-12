import { describe, expect, it } from 'vitest'
import {
  DM_RECIPIENT_LIMIT,
  addDmRecipient,
  dmConfirmLabel,
  groupDirectCompose,
  recipientRemoveLabel,
  removeDmRecipient,
} from '../app/utils/dmRecipients'

const person = (id: string, acct = id) => ({ id, acct, displayName: id })

describe('dm recipient chips', () => {
  it('adds people in pick order and ignores a second pick of the same id', () => {
    const first = addDmRecipient([], person('1', 'alice'))
    const second = addDmRecipient(first.selected, person('2', 'bob@remote.social'))
    const again = addDmRecipient(second.selected, person('1', 'alice'))
    expect(first.added).toBe(true)
    expect(second.selected.map((a) => a.id)).toEqual(['1', '2'])
    expect(again.added).toBe(false)
    expect(again.reason).toBe('duplicate')
    expect(again.selected).toHaveLength(2)
  })

  it('stops at 8 people', () => {
    let selected = [] as { id: string; acct: string }[]
    for (let i = 0; i < DM_RECIPIENT_LIMIT; i++) {
      const next = addDmRecipient(selected, person(String(i)))
      expect(next.added).toBe(true)
      selected = next.selected
    }
    const overflow = addDmRecipient(selected, person('extra'))
    expect(overflow.added).toBe(false)
    expect(overflow.reason).toBe('limit')
    expect(overflow.selected).toHaveLength(DM_RECIPIENT_LIMIT)
  })

  it('removes only the requested chip', () => {
    const selected = [person('1'), person('2'), person('3')]
    expect(removeDmRecipient(selected, '2').map((a) => a.id)).toEqual(['1', '3'])
    expect(removeDmRecipient(selected, 'missing')).toHaveLength(3)
  })

  it('names the confirm button for one person and for a group', () => {
    expect(dmConfirmLabel(0)).toBe('Message')
    expect(dmConfirmLabel(1)).toBe('Message')
    expect(dmConfirmLabel(2)).toBe('Message 2 people')
    expect(dmConfirmLabel(8)).toBe('Message 8 people')
  })

  it('uses the display name in the remove button name', () => {
    expect(recipientRemoveLabel({ displayName: 'Ada Lovelace', username: 'ada' })).toBe(
      'Remove Ada Lovelace',
    )
    expect(recipientRemoveLabel({ displayName: '  ', username: 'ada' })).toBe('Remove ada')
  })
})

describe('group direct compose', () => {
  it('mentions every selected account on a direct post', () => {
    const opts = groupDirectCompose([
      { acct: '@Alice' },
      { acct: 'bob@remote.social' },
      { acct: 'alice' },
    ])
    expect(opts).toEqual({
      pickRecipient: false,
      visibility: 'direct',
      title: 'New message',
      placeholder: 'Write a private message…',
      initialText: '@Alice @bob@remote.social ',
      mentionAccts: ['Alice', 'bob@remote.social'],
    })
  })

  it('leaves a single usable acct on the 1:1 path', () => {
    expect(groupDirectCompose([{ acct: 'alice' }])).toBeNull()
    expect(groupDirectCompose([{ acct: 'alice' }, { acct: '' }, { acct: 'a b' }])).toBeNull()
    expect(groupDirectCompose([])).toBeNull()
  })
})
