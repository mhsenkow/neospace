import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useInstancesStore } from '../app/stores/instances'
import { useStatusStore } from '../app/stores/status'
import { useComposeAutocomplete } from '../app/composables/useComposeAutocomplete'
import { useComposeMedia, type ComposeAttachment } from '../app/composables/useComposeMedia'

// Composables run outside a component here — skip the lifecycle hook (and its warning)
vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue')>()),
  onUnmounted: () => {},
}))

const searchList = vi.fn()
const credsFor = vi.fn()

vi.mock('~/composables/useMasto', () => ({
  activeClient: () => ({ v1: { accounts: { search: { list: searchList } } } }),
  activeCredentials: () => ({ url: 'https://a.example', accessToken: 'tok-a' }),
  credentialsFor: (id: string) => credsFor(id),
  clientFor: vi.fn(),
  publicClient: vi.fn(),
}))

const account = (id: string, host: string) =>
  ({
    id,
    url: `https://${host}`,
    accessToken: `tok-${id}`,
    user: { id: `u-${id}`, acct: id, username: id },
  }) as never

const setup = () => {
  setActivePinia(createPinia())
  const instances = useInstancesStore()
  instances.instances = [account('a', 'a.example'), account('b', 'b.example')]
  instances.activeAccountId = 'a'
  return instances
}

describe('compose autocomplete — account changes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    searchList.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('closes and drops suggestions when the active account changes', async () => {
    const instances = setup()
    searchList.mockResolvedValue([{ id: 'x1', acct: 'alice', username: 'alice' }])
    const ac = useComposeAutocomplete({ text: () => '@al', caret: () => 3 })

    ac.sync()
    await vi.advanceTimersByTimeAsync(300)
    expect(ac.items.value).toHaveLength(1)
    expect(ac.open.value).toBe(true)

    instances.activeAccountId = 'b'
    await nextTick()
    expect(ac.open.value).toBe(false)
    expect(ac.items.value).toEqual([])
    // The old row can't be applied under account B
    expect(ac.pick({ kind: 'mention', key: 'x1', account: { acct: 'alice' } } as never)).toBeNull()
  })

  it('ignores a lookup that resolves after the account changed', async () => {
    const instances = setup()
    let resolve!: (v: unknown) => void
    searchList.mockReturnValue(new Promise((r) => (resolve = r)))
    const ac = useComposeAutocomplete({ text: () => '@al', caret: () => 3 })

    ac.sync()
    await vi.advanceTimersByTimeAsync(300)
    instances.activeAccountId = 'b'
    await nextTick()
    resolve([{ id: 'x1', acct: 'alice', username: 'alice' }])
    await vi.advanceTimersByTimeAsync(0)
    expect(ac.items.value).toEqual([])
  })
})

describe('compose media — account ownership', () => {
  const attachment = (over: Partial<ComposeAttachment> = {}): ComposeAttachment => ({
    localId: 'm1',
    file: new File(['x'], 'a.png', { type: 'image/png' }),
    previewUrl: 'data:,',
    remoteId: 'media-1',
    ownerId: 'a',
    phase: 'ready',
    progress: 1,
    uploading: false,
    error: null,
    description: '',
    source: 'user',
    optimizeHint: null,
    ...over,
  })

  beforeEach(() => {
    vi.useFakeTimers()
    credsFor.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('detaches attachments and explains why when the account changes', async () => {
    const instances = setup()
    const media = useComposeMedia()
    media.attachments.value = [attachment()]
    expect(media.mediaIds.value).toEqual(['media-1'])

    instances.activeAccountId = 'b'
    await nextTick()
    expect(media.attachments.value).toEqual([])
    expect(media.mediaIds.value).toEqual([])
    expect(media.accountSwitchNotice.value).toMatch(/switched accounts/i)
    media.dismissAccountSwitchNotice()
    expect(media.accountSwitchNotice.value).toBeNull()
  })

  it('never offers another account’s media id for posting', () => {
    setup()
    const media = useComposeMedia()
    media.attachments.value = [attachment({ ownerId: 'b' })]
    expect(media.mediaIds.value).toEqual([])
    expect(media.allReady.value).toBe(false)
  })

  it('sends alt text with the uploading account, even after the active account changed', async () => {
    const instances = setup()
    const status = useStatusStore()
    const update = vi.spyOn(status, 'updateMediaDescription').mockResolvedValue()
    const media = useComposeMedia()
    media.attachments.value = [attachment()]

    media.setDescription('m1', 'a cat')
    // Switching normally detaches first; keep the attachment to prove the owner is explicit
    instances.activeAccountId = 'b'
    media.attachments.value = [attachment({ description: 'a cat' })]
    await media.flushAltDescriptions()
    expect(update).toHaveBeenCalledWith('media-1', 'a cat', 'a')
  })

  it('keeps media the server is still processing out of the ready state', async () => {
    setup()
    const status = useStatusStore()
    vi.spyOn(status, 'uploadMedia').mockResolvedValue({ id: 'media-9', processing: true } as never)
    const resume = vi.spyOn(status, 'resumeMediaProcessing')
    const media = useComposeMedia()

    await media.addFiles([new File(['v'], 'clip.mp4', { type: 'video/mp4' })])
    const item = media.attachments.value[0]!
    expect(item.remoteId).toBe('media-9')
    expect(item.phase).toBe('processing')
    expect(item.error).toBe('Still processing')
    expect(item.ownerId).toBe('a')
    expect(media.allReady.value).toBe(false)
    expect(media.mediaIds.value).toEqual([])

    // Retry re-checks the same media instead of uploading the file again
    resume.mockResolvedValue({ id: 'media-9', url: 'https://a.example/m.mp4' } as never)
    await media.retryUpload(item.localId)
    expect(status.uploadMedia).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledWith('media-9', expect.objectContaining({ accountId: 'a' }))
    expect(media.allReady.value).toBe(true)
    expect(media.mediaIds.value).toEqual(['media-9'])
  })
})
