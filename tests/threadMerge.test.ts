import { describe, expect, it } from 'vitest'
import { mergeThreadBranches } from '../app/utils/threadMerge'

const msg = (id: string, minute: number) => ({
  id,
  createdAt: new Date(Date.UTC(2026, 9, 12, 10, minute)).toISOString(),
})

describe('mergeThreadBranches', () => {
  it('shows the other branch of a group DM and splits around the focus', () => {
    const root = msg('1', 0)
    const mine = msg('2', 5) // focus: my answer to the root
    const theirs = msg('3', 3) // another person's answer to the same root
    const later = msg('4', 8) // reply to my answer
    const out = mergeThreadBranches(mine, {
      root,
      rootDescendants: [mine, theirs, later],
      ancestors: [root],
      descendants: [later],
    })
    expect(out.ancestors.map((s) => s.id)).toEqual(['1', '3'])
    expect(out.descendants.map((s) => s.id)).toEqual(['4'])
  })

  it('de-duplicates and never includes the focus post', () => {
    const root = msg('1', 0)
    const focus = msg('2', 1)
    const out = mergeThreadBranches(focus, {
      root,
      rootDescendants: [focus, msg('3', 2), msg('3', 2)],
      ancestors: [root],
      descendants: [msg('3', 2)],
    })
    expect([...out.ancestors, ...out.descendants].map((s) => s.id)).toEqual(['1', '3'])
  })

  it('orders same-minute posts by snowflake id (10 sorts after 9)', () => {
    const root = msg('8', 0)
    const focus = msg('10', 5)
    const out = mergeThreadBranches(focus, {
      root,
      rootDescendants: [msg('11', 5), msg('9', 5)],
      ancestors: [root],
      descendants: [],
    })
    expect(out.ancestors.map((s) => s.id)).toEqual(['8', '9'])
    expect(out.descendants.map((s) => s.id)).toEqual(['11'])
  })
})
