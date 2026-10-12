import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error plain .mjs build script
import { BUILD_INFO_FILE, buildInfo, treeDigest, verifyBuildInfo } from '../scripts/build-info.mjs'

let dir: string
const env = { GITHUB_SHA: 'abc123', GITHUB_RUN_ID: '42' }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'neo-build-'))
  mkdirSync(join(dir, '_nuxt'))
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  writeFileSync(join(dir, '_nuxt', 'app.js'), 'console.log(1)')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const stamp = (e = env) =>
  writeFileSync(join(dir, BUILD_INFO_FILE), JSON.stringify(buildInfo(dir, e, new Date(0))))

describe('build provenance', () => {
  it('records the commit and run alongside a digest of the artifact', () => {
    const info = buildInfo(dir, env, new Date(0))
    expect(info).toMatchObject({ commit: 'abc123', runId: '42', fileCount: 2 })
    expect(info.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the digest ignores build-info.json itself', () => {
    const before = treeDigest(dir)
    stamp()
    expect(treeDigest(dir)).toBe(before)
  })

  it('verifies the artifact that was checked', () => {
    stamp()
    expect(verifyBuildInfo(dir, env)).toBeNull()
  })

  it('refuses an artifact built from a different commit', () => {
    stamp()
    expect(verifyBuildInfo(dir, { GITHUB_SHA: 'def456' })).toMatch(/built from abc123/)
  })

  it('refuses an artifact edited after the check', () => {
    stamp()
    writeFileSync(join(dir, 'index.html'), '<html>tampered</html>')
    expect(verifyBuildInfo(dir, env)).toMatch(/digest mismatch/)
  })

  it('refuses an artifact that never went through CI', () => {
    expect(verifyBuildInfo(dir, env)).toMatch(/missing build-info/)
    stamp({} as never)
    expect(verifyBuildInfo(dir, env)).toMatch(/no commit/)
  })
})
