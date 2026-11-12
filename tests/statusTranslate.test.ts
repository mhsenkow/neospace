import { describe, expect, it } from 'vitest'
import { fetchStatusTranslation, languagesDiffer } from '../app/utils/statusTranslate'

describe('languagesDiffer', () => {
  it('treats regional variants as the same language', () => {
    expect(languagesDiffer('en-US', 'en')).toBe(false)
    expect(languagesDiffer('pt_BR', 'pt')).toBe(false)
  })

  it('is true only when both languages are known and different', () => {
    expect(languagesDiffer('ja', 'en')).toBe(true)
    expect(languagesDiffer('', 'en')).toBe(false)
    expect(languagesDiffer('fr', null)).toBe(false)
  })
})

describe('fetchStatusTranslation', () => {
  it('posts to the status translate endpoint and reads the body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(
        JSON.stringify({
          content: '<p>Bonjour</p>',
          detected_source_language: 'fr',
          provider: 'DeepL',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const result = await fetchStatusTranslation(
      '123',
      { url: 'https://mastodon.social/', accessToken: 'tok' },
      fetchImpl,
    )

    expect(result).toEqual({
      content: '<p>Bonjour</p>',
      spoilerText: '',
      detectedSourceLanguage: 'fr',
      provider: 'DeepL',
    })
    expect(calls[0]?.url).toBe('https://mastodon.social/api/v1/statuses/123/translate')
    expect(calls[0]?.init?.method).toBe('POST')
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('rejects an empty translation', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ content: '  ' }), { status: 200 })
    await expect(
      fetchStatusTranslation('1', { url: 'https://example.com', accessToken: 't' }, fetchImpl),
    ).rejects.toThrow(/Empty translation/)
  })
})
