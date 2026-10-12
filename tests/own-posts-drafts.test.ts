import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { normalizePoll } from '../app/stores/status'
import { useComposeSheetStore } from '../app/stores/composeSheet'
import { useOverlayStore } from '../app/stores/overlay'
import { useEdwardStore } from '../app/stores/edward'
import { edwardAuthorKey } from '../app/utils/edwardSemantics'
import {
  draftStorageKey,
  migrateLegacyDraft,
  readDraft,
  writeDraft,
} from '../app/composables/useDraft'
import type { ExtendedStatus } from '../app/stores/instances'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('drafts — account scoping', () => {
  let store: ReturnType<typeof memoryStorage>
  beforeEach(() => {
    store = memoryStorage()
    vi.stubGlobal('localStorage', store)
  })

  it('keeps one account’s draft invisible to another', () => {
    writeDraft(draftStorageKey('acct-a', 'new'), { text: 'hello from A', spoiler: '', visibility: '' })
    expect(readDraft(draftStorageKey('acct-a', 'new'))?.text).toBe('hello from A')
    expect(readDraft(draftStorageKey('acct-b', 'new'))).toBeNull()
  })

  it('migrates a legacy unscoped draft only when migration is unambiguous', () => {
    store.setItem('neospace_draft:new', JSON.stringify({ text: 'old', spoiler: '', visibility: '' }))

    // Several accounts signed in: can't tell whose it was → ignored, left untouched
    migrateLegacyDraft('acct-a', 'new', false)
    expect(readDraft(draftStorageKey('acct-a', 'new'))).toBeNull()
    expect(store.getItem('neospace_draft:new')).not.toBeNull()

    migrateLegacyDraft('acct-a', 'new', true)
    expect(readDraft(draftStorageKey('acct-a', 'new'))?.text).toBe('old')
    expect(store.getItem('neospace_draft:new')).toBeNull()
  })

  it('never overwrites an existing scoped draft with a legacy one', () => {
    writeDraft(draftStorageKey('acct-a', 'new'), { text: 'current', spoiler: '', visibility: '' })
    store.setItem('neospace_draft:new', JSON.stringify({ text: 'old', spoiler: '', visibility: '' }))
    migrateLegacyDraft('acct-a', 'new', true)
    expect(readDraft(draftStorageKey('acct-a', 'new'))?.text).toBe('current')
  })

  it('persists scalars only', () => {
    writeDraft(draftStorageKey('a', 'new'), {
      text: 'x',
      spoiler: 'cw',
      visibility: 'unlisted',
      // @ts-expect-error attachments / polls are deliberately not part of the payload
      attachments: [{ id: '1' }],
    })
    const raw = JSON.parse(store.getItem(draftStorageKey('a', 'new'))!)
    expect(Object.keys(raw).sort()).toEqual(['spoiler', 'text', 'visibility'])
    expect(readDraft(draftStorageKey('a', 'new'))).toEqual({
      text: 'x',
      spoiler: 'cw',
      visibility: 'unlisted',
    })
  })
})

describe('overlay.openChoice', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('resolves the secondary action and keeps openConfirm boolean', async () => {
    const overlay = useOverlayStore()
    const choice = overlay.openChoice({ title: 't', body: 'b', secondaryLabel: 'Save' })
    overlay.resolveConfirm('secondary')
    expect(await choice).toBe('secondary')

    const ok = overlay.openConfirm({ title: 't', body: 'b' })
    overlay.resolveConfirm(true)
    expect(await ok).toBe(true)

    const no = overlay.openConfirm({ title: 't', body: 'b' })
    overlay.resolveConfirm(false)
    expect(await no).toBe(false)
  })
})

describe('composeSheet redraft prefill', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('carries CW + draft slot and clears them on hide', () => {
    const sheet = useComposeSheetStore()
    sheet.show({ initialText: 'again', spoilerText: 'cw', draftSlot: 'redraft:1' })
    expect(sheet.initialSpoiler).toBe('cw')
    expect(sheet.draftSlot).toBe('redraft:1')
    sheet.hide()
    expect(sheet.initialSpoiler).toBe('')
    expect(sheet.draftSlot).toBeNull()
  })
})

describe('normalizePoll', () => {
  it('trims, drops blanks and passes flags', () => {
    expect(normalizePoll({ options: [' a ', '', 'b'], expiresIn: 3600, multiple: true })).toEqual({
      options: ['a', 'b'],
      expiresIn: 3600,
      multiple: true,
    })
  })

  it('enforces 2–4 distinct options and a valid duration', () => {
    expect(() => normalizePoll({ options: ['only'], expiresIn: 3600 })).toThrow(/at least 2/)
    expect(() => normalizePoll({ options: ['a', 'b', 'c', 'd', 'e'], expiresIn: 3600 })).toThrow(/at most 4/)
    expect(() => normalizePoll({ options: ['a', 'A'], expiresIn: 3600 })).toThrow(/different/)
    expect(() => normalizePoll({ options: ['a', 'b'], expiresIn: 60 })).toThrow(/5 minutes/)
    expect(normalizePoll(undefined)).toBeUndefined()
  })
})

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

describe('edward excluded authors', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('normalizes author keys relative to your server', () => {
    expect(edwardAuthorKey('@Bob@Home.Example', 'https://home.example')).toBe('bob')
    expect(edwardAuthorKey('bob@other.example', 'https://home.example')).toBe('bob@other.example')
    expect(edwardAuthorKey('', 'https://home.example')).toBe('')
  })

  it('keeps an excluded author out of later merges and replaces, even with nothing on stage', () => {
    const edward = useEdwardStore()
    edward.dropAuthor('@Spam')
    expect(edward.excludedAuthors).toEqual(['spam'])

    edward.replaceStatuses([status('1', 'kind'), status('2', 'spam')])
    expect(edward.statuses.map((s) => s.id)).toEqual(['1'])

    expect(edward.mergeNewer([status('3', 'SPAM'), status('4', 'kind2')])).toHaveLength(1)
    expect(edward.statuses.map((s) => s.id)).toEqual(['4', '1'])
  })

  it('does not confuse same-named locals from different servers', () => {
    const edward = useEdwardStore()
    // spam@other.example excluded — a bare "spam" from a *different* source server stays
    edward.dropAuthor('spam@other.example')
    const foreign = status('5', 'spam', {
      account: {
        id: 'x',
        acct: 'spam',
        username: 'spam',
        displayName: 'spam',
        url: 'https://other.example/@spam',
      },
    } as Partial<ExtendedStatus>)
    const elsewhere = status('6', 'spam', {
      account: {
        id: 'y',
        acct: 'spam',
        username: 'spam',
        displayName: 'spam',
        url: 'https://third.example/@spam',
      },
    } as Partial<ExtendedStatus>)
    expect(edward.isAuthorExcluded(foreign)).toBe(true)
    expect(edward.isAuthorExcluded(elsewhere)).toBe(false)
  })

  it('forgets exclusions when the session ends', () => {
    const edward = useEdwardStore()
    edward.dropAuthor('spam')
    edward.exit()
    expect(edward.excludedAuthors).toEqual([])
  })
})
