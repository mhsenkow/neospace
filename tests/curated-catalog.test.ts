import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
// @ts-expect-error plain .mjs build script
import { KNOWN_SOFTWARE, catalogBlocks, classifyInstance, patchBlock, patchCatalog } from '../scripts/instanceProbe.mjs'

const SOURCE = readFileSync(new URL('../app/composables/useCuratedInstances.ts', import.meta.url), 'utf8')

describe('curated catalog', () => {
  const blocks = catalogBlocks(SOURCE) as { domain: string; text: string }[]

  it('has unique domains', () => {
    const domains = blocks.map((b) => b.domain)
    expect(new Set(domains).size).toBe(domains.length)
  })

  it('every entry records software and a verification date from the probe', () => {
    for (const b of blocks) {
      const software = /software: '([^']+)'/.exec(b.text)?.[1]
      const verified = /verifiedAt: '(\d{4}-\d{2}-\d{2})'/.exec(b.text)?.[1]
      expect(KNOWN_SOFTWARE, `${b.domain} software`).toContain(software)
      expect(verified, `${b.domain} verifiedAt`).toBeTruthy()
    }
  })

  it('only Mastodon-API servers ship (no "other")', () => {
    for (const b of blocks) expect(b.text, b.domain).not.toContain("software: 'other'")
  })
})

describe('instance probe helpers', () => {
  it('classifies software from version / source_url', () => {
    expect(classifyInstance({ domain: 'a', version: '4.3.1' })).toBe('mastodon')
    expect(classifyInstance({ domain: 'a', version: '4.3.1+glitch' })).toBe('glitch')
    expect(classifyInstance({ domain: 'a', version: '2.7.0 (compatible; Akkoma 3.10)' })).toBe('akkoma')
    expect(classifyInstance({ domain: 'a', version: '2.7.0 (compatible; Pleroma 2.6.0)' })).toBe('pleroma')
    expect(classifyInstance({ domain: 'a', version: '0.1', source_url: 'https://github.com/superseriousbusiness/gotosocial' })).toBe('gotosocial')
  })

  it('rejects payloads that are not an instance document', () => {
    expect(classifyInstance(null)).toBeNull()
    expect(classifyInstance({ error: 'not found' })).toBeNull()
  })

  it('patchBlock updates existing keys and inserts missing ones before color', () => {
    const text = "\n  {\n    domain: 'x.example',\n    verifiedAt: '2026-01-01',\n    color: '#fff',\n  },"
    const out = patchBlock(text, { software: 'glitch', verifiedAt: '2026-10-12' })
    expect(out).toContain("verifiedAt: '2026-10-12'")
    expect(out).toMatch(/software: 'glitch',\n\s+color:/)
  })

  it('patchCatalog leaves entries without results untouched', () => {
    const src =
      "const CATALOG = [\n  {\n    domain: 'a.example',\n    color: '#1',\n  },\n  {\n    domain: 'b.example',\n    color: '#2',\n  },\n]\n"
    const out = patchCatalog(src, new Map([['a.example', { software: 'mastodon', verifiedAt: '2026-10-12' }]]))
    expect(out).toContain("domain: 'a.example',\n    verifiedAt")
    expect(out).toContain("domain: 'b.example',\n    color: '#2'")
  })
})
