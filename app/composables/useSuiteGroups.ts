/**
 * Suite tool groups for NeoSpace — shared by the desktop waffle (SuiteMenu) and the
 * mobile drawer, so both list the same tools (incl. the Edward entry) with the same copy.
 */

import { edwardActive, toggleEdward } from '~/utils/edwardShell'
import { suiteGroups, type SuiteGroup } from '~/utils/suiteCatalog'

/** Where Edward is announced; kept in one place with its keyboard shortcut. */
export const EDWARD_BLURB = 'lean back · watch posts float by'
export const EDWARD_SHORTCUT_LABEL = 'Alt+Shift+E'

export function useSuiteGroups() {
  return computed<SuiteGroup[]>(() =>
    suiteGroups({
      currentId: 'neospace',
      extraGroups: [
        {
          id: 'play',
          label: 'play',
          tools: [
            {
              id: 'edward',
              label: 'edward',
              blurb: EDWARD_BLURB,
              current: edwardActive.value,
              action: () => void toggleEdward(),
            },
          ],
        },
      ],
    }),
  )
}

/** Alt+Shift+E toggles Edward from anywhere (physical key, so Option's glyphs don't matter). */
export function isEdwardShortcut(e: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code' | 'defaultPrevented' | 'isComposing'>): boolean {
  return (
    !e.defaultPrevented &&
    !e.isComposing &&
    e.altKey &&
    e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    e.code === 'KeyE'
  )
}
