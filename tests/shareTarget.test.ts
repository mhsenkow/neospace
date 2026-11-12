import { describe, expect, it } from 'vitest'
import { composeShareText, shareTargetIntent } from '../app/utils/shareTarget'

describe('composeShareText', () => {
  it('joins a title, body, and https link', () => {
    expect(
      composeShareText({
        title: 'Field notes',
        text: 'Saw the heron again.',
        url: 'https://example.com/heron',
      }),
    ).toBe('Field notes\n\nSaw the heron again.\n\nhttps://example.com/heron')
  })

  it('skips a title or link already present in the body', () => {
    expect(
      composeShareText({
        title: 'Field notes',
        text: 'Field notes\nhttps://example.com/heron',
        url: 'https://example.com/heron',
      }),
    ).toBe('Field notes\nhttps://example.com/heron')
  })

  it('drops non-http urls', () => {
    expect(composeShareText({ text: 'hi', url: 'javascript:alert(1)' })).toBe('hi')
  })
})

describe('shareTargetIntent', () => {
  it('opens an empty composer for the home shortcut', () => {
    expect(shareTargetIntent('/', { compose: '1' })).toEqual({ text: '' })
  })

  it('leaves thread-page compose=1 to the peek handoff', () => {
    expect(shareTargetIntent('/status/abc', { compose: '1', draft: 'hello' })).toBeNull()
  })

  it('builds a draft from share_target params', () => {
    expect(
      shareTargetIntent('/', {
        compose: 'share',
        title: 'A link',
        text: 'Worth reading',
        url: 'https://example.com/a',
      }),
    ).toEqual({ text: 'A link\n\nWorth reading\n\nhttps://example.com/a' })
  })

  it('ignores unrelated queries', () => {
    expect(shareTargetIntent('/', { account: 'a' })).toBeNull()
  })
})
