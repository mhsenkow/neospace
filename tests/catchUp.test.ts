import { describe, expect, it } from 'vitest'
import {
  catchUpForward,
  mergeCursors,
  nextGapSources,
  type CatchUpSource,
} from '../app/utils/catchUp'
import { compareId } from '../app/utils/compareId'

type S = { id: string }

/** Minimal Mastodon timeline: ids ascending in time, pages come back newest-first. */
const fakeServer = (firstId: number, count: number) => {
  const ids = Array.from({ length: count }, (_, i) => String(firstId + i))
  const calls: string[] = []
  return {
    ids,
    calls,
    /** `since_id`: the NEWEST `limit` statuses above the bound (the documented trap) */
    since: (sinceId: string, limit: number): S[] =>
      ids
        .filter((id) => compareId(id, sinceId) > 0)
        .slice(-limit)
        .reverse()
        .map((id) => ({ id })),
    /** `min_id`: the `limit` statuses immediately above the cursor */
    min: async (minId: string, limit: number): Promise<S[]> => {
      calls.push(minId)
      return ids
        .filter((id) => compareId(id, minId) > 0)
        .slice(0, limit)
        .reverse()
        .map((id) => ({ id }))
    },
  }
}

const source = (key: string, server: ReturnType<typeof fakeServer>, cursor: string): CatchUpSource<S> => ({
  key,
  cursor,
  fetchPage: server.min,
})

describe('timeline catch-up (NS-001)', () => {
  it('shows why advancing since_id to the newest result skips arrivals', () => {
    const server = fakeServer(1001, 75)
    // Old loop: page 1 = newest 20, then since_id := newest → nothing newer is left
    const first = server.since('1000', 20)
    const next = server.since(first[0]!.id, 20)
    expect(first).toHaveLength(20)
    expect(next).toHaveLength(0)
  })

  it('returns all 75 arrivals exactly once with forward min_id paging', async () => {
    const server = fakeServer(1001, 75)
    const result = await catchUpForward([source('a', server, '1000')], { pageLimit: 20, maxPages: 5 })

    const ids = result.items.map((s) => s.id)
    expect(ids).toHaveLength(75)
    expect(new Set(ids).size).toBe(75)
    expect([...ids].sort((a, b) => compareId(a, b))).toEqual(server.ids)
    expect(result.cursors).toEqual({ a: '1075' })
    expect(result.settled).toEqual(['a'])
    expect(result.capped).toEqual([])
    // 20 + 20 + 20 + 15: the short page ends the walk without an extra empty fetch
    expect(server.calls).toEqual(['1000', '1020', '1040', '1060'])
  })

  it('stops at the cap with the cursor advanced so the next poll resumes without loss', async () => {
    const server = fakeServer(1001, 130)
    const opts = { pageLimit: 20, maxPages: 3 }
    const seen: string[] = []

    let cursor = '1000'
    let gap: string[] = []
    for (let poll = 0; poll < 5; poll++) {
      const result = await catchUpForward([source('a', server, cursor)], opts)
      seen.push(...result.items.map((s) => s.id))
      cursor = result.cursors.a ?? cursor
      gap = nextGapSources(gap, result)
      if (!gap.length) break
      expect(result.capped).toEqual(['a'])
    }

    expect(seen).toHaveLength(130)
    expect(new Set(seen).size).toBe(130)
    expect(gap).toEqual([])
  })

  it('does not loop on a server whose pages never advance the cursor', async () => {
    let calls = 0
    const stuck: CatchUpSource<S> = {
      key: 'x',
      cursor: '500',
      fetchPage: async () => {
        calls++
        return Array.from({ length: 20 }, (_, i) => ({ id: String(400 + i) }))
      },
    }
    const result = await catchUpForward([stuck], { pageLimit: 20, maxPages: 5 })
    expect(calls).toBe(1)
    expect(result.settled).toEqual(['x'])
  })
})

describe('per-source exhaustion (NS-003)', () => {
  it('lets a quiet server settle while a busy one stays capped', async () => {
    const busy = fakeServer(2001, 100)
    const quiet = fakeServer(9001, 3)
    const result = await catchUpForward(
      [source('busy', busy, '2000'), source('quiet', quiet, '9000')],
      { pageLimit: 20, maxPages: 2 },
    )
    expect(result.capped).toEqual(['busy'])
    expect(result.settled).toEqual(['quiet'])
    expect(result.items.filter((s) => compareId(s.id, '5000') > 0)).toHaveLength(3)
    expect(result.cursors).toEqual({ busy: '2040', quiet: '9003' })
  })

  it('keeps a failed server’s cursor and still returns the others', async () => {
    const ok = fakeServer(101, 5)
    const down: CatchUpSource<S> = {
      key: 'down',
      cursor: '77',
      fetchPage: async () => {
        throw new Error('503')
      },
    }
    const result = await catchUpForward([source('ok', ok, '100'), down], { pageLimit: 20, maxPages: 5 })
    expect(result.items).toHaveLength(5)
    expect(result.failed).toEqual(['down'])
    expect(result.cursors).toEqual({ ok: '105' })
    expect(result.firstError).toBeInstanceOf(Error)
  })

  it('clears a gap only for the source that settled', () => {
    expect(nextGapSources(['busy', 'quiet'], { capped: ['busy'], settled: ['quiet'] })).toEqual(['busy'])
    expect(nextGapSources([], { capped: ['busy'], settled: [] })).toEqual(['busy'])
    // A failed poll neither clears nor adds
    expect(nextGapSources(['busy'], { capped: [], settled: [] })).toEqual(['busy'])
  })
})

describe('cursor commit (NS-002)', () => {
  it('never moves a cursor backwards and leaves the input untouched', () => {
    const current = { a: '120', b: '5' }
    const merged = mergeCursors(current, { a: '99', b: '9', c: '1' })
    expect(merged).toEqual({ a: '120', b: '9', c: '1' })
    expect(current).toEqual({ a: '120', b: '5' })
    // Digit length decides before lexical order ("99" < "100")
    expect(mergeCursors({ a: '99' }, { a: '100' }).a).toBe('100')
  })

  it('catch-up is pure: a stale result changes nothing until the caller commits it', async () => {
    const server = fakeServer(1001, 30)
    const committed = { a: '1000' }
    const snapshot = { ...committed }
    const result = await catchUpForward([source('a', server, committed.a)], { pageLimit: 20, maxPages: 5 })
    // Caller dropped this result (feed switched mid-poll) → its own cursors are unchanged
    expect(committed).toEqual(snapshot)
    expect(result.cursors.a).toBe('1030')
  })
})
