import { describe, expect, it } from 'vitest'
import { parseRssXml, sanitizeRssFetchUrl } from '../shared/rssParser'
import {
  encodePackShare,
  packShareToFeedPack,
  shareTokenToColumn,
  tryDecodePackShare,
  columnToShareToken,
  STARTER_PACKS,
  starterToPack,
} from '../app/utils/packs'
import type { ColumnConfig } from '../app/stores/columns'
import type { AlgorithmRecipe } from '../app/utils/algorithms'

describe('sanitizeRssFetchUrl', () => {
  it('allows public http(s) URLs', () => {
    expect(sanitizeRssFetchUrl('https://example.com/feed.xml')).toBe(
      'https://example.com/feed.xml',
    )
    expect(sanitizeRssFetchUrl('http://news.example.org/rss')).toBe(
      'http://news.example.org/rss',
    )
  })

  it('blocks credentials, localhost, and private ranges', () => {
    expect(sanitizeRssFetchUrl('https://user:pass@example.com/f')).toBeNull()
    expect(sanitizeRssFetchUrl('http://localhost/feed')).toBeNull()
    expect(sanitizeRssFetchUrl('http://127.0.0.1/feed')).toBeNull()
    expect(sanitizeRssFetchUrl('http://10.0.0.5/feed')).toBeNull()
    expect(sanitizeRssFetchUrl('http://192.168.1.1/feed')).toBeNull()
    expect(sanitizeRssFetchUrl('http://169.254.1.1/feed')).toBeNull()
    expect(sanitizeRssFetchUrl('http://feed.local/rss')).toBeNull()
  })
})

describe('parseRssXml', () => {
  it('parses RSS 2.0 items', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <title>Demo Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Hello</title>
          <link>https://example.com/hello</link>
          <guid>hello-1</guid>
          <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
          <description><![CDATA[<p>Body</p>]]></description>
          <enclosure url="https://example.com/img.jpg" type="image/jpeg" />
        </item>
      </channel></rss>`
    const parsed = parseRssXml(xml)
    expect(parsed.title).toBe('Demo Feed')
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]!.title).toBe('Hello')
    expect(parsed.items[0]!.url).toBe('https://example.com/hello')
    expect(parsed.items[0]!.imageUrl).toBe('https://example.com/img.jpg')
  })

  it('parses Atom entries', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Demo</title>
        <link href="https://blog.example" rel="alternate"/>
        <entry>
          <title>Entry</title>
          <id>tag:blog.example,2024:1</id>
          <link href="https://blog.example/e1" rel="alternate"/>
          <updated>2024-06-01T00:00:00Z</updated>
          <author><name>Ada</name></author>
          <summary>Short</summary>
        </entry>
      </feed>`
    const parsed = parseRssXml(xml)
    expect(parsed.title).toBe('Atom Demo')
    expect(parsed.items[0]!.authorName).toBe('Ada')
    expect(parsed.items[0]!.url).toBe('https://blog.example/e1')
  })
})

describe('pack share codec', () => {
  it('round-trips columns including RSS and embeds algorithms', () => {
    const columns: ColumnConfig[] = [
      { id: '1', feedType: 'home', viewMode: 'flow' },
      { id: '2', feedType: 'group', groupTag: 'rust', viewMode: 'flow' },
      {
        id: '3',
        feedType: 'rss',
        rssUrl: 'https://hnrss.org/frontpage',
        rssTitle: 'HN',
        viewMode: 'flow',
      },
      { id: '4', feedType: 'algorithm', algorithmId: 'algo_abc', viewMode: 'flow' },
    ]
    const recipe: AlgorithmRecipe = {
      id: 'algo_abc',
      name: 'Rust pulse',
      source: 'federated',
      includeTags: ['rust'],
      excludeTags: [],
      includeKeywords: [],
      excludeKeywords: [],
      mediaOnly: false,
      noReblogs: false,
      noReplies: false,
      createdAt: 1,
      updatedAt: 1,
    }
    const encoded = encodePackShare(
      {
        id: 'pack_1',
        name: 'Tech desk',
        description: 'Daily tech',
        columns,
        updatedAt: Date.now(),
      },
      { authorAcct: 'ada@example.com', authorName: 'Ada', algorithms: [recipe] },
    )
    const decoded = tryDecodePackShare(encoded)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.payload.n).toBe('Tech desk')
    expect(decoded.payload.a).toBe('ada@example.com')
    expect(decoded.payload.al?.algo_abc?.n).toBe('Rust pulse')
    const { pack, algorithms } = packShareToFeedPack(decoded.payload)
    expect(pack.columns.some((c) => c.feedType === 'rss' && c.rssUrl?.includes('hnrss'))).toBe(
      true,
    )
    expect(pack.columns.some((c) => c.feedType === 'group' && c.groupTag === 'rust')).toBe(true)
    expect(algorithms.some((r) => r.name === 'Rust pulse')).toBe(true)
  })

  it('maps share tokens for local@host and list', () => {
    const local = shareTokenToColumn({ t: 'local@host:mastodon.social' })
    expect(local?.feedType).toBe('local')
    expect(local?.serverHost).toBe('mastodon.social')
    const list = shareTokenToColumn({ t: 'list:42', n: 'Friends' })
    expect(list?.feedType).toBe('list')
    expect(list?.listId).toBe('42')
    expect(list?.listTitle).toBe('Friends')
    expect(columnToShareToken(list!).t).toBe('list:42')
  })

  it('builds starter packs under the column cap', () => {
    for (const starter of STARTER_PACKS) {
      const pack = starterToPack(starter)
      expect(pack.columns.length).toBeGreaterThan(0)
      expect(pack.columns.length).toBeLessThanOrEqual(8)
      expect(pack.name).toBe(starter.name)
    }
  })
})
