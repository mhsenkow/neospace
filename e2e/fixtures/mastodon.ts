/**
 * Deterministic Mastodon API fixtures for Playwright route mocks.
 * No live credentials — all journeys hit these canned responses.
 */

export const HOME_INSTANCE = 'https://mastodon.test'

export const account = {
  id: '1',
  username: 'neo',
  acct: 'neo',
  display_name: 'Neo Tester',
  locked: false,
  bot: false,
  discoverable: true,
  group: false,
  created_at: '2024-01-01T00:00:00.000Z',
  note: '',
  url: `${HOME_INSTANCE}/@neo`,
  avatar: `${HOME_INSTANCE}/avatars/neo.png`,
  avatar_static: `${HOME_INSTANCE}/avatars/neo.png`,
  header: `${HOME_INSTANCE}/headers/neo.png`,
  header_static: `${HOME_INSTANCE}/headers/neo.png`,
  followers_count: 10,
  following_count: 5,
  statuses_count: 42,
  last_status_at: '2024-06-01',
  emojis: [],
  fields: [],
}

export const instanceV2 = {
  domain: 'mastodon.test',
  title: 'Mastodon Test',
  version: '4.3.0',
  source_url: 'https://github.com/mastodon/mastodon',
  description: 'Fixture instance',
  usage: { users: { active_month: 1 } },
  thumbnail: { url: `${HOME_INSTANCE}/packs/logo.png` },
  languages: ['en'],
  configuration: {
    urls: { streaming: 'wss://mastodon.test' },
    accounts: { max_featured_tags: 10 },
    statuses: {
      max_characters: 500,
      max_media_attachments: 4,
      characters_reserved_per_url: 23,
    },
    media_attachments: {
      supported_mime_types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      image_size_limit: 10_485_760,
      image_matrix_limit: 16_777_216,
      video_size_limit: 41_943_040,
      video_frame_rate_limit: 60,
      video_matrix_limit: 2_304_000,
    },
    polls: {
      max_options: 4,
      max_characters_per_option: 50,
      min_expiration: 300,
      max_expiration: 2_592_000,
    },
  },
  registrations: { enabled: true, approval_required: false, message: null },
  contact: { email: 'admin@mastodon.test', account: null },
  rules: [],
}

/** Second signed-in account on a different server — for account-switching journeys */
export const SECOND_INSTANCE = 'https://second.test'

export const secondAccount = {
  ...account,
  id: '2',
  username: 'trin',
  acct: 'trin',
  display_name: 'Trin Tester',
  url: `${SECOND_INSTANCE}/@trin`,
  avatar: `${SECOND_INSTANCE}/avatars/trin.png`,
  avatar_static: `${SECOND_INSTANCE}/avatars/trin.png`,
  header: `${SECOND_INSTANCE}/headers/trin.png`,
  header_static: `${SECOND_INSTANCE}/headers/trin.png`,
}

export const secondInstanceV2 = {
  ...instanceV2,
  domain: 'second.test',
  title: 'Second Test',
  thumbnail: { url: `${SECOND_INSTANCE}/packs/logo.png` },
  configuration: {
    ...instanceV2.configuration,
    urls: { streaming: 'wss://second.test' },
  },
  contact: { email: 'admin@second.test', account: null },
}

export function makeStatus(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    created_at: '2024-06-01T12:00:00.000Z',
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    sensitive: false,
    spoiler_text: '',
    visibility: 'public',
    language: 'en',
    uri: `${HOME_INSTANCE}/users/neo/statuses/${id}`,
    url: `${HOME_INSTANCE}/@neo/${id}`,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    edited_at: null,
    content: `<p>Fixture post ${id}</p>`,
    reblog: null,
    account,
    media_attachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    card: null,
    poll: null,
    favourited: false,
    reblogged: false,
    muted: false,
    bookmarked: false,
    pinned: false,
    ...overrides,
  }
}

export const homeTimeline = [
  makeStatus('100'),
  makeStatus('99', { content: '<p>Earlier fixture</p>' }),
]

/** Home feed for the second account — distinct author, ids, and copy */
export const secondHomeTimeline = [
  makeStatus('200', {
    content: '<p>Second server home post</p>',
    uri: `${SECOND_INSTANCE}/users/trin/statuses/200`,
    url: `${SECOND_INSTANCE}/@trin/200`,
    account: secondAccount,
  }),
]

export const oauthToken = {
  access_token: 'e2e-access-token',
  token_type: 'Bearer',
  scope: 'read write follow push',
  created_at: 1_700_000_000,
}

export const secondOauthToken = { ...oauthToken, access_token: 'e2e-access-token-2' }

/** OAuth app registered for the fixture host (POST /api/v1/apps) */
export const oauthApp = {
  id: '1',
  name: 'NeoSpace',
  website: null,
  redirect_uri: 'http://127.0.0.1/auth/callback',
  client_id: 'e2e-client',
  client_secret: 'e2e-secret',
  vapid_key: '',
}
