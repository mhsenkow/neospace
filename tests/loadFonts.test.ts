import { describe, expect, it } from 'vitest'
import { SELF_HOSTED_FONT_FAMILIES } from '../app/utils/loadFonts'

describe('self-hosted fonts', () => {
  it('covers the appearance chrome families without Google Fonts', () => {
    expect(SELF_HOSTED_FONT_FAMILIES).toContain('Source Sans 3')
    expect(SELF_HOSTED_FONT_FAMILIES).toContain('IBM Plex Sans')
    expect(SELF_HOSTED_FONT_FAMILIES).toContain('Newsreader')
    expect(SELF_HOSTED_FONT_FAMILIES.length).toBeGreaterThanOrEqual(12)
  })
})
