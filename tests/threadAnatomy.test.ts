import { describe, expect, it } from 'vitest'
import {
  computeAccountDistribution,
  computeThreadAnatomy,
  formatDurationShort,
  replyDepths,
} from '../app/utils/threadAnatomy'

const status = (
  id: string,
  opts: { acct?: string; inReplyToId?: string | null; createdAt?: string; url?: string } = {},
) => {
  const acct = opts.acct || `user${id}@example.social`
  return {
    id,
    createdAt: opts.createdAt || '2026-01-01T12:00:00Z',
    inReplyToId: opts.inReplyToId ?? null,
    account: {
      id: `acc-${acct}`,
      acct,
      url: opts.url || `https://${acct.split('@')[1]}/@${acct.split('@')[0]}`,
    },
  }
}

describe('replyDepths', () => {
  it('walks nested replies from the focus post', () => {
    const focus = status('root')
    const a = status('a', { inReplyToId: 'root' })
    const b = status('b', { inReplyToId: 'a' })
    const c = status('c', { inReplyToId: 'root' })
    const depths = replyDepths(focus.id, [a, b, c])
    expect(depths.get('a')).toBe(1)
    expect(depths.get('b')).toBe(2)
    expect(depths.get('c')).toBe(1)
  })
})

describe('computeThreadAnatomy', () => {
  it('summarizes tree shape, instances, and cadence', () => {
    const focus = status('root', {
      acct: 'alice@a.social',
      createdAt: '2026-01-01T12:00:00Z',
    })
    const replies = [
      status('r1', {
        acct: 'bob@b.social',
        inReplyToId: 'root',
        createdAt: '2026-01-01T12:10:00Z',
      }),
      status('r2', {
        acct: 'alice@a.social',
        inReplyToId: 'r1',
        createdAt: '2026-01-01T12:20:00Z',
      }),
      status('r3', {
        acct: 'carol@c.social',
        inReplyToId: 'root',
        createdAt: '2026-01-01T12:40:00Z',
      }),
    ]
    const anatomy = computeThreadAnatomy({ focus, ancestors: [], descendants: replies })
    expect(anatomy.totalNodes).toBe(4)
    expect(anatomy.descendantCount).toBe(3)
    expect(anatomy.maxDepth).toBe(2)
    expect(anatomy.rootReplies).toBe(2)
    expect(anatomy.nestedReplies).toBe(1)
    expect(anatomy.uniqueParticipants).toBe(3)
    expect(anatomy.instanceCount).toBe(3)
    expect(anatomy.timeToFirstReplyMs).toBe(10 * 60_000)
    expect(anatomy.medianReplyIntervalMs).toBe(15 * 60_000)
    expect(anatomy.replySparkline.length).toBeGreaterThan(0)
    expect(anatomy.authorSelfReplyRatio).toBeCloseTo(1 / 3)
  })
})

describe('computeAccountDistribution', () => {
  it('counts local vs remote and top hosts', () => {
    const dist = computeAccountDistribution(
      [
        { acct: 'a@home.social' },
        { acct: 'b@home.social' },
        { acct: 'c@other.social' },
        { acct: 'localonly' },
      ],
      'home.social',
    )
    expect(dist.total).toBe(4)
    expect(dist.instanceCount).toBe(3)
    // two @home.social + bare local acct (host "local") count as local
    expect(dist.localCount).toBe(3)
    expect(dist.remoteCount).toBe(1)
    expect(dist.instances[0]!.host).toBe('home.social')
    expect(dist.instances[0]!.count).toBe(2)
  })
})

describe('formatDurationShort', () => {
  it('formats common spans', () => {
    expect(formatDurationShort(null)).toBe('—')
    expect(formatDurationShort(4500)).toBe('5s')
    expect(formatDurationShort(120_000)).toBe('2m')
    expect(formatDurationShort(3_600_000)).toBe('1h')
  })
})
