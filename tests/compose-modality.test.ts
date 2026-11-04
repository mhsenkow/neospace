import { describe, expect, it } from 'vitest'
import {
  emptyModalityPrefs,
  modalityFromPost,
  modalityIcon,
  preferredFromPrefs,
  recordModalitySuccess,
} from '../app/composables/useComposeModality'

describe('compose modality prefs', () => {
  it('defaults to write with empty counts', () => {
    expect(preferredFromPrefs(emptyModalityPrefs())).toBe('write')
    expect(modalityIcon('write')).toBe('pen')
  })

  it('prefers media once photo posts outpace text', () => {
    let prefs = emptyModalityPrefs()
    prefs = recordModalitySuccess(prefs, 'write')
    prefs = recordModalitySuccess(prefs, 'media')
    prefs = recordModalitySuccess(prefs, 'media')
    expect(preferredFromPrefs(prefs)).toBe('media')
    expect(modalityIcon('media')).toBe('camera')
  })

  it('prefers media on a write/media tie (photo optimization)', () => {
    let prefs = emptyModalityPrefs()
    prefs = recordModalitySuccess(prefs, 'write')
    prefs = recordModalitySuccess(prefs, 'media')
    expect(preferredFromPrefs(prefs)).toBe('media')
  })

  it('honors a manual override over counts', () => {
    let prefs = emptyModalityPrefs()
    prefs = recordModalitySuccess(prefs, 'media')
    prefs = recordModalitySuccess(prefs, 'media')
    prefs = { ...prefs, override: 'write' }
    expect(preferredFromPrefs(prefs)).toBe('write')
  })

  it('infers modality from a successful post', () => {
    expect(modalityFromPost({ hasMedia: true })).toBe('media')
    expect(modalityFromPost({ hasMedia: false })).toBe('write')
    expect(modalityFromPost({ hasMedia: false, hasVoice: true })).toBe('voice')
  })
})
