import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { normalizePoll } from '../app/stores/status'
import { useComposeSheetStore } from '../app/stores/composeSheet'
import { useOverlayStore } from '../app/stores/overlay'
import { useEdwardStore } from '../app/stores/edward'
import { edwardAuthorKey } from '../app/utils/edwardSemantics'
import {
  draftReplyTarget,
  draftSaveMessage,
  draftStorageKey,
  isRedraftSlot,
  MAX_DRAFT_BYTES,
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
    expect(Object.keys(raw).sort()).toEqual(['spoiler', 'text', 'updatedAt', 'v', 'visibility'])
    expect(readDraft(draftStorageKey('a', 'new'))).toEqual({
      text: 'x',
      spoiler: 'cw',
      visibility: 'unlisted',
    })
  })
})

describe('drafts — long text is never silently truncated', () => {
  let store: ReturnType<typeof memoryStorage>
  beforeEach(() => {
    store = memoryStorage()
    vi.stubGlobal('localStorage', store)
  })

  it('round-trips a long Unicode draft intact', () => {
    const text = `${'héllo 👩‍👩‍👧 日本語 '.repeat(800)}end`
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(8 * 1024)
    const key = draftStorageKey('a', 'new')
    expect(writeDraft(key, { text, spoiler: '', visibility: '' })).toEqual({ ok: true })
    expect(readDraft(key)?.text).toBe(text)
  })

  it('measures UTF-8 bytes, not UTF-16 units', () => {
    // ~21.8k UTF-16 units but ~65.5k bytes once encoded
    const text = '日'.repeat(Math.ceil(MAX_DRAFT_BYTES / 3) + 10)
    expect(text.length).toBeLessThan(MAX_DRAFT_BYTES)
    expect(writeDraft(draftStorageKey('a', 'new'), { text, spoiler: '', visibility: '' })).toEqual({
      ok: false,
      reason: 'too-large',
    })
  })

  it('reports an oversized draft and keeps the last good one instead of slicing', () => {
    const key = draftStorageKey('a', 'new')
    writeDraft(key, { text: 'saved earlier', spoiler: '', visibility: '' })
    const result = writeDraft(key, { text: 'x'.repeat(MAX_DRAFT_BYTES + 1), spoiler: '', visibility: '' })
    expect(result).toEqual({ ok: false, reason: 'too-large' })
    expect(readDraft(key)?.text).toBe('saved earlier')
    expect(draftSaveMessage('too-large')).toMatch(/too long/i)
  })

  it('reports storage failures (quota / private mode)', () => {
    vi.stubGlobal('localStorage', {
      ...store,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(writeDraft(draftStorageKey('a', 'new'), { text: 'hi', spoiler: '', visibility: '' })).toEqual({
      ok: false,
      reason: 'storage',
    })
    expect(draftSaveMessage('storage')).toMatch(/storage/i)
  })
})

describe('drafts — reopening a saved draft', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('recovers the reply target from the draft key', () => {
    expect(draftReplyTarget('reply:1234')).toBe('1234')
    expect(draftReplyTarget('reply:')).toBeNull()
    expect(draftReplyTarget('new')).toBeNull()
    expect(draftReplyTarget('group:cats')).toBeNull()
  })

  it('only redraft slots are unreopenable', () => {
    expect(isRedraftSlot('redraft:1')).toBe(true)
    expect(isRedraftSlot('reply:1')).toBe(false)
    expect(isRedraftSlot(null)).toBe(false)
  })

  it('keeps the reply id and slot together, and remounts when only the slot changes', () => {
    const sheet = useComposeSheetStore()
    sheet.show({ initialText: '@bob hi', draftSlot: 'reply:77', inReplyToId: draftReplyTarget('reply:77') })
    expect(sheet.inReplyToId).toBe('77')
    expect(sheet.draftSlot).toBe('reply:77')

    // A different saved new-post draft while the sheet is open must not keep the old composer
    sheet.show({ initialText: 'one', draftSlot: 'group:cats' })
    const key = sheet.instanceKey
    sheet.show({ initialText: 'two', draftSlot: 'group:dogs' })
    expect(sheet.instanceKey).toBe(key + 1)
    expect(sheet.initialText).toBe('two')
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
    expect(
      normalizePoll({ options: ['a', 'b'], expiresIn: 3600, hideTotals: true }),
    ).toEqual({ options: ['a', 'b'], expiresIn: 3600, hideTotals: true })
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
