import { ref } from 'vue'

/**
 * Bumped whenever the OS colour scheme / contrast preference changes, so "Auto"
 * labels (which read matchMedia, not reactive state) recompute.
 */
export const osSchemeTick = ref(0)

export function bumpOsScheme() {
  osSchemeTick.value += 1
}
