import { describe, expect, it } from 'vitest'
import { isNotebookOrigin } from '../app/utils/notebookHandoff'

describe('isNotebookOrigin', () => {
  it('trusts the suite and local dev', () => {
    expect(isNotebookOrigin('https://ibm.io')).toBe(true)
    expect(isNotebookOrigin('https://notebook.ibm.io')).toBe(true)
    expect(isNotebookOrigin('https://throughline.mhsenkow.workers.dev')).toBe(true)
    expect(isNotebookOrigin('http://localhost:5173')).toBe(true)
  })

  it('rejects look-alike hosts anyone can register', () => {
    expect(isNotebookOrigin('https://evil-notebook.pages.dev')).toBe(false)
    expect(isNotebookOrigin('https://throughline-x.workers.dev')).toBe(false)
    expect(isNotebookOrigin('https://ibm.io.evil.com')).toBe(false)
    expect(isNotebookOrigin('https://evilibm.io')).toBe(false)
    expect(isNotebookOrigin('http://notebook.ibm.io')).toBe(false)
    expect(isNotebookOrigin('null')).toBe(false)
  })
})
