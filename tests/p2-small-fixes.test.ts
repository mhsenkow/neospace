import { describe, expect, it } from 'vitest'
import { extractProfileCss, isColumnsField, isProfileCssField } from '../app/utils/profileCss'
import { inAppLinkFor } from '../app/utils/richTextLinks'
import { normalizeDomainInput } from '../app/utils/domainInput'
import { isAnimatedImageBytes } from '../app/utils/prepareComposeImage'
import { mastodonLength } from '../app/utils/mastodonLength'
import { urlWeightFor } from '../app/utils/instanceInfo'
import { resolvableQuery, detectIntent } from '../app/utils/searchQuery'
import { resolvePresence } from '../app/utils/profileSources'
import { settingsKeywordMatches } from '../app/stores/settings'
import { notifHasActor, notifLabel } from '../app/utils/notifHelpers'
import { dmPreviewText } from '../app/utils/dmHelpers'
import { isValidHashtag } from '../app/utils/hashtag'

describe('profile custom CSS field', () => {
  it('always honours css / custom_css / chaos_css', () => {
    expect(isProfileCssField({ name: 'CSS', value: 'x' })).toBe(true)
    expect(isProfileCssField({ name: 'chaos-css', value: 'x' })).toBe(false) // hyphen is not an underscore
    expect(isProfileCssField({ name: 'custom_css', value: 'x' })).toBe(true)
  })

  it('only treats theme / style as CSS when the value looks like CSS', () => {
    expect(isProfileCssField({ name: 'Style', value: 'Jazz' })).toBe(false)
    expect(isProfileCssField({ name: 'Theme', value: 'a { color: red }' })).toBe(true)
    expect(extractProfileCss([{ name: 'Style', value: 'Jazz' }, { name: 'css', value: 'b{}' }])).toBe('b{}')
  })

  it('recognises the columns field regardless of punctuation', () => {
    expect(isColumnsField({ name: 'NeoSpace Columns' })).toBe(true)
    expect(isColumnsField({ name: 'Homepage' })).toBe(false)
  })
})

describe('in-app rich text links', () => {
  const anchor = (href: string, className = '', text = '') => ({
    getAttribute: (n: string) => (n === 'href' ? href : null),
    className,
    textContent: text,
  })

  it('routes hashtags and mentions, leaves other links', () => {
    expect(inAppLinkFor(anchor('https://m.example/tags/Linux', 'hashtag', '#Linux'))).toEqual({
      kind: 'tag',
      tag: 'Linux',
    })
    expect(inAppLinkFor(anchor('https://m.example/@bob', 'u-url mention', '@bob'))).toEqual({
      kind: 'profile',
      acct: 'bob@m.example',
    })
    expect(inAppLinkFor(anchor('https://example.com/page', '', 'page'))).toBeNull()
  })
})

describe('normalizeDomainInput', () => {
  it('extracts a hostname from URLs and handles', () => {
    expect(normalizeDomainInput('https://Mastodon.Social/@bob')).toBe('mastodon.social')
    expect(normalizeDomainInput('@bob@Host.Example')).toBe('host.example')
    expect(normalizeDomainInput('host.example:443/path')).toBe('host.example')
  })

  it('rejects things that are not domains', () => {
    expect(normalizeDomainInput('')).toBeNull()
    expect(normalizeDomainInput('nodots')).toBeNull()
    expect(normalizeDomainInput('bad domain.com')).toBeNull()
  })
})

describe('isAnimatedImageBytes', () => {
  it('detects the VP8X animation flag in WebP', () => {
    const bytes = new Uint8Array(30)
    bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
    bytes.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8)
    bytes.set([...'VP8X'].map((c) => c.charCodeAt(0)), 12)
    expect(isAnimatedImageBytes(bytes, 'image/webp')).toBe(false)
    bytes[20] = 0x02
    expect(isAnimatedImageBytes(bytes, 'image/webp')).toBe(true)
  })

  it('detects acTL before IDAT in PNG', () => {
    const chunk = (type: string, len: number) => {
      const out = new Uint8Array(12 + len)
      new DataView(out.buffer).setUint32(0, len)
      out.set([...type].map((c) => c.charCodeAt(0)), 4)
      return out
    }
    const png = (types: string[]) => {
      const parts = [new Uint8Array(8), ...types.map((t) => chunk(t, t === 'IHDR' ? 13 : 8))]
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
      let at = 0
      for (const p of parts) {
        out.set(p, at)
        at += p.length
      }
      return out
    }
    expect(isAnimatedImageBytes(png(['IHDR', 'acTL', 'IDAT']), 'image/png')).toBe(true)
    expect(isAnimatedImageBytes(png(['IHDR', 'IDAT', 'IEND']), 'image/png')).toBe(false)
  })
})

describe('mastodonLength url weight', () => {
  const url = 'https://example.com/a/very/long/path/that/exceeds/twenty-three/chars'
  it('counts 23 by default, the reported weight, or full length when null', () => {
    expect(mastodonLength(url)).toBe(23)
    expect(mastodonLength(url, { urlWeight: 30 })).toBe(30)
    expect(mastodonLength(url, { urlWeight: null })).toBe(url.length)
  })

  it('picks the right weight per server', () => {
    expect(urlWeightFor(25, 'mastodon')).toBe(25)
    expect(urlWeightFor(undefined, 'mastodon')).toBe(23)
    expect(urlWeightFor(undefined, 'gotosocial')).toBeNull()
  })
})

describe('hashtag validation', () => {
  it('accepts Unicode letters and rejects digits-only', () => {
    expect(isValidHashtag('日本語')).toBe(true)
    expect(isValidHashtag('café')).toBe(true)
    expect(isValidHashtag('2024')).toBe(false)
    expect(isValidHashtag('two words')).toBe(false)
  })
})

describe('search query intent', () => {
  it('turns scheme-less links into resolvable https urls', () => {
    expect(resolvableQuery('example.com/@bob/123')).toBe('https://example.com/@bob/123')
    expect(resolvableQuery('hello world')).toBe('hello world')
  })

  it('does not treat file names as hosts', () => {
    expect(detectIntent('notes.txt').kind).toBe('text')
    expect(detectIntent('mastodon.social').kind).toBe('host')
  })
})

describe('resolvePresence', () => {
  it('leaves extra website fields as ordinary tokens', () => {
    const { links, consumed } = resolvePresence({
      fields: [
        { name: 'Homepage', value: 'https://a.example' },
        { name: 'Website', value: 'https://b.example' },
      ],
    })
    expect(links.filter((l) => l.kind === 'website')).toHaveLength(1)
    expect([...consumed]).toEqual([0])
  })
})

describe('settings search keywords', () => {
  it('matches by prefix of the keyword or any of its words', () => {
    expect(settingsKeywordMatches(['sign out'], 'out')).toBe(true)
    expect(settingsKeywordMatches(['email'], 'ai')).toBe(false)
    expect(settingsKeywordMatches(['build'], 'ui')).toBe(false)
    expect(settingsKeywordMatches(undefined, 'x')).toBe(false)
  })
})

describe('actorless notifications', () => {
  it('flags server-generated types and labels them without an actor', () => {
    expect(notifHasActor('severed_relationships')).toBe(false)
    expect(notifHasActor('moderation_warning')).toBe(false)
    expect(notifHasActor('favourite')).toBe(true)
    expect(notifLabel('moderation_warning')).toMatch(/warning/i)
  })
})

describe('dmPreviewText', () => {
  const base = { content: '', spoilerText: '', mediaAttachments: [] as any[] }
  it('shows only the content warning when set', () => {
    expect(dmPreviewText({ ...base, content: '<p>secret</p>', spoilerText: 'spoilers' }, [])).toBe(
      'CW: spoilers',
    )
  })

  it('strips participant mentions and clips', () => {
    expect(dmPreviewText({ ...base, content: '<p>@bob hello</p>' }, ['bob'])).toBe('hello')
  })

  it('names media when there is no text', () => {
    expect(
      dmPreviewText({ ...base, content: '<p>@bob</p>', mediaAttachments: [{ type: 'image' }] }, ['bob']),
    ).toBe('Photo')
    expect(dmPreviewText({ ...base, mediaAttachments: [{ type: 'audio' }] }, [])).toBe('Audio')
    expect(dmPreviewText(base, [])).toBe('')
  })
})
