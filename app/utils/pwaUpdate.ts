/**
 * When a waiting service worker may take over (which reloads the page).
 * Reloading mid-use drops attachments, open threads, scroll and Edward state, so an
 * update is applied only when the tab is hidden and nothing modal (compose, dialog) is open;
 * otherwise the user gets an "Update ready" toast with a Reload button.
 */
export function canApplyUpdateNow(state: { hidden: boolean; modalOpen: boolean }): boolean {
  return state.hidden && !state.modalOpen
}
