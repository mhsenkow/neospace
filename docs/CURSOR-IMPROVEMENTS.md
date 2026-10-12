# NeoSpace: 20 prioritized improvements

Reviewed October 12, 2026. Ordered roughly by priority. Start with items 1–6.

Baseline: both typechecks, all 222 Vitest tests, and `npm run generate` passed. This was a local code review, not authenticated live-server validation. Reproduce each suspected defect before changing it; older audit findings and line references can be stale.

For each item, inspect surrounding code and existing tests, implement a focused change, and verify the relevant behavior. Run `npm run check` and `npm run generate` before considering a slice complete. Preserve unrelated local changes. Do not deploy or alter production secrets as part of this checklist.

- [x] **1. Make cross-server account actions unambiguous.**
  - Normalize authors to complete account identities before replies, profile navigation, mute, block, and report actions.
  - Inspect `app/stores/status.ts`, `app/components/RealPostCard.vue`, and federation helpers. `resolveAccount` currently accepts the first fuzzy search result.
  - Acceptance: same-named users on different servers cannot be confused; ambiguous resolution fails safely. Add regression coverage for foreign local handles and mismatched search results.

- [x] **2. Apply content warnings to the entire post.**
  - Inspect `app/components/RealPostCard.vue`. Link previews and polls currently render outside the collapsed warning gate.
  - Gate text, previews, poll options, and media consistently across supported card layouts.
  - Acceptance: collapsed warnings reveal no protected content; expanding and collapsing works with keyboard and pointer input.

- [x] **3. Clear old content when a column changes feeds.**
  - Inspect feed watchers and `fetchTimeline` in `app/components/TimelineColumn.vue`.
  - Preserve content during refreshes of the same feed, but reset posts, pending posts, cursors, and errors when feed identity changes.
  - Acceptance: old posts never appear beneath a new feed label, including failed fetches and rapid feed changes.

- [x] **4. Prevent silent gaps in busy timelines.**
  - Inspect `fetchNewSince` in `app/components/TimelineColumn.vue` and merged timeline helpers. Polls currently request 20 newer posts.
  - Implement bounded catch-up pagination or a visible gap marker with a recovery action. Maintain server-specific cursors.
  - Acceptance: more than 20 arrivals between polls do not silently disappear; account changes and rate limits remain safe.

- [x] **5. Stop navigation from silently replacing columns.**
  - Inspect `ensureFocusedView` and removal/undo behavior in `app/stores/columns.ts`.
  - Use a temporary view or an explicit replacement choice when the board has eight columns.
  - Acceptance: opening another view preserves the saved board unless the user deliberately replaces a column; cancellation and any offered undo work.

- [x] **6. Add browser tests for critical journeys.**
  - Introduce Playwright with mocked Mastodon API routes and an automated accessibility check.
  - Cover OAuth callback, account switching, composing, remote actions, feed changes, and mobile dialogs.
  - Wire the browser suite into CI. Use deterministic fixtures rather than live account credentials.
  - Acceptance: regressions in the critical journeys fail CI, and serious accessibility violations fail the selected checks.

- [x] **7. Make drafts a complete workflow.**
  - Inspect `app/components/ComposeSheet.vue`, `app/composables/useDraft.ts`, and composer draft keys.
  - Add “Save draft and close,” account-scoped storage, and a way to find saved drafts. Define migration and attachment-restoration behavior explicitly.
  - Acceptance: saving, reopening, discarding, and switching accounts preserve the intended draft without leaking it into another account.

- [x] **8. Mark notifications read intentionally.**
  - Inspect `app/pages/notifications.vue` and `app/stores/notifications.ts`. Page exit currently marks all loaded notifications read.
  - Track viewed notifications or provide an explicit mark-read action; respect filters and account scope.
  - Acceptance: notifications hidden by a filter retain unread state unless the user explicitly marks them read.

- [x] **9. Allow multiline messages on mobile.**
  - Inspect Enter handling in `app/components/ChatComposer.vue`.
  - Let touch users insert line breaks and send with the visible button. Preserve IME safeguards and a clear desktop keyboard convention.
  - Acceptance: mobile Enter inserts a newline; explicit send works; IME composition never triggers an accidental send.

- [x] **10. Harden Edward’s interaction lifecycle.**
  - Inspect Edward components, `app/stores/edward.ts`, the compose sheet, and queued stream state.
  - Reproduce reply cancellation, modal closure, account changes, and mute/block behavior while posts are queued. Keep cleanup owned by components or stores that remain mounted.
  - Acceptance: closing or cancelling compose restores interaction; excluded authors cannot return through queued posts; account changes reset relevant state.

- [x] **11. Finish managing your own posts.**
  - Inspect the post action menu, ownership checks, and status store.
  - Add delete, edit where supported, delete-and-redraft, and pin/unpin with appropriate confirmation and capability checks.
  - Acceptance: actions target the correct post and account, failures preserve recoverable state, and unsupported actions are not offered.
  - Note: edit-in-place UI deferred; delete, delete-and-redraft, and pin/unpin ship. Source fetch helper is in place for a future edit flow.

- [x] **12. Complete polls end to end.**
  - Add poll creation and voting, including multiple-choice support, expiry, and your-vote state.
  - Inspect `app/components/RealComposeBox.vue`, `app/components/RealPostCard.vue`, and status API helpers. Current cards display results without voting controls.
  - Acceptance: polls can be created and voted on through supported servers; expired polls cannot be voted on; remote polls resolve correctly; content warnings remain respected.

- [x] **13. Make scheduled posts manageable.**
  - Preserve the existing schedule picker and add a scheduled-post queue with inspect, cancel, and reschedule actions.
  - Scope requests and state to the selected account and handle unsupported servers.
  - Acceptance: a scheduled post appears in the queue, can be cancelled or rescheduled, and cannot be mistaken for a published post.

- [x] **14. Show meaningful upload progress.**
  - Inspect `app/composables/useComposeMedia.ts` and the upload transport. Existing abort controllers provide a starting point.
  - Add per-file transfer and processing states, clear cancellation, and retry. Avoid displaying invented percentages when the transport cannot report progress.
  - Acceptance: users can understand and cancel a slow upload, retry a failure, and post only after required processing and alt-text updates finish.

- [x] **15. Extend compose autocomplete.**
  - Generalize mention autocomplete to hashtags and custom emoji, with consistent keyboard navigation and accessible announcements.
  - Inspect `app/components/ComposeAutocomplete.vue` and composer token detection.
  - Acceptance: selecting a suggestion replaces only the intended token; stale results cannot cross accounts or overwrite newer input.

- [x] **16. Centralize server capabilities.**
  - Detect supported features, upload/posting limits, and settings destinations once, then consume that model throughout the UI.
  - Inspect instance metadata, settings deep links, compose limits, and existing fallbacks.
  - Acceptance: supported server software receives appropriate controls and destinations; unknown software degrades clearly and safely. Document and test the supported matrix.

- [x] **17. Split the largest components and stores.**
  - Start with `app/components/SettingsModal.vue` (3,429 lines at review) and `app/stores/instances.ts` (1,429 lines).
  - Extract settings panels and separate authentication, persistence, and timeline access behind stable interfaces. Make this an incremental behavior-preserving refactor.
  - Acceptance: existing journeys and checks pass after each slice; responsibilities and state ownership are easier to identify.

- [x] **18. Strengthen feedback privacy and abuse controls.**
  - Inspect `app/utils/feedback.ts`, `functions/api/feedback.ts`, and `functions/utils/rateLimit.ts`.
  - Let users preview and opt into diagnostic logs before creating public issues. Retain redaction and reduce unnecessary identifying details.
  - Define and verify enforceable production rate limits and bot protection. The current limiter is local to each runtime instance; production configuration was not verified during this review.
  - Acceptance: submitted diagnostics match the user’s choice; sensitive fields remain redacted; missing/invalid verification and rate-limit branches have meaningful tests. Document any required operational setup.

- [x] **19. Self-host the fonts actually used.**
  - Inspect `app/utils/loadFonts.ts`, the appearance catalog, and security headers.
  - Serve selected families and weights locally, loading only what the active appearance needs. Preserve OpenDyslexic support.
  - Acceptance: appearance controls work without Google Fonts requests, startup remains stable, and obsolete font origins are removed from CSP after verification.

- [x] **20. Make release evidence and documentation trustworthy.**
  - Replace the successful no-op lint command with a real check or remove the misleading script. Resolve actionable build/typecheck warnings.
  - Establish traceable deployments and reconcile README, STATUS, architecture docs, and the deferred plan with actual behavior.
  - Correct known drift: mobile settings navigation already ships, scheduling already ships, and app typechecking now passes and runs in CI.
  - Acceptance: documented commands match their behavior, completed work leaves the open roadmap, releases identify the checked commit, and readiness is measured through critical journeys rather than audit checkbox totals.
