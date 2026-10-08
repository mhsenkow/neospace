/**
 * Tiny shell-facing handle for Edward Mode. The layout and suite menu only
 * need "is it on?" + a toggle — importing the full store would drag the
 * semantics / faces / explore helpers onto the boot path.
 */

import { ref } from 'vue'

/** Mirrors useEdwardStore().active (written by the store's enter/exit). */
export const edwardActive = ref(false)

export async function toggleEdward() {
  const { useEdwardStore } = await import('~/stores/edward')
  useEdwardStore().toggle()
}
