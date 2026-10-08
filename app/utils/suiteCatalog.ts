/**
 * ibm.io suite waffle catalog — same quiet map as wordcount's suite.js.
 * Think tools first (bruh → loom → notebook → words → neospace), then home.
 */

export type SuiteTool = {
  id: string
  label: string
  blurb: string
  href?: string
  current?: boolean
  action?: () => void
}

export type SuiteGroup = {
  id: string
  label: string
  tools: SuiteTool[]
}

export const SUITE_HOME = 'https://ibm.io/'
export const SUITE_TOOLS_MAP = 'https://ibm.io/tools/'

export const SUITE_URLS = {
  bruh: 'https://bruh.ibm.io/',
  loom: 'https://loom.ibm.io/',
  notebook: 'https://ibm.io/notebook/',
  wordcount: 'https://ibm.io/wordcount/',
  neospace: 'https://neospace.ibm.io/',
  ibm: SUITE_HOME,
} as const

/** Waffle groups for NeoSpace. `currentId` marks the active instrument. */
export function suiteGroups(opts?: {
  currentId?: string
  extraGroups?: SuiteGroup[]
}): SuiteGroup[] {
  const currentId = opts?.currentId ?? 'neospace'
  const mark = (id: string, tool: Omit<SuiteTool, 'current'>): SuiteTool => ({
    ...tool,
    current: id === currentId,
  })

  const groups: SuiteGroup[] = [
    {
      id: 'think',
      label: 'think',
      tools: [
        mark('bruh', {
          id: 'bruh',
          label: 'bruh',
          blurb: 'ideas · paper',
          href: SUITE_URLS.bruh,
        }),
        mark('loom', {
          id: 'loom',
          label: 'loom',
          blurb: 'data · stories',
          href: SUITE_URLS.loom,
        }),
        mark('notebook', {
          id: 'notebook',
          label: 'notebook',
          blurb: 'cells · teach',
          href: SUITE_URLS.notebook,
        }),
        mark('wordcount', {
          id: 'wordcount',
          label: 'words',
          blurb: 'count · draft',
          href: SUITE_URLS.wordcount,
        }),
        mark('neospace', {
          id: 'neospace',
          label: 'neospace',
          blurb: 'people · feed',
          href: SUITE_URLS.neospace,
        }),
      ],
    },
    {
      id: 'connect',
      label: 'connect',
      tools: [
        mark('ibm', {
          id: 'ibm',
          label: 'ibm.io',
          blurb: 'home · work',
          href: SUITE_URLS.ibm,
        }),
      ],
    },
  ]

  if (opts?.extraGroups?.length) groups.push(...opts.extraGroups)
  return groups
}
