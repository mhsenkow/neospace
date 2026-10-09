import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { newestIdPerInstance, useEdwardStore } from '../app/stores/edward'
import { lookupAcctFor } from '../app/utils/edwardSemantics'
import { affinityScore, emptyAffinityContext } from '../app/utils/edwardAffinity'
import type { ExtendedStatus } from '../app/stores/instances'

const st = (id: string, instanceId: string) =>
  ({ id, _instanceId: instanceId }) as unknown as ExtendedStatus

describe('newestIdPerInstance', () => {
  it('takes the highest id per server, not the first one in createdAt order', () => {
    // Late-delivered remote post sorts first by createdAt but has a lower id
    const cursors = newestIdPerInstance([st('99', 'a'), st('100', 'a'), st('7', 'b'), st('', 'b')])
    expect(cursors).toEqual({ a: '100', b: '7' })
  })

  it('skips rows without an instance', () => {
    expect(newestIdPerInstance([st('5', '')])).toEqual({})
  })
})

describe('lookupAcctFor', () => {
  const mine = 'https://my.server'

  it('keeps a bare acct when the post came from your own server', () => {
    expect(lookupAcctFor('bob', 'https://my.server/@bob', mine, mine)).toBe('bob')
  })

  it('qualifies a local acct from another server with its profile host', () => {
    expect(
      lookupAcctFor('@bob', 'https://other.social/@bob', 'https://other.social', mine),
    ).toBe('bob@other.social')
  })

  it('falls back to the source server when the profile url is missing', () => {
    expect(lookupAcctFor('bob', null, 'https://other.social', mine)).toBe('bob@other.social')
  })

  it('leaves already-qualified handles alone', () => {
    expect(lookupAcctFor('bob@third.net', 'https://third.net/@bob', 'https://other.social', mine)).toBe(
      'bob@third.net',
    )
  })
})

describe('affinityScore follow match', () => {
  it('matches followed accounts by local part as before', () => {
    const ctx = emptyAffinityContext()
    ctx.following.add('alice@far.example')
    const input = { mentionAccts: [], tagNames: [], preview: '', isBoost: false }
    expect(affinityScore({ ...input, authorAcct: 'alice' }, ctx)).toBeCloseTo(0.38)
    expect(affinityScore({ ...input, authorAcct: 'carol' }, ctx)).toBe(0)
    // Set grows after first use — the cached local parts must follow
    ctx.following.add('carol@far.example')
    expect(affinityScore({ ...input, authorAcct: 'carol' }, ctx)).toBeCloseTo(0.38)
  })
})

describe('edward store exit', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('drops the stream on exit', () => {
    const edward = useEdwardStore()
    edward.enter()
    edward.replaceStatuses([st('1', 'a')])
    edward.exit()
    expect(edward.statuses).toEqual([])
  })
})
