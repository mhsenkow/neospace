import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('build-prepaint', () => {
  it('regenerates public/boot/prepaint.js identically from appearance.ts', () => {
    const committed = readFileSync(join(root, 'public/boot/prepaint.js'), 'utf8')
    const dir = mkdtempSync(join(tmpdir(), 'prepaint-'))
    try {
      mkdirSync(join(dir, 'app/utils'), { recursive: true })
      mkdirSync(join(dir, 'public/boot'), { recursive: true })
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      copyFileSync(join(root, 'app/utils/appearance.ts'), join(dir, 'app/utils/appearance.ts'))
      copyFileSync(join(root, 'scripts/build-prepaint.mjs'), join(dir, 'scripts/build-prepaint.mjs'))
      // Seed a divergent file so a no-op bug would still fail the equality check
      writeFileSync(join(dir, 'public/boot/prepaint.js'), '/* stale */\n')
      execFileSync(process.execPath, ['scripts/build-prepaint.mjs'], { cwd: dir })
      const regenerated = readFileSync(join(dir, 'public/boot/prepaint.js'), 'utf8')
      expect(regenerated).toBe(committed)
      expect(regenerated).toContain('data-theme')
      expect(regenerated.length).toBeGreaterThan(500)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
