import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEdwardStore, edwardBallFor } from '../app/stores/edward'
import { emptyAffinityContext } from '../app/utils/edwardAffinity'
import type { ExtendedStatus } from '../app/stores/instances'

const status = (id: string, acct: string, extra: Partial<ExtendedStatus> = {}): ExtendedStatus =>
  ({
    id,
    uri: `https://example.social/@${acct}/${id}`,
    url: `https://example.social/@${acct}/${id}`,
    createdAt: new Date(2026, 9, 7, 12, 0, Number(id)).toISOString(),
    content: `<p>post ${id}</p>`,
    account: { id: `a-${acct}`, acct, username: acct, displayName: acct },
    mediaAttachments: [],
    tags: [],
    mentions: [],
    _key: `i:${id}`,
    _instanceId: 'i',
    _tsMs: 0,
    ...extra,
  }) as unknown as ExtendedStatus

describe('edward store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('holds the watch deck while the user reaches for it', () => {
    const edward = useEdwardStore()
    edward.setFocusedIdentity('a')
    edward.setWatchHold(true)
    edward.setFocusedIdentity('b')
    expect(edward.focusedIdentity).toBe('a')
    edward.setWatchHold(false)
    edward.setFocusedIdentity('b')
    expect(edward.focusedIdentity).toBe('b')
  })

  it('drops a ghosted author from stream, history, focus and selection', () => {
    const edward = useEdwardStore()
    const keep = status('1', 'kind')
    const goneA = status('2', 'spam')
    const goneB = status('3', 'Spam')
    edward.replaceStatuses([keep, goneA, goneB])
    const ids = edward.statuses.map((s) => s.uri)
    edward.setFocusedIdentity(ids[1]!)
    edward.selectByIdentity(ids[2]!)
    edward.setWatchHold(true)

    edward.dropAuthor('@SPAM')

    expect(edward.statuses.map((s) => s.id)).toEqual(['1'])
    expect(edward.watchHistory).not.toContain(ids[1])
    expect(edward.focusedIdentity).toBeNull()
    expect(edward.selectedIdentity).toBeNull()
    expect(edward.watchHold).toBe(false)
  })

  it('memoizes descriptors per status until affinity changes', () => {
    const s = status('9', 'someone')
    const aff = emptyAffinityContext()
    const a = edwardBallFor(s, aff)
    expect(edwardBallFor(s, aff)).toBe(a)
    expect(edwardBallFor(s, emptyAffinityContext())).not.toBe(a)
  })

  it('strips custom emoji shortcodes from plain-text labels', () => {
    const s = status('7', 'jiub', {
      account: { id: 'x', acct: 'jiub', username: 'jiub', displayName: 'jiub :v_enby: :v_trans:' },
    } as Partial<ExtendedStatus>)
    expect(edwardBallFor(s, emptyAffinityContext()).label).toBe('jiub')
  })
})
