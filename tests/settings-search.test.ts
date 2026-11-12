import { describe, expect, it } from 'vitest'
import { firstSettingsTarget } from '../app/stores/settings'

describe('firstSettingsTarget', () => {
  it('names the control a short query is heading for', () => {
    expect(firstSettingsTarget('radius')?.id).toBe('setting-radius')
    expect(firstSettingsTarget('sensitive')?.id).toBe('setting-sensitive')
    expect(firstSettingsTarget('bio')?.category).toBe('profile')
  })

  it('ignores a single character so the sidebar is not yanked around', () => {
    expect(firstSettingsTarget('r')).toBeNull()
    expect(firstSettingsTarget('  ')).toBeNull()
  })
})
