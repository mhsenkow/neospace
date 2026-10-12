/**
 * Which profile metadata field carries a person's custom CSS.
 *
 * `css`, `custom_css` and `chaos_css` are unambiguous. `theme` / `style` are also
 * ordinary labels ("Style: Jazz"), so those only count when the value looks like CSS —
 * otherwise a normal field is hidden from viewers and fed to the sanitizer.
 */

type NamedField = { name?: string | null; value?: string | null }

const STRONG_CSS_FIELDS = new Set(['css', 'custom_css', 'chaos_css'])
const AMBIGUOUS_CSS_FIELDS = new Set(['theme', 'style'])

/** Same key rule the CSS lookup has always used: lowercase, letters and underscores only */
export const cssFieldKey = (name: string | null | undefined) =>
  (name || '').toLowerCase().replace(/[^a-z_]/g, '')

const looksLikeCss = (value: string | null | undefined) => (value || '').includes('{')

export function isProfileCssField(field: NamedField): boolean {
  const key = cssFieldKey(field.name)
  if (STRONG_CSS_FIELDS.has(key)) return true
  return AMBIGUOUS_CSS_FIELDS.has(key) && looksLikeCss(field.value)
}

/** The CSS text from a profile's fields, or '' */
export function extractProfileCss(fields: NamedField[] | null | undefined): string {
  return fields?.find(isProfileCssField)?.value || ''
}

/** NeoSpace's own column-layout field (kept out of the visible profile tokens) */
export const isColumnsField = (field: NamedField) =>
  (field.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'neospacecolumns'
