import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  HANDOFF_BUFFER_TTL_MS,
  dropHandoffBuffer,
  memoryBackend,
  readHandoffBuffer,
  setHandoffBufferBackend,
  stashHandoffBuffer,
} from '../app/utils/handoffBuffers'
import { useComposeHandoffStore } from '../app/stores/composeHandoff'

const bytes = (n: number) => new Uint8Array(n).fill(7).buffer

beforeEach(() => {
  setHandoffBufferBackend(memoryBackend())
  setActivePinia(createPinia())
})

describe('handoff buffers', () => {
  it('round-trips a large image by share key', async () => {
    expect(await stashHandoffBuffer('k', { buffer: bytes(600_000), type: 'image/png', name: 'c.png' })).toBe(true)
    const got = await readHandoffBuffer('k')
    expect(got?.buffer.byteLength).toBe(600_000)
    expect(got?.name).toBe('c.png')
  })

  it('expires after the TTL and prunes old entries on the next stash', async () => {
    const t0 = 1_000_000
    await stashHandoffBuffer('old', { buffer: bytes(10), type: 'image/png', name: 'a.png' }, t0)
    expect(await readHandoffBuffer('old', t0 + HANDOFF_BUFFER_TTL_MS + 1)).toBeNull()
    await stashHandoffBuffer('new', { buffer: bytes(10), type: 'image/png', name: 'b.png' }, t0 + HANDOFF_BUFFER_TTL_MS + 5)
    expect(await readHandoffBuffer('old', t0)).toBeNull() // pruned for good
  })

  it('drop removes it', async () => {
    await stashHandoffBuffer('k', { buffer: bytes(10), type: 'image/png', name: 'a.png' })
    await dropHandoffBuffer('k')
    expect(await readHandoffBuffer('k')).toBeNull()
  })
})

describe('compose handoff resumes a large image after sign-in', () => {
  it('ingests a persisted share whose image lives in the buffer store', async () => {
    await stashHandoffBuffer('local:chart', { buffer: bytes(600_000), type: 'image/png', name: 'chart.png' })
    const store = useComposeHandoffStore()
    const ok = await store.ingestStored({
      text: 'Revenue by quarter',
      story: '',
      imageName: 'chart.png',
      imageBufferKey: 'local:chart',
      source: 'loom',
    })
    expect(ok).toBe(true)
    expect(store.pending?.files).toHaveLength(1)
    expect(store.pending?.files[0]?.name).toBe('chart.png')
    expect(store.pending?.files[0]?.size).toBe(600_000)
  })

  it('falls back to a caption-only draft when the stashed image is gone', async () => {
    const store = useComposeHandoffStore()
    await store.ingestStored({ text: 'No chart', story: '', imageBufferKey: 'missing', source: 'loom' })
    expect(store.pending?.files).toHaveLength(0)
    expect(store.pending?.text).toBe('No chart')
  })

  it('refuses a stashed non-image type', async () => {
    await stashHandoffBuffer('k', { buffer: bytes(50), type: 'image/svg+xml', name: 'x.svg' })
    const store = useComposeHandoffStore()
    await store.ingestStored({ text: 't', story: '', imageBufferKey: 'k', source: 'loom' })
    expect(store.pending?.files).toHaveLength(0)
  })
})
