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
  const input = { mentionAccts: [], tagNames: [], preview: '', isBoost: false }

  it('matches followed accounts by full handle', () => {
    const ctx = emptyAffinityContext()
    ctx.following.add('alice@far.example')
    expect(affinityScore({ ...input, authorAcct: 'alice@far.example' }, ctx)).toBeCloseTo(0.38)
    expect(affinityScore({ ...input, authorAcct: 'carol@far.example' }, ctx)).toBe(0)
    // Set grows after first use — the cached keys must follow
    ctx.following.add('carol@far.example')
    expect(affinityScore({ ...input, authorAcct: 'carol@far.example' }, ctx)).toBeCloseTo(0.38)
  })

  it('does not treat a same-named account on another server as someone you follow', () => {
    const ctx = emptyAffinityContext()
    ctx.homeHost = 'my.server'
    ctx.following.add('alice')
    ctx.following.add('bob@far.example')
    expect(affinityScore({ ...input, authorAcct: 'alice@elsewhere.net' }, ctx)).toBe(0)
    expect(affinityScore({ ...input, authorAcct: 'bob@other.net' }, ctx)).toBe(0)
    // Your own server's alice (bare, or qualified with your host) still matches
    expect(affinityScore({ ...input, authorAcct: 'alice' }, ctx)).toBeCloseTo(0.38)
    expect(affinityScore({ ...input, authorAcct: 'alice@my.server' }, ctx)).toBeCloseTo(0.38)
  })

  it('does not mark other servers\' namesakes as you or as mentioning you', () => {
    const ctx = emptyAffinityContext()
    ctx.homeHost = 'my.server'
    ctx.selfAcct = 'me'
    ctx.selfUsername = 'me'
    expect(affinityScore({ ...input, authorAcct: 'me@elsewhere.net' }, ctx)).toBe(0)
    expect(affinityScore({ ...input, authorAcct: 'me' }, ctx)).toBeCloseTo(0.55)
    expect(
      affinityScore({ ...input, authorAcct: 'zed@x.net', mentionAccts: ['me@elsewhere.net'] }, ctx),
    ).toBe(0)
    expect(
      affinityScore({ ...input, authorAcct: 'zed@x.net', mentionAccts: ['me@my.server'] }, ctx),
    ).toBeCloseTo(0.48)
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
