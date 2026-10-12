import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const DOCKERFILE = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')

describe('Dockerfile', () => {
  const froms = DOCKERFILE.split('\n').filter((l) => /^FROM\s/.test(l))

  it('pins every base image by sha256 digest', () => {
    expect(froms.length).toBeGreaterThanOrEqual(2)
    for (const line of froms) expect(line).toMatch(/@sha256:[0-9a-f]{64}/)
  })

  it('serves from a current nginx branch, not the ended 1.27', () => {
    expect(DOCKERFILE).not.toContain('nginx-unprivileged:1.27')
  })
})
