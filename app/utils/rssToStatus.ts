/**
 * Map parsed RSS items into ExtendedStatus-shaped objects for TimelineColumn / RealPostCard.
 */

import type { mastodon } from 'masto'
import type { ExtendedStatus } from '~/stores/instances'
import type { RssItem } from '../../shared/rssParser'

export type RssFeedPayload = {
  title: string
  siteUrl: string
  feedUrl: string
  items: RssItem[]
}

export type RssExtendedStatus = ExtendedStatus & {
  _isRss: true
  _rssFeedTitle: string
  _rssFeedUrl: string
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'rss'
  }
}

function hashId(input: string): string {
  // Stable non-crypto hash so list keys don't churn across refreshes
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `rss_${(h >>> 0).toString(36)}`
}

function fakeAccount(item: RssItem, feedTitle: string, siteUrl: string): mastodon.v1.Account {
  const host = hostOf(item.url || siteUrl)
  const username =
    item.authorName.replace(/[^\p{L}\p{N}_.-]+/gu, '').slice(0, 30) ||
    feedTitle.replace(/[^\p{L}\p{N}_.-]+/gu, '').slice(0, 30) ||
    'feed'
  const acct = `${username}@${host}`
  const now = item.publishedAt || new Date().toISOString()
  return {
    id: hashId(`acct:${acct}`),
    username,
    acct,
    displayName: item.authorName || feedTitle,
    locked: false,
    bot: false,
    discoverable: true,
    group: false,
    createdAt: now,
    note: '',
    url: siteUrl || item.url || `https://${host}`,
    avatar: '',
    avatarStatic: '',
    header: '',
    headerStatic: '',
    followersCount: 0,
    followingCount: 0,
    statusesCount: 0,
    lastStatusAt: now,
    emojis: [],
    fields: [],
    roles: [],
    featureApproval: null,
  } as unknown as mastodon.v1.Account
}

function buildContent(item: RssItem): string {
  const bits: string[] = []
  if (item.title) {
    bits.push(`<p><strong>${escapeHtml(item.title)}</strong></p>`)
  }
  if (item.summaryHtml) {
    bits.push(item.summaryHtml)
  }
  if (item.url) {
    bits.push(
      `<p><a href="${escapeAttr(item.url)}" rel="nofollow noopener noreferrer" target="_blank">Read article</a></p>`,
    )
  }
  return bits.join('\n') || '<p></p>'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;')
}

export function isRssStatus(
  s: mastodon.v1.Status | ExtendedStatus | null | undefined,
): s is RssExtendedStatus {
  return !!(s && (s as RssExtendedStatus)._isRss)
}

export function rssItemToStatus(
  item: RssItem,
  feed: Pick<RssFeedPayload, 'title' | 'siteUrl' | 'feedUrl'>,
): RssExtendedStatus {
  const id = hashId(item.id || item.url || item.title)
  const createdAt = item.publishedAt || new Date().toISOString()
  const account = fakeAccount(item, feed.title, feed.siteUrl)
  const card: mastodon.v1.PreviewCard | null = item.url
    ? ({
        url: item.url,
        title: item.title,
        description: item.summaryHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240),
        type: 'link',
        authorName: item.authorName || feed.title,
        authorUrl: feed.siteUrl || '',
        providerName: feed.title,
        providerUrl: feed.siteUrl || '',
        html: '',
        width: 0,
        height: 0,
        image: item.imageUrl || null,
        embedUrl: '',
        blurhash: null,
        authors: [],
      } as unknown as mastodon.v1.PreviewCard)
    : null

  const media: mastodon.v1.MediaAttachment[] = item.imageUrl
    ? [
        {
          id: hashId(`img:${item.imageUrl}`),
          type: 'image',
          url: item.imageUrl,
          previewUrl: item.imageUrl,
          remoteUrl: item.imageUrl,
          textUrl: null,
          meta: null,
          description: item.title,
          blurhash: null,
        } as mastodon.v1.MediaAttachment,
      ]
    : []

  return {
    id,
    uri: item.url || `rss://${encodeURIComponent(feed.feedUrl)}/${id}`,
    url: item.url || feed.siteUrl || feed.feedUrl,
    createdAt,
    account,
    content: buildContent(item),
    visibility: 'public',
    sensitive: false,
    spoilerText: '',
    mediaAttachments: media,
    mentions: [],
    tags: [],
    emojis: [],
    reblogsCount: 0,
    favouritesCount: 0,
    repliesCount: 0,
    quotesCount: 0,
    quoteApproval: null,
    reblogged: false,
    favourited: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    reblog: null,
    application: { name: 'RSS', website: feed.siteUrl || null },
    language: null,
    poll: null,
    card,
    inReplyToId: null,
    inReplyToAccountId: null,
    filtered: [],
    text: null,
    editedAt: null,
    _instanceId: `rss:${hostOf(feed.feedUrl || feed.siteUrl)}`,
    _instanceUrl: feed.siteUrl || feed.feedUrl,
    _isRss: true,
    _rssFeedTitle: feed.title,
    _rssFeedUrl: feed.feedUrl,
  } as unknown as RssExtendedStatus
}

export function rssFeedToStatuses(payload: RssFeedPayload): RssExtendedStatus[] {
  return (payload.items || []).map((item) =>
    rssItemToStatus(item, {
      title: payload.title || 'Feed',
      siteUrl: payload.siteUrl || payload.feedUrl,
      feedUrl: payload.feedUrl,
    }),
  )
}

/** Client helper — calls the CF Pages RSS proxy. */
export async function fetchRssFeed(feedUrl: string): Promise<RssFeedPayload> {
  const q = encodeURIComponent(feedUrl)
  const res = await fetch(`/api/rss?url=${q}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    let message = 'Couldn’t load that feed'
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* keep default */
    }
    throw new Error(message)
  }
  return (await res.json()) as RssFeedPayload
}
