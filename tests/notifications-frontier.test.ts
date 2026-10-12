import { describe, expect, it } from 'vitest'
import { notificationFrontier, withinFrontier } from '../app/utils/notifHelpers'

const r = (id: string, instance: string, ts: number) => ({ id, _instanceId: instance, _tsMs: ts })

describe('notification merge frontier', () => {
  // busy account b: last hour; quiet account a: a month-old row. Both fetched page 1; b has more pages.
  const rows = [r('b3', 'b', 3000), r('b2', 'b', 2000), r('b1', 'b', 1000), r('a1', 'a', 10)]

  it('holds the quiet account’s old row while the busy account has older pages', () => {
    expect(notificationFrontier(rows, { a: false, b: true })).toBe(1000)
    expect(withinFrontier(rows, { a: false, b: true }).map((x) => x.id)).toEqual(['b3', 'b2', 'b1'])
  })

  it('shows everything once no account has older pages', () => {
    expect(notificationFrontier(rows, { a: false, b: false })).toBeNull()
    expect(withinFrontier(rows, { a: false, b: false })).toBe(rows)
  })

  it('uses the newest oldest-row when several accounts still page', () => {
    expect(notificationFrontier(rows, { a: true, b: true })).toBe(1000)
  })

  it('treats unknown accounts as fully loaded', () => {
    expect(withinFrontier(rows, {})).toBe(rows)
  })

  it('releases held rows after the next page lowers the frontier', () => {
    const next = [...rows, r('b0', 'b', 5)]
    // b is now exhausted: the month-old a1 sits between nothing it owes anymore
    expect(withinFrontier(next, { a: false, b: false })).toHaveLength(5)
  })
})
