import { describe, expect, it } from 'vitest'
import {
  extractHttpsIframeSrc,
  peerTubeEmbedUrl,
  resolvePeerTubeEmbed,
} from '../app/utils/peertube'

describe('peerTubeEmbedUrl', () => {
  it('maps watch / short / embed paths on https hosts', () => {
    const id = '9db9f3f1-9b54-44ed-9e91-461d262d2205'
    expect(peerTubeEmbedUrl(`https://framatube.org/videos/watch/${id}`)).toBe(
      `https://framatube.org/videos/embed/${id}`,
    )
    expect(peerTubeEmbedUrl(`https://framatube.org/w/${id}`)).toBe(
      `https://framatube.org/videos/embed/${id}`,
    )
    expect(peerTubeEmbedUrl(`https://framatube.org/videos/embed/${id}`)).toBe(
      `https://framatube.org/videos/embed/${id}`,
    )
  })

  it('maps playlist short and watch URLs', () => {
    const id = '79216e9d-95bc-4e58-bacd-d10ff430f173'
    expect(peerTubeEmbedUrl(`https://tube.example/w/p/${id}`)).toBe(
      `https://tube.example/video-playlists/embed/${id}`,
    )
    expect(peerTubeEmbedUrl(`https://tube.example/video-playlists/watch/${id}`)).toBe(
      `https://tube.example/video-playlists/embed/${id}`,
    )
  })

  it('rejects non-https and unrelated paths', () => {
    expect(peerTubeEmbedUrl('http://framatube.org/w/abc')).toBeNull()
    expect(peerTubeEmbedUrl('https://example.com/blog/post')).toBeNull()
    expect(peerTubeEmbedUrl('not-a-url')).toBeNull()
  })
})

describe('resolvePeerTubeEmbed', () => {
  it('prefers path detection, then html iframe for PeerTube cards', () => {
    const id = '52a10666-3a18-4e73-93da-e8d3c12c305a'
    expect(
      resolvePeerTubeEmbed({
        url: `https://my.tube/videos/watch/${id}`,
        providerName: 'PeerTube',
      }),
    ).toBe(`https://my.tube/videos/embed/${id}`)

    expect(
      resolvePeerTubeEmbed({
        url: 'https://my.tube/',
        type: 'video',
        providerName: 'PeerTube',
        html: `<iframe src="https://my.tube/videos/embed/${id}"></iframe>`,
      }),
    ).toBe(`https://my.tube/videos/embed/${id}`)
  })

  it('does not embed arbitrary non-PeerTube video cards', () => {
    expect(
      resolvePeerTubeEmbed({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        type: 'video',
        html: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      }),
    ).toBeNull()
  })
})

describe('extractHttpsIframeSrc', () => {
  it('only accepts https iframe sources', () => {
    expect(extractHttpsIframeSrc('<iframe src="https://a.example/embed/1">')).toBe(
      'https://a.example/embed/1',
    )
    expect(extractHttpsIframeSrc('<iframe src="http://a.example/embed/1">')).toBeNull()
    expect(extractHttpsIframeSrc('<iframe src="javascript:alert(1)">')).toBeNull()
  })
})
