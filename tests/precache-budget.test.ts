import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs build script
import { BUDGET, check, precacheUrls } from '../scripts/precache-budget.mjs'

describe('precache budget', () => {
  it('reads precache urls from a generated service worker', () => {
    const sw = 'precacheAndRoute([{url:"_nuxt/a.js",revision:null},{url:"index.html",revision:"x"}])'
    expect(precacheUrls(sw)).toEqual(['_nuxt/a.js', 'index.html'])
  })

  it('passes a lean precache', () => {
    expect(check({ entries: 158, bytes: 2_700_000, fonts: [] })).toEqual([])
  })

  it('fails when a font face is precached again', () => {
    const problems = check({ entries: 10, bytes: 1000, fonts: ['_nuxt/x-latin-400-normal.woff2'] })
    expect(problems[0]).toMatch(/font file/)
  })

  it('fails when the precache outgrows the budget', () => {
    const problems = check({ entries: BUDGET.maxEntries + 1, bytes: BUDGET.maxBytes + 1, fonts: [] })
    expect(problems).toHaveLength(2)
  })
})
