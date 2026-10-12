import { describe, expect, it } from 'vitest'
import {
  detectServerCapabilities,
  detectServerSoftware,
  isFeatureAvailable,
  serverSettingsUrl,
  UNKNOWN_CAPABILITIES,
  type ServerMetadata,
  type ServerSoftware,
} from '../app/utils/serverCapabilities'
import { mapInstanceConfig } from '../app/utils/instanceInfo'

type Row = {
  name: string
  meta: ServerMetadata
  software: ServerSoftware
  scheduled: 'yes' | 'no' | 'unknown'
  polls: 'yes' | 'no' | 'unknown'
  notificationsLink: string | null
  accountLink: string | null
}

const rows: Row[] = [
  {
    name: 'Mastodon',
    meta: { version: '4.3.2', sourceUrl: 'https://github.com/mastodon/mastodon' },
    software: 'mastodon',
    scheduled: 'yes',
    polls: 'yes',
    notificationsLink: 'https://m.example/settings/notifications',
    accountLink: 'https://m.example/settings',
  },
  {
    name: 'Mastodon glitch fork',
    meta: { version: '4.4.0-alpha.1+glitch', sourceUrl: 'https://github.com/glitch-soc/mastodon' },
    software: 'mastodon',
    scheduled: 'yes',
    polls: 'yes',
    notificationsLink: 'https://m.example/settings/notifications',
    accountLink: 'https://m.example/settings',
  },
  {
    name: 'GoToSocial',
    meta: { version: '0.17.1 git-abc123', sourceUrl: 'https://codeberg.org/superseriousbusiness/gotosocial' },
    software: 'gotosocial',
    scheduled: 'unknown',
    polls: 'yes',
    notificationsLink: null,
    accountLink: 'https://m.example/settings',
  },
  {
    name: 'Akkoma',
    meta: { version: '2.7.2 (compatible; Akkoma 3.13.0)', sourceUrl: 'https://akkoma.dev/AkkomaGang/akkoma' },
    software: 'akkoma',
    scheduled: 'yes',
    polls: 'yes',
    notificationsLink: null,
    accountLink: 'https://m.example/settings',
  },
  {
    name: 'Pixelfed',
    meta: { version: '0.12.4 (compatible; Pixelfed 0.12.4)', sourceUrl: 'https://github.com/pixelfed/pixelfed' },
    software: 'pixelfed',
    scheduled: 'no',
    polls: 'no',
    notificationsLink: null,
    accountLink: 'https://m.example/settings/home',
  },
  {
    name: 'unknown software',
    meta: { version: '2024.1 (compatible; Somethingelse)', sourceUrl: 'https://example.org/src' },
    software: 'unknown',
    scheduled: 'unknown',
    polls: 'unknown',
    notificationsLink: null,
    accountLink: null,
  },
  {
    name: 'empty metadata',
    meta: {},
    software: 'unknown',
    scheduled: 'unknown',
    polls: 'unknown',
    notificationsLink: null,
    accountLink: null,
  },
]

describe('server capabilities matrix', () => {
  it.each(rows)('$name', (row) => {
    const caps = detectServerCapabilities(row.meta)
    expect(caps.software).toBe(row.software)
    expect(caps.scheduledStatuses).toBe(row.scheduled)
    expect(caps.polls).toBe(row.polls)
    expect(serverSettingsUrl(caps, 'https://m.example/', 'notifications')).toBe(row.notificationsLink)
    expect(serverSettingsUrl(caps, 'https://m.example', 'account')).toBe(row.accountLink)
  })

  it('hides a feature only when the server positively lacks it', () => {
    expect(isFeatureAvailable('yes')).toBe(true)
    expect(isFeatureAvailable('unknown')).toBe(true)
    expect(isFeatureAvailable('no')).toBe(false)
  })

  it('lets explicit instance configuration override the per-software matrix', () => {
    const noPolls = detectServerCapabilities({
      version: '4.3.0',
      sourceUrl: 'https://github.com/mastodon/mastodon',
      configuration: { polls: { maxOptions: 0 }, translation: { enabled: true } },
    })
    expect(noPolls.polls).toBe('no')
    expect(noPolls.translation).toBe('yes')

    const unknownWithPolls = detectServerCapabilities({
      version: '1.0 (compatible; Other)',
      configuration: { polls: { maxOptions: 4 } },
    })
    expect(unknownWithPolls.software).toBe('unknown')
    expect(unknownWithPolls.polls).toBe('yes')
  })

  it('never invents settings URLs for unknown servers or missing base URLs', () => {
    expect(serverSettingsUrl(UNKNOWN_CAPABILITIES, 'https://x.example', 'export')).toBeNull()
    const caps = detectServerCapabilities(rows[0]!.meta)
    expect(serverSettingsUrl(caps, null, 'export')).toBeNull()
    expect(detectServerSoftware(null, null)).toBe('unknown')
    expect(detectServerSoftware('4.2.0', null)).toBe('mastodon')
  })

  it('does not share mutable state between detections', () => {
    const a = detectServerCapabilities(rows[0]!.meta)
    a.settingsPaths.export = '/mutated'
    expect(detectServerCapabilities(rows[0]!.meta).settingsPaths.export).toBe('/settings/export')
  })
})

describe('mapInstanceConfig', () => {
  it('stores limits and capabilities at probe time, keeping prior branding on refresh', () => {
    const first = mapInstanceConfig({
      title: 'Example',
      version: '4.3.0',
      sourceUrl: 'https://github.com/mastodon/mastodon',
      thumbnail: { url: 'https://x/t.png' },
      configuration: {
        statuses: { maxCharacters: 1000, maxMediaAttachments: 6 },
        mediaAttachments: { imageSizeLimit: 10, videoSizeLimit: 20, descriptionLimit: 1500 },
      },
    })
    expect(first.maxCharacters).toBe(1000)
    expect(first.mediaDescriptionLimit).toBe(1500)
    expect(first.capabilities?.software).toBe('mastodon')

    const refreshed = mapInstanceConfig({ title: '', version: '4.3.0' }, first)
    expect(refreshed.title).toBe('Example')
    expect(refreshed.thumbnail).toBe('https://x/t.png')
  })
})
