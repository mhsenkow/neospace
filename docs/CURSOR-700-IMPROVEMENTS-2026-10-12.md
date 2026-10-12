# NeoSpace — 700 fixes and improvements after the October 12 implementation

Reviewed October 12, 2026 against `069e5a4`. This is a Cursor work queue, not a claim that the project has 700 independently reproduced bugs.

**Provenance:** items NS-001–NS-100 come from this current implementation review. Items NS-101–NS-700 are remaining candidates from the October 9 audit, filtered to existing explicitly cited files that are byte-for-byte unchanged since `b82137e`. Completed work in changed files, selected overlaps, duplicate actions, and obsolete cross-item instructions were excluded. An unchanged source anchor does not prove unchanged behavior in its dependencies; reproduce each A item before implementing it.

## Evidence and priorities

- **R:** reproduced in a local mocked browser or standalone code experiment during this pass. Not authenticated production validation.
- **C:** the relevant current implementation was read during this pass and supports the stated gap/risk; server-dependent behavior still needs a targeted test.
- **I:** intentional improvement or verification work, not a claim of an existing defect.
- **A:** prior-audit candidate with unchanged explicit source anchors; inspect first and close as not applicable if current behavior already meets the goal.
- **P1:** user trust, data/account safety, inaccessible core behavior, or critical regression protection. **P2:** routine correctness, recovery, performance, and maintainability. **P3:** polish or lower-risk improvement.
- For carried items, lens and effort come from the previous audit and remain estimates: UX, DESIGN, A11Y, CODE, PERF, SEC, TOOLING; S/M/L effort.

## Current baseline

- `npm run check`: both typechecks and 288 tests in 23 files passed.
- `npm run generate`: passed. Generated service-worker precache: 288 entries, 4,270.31 KiB.
- Chromium: all seven existing journeys passed against generated output via a temporary localhost server. Their assertions are shallow, so this is not comprehensive journey verification.
- The default browser-test server failed to fetch undeclared `serve` from npm in the restricted environment. The temporary local server avoided that download.
- The configured mobile project could not start because the required WebKit binary was absent. This is a test-environment limitation, not seven demonstrated app failures. Mobile viewport inspection was performed separately in Chromium.
- Additional mocked local inspection: authenticated home at 1280px and 375px, profile at 375px, Search at 375px, and Y-themed home at 1280px. Loaded feeds triggered critical `aria-required-children`; Y navigation triggered serious contrast findings; profile tabs overflowed their 360px container to 465px; shared focus color was missing in light and Y.
- A malformed mocked unread-count response exposed a visible `NaN` Activity badge. This motivates boundary validation; it is not evidence that production servers normally return that payload.
- A standalone sanitizer experiment retained `position:fixed` after a blocked declaration marker and allowed an empty selector to target the profile container. These inputs need browser containment regression tests.
- Existing `.claude/` content was left untouched. No app implementation or production settings were changed by this review.

## Implementation rules for Cursor

Work in small coherent slices. Start with P1 items, especially NS-001, NS-002, NS-004–NS-006, NS-010, NS-015–NS-017, NS-021–NS-022, NS-025–NS-026, NS-032, NS-035–NS-036, NS-062, NS-068, and NS-086–NS-088, plus the P1 security/settings candidates later in this file. Reproduce A items before editing. Reuse existing primitives and capability models. Add behavior tests where they protect real risk; do not create tests that merely duplicate implementation. Record not-applicable findings with evidence rather than forcing changes to satisfy the number. Run the relevant checks for each slice and the full available gates before release.

For each item, completion means the specified behavior works, relevant account/race/error paths are checked, and the checkbox is updated with the checked commit or a short evidence note. Product alternatives marked decision are proposals: choose a concrete consistent behavior before implementation. Security changes should be verified without weakening sanitizer or account boundaries.

**External reference for NS-001:** Mastodon distinguishes a lower-bound `since_id` from forward pagination with `min_id` in its [timeline API documentation](https://docs.joinmastodon.org/methods/timelines/#view-public-timeline). The current loop advances the lower bound to the newest result; test an interval larger than one page before considering catch-up fixed.

## Queue index

| Section | Items |
|---|---:|
| Current implementation review | 100 |
| Remaining candidates: Accounts, auth & server picking | 74 |
| Remaining candidates: App shell, navigation & shared UI primitives | 100 |
| Remaining candidates: Board & columns | 42 |
| Remaining candidates: Edward (lean-back 3D discovery mode) | 31 |
| Remaining candidates: Groups (hashtag groups) & ranked-feed algorithms | 86 |
| Remaining candidates: Platform, security, handoffs, build/deploy, tests & docs | 20 |
| Remaining candidates: Posts & compose | 32 |
| Remaining candidates: Profile, Explore & Search | 90 |
| Remaining candidates: Settings, theming & design system | 40 |
| Remaining candidates: Threads, notifications & direct messages | 85 |
| **Total** | **700** |

## New pass: timeline and destructive-action correctness

- [x] **NS-001 · P1 · C — Fix catch-up pagination direction.**
  - **Target:** [app/components/TimelineColumn.vue:892](/Users/powerox/neospace/app/components/TimelineColumn.vue:892).
  - **Change:** Use forward min_id pagination or a fixed since_id with descending max_id windows; advancing since_id to the newest returned post skips intermediate arrivals.
  - **Done when:** A fixture with 75 arrivals returns all 75 exactly once, using Mastodon's documented cursor semantics.
  - Evidence: `TimelineColumn.vue` now pages each server forward with `min_id` via `app/utils/catchUp.ts`; `tests/catchUp.test.ts` shows the old `since_id` walk returns 20 of 75 and the new walk returns all 75 exactly once (also resumes losslessly across polls after the page cap).

- [x] **NS-002 · P1 · C — Commit polling cursors only for the current feed.**
  - **Target:** [app/components/TimelineColumn.vue:916](/Users/powerox/neospace/app/components/TimelineColumn.vue:916).
  - **Change:** Keep cursor and gap updates local until the fetch generation is checked; fetchNewSince currently mutates them before pollForNew rejects a stale result.
  - **Done when:** Switch feeds during a delayed poll; the new feed retains only its own cursors and gap state.
  - Evidence: `fetchNewSince` is now pure (local cursor copy via `seedSinceCursors`, no `refreshSinceCursors` mutation); `pollForNew` commits `sinceCursors` / `gapSources` only after `gen === fetchGen`. Purity covered in `tests/catchUp.test.ts`; the live feed-switch race was not exercised in a browser.

- [x] **NS-003 · P2 · I — Track catch-up exhaustion per server.**
  - **Target:** [app/components/TimelineColumn.vue:301](/Users/powerox/neospace/app/components/TimelineColumn.vue:301).
  - **Change:** Use per-source completion rather than the merged batch length to decide whether more catch-up is needed.
  - **Done when:** A busy server and a quiet server can independently finish or expose a recoverable gap.
  - Evidence: one `CatchUpSource` per server with its own `settled` / `capped` / `failed` outcome; `gapSources` clears per source (`nextGapSources`). Busy-capped + quiet-settled + failed-server cases in `tests/catchUp.test.ts`. Gap banner copy updated (data is no longer skipped, only pending).

- [x] **NS-004 · P1 · C — Use canonical identities for post-deletion events.**
  - **Target:** [app/components/TimelineColumn.vue:563](/Users/powerox/neospace/app/components/TimelineColumn.vue:563).
  - **Change:** Replace bare status-id deletion payloads with origin-aware post identities; current removal compares ids and reblog ids alone.
  - **Done when:** Deleting one post cannot remove a distinct post with the same id on another server.
  - Evidence: deletions match by canonical identity (uri/url) or same-origin-host id via `app/utils/deletedStatus.ts`; `TimelineColumn.vue` uses `dropDeletedStatus` instead of bare id compare. Same-id/other-server case in `tests/status-management.test.ts`.

- [x] **NS-005 · P1 · C — Bind delete confirmations to an account.**
  - **Target:** [app/components/RealPostCard.vue:738](/Users/powerox/neospace/app/components/RealPostCard.vue:738).
  - **Change:** Capture account and post identity before opening confirmation, revalidate after it closes, and call an explicitly account-bound delete API.
  - **Done when:** Switching accounts while confirmation is open cannot delete through the newly active account.
  - Evidence: `RealPostCard.vue` captures `ManageTarget` (account + post) before the confirm, revalidates with `stillManageable`, and calls `statusStore.deleteStatus(id, accountId)` / `pinStatus` / `unpinStatus`, which resolve credentials by captured account id (`credentialsForAccount`), not the active account. `MessageBubble.vue` bound the same way. Store behavior tested in `tests/status-management.test.ts`.

- [x] **NS-006 · P1 · C — Bind redraft source and deletion to one account.**
  - **Target:** [app/components/RealPostCard.vue:763](/Users/powerox/neospace/app/components/RealPostCard.vue:763).
  - **Change:** Keep source retrieval, deletion, and reopened composition attached to the same captured account across awaits.
  - **Done when:** An account switch between source retrieval and deletion cannot cross account boundaries.
  - Evidence: `handleRedraft` uses the captured account for source fetch and delete, rechecks `stillManageable` after each await, and only opens the composer if that account is still active (otherwise toasts that the redraft is saved in Drafts).

- [x] **NS-007 · P1 · I — Recover redrafts before destructive deletion.**
  - **Target:** [app/components/RealPostCard.vue:763](/Users/powerox/neospace/app/components/RealPostCard.vue:763).
  - **Change:** Save a recoverable text/CW/visibility snapshot before deleting, and clear it only after the replacement is posted or deliberately discarded.
  - **Done when:** Closing or crashing immediately after deletion leaves a recoverable redraft.
  - Evidence: `saveRedraftSnapshot` writes text/CW/visibility to the account-scoped `redraft:<id>` draft slot before the DELETE (no snapshot, no delete); the composer already clears that slot on post / confirmed discard, and `discardRedraftSnapshot` removes it when the server definitely refused the delete. Covered in `tests/status-management.test.ts`.

- [x] **NS-008 · P2 · C — Distinguish unavailable post source from failed fetch.**
  - **Target:** [app/stores/status.ts:362](/Users/powerox/neospace/app/stores/status.ts:362).
  - **Change:** Return typed unsupported/network/auth outcomes instead of swallowing every error as null; redraft should not mistake a transient failure for an unsupported source API.
  - **Done when:** An offline source fetch preserves the original post and offers retry.
  - Evidence: `fetchStatusSource` returns `{ ok: true, ... } | { ok: false, reason: 'unsupported' | 'auth' | 'network' | 'unknown' }`; only `unsupported` falls back to rendered HTML, other failures abort with the original post intact and a Retry toast. Classifier + 404/offline store cases tested.

- [x] **NS-009 · P2 · I — Synchronize deletion across every mounted surface.**
  - **Target:** [app/components/RealPostCard.vue:129](/Users/powerox/neospace/app/components/RealPostCard.vue:129).
  - **Change:** Publish an account-scoped canonical deletion event consumed by board, profile, thread, search, and discovery caches.
  - **Done when:** A deleted post disappears consistently from every visible copy without a full refresh.
  - **Done:** Every surface that holds statuses now subscribes to the account-scoped `onDeletedStatus` event: board columns, profile store, thread page (earlier), plus search results / tag timeline (`useFediverseSearch`, used by Explore), panel columns' remote-profile and search lists (`PanelColumn`), the open group timeline (`groups` store + `groups/[tag].vue`) and Edward Mode (stage, selection/focus/history, and the stream backpack so a deleted post can't drip in later). Tests: `tests/deleted-surfaces.test.ts`, `tests/edwardStream.test.ts` (backpack purge).

- [x] **NS-010 · P1 · C — Require proven provenance before management actions.**
  - **Target:** [app/components/RealPostCard.vue:347](/Users/powerox/neospace/app/components/RealPostCard.vue:347).
  - **Change:** Replace the allow-when-source-is-missing fallback with a verified account identity and origin check.
  - **Done when:** Missing provenance or a same-id remote author cannot expose delete or pin actions.
  - Evidence: `canManageOwn` now uses `provenOwnStatus` (author id AND origin tag matching the acting server; missing provenance fails closed). Profile lists and thread fetches are now stamped with the serving host (`profile.ts`, `status.ts#fetchThread`). Untagged surfaces (explore/search, groups page, PanelColumn) intentionally no longer show delete/pin.

## New pass: browser-test integrity

- [x] **NS-011 · P1 · C — Exercise a valid OAuth exchange.**
  - **Target:** [e2e/journeys/smoke.spec.ts:23](/Users/powerox/neospace/e2e/journeys/smoke.spec.ts:23).
  - **Change:** Seed valid pending state, verifier, and target account; assert the token request and resulting signed-in state. The current callback test accepts an attached Nuxt root.
  - **Done when:** The test fails if valid OAuth no longer exchanges a code or establishes the account.
  - Evidence: `smoke.spec.ts` seeds the pending state/verifier, client secret and target slot (`seedPendingOAuth`), arms the mock token endpoint with the exact code, verifier, client id/secret and redirect URI, and asserts one `/oauth/token` POST, a `verify_credentials` call with the new bearer token, the persisted `activeAccountId`/token, the cleared pending record, and the signed-in UI. Mismatched-state and rejected-code cases assert no token request / no sign-in.

- [x] **NS-012 · P1 · C — Test posting through the browser.**
  - **Target:** [e2e/journeys/compose-feed.spec.ts:10](/Users/powerox/neospace/e2e/journeys/compose-feed.spec.ts:10).
  - **Change:** Type a post, submit, assert the request payload and visible returned post, then verify the draft is cleared.
  - **Done when:** A broken submit handler or wrong visibility fails the browser test.
  - Evidence: `compose-feed.spec.ts` types in the New post sheet, picks Unlisted, posts, and asserts the POST target/token/body (`status`, `visibility: 'unlisted'`), the returned post in the feed, the closed sheet, and the cleared `neospace_draft:local-1:new` slot (empty on reopen). A refused post (422) keeps text + draft and adds no phantom post. Not verified: composer initial focus — in the sheet it lands on Cancel, not the textarea, despite the `initialFocus` selector (observed, not changed).

- [x] **NS-013 · P1 · I — Test actual account switching.**
  - **Target:** [e2e/journeys/smoke.spec.ts:31](/Users/powerox/neospace/e2e/journeys/smoke.spec.ts:31).
  - **Change:** Seed two accounts with distinct home feeds and switch between them through the UI.
  - **Done when:** Account identity, feed content, and posting target all change together.
  - Evidence: new `accounts.spec.ts` seeds two accounts on different mock servers with distinct home feeds, switches via the account sheet, and asserts together: switcher identity + "Posting as" toast, home feed content swapped (second-server token on `/timelines/home`), the next POST going to the second server with its token (none to the first), and persisted `activeAccountId`. Switching back is covered too.

- [x] **NS-014 · P1 · C — Fail on unhandled mocked API requests.**
  - **Target:** [e2e/helpers/mockApi.ts:57](/Users/powerox/neospace/e2e/helpers/mockApi.ts:57).
  - **Change:** Replace the blanket empty-success fallback with explicit optional-probe fixtures and failures for unrecognized requests.
  - **Done when:** A misspelled endpoint or unintended mutation fails the relevant journey.
  - Evidence: `mockApi.ts` no longer has an empty-success fallback. Handlers are explicit per server (bearer required), optional read-only probes are an enumerated table, and anything else is answered 501, recorded, and fails the test at teardown via the auto `api` fixture in `helpers/test.ts`. Verified with a scratch test hitting a misspelled endpoint (failed with the request listed).

- [x] **NS-015 · P1 · C — Wait for meaningful readiness before axe.**
  - **Target:** [e2e/journeys/smoke.spec.ts:10](/Users/powerox/neospace/e2e/journeys/smoke.spec.ts:10).
  - **Change:** Wait for settled feed/error content and key interactive controls before scanning; body visibility alone can scan the loading shell.
  - **Done when:** Accessibility failures in loaded content are detected consistently.
  - Evidence: guest and authenticated axe scans now wait for the feed with real fixture posts (plus compose/account controls and no loading status) via `expectNoSeriousViolations` in `helpers/axe.ts`; mobile scans wait for the settled feed or open dialog. Injecting a `role=status` child into the feed makes the scan fail with `aria-required-children`.

- [x] **NS-016 · P1 · R — Scan the authenticated feed semantics.**
  - **Target:** [app/components/TimelineColumn.vue:791](/Users/powerox/neospace/app/components/TimelineColumn.vue:791).
  - **Change:** Move loading/status/load-more controls out of the feed ownership tree or otherwise preserve article-only owned semantics. A loaded fixture feed contained ARTICLE children plus DIV controls including role=status and reproduced the critical aria-required-children violation.
  - **Done when:** The loaded authenticated board passes the relevant axe rule with real fixture posts.
  - Evidence: `TimelineColumn.vue` now renders `role="feed"` with article children only; the infinite-scroll sentinel, loading-more status, retry/keep-looking controls and "All caught up" are siblings inside the scroll container (flip-mode sentinel sized from `--flip-port`). Loaded authenticated feed passes axe (no critical `aria-required-children`) and the e2e asserts the feed has no non-article children. Flip-mode layout was not visually checked.

- [x] **NS-017 · P1 · C — Cover dialogs through explicit mobile actions.**
  - **Target:** [e2e/journeys/smoke.spec.ts:50](/Users/powerox/neospace/e2e/journeys/smoke.spec.ts:50).
  - **Change:** Require the expected menu control, open a named dialog, and assert its contents and focus; remove the conditional that silently skips opening it.
  - **Done when:** The mobile test fails when the dialog trigger, dialog, or focus behavior breaks.
  - Evidence: `shell.mobile.spec.ts` requires the `Menu` button (no conditional), opens the named `Menu` dialog, asserts its nav/controls, `aria-expanded`, focus on `Close menu` and trapped Tab, axe on the open dialog, then Escape closes it and restores focus to the trigger. Also covers menu navigation, signed-in menu, and the New post dialog (open/Cancel).

- [x] **NS-018 · P2 · C — Assert route contents instead of body existence.**
  - **Target:** [e2e/journeys/smoke.spec.ts:39](/Users/powerox/neospace/e2e/journeys/smoke.spec.ts:39).
  - **Change:** Remove the body fallback and assert Search and Login headings, controls, and route-specific state.
  - **Done when:** An empty or wrong page fails the route test.
  - Evidence: the body fallbacks are gone. `/explore` asserts the `Search` h1, the `Search` searchbox and the `Search in` tablist; `/login` asserts the `Sign in` h1, the server field, the submit button and the browse link; guest `/` asserts a feed with real posts.

- [x] **NS-019 · P2 · C — Retain useful traces in CI artifacts.**
  - **Target:** [playwright.config.ts:12](/Users/powerox/neospace/playwright.config.ts:12).
  - **Change:** Generate an HTML report alongside the GitHub reporter and upload trace/test-results artifacts that actually exist on failure.
  - **Done when:** A failed CI browser job provides a viewable report and trace.
  - Evidence: `playwright.config.ts` uses `[['github'], ['html', { open: 'never' }]]` and `trace: 'retain-on-failure'` in CI (still `on-first-retry` locally); `ci.yml` uploads both `playwright-report/` and `test-results/` (traces/screenshots) on failure with `if-no-files-found: warn`. Not exercised on a real failing GitHub run.

- [x] **NS-020 · P2 · C — Pin the local e2e server dependency.**
  - **Target:** [playwright.config.ts:31](/Users/powerox/neospace/playwright.config.ts:31).
  - **Change:** Use a declared locked server dependency or a repository-owned server instead of downloading serve during each browser run.
  - **Done when:** Browser tests start offline after npm ci and use a reproducible server version.
  - Evidence: `scripts/serve-e2e.mjs` (repo-owned, no dependency, SPA fallback, traversal guard) replaces `npx --yes serve`; `playwright.config.ts` starts it with `node scripts/serve-e2e.mjs`. Local runs used it offline.

## New pass: draft recovery and context

- [x] **NS-021 · P1 · C — Restore reply drafts with their reply target.**
  - **Target:** [app/components/settings/SettingsDrafts.vue:53](/Users/powerox/neospace/app/components/settings/SettingsDrafts.vue:53).
  - **Change:** Pass the stored draft slot and restore its reply/context identity; openDraft currently forwards only text, CW, and visibility.
  - **Done when:** Opening a saved reply still replies to the original target and uses the original draft slot.
  - Evidence: `SettingsDrafts.vue` reopens a saved draft under its own key as the draft slot and, for `reply:<id>` keys, with `inReplyToId` (`draftReplyTarget`); `tests/own-posts-drafts.test.ts` covers key parsing and the sheet carrying id + slot.

- [x] **NS-022 · P1 · C — Prevent existing new-post drafts overwriting chosen drafts.**
  - **Target:** [app/components/settings/SettingsDrafts.vue:53](/Users/powerox/neospace/app/components/settings/SettingsDrafts.vue:53).
  - **Change:** Open a selected draft under its own slot so the generic new-post restore cannot replace the explicit prefill.
  - **Done when:** Opening a group or reply draft while a new-post draft exists shows the selected draft.
  - Evidence: The selected draft is passed as `draftSlot`, so the generic `new` slot can't replace the prefill; `composeSheet.show` now remounts when only the slot changes, and a reopened (non-redraft) slot offers “Save draft and close” again (`isRedraftSlot`).

- [x] **NS-023 · P2 · C — Preserve group and quote context in reopened drafts.**
  - **Target:** [app/components/settings/SettingsDrafts.vue:39](/Users/powerox/neospace/app/components/settings/SettingsDrafts.vue:39).
  - **Change:** Decode recognized group/quote keys into safe structured context and pass it to the compose sheet.
  - **Done when:** The reopened draft keeps its group or quote relationship instead of becoming an unrelated post.
  - Evidence: `SettingsDrafts` decodes `group:<tag>` / `quote:<url>` slots via `draftGroupTag` / `draftQuoteUrl` (hashtag charset / http(s) only) and passes `groupTag` / `quoteUrl` to the compose sheet; `tests/drafts-media-hardening.test.ts`.

- [x] **NS-024 · P1 · I — Warn before losing poll and schedule edits.**
  - **Target:** [app/components/RealComposeBox.vue:281](/Users/powerox/neospace/app/components/RealComposeBox.vue:281).
  - **Change:** Include edited poll options and scheduled time in dirty-close decisions, and explain which fields survive a text-only save.
  - **Done when:** A poll-only or schedule-only edit cannot disappear without a clear user decision.
  - Evidence: `RealComposeBox` dirty state now includes the schedule; `ComposeSheet` names what a text-only save drops (attachments / poll / scheduled time), hides “Save draft” when there is no text/CW to keep, and keeps the sheet open if the save fails.

- [x] **NS-025 · P2 · C — Order drafts by last modification.**
  - **Target:** [app/composables/useDraft.ts:72](/Users/powerox/neospace/app/composables/useDraft.ts:72).
  - **Change:** Persist a versioned updatedAt timestamp and sort the list by recency rather than draft-key alphabet.
  - **Done when:** The newest edited draft appears first without relying on its context label.
  - Evidence: Drafts persist `updatedAt` and `listAccountDrafts` sorts newest-first (legacy undated records last); tested with fake timers.

- [x] **NS-026 · P1 · C — Replace silent long-draft truncation with recovery.**
  - **Target:** [app/composables/useDraft.ts:32](/Users/powerox/neospace/app/composables/useDraft.ts:32).
  - **Change:** Measure serialized UTF-8 bytes, preserve supported long posts, and report storage failures or truncation rather than silently slicing text.
  - **Done when:** A long Unicode draft round-trips intact or visibly reports why it cannot be saved.
  - Evidence: `writeDraft` no longer slices: limit is 64 KiB measured in UTF-8 bytes, returns `{ ok:false, reason }` (previous draft left intact), `useDraft` exposes `saveError`, the composer shows a warning and “Save draft and close” refuses to close on failure; `tests/own-posts-drafts.test.ts` covers Unicode round-trip, byte measuring, oversize and quota.

- [x] **NS-027 · P2 · I — Validate and version stored draft payloads.**
  - **Target:** [app/composables/useDraft.ts:93](/Users/powerox/neospace/app/composables/useDraft.ts:93).
  - **Change:** Add a small schema version and explicit object/type validation with a safe legacy migration.
  - **Done when:** Malformed or future-version records cannot accidentally become writable current drafts.
  - Evidence: Stored drafts carry `v: 1`; `parseDraftRecord` rejects non-objects, arrays, non-numeric and future versions, and accepts legacy unversioned objects; tested.

- [x] **NS-028 · P2 · I — Flush drafts before backgrounding.**
  - **Target:** [app/composables/useDraft.ts:207](/Users/powerox/neospace/app/composables/useDraft.ts:207).
  - **Change:** Persist pending edits on pagehide and visibility loss with lifecycle cleanup, not only component unmount.
  - **Done when:** Text typed immediately before closing/backgrounding is recovered on return.
  - Evidence: `useDraft` flushes pending edits on `pagehide` and `visibilitychange→hidden` (listeners removed on unmount), not only on unmount.

- [x] **NS-029 · P2 · I — Detect cross-tab draft conflicts.**
  - **Target:** [app/composables/useDraft.ts:144](/Users/powerox/neospace/app/composables/useDraft.ts:144).
  - **Change:** Track revisions and notify an open composer when another tab changes the same draft instead of silently overwriting it.
  - **Done when:** Two tabs editing one slot offer an explicit conflict/recovery path.
  - Evidence: `useDraft` tracks the last-seen revision and listens for `storage` events on its slot; a differing remote write sets `conflict`, and the composer offers “Use other version” / “Keep mine” (`resolveConflict`).

- [x] **NS-030 · P2 · C — Confirm destructive saved-draft removal.**
  - **Target:** [app/components/settings/SettingsDrafts.vue:62](/Users/powerox/neospace/app/components/settings/SettingsDrafts.vue:62).
  - **Change:** Offer undo or confirmation and expose deletion failure instead of always claiming the draft was discarded.
  - **Done when:** A failed storage removal shows failure; an accidental successful removal is recoverable.
  - Evidence: Discard verifies the key is really gone (failure toast otherwise) and shows an Undo toast that restores the raw record.

## New pass: upload transport and account safety

- [x] **NS-031 · P2 · C — Clean up media-processing sleep listeners.**
  - **Target:** [app/stores/status.ts:247](/Users/powerox/neospace/app/stores/status.ts:247).
  - **Change:** Remove each abort listener when its polling delay resolves; once:true only removes it when an abort happens.
  - **Done when:** Many processing iterations leave no accumulated listeners after success, timeout, or cancel.
  - Evidence: Processing-poll sleep now removes its abort listener when the delay resolves (`waitForMediaProcessing`); `tests/drafts-media-hardening.test.ts` asserts add/remove listener counts match.

- [x] **NS-032 · P1 · C — Keep unfinished media out of the ready state.**
  - **Target:** [app/stores/status.ts:224](/Users/powerox/neospace/app/stores/status.ts:224).
  - **Change:** Return an explicit processing outcome instead of promoting a 202 payload with a null URL to ready when the poll budget expires.
  - **Done when:** A still-processing attachment remains retryable/processing and cannot be presented as ready.
  - Evidence: `uploadMedia` returns `processing: true` when a 202 isn't finished within the poll budget (or the poll fails); compose keeps the id, shows “Still processing · retry”, blocks posting, and retry re-checks via `resumeMediaProcessing` without re-uploading (`tests/compose-accounts.test.ts`). Servers without the poll endpoint (404/501) keep the old id-only behavior.

- [x] **NS-033 · P2 · C — Retry transient processing failures within budget.**
  - **Target:** [app/stores/status.ts:285](/Users/powerox/neospace/app/stores/status.ts:285).
  - **Change:** Handle transient poll failures with bounded backoff and respect Retry-After, rather than immediately ending processing as a successful upload.
  - **Done when:** A temporary network failure can recover without uploading the file a second time.
  - Evidence: Poll loop treats network errors / 429 / 5xx as transient: doubling backoff, honours `Retry-After` (`parseRetryAfterMs`, capped 10s), gives up as `processing` after 3 consecutive failures without re-uploading; tested.

- [x] **NS-034 · P2 · C — Clean up synchronous XHR setup failures.**
  - **Target:** [app/utils/mediaUpload.ts:99](/Users/powerox/neospace/app/utils/mediaUpload.ts:99).
  - **Change:** Wrap open, headers, and send setup so thrown errors remove listeners and timers before rejecting.
  - **Done when:** A synchronous XHR setup/send exception leaves no timer or signal listener behind.
  - Evidence: N/A — already fixed: `postFormWithProgress` wraps open/headers/send in try/catch that calls `cleanup()` (timer + abort listener) before rejecting, and `tests/mediaUpload.test.ts` covers synchronous `open`/`send` failure with listener/timer cleanup (see NS-039).

- [x] **NS-035 · P1 · C — Bind alt-text updates to the uploading account.**
  - **Target:** [app/composables/useComposeMedia.ts:187](/Users/powerox/neospace/app/composables/useComposeMedia.ts:187).
  - **Change:** Record owner account credentials with each attachment and use that owner for later media-description updates.
  - **Done when:** Switching active accounts never sends an old media id to the new account's server.
  - Evidence: Each attachment records `ownerId`; `uploadMedia`/`updateMediaDescription` take an explicit `accountId` (`credentialsFor`), so alt-text PUTs go to the uploading account's server (`tests/compose-accounts.test.ts`).

- [x] **NS-036 · P1 · I — Define account-switch behavior for attached media.**
  - **Target:** [app/composables/useComposeMedia.ts:50](/Users/powerox/neospace/app/composables/useComposeMedia.ts:50).
  - **Change:** Freeze the composer account or explicitly detach/reupload files when the account changes; explain the transition to the user.
  - **Done when:** Posting cannot combine media ids owned by account A with a status created by account B.
  - Evidence: Policy: detach. `useComposeMedia` clears attachments when the active account changes and shows a dismissible notice (“Attachments were removed because you switched accounts…”); `mediaIds`/`allReady` also ignore media owned by another account.

- [x] **NS-037 · P2 · C — Use one deadline for upload plus processing.**
  - **Target:** [app/stores/status.ts:175](/Users/powerox/neospace/app/stores/status.ts:175).
  - **Change:** Budget transfer and processing together and distinguish transfer timeout from server-processing timeout.
  - **Done when:** The documented total deadline is respected and each timeout offers the appropriate recovery action.
  - Evidence: `uploadMedia` takes one `totalTimeoutMs` deadline (90s): transfer is clamped to what remains, processing gets the remainder (max 45s); a transfer timeout throws `UploadTimeoutError` (“Upload timed out before it finished sending — retry”), a processing timeout yields a retryable `processing` attachment.

- [x] **NS-038 · P2 · C — Reject malformed successful upload payloads.**
  - **Target:** [app/utils/mediaUpload.ts:52](/Users/powerox/neospace/app/utils/mediaUpload.ts:52).
  - **Change:** Require a plain object with a valid media-id shape at the API boundary; distinguish HTML/array/null responses from normal server errors.
  - **Done when:** A malformed 2xx response produces a clear protocol error and never a ready tile.
  - Evidence: `postFormWithProgress` flags non-object 2xx bodies (HTML, array, null, empty) as `malformed`; `uploadMedia` throws `UploadProtocolError` for those and for ids failing `parseMediaId`, so no ready tile appears; tested.

- [x] **NS-039 · P1 · C — Exercise the real XHR branch.**
  - **Target:** [tests/mediaUpload.test.ts:24](/Users/powerox/neospace/tests/mediaUpload.test.ts:24).
  - **Change:** Add browser or XHR-double tests covering computable progress, unknown totals, onSent, user abort, timeout, and setup failure; current transport tests cover only fetch fallback.
  - **Done when:** Breaking XHR progress/cancellation fails tests even when fetch fallback still works.
  - Evidence: `tests/mediaUpload.test.ts` adds an XHR double (fetch stubbed to throw) covering headers/response, computable and unknown progress, `onSent`, user abort, pre-aborted signal, timeout, timer/listener cleanup, and synchronous `open`/`send` failure. `postFormWithProgress` now cleans up on such setup errors.

- [x] **NS-040 · P2 · I — Preserve cancellation state across late callbacks.**
  - **Target:** [app/composables/useComposeMedia.ts:190](/Users/powerox/neospace/app/composables/useComposeMedia.ts:190).
  - **Change:** Verify retry ownership through late progress/load/error callbacks and distinguish local cancellation from server-side processing cancellation.
  - **Done when:** Cancelled or superseded attempts cannot make a newer attachment ready or clear its error.
  - Evidence: N/A — verified current behavior: every progress/phase/success/error/finally path in `useComposeMedia.uploadOne` is guarded by `isCurrent()` (controller identity), `retry` aborts and replaces the controller first, and `userCancelled` is only consumed by the current attempt, so superseded attempts cannot mark a newer attachment ready or clear its error.

## New pass: poll completeness

- [x] **NS-041 · P2 · C — Read server poll-option limits.**
  - **Target:** [app/stores/status.ts:28](/Users/powerox/neospace/app/stores/status.ts:28).
  - **Change:** Use instance poll configuration instead of a universal maximum of four options.
  - **Done when:** Servers advertising different limits get matching controls and submission validation.
  - Evidence: Poll option cap comes from `configuration.polls.max_options` (`pollLimitsFrom`, validated 2–20, default 4) via `instances.composePollLimits`; composer controls and `normalizePoll` honour it.

- [x] **NS-042 · P2 · C — Read server poll-option length limits.**
  - **Target:** [app/components/RealComposeBox.vue:1127](/Users/powerox/neospace/app/components/RealComposeBox.vue:1127).
  - **Change:** Replace the hard-coded 50-character limit with validated server metadata and a documented fallback.
  - **Done when:** An option accepted by the UI satisfies the selected server's advertised length limit.
  - Evidence: Option length limit comes from `max_characters_per_option` (validated, default 50): input `maxlength`, composer error and `normalizePoll` use it (counted in code points).

- [x] **NS-043 · P2 · C — Read server poll-duration bounds.**
  - **Target:** [app/stores/status.ts:30](/Users/powerox/neospace/app/stores/status.ts:30).
  - **Change:** Use advertised minimum/maximum expiration values for validation and available durations.
  - **Done when:** The UI cannot offer a duration the selected server positively rejects.
  - Evidence: Duration choices are filtered to `min_expiration`/`max_expiration` (server bounds offered if no preset fits), the selection snaps to the nearest allowed value, and `normalizePoll` validates against them.

- [x] **NS-044 · P2 · C — Refresh poll time labels as time passes.**
  - **Target:** [app/components/PostPoll.vue:65](/Users/powerox/neospace/app/components/PostPoll.vue:65).
  - **Change:** Drive expiry text and voting eligibility from a shared clock tick; Date.now inside a computed getter is not reactive.
  - **Done when:** An open poll's countdown and close state update without a prop refresh.
  - Evidence: `PostPoll` ticks a 30s clock while open; the countdown, `Closed` label and voting eligibility derive from it (and stop ticking once closed).

- [x] **NS-045 · P2 · I — Reset poll selections when the voting account changes.**
  - **Target:** [app/components/PostPoll.vue:22](/Users/powerox/neospace/app/components/PostPoll.vue:22).
  - **Change:** Scope selection and personalized voted state to the acting account, including cached cards reused after account switching.
  - **Done when:** Choices and your-vote indicators from one account never masquerade as another account's state.
  - **Done:** `PostPoll.vue` clears picks when the active account or poll id changes; `RealPostCard` votes through the account that owns the status, so personalised `voted`/`ownVotes` always belong to that voting account.
- [x] **NS-046 · P2 · C — Distinguish people from selections in multiple-choice polls.**
  - **Target:** [app/components/PostPoll.vue:34](/Users/powerox/neospace/app/components/PostPoll.vue:34).
  - **Change:** Use votersCount for per-person percentages and label it people/voters; reserve votes for total selections.
  - **Done when:** A two-person, three-selection poll shows accurate percentages and unambiguous totals.
  - Evidence: Multiple-choice polls now summarize “N people” (`votersCount`) instead of reusing the selection total as votes.

- [ ] **NS-047 · P3 · I — Expose hidden-total polls in compose.**
  - **Target:** [app/components/RealComposeBox.vue:300](/Users/powerox/neospace/app/components/RealComposeBox.vue:300).
  - **Change:** Add the hideTotals option already supported by normalizePoll, with server-aware availability and explanatory copy.
  - **Done when:** The created poll payload can intentionally hide totals until closing.

- [x] **NS-048 · P2 · C — Avoid numeric meters for unknown poll counts.**
  - **Target:** [app/components/PostPoll.vue:46](/Users/powerox/neospace/app/components/PostPoll.vue:46).
  - **Change:** When totals are hidden, render descriptive results without a numeric meter claiming zero percent.
  - **Done when:** Assistive technology does not announce fabricated numeric results for hidden counts.
  - Evidence: When the server hides counts, options no longer render as `role=meter` with a fake 0%; they say “Results hidden until the poll closes” and expose own-vote text to screen readers.

- [ ] **NS-049 · P3 · I — Render custom emoji in poll options.**
  - **Target:** [app/components/PostPoll.vue:97](/Users/powerox/neospace/app/components/PostPoll.vue:97).
  - **Change:** Use the existing safe emoji renderer with the poll's emoji allowlist in both choices and results.
  - **Done when:** Custom-emoji labels display consistently and remain safely named to screen readers.

- [x] **NS-050 · P2 · I — Refresh poll state after a duplicate vote response.**
  - **Target:** [app/components/RealPostCard.vue:823](/Users/powerox/neospace/app/components/RealPostCard.vue:823).
  - **Change:** Fetch current voter state after already-voted or expired responses and update every matching visible poll.
  - **Done when:** A vote cast in another tab does not leave this card stuck offering an invalid vote.
  - Evidence: A 422/“already voted” (or expired) vote response refetches the poll and shows “You already voted in this poll” / “This poll has closed” instead of a generic failure.

## New pass: scheduled-post queue

- [x] **NS-051 · P2 · C — Paginate the scheduled-post queue.**
  - **Target:** [app/stores/status.ts:301](/Users/powerox/neospace/app/stores/status.ts:301).
  - **Change:** Follow Link cursors or expose load-more; the queue currently requests only the first 40 scheduled posts.
  - **Done when:** An account with more than 40 scheduled posts can reach and manage every item.
  - Evidence: `listScheduledStatuses` follows Link pagination (up to 10 pages of 40, deduped by id); a later-page failure keeps earlier pages.

- [x] **NS-052 · P2 · C — Load the queue after capability metadata arrives.**
  - **Target:** [app/components/settings/SettingsScheduledPosts.vue:54](/Users/powerox/neospace/app/components/settings/SettingsScheduledPosts.vue:54).
  - **Change:** Watch capability/readiness transitions as well as account id so a late probe can trigger the first load.
  - **Done when:** Opening Posting before instance metadata resolves still loads the queue once support becomes known.
  - Evidence: The queue watches `[activeAccountId, canSchedulePosts]`, so a late capability probe triggers the first load.

- [x] **NS-053 · P2 · C — Prevent detached queue mutation after unmount.**
  - **Target:** [app/components/settings/SettingsScheduledPosts.vue:109](/Users/powerox/neospace/app/components/settings/SettingsScheduledPosts.vue:109).
  - **Change:** Use lifecycle/operation tokens for reschedule and cancel as well as loading; account equality alone does not detect unmount or a switch away and back.
  - **Done when:** Late mutation results cannot update a detached or reinitialized queue or show stale success toasts.
  - Evidence: Reschedule/cancel capture a lifecycle `generation` (bumped on reset and unmount); late results after unmount or an account round-trip are dropped without toasts.

- [x] **NS-054 · P2 · I — Prevent a stale load overwriting queue mutations.**
  - **Target:** [app/components/settings/SettingsScheduledPosts.vue:28](/Users/powerox/neospace/app/components/settings/SettingsScheduledPosts.vue:28).
  - **Change:** Sequence queue loads against reschedule/cancel operations and reconcile responses by operation version.
  - **Done when:** A delayed load cannot resurrect a cancelled item or undo its new scheduled time.
  - Evidence: A `mutations` counter detects reschedule/cancel completing during a load; the stale response is discarded and the load re-run.

- [x] **NS-055 · P2 · C — Represent concurrent queue operations independently.**
  - **Target:** [app/components/settings/SettingsScheduledPosts.vue:32](/Users/powerox/neospace/app/components/settings/SettingsScheduledPosts.vue:32).
  - **Change:** Use per-item pending state or serialize actions instead of one busyId overwritten by another item's operation.
  - **Done when:** Two item actions cannot re-enable the wrong controls or lose each other's error state.
  - Evidence: Replaced single `busyId` with a per-item `busy` map; each row's controls and labels follow only its own operation.

- [x] **NS-056 · P2 · I — Show the timezone used for scheduling.**
  - **Target:** [app/components/settings/SettingsScheduledPosts.vue:43](/Users/powerox/neospace/app/components/settings/SettingsScheduledPosts.vue:43).
  - **Change:** Display a clear local timezone label alongside the datetime editor and confirmation.
  - **Done when:** Users can tell which timezone their selected time uses before saving.
  - Evidence: Queue editor and composer show the local time zone (`localTimeZoneLabel`, e.g. America/New_York (EDT)); the reschedule toast includes it.

- [x] **NS-057 · P2 · I — Reject nonexistent local times during DST changes.**
  - **Target:** [app/utils/scheduledPosts.ts:25](/Users/powerox/neospace/app/utils/scheduledPosts.ts:25).
  - **Change:** Round-trip local date parts to detect browser normalization of nonexistent times and clearly explain ambiguous times.
  - **Done when:** DST transition inputs are either preserved as intended or rejected with a useful correction.
  - Evidence: `checkLocalSchedule` round-trips local date parts to reject nonexistent (DST gap / Feb 31) times with a correction message, used by both the queue and the composer; tested.

- [ ] **NS-058 · P3 · I — Preview scheduled attachments and visibility.**
  - **Target:** [app/components/settings/SettingsScheduledPosts.vue:16](/Users/powerox/neospace/app/components/settings/SettingsScheduledPosts.vue:16).
  - **Change:** Show media presence, visibility, and reply/poll context so similarly worded scheduled posts can be distinguished.
  - **Done when:** Users can identify the correct queued post before cancelling or rescheduling it.

- [x] **NS-059 · P2 · C — Respect scheduled-post content warnings in previews.**
  - **Target:** [app/utils/scheduledPosts.ts:32](/Users/powerox/neospace/app/utils/scheduledPosts.ts:32).
  - **Change:** Avoid always concatenating the hidden body after CW text; let the queue disclose it deliberately.
  - **Done when:** A collapsed scheduled preview reveals only its warning and safe metadata.
  - Evidence: `scheduledPreview` shows only `CW: <warning>` for content-warned posts; the queue reveals the body via an explicit “Show text” toggle (`scheduledHiddenBody`).

- [x] **NS-060 · P2 · C — Refresh the queue after creating a schedule.**
  - **Target:** [app/components/RealComposeBox.vue:703](/Users/powerox/neospace/app/components/RealComposeBox.vue:703).
  - **Change:** Publish a scheduled-created event or invalidate the queue and complete the compose-sheet schedule lifecycle explicitly.
  - **Done when:** A newly scheduled post appears in the open queue and the sheet reaches a clear completed state.
  - Evidence: Scheduling bumps `statusStore.scheduledRevision` (open queue reloads) and the composer emits `scheduled`; `ComposeSheet` closes with a “Scheduled for …” toast.

## New pass: autocomplete edge cases

- [x] **NS-061 · P2 · C — Clear old suggestions when query text changes.**
  - **Target:** [app/composables/useComposeAutocomplete.ts:140](/Users/powerox/neospace/app/composables/useComposeAutocomplete.ts:140).
  - **Change:** Invalidate visible items for every changed query, not only kind/start changes, or label stale rows as unavailable.
  - **Done when:** Suggestions from the previous query cannot be selected under newly typed text.
  - Evidence: `sync()` now clears visible rows whenever the token's query text changes (not only kind/start), so rows for an earlier query never sit under a new one.

- [x] **NS-062 · P1 · C — Close suggestions when the active account changes.**
  - **Target:** [app/composables/useComposeAutocomplete.ts:30](/Users/powerox/neospace/app/composables/useComposeAutocomplete.ts:30).
  - **Change:** Watch account changes, invalidate the race ticket, and clear/requery visible items immediately.
  - **Done when:** No suggestion from account A remains selectable while composing as account B.
  - Evidence: `useComposeAutocomplete` watches the effective active account, closes the popup and aborts in-flight lookups at once; `tests/compose-accounts.test.ts` checks rows are cleared/unpickable and a late response is dropped.

- [x] **NS-063 · P2 · C — Validate suggestion query identity on selection.**
  - **Target:** [app/composables/useComposeAutocomplete.ts:161](/Users/powerox/neospace/app/composables/useComposeAutocomplete.ts:161).
  - **Change:** Require the selected item's token/query generation to match the current token, not only its kind and start offset.
  - **Done when:** A late click on an old query result cannot replace a newer token.
  - Evidence: The autocomplete remembers the token (kind/start/query) its rows were fetched for; `pick` rejects a row unless that token equals the one under the caret.

- [x] **NS-064 · P2 · C — Replace a full token when editing its middle.**
  - **Target:** [app/utils/composeTokens.ts:73](/Users/powerox/neospace/app/utils/composeTokens.ts:73).
  - **Change:** Scan the token suffix after the caret and replace the complete token span when selecting a completion.
  - **Done when:** Choosing a suggestion in the middle of @alice does not leave duplicated trailing characters.
  - Evidence: `findComposeToken` records `replaceEnd` when the caret is inside a token (trailing `.`/`-`/`/` punctuation excluded) and `applyToken` replaces the whole span; tested (`@al|iceb.` → full replacement, period kept).

- [x] **NS-065 · P2 · C — Allow Escape to dismiss a searching popup.**
  - **Target:** [app/composables/useComposeAutocomplete.ts:171](/Users/powerox/neospace/app/composables/useComposeAutocomplete.ts:171).
  - **Change:** Handle Escape before returning for an empty result list; cancel pending lookup and avoid closing the containing compose sheet.
  - **Done when:** Escape dismisses a loading or empty autocomplete popup predictably.
  - Evidence: `handleKeydown` dismisses a visible popup on Escape even while searching or after a failed lookup (cancels timer + race) and the composer stops propagation, so the sheet's own Escape doesn't fire; an invisible popup doesn't swallow Escape.

- [ ] **NS-066 · P3 · I — Support valid non-ASCII mention names.**
  - **Target:** [app/utils/composeTokens.ts:30](/Users/powerox/neospace/app/utils/composeTokens.ts:30).
  - **Change:** Define token rules from supported server handle shapes and add Unicode cases where allowed.
  - **Done when:** Typing a supported non-ASCII username offers completions without breaking URL/email detection.

- [x] **NS-067 · P2 · C — Support combining marks in hashtag tokens.**
  - **Target:** [app/utils/composeTokens.ts:31](/Users/powerox/neospace/app/utils/composeTokens.ts:31).
  - **Change:** Align hashtag token character rules with the group validator's Unicode marks and accepted separators.
  - **Done when:** Decomposed accented tags and supported scripts stay one complete autocomplete token.
  - Evidence: Hashtag tokens use the group validator's set (`\p{L}\p{M}\p{N}_ · ZWNJ`); tested with Devanagari and accented tags.

- [x] **NS-068 · P1 · R — Reject non-finite unread badge counts.**
  - **Target:** [app/stores/notifications.ts:239](/Users/powerox/neospace/app/stores/notifications.ts:239).
  - **Change:** Validate count as a finite nonnegative integer before summing, and preserve valid prior counts on malformed responses. The current mocked profile visibly rendered NaN in the Activity badge.
  - **Done when:** Missing, string, NaN, negative, and infinite counts cannot render a NaN badge or corrupt totals from healthy accounts.
  - Evidence: `parseUnreadCount` accepts only finite non-negative integers; `refreshUnreadBadge` validates per account, falls back to that account's last good count, and `badgeLabel` can't render NaN (`tests/notifications-badge.test.ts`).

- [x] **NS-069 · P2 · I — Announce autocomplete results and failures distinctly.**
  - **Target:** [app/components/ComposeAutocomplete.vue:8](/Users/powerox/neospace/app/components/ComposeAutocomplete.vue:8).
  - **Change:** Expose kind-specific searching, empty-result, and failed-lookup messages through a concise status region.
  - **Done when:** Screen-reader users can distinguish no matches from a failed lookup for mentions, tags, and emoji.
  - Evidence: `useComposeAutocomplete` exposes an `outcome` (pending/results/empty/failed); the status region announces kind-specific “Looking up people/hashtags/emoji…”, “No matching …”, or “Couldn’t look up … Keep typing to try again”, and failures also show a visible note.

- [x] **NS-070 · P2 · I — Keep autocomplete placement correct after resize.**
  - **Target:** [app/components/RealComposeBox.vue:510](/Users/powerox/neospace/app/components/RealComposeBox.vue:510).
  - **Change:** Recalculate popup placement when viewport, keyboard inset, active font, or popup height changes without moving focus.
  - **Done when:** Suggestions remain visible above the keyboard after rotation or appearance changes.
  - Evidence: While the popup is open the composer re-places it (rAF-throttled) on window and `visualViewport` resize/scroll, with listeners removed on close/unmount; focus and caret are untouched.

## New pass: capabilities, metadata, and OAuth helpers

- [ ] **NS-071 · P3 · I — Keep unknown capabilities immutable.**
  - **Target:** [app/utils/serverCapabilities.ts:46](/Users/powerox/neospace/app/utils/serverCapabilities.ts:46).
  - **Change:** Return isolated capability values or a deeply immutable type instead of a mutable interface assertion for the shared unknown object.
  - **Done when:** A caller cannot alter another account's unknown feature state.

- [x] **NS-072 · P2 · C — Avoid identifying every bare semver as Mastodon.**
  - **Target:** [app/utils/serverCapabilities.ts:134](/Users/powerox/neospace/app/utils/serverCapabilities.ts:134).
  - **Change:** Require stronger software evidence or preserve unknown for ambiguous metadata rather than enabling Mastodon-specific behavior from version shape alone.
  - **Done when:** An unknown server reporting a semver receives conservative unknown capabilities.
  - Evidence: A bare semver with no source URL now stays `unknown` (Mastodon needs a source URL or fork tag); tests updated and added.

- [x] **NS-073 · P2 · C — Retain full poll configuration in instance metadata.**
  - **Target:** [app/utils/instanceInfo.ts:12](/Users/powerox/neospace/app/utils/instanceInfo.ts:12).
  - **Change:** Map validated poll maxOptions, maxCharactersPerOption, minExpiration, and maxExpiration into the shared capability/limits model.
  - **Done when:** Compose controls can read all advertised poll limits without a second unrelated probe.
  - Evidence: `ConnectedInstanceInfo.polls` retains max options, option length and min/max expiration from `configuration.polls`.

- [x] **NS-074 · P2 · C — Preserve known limits when refresh metadata omits them.**
  - **Target:** [app/utils/instanceInfo.ts:84](/Users/powerox/neospace/app/utils/instanceInfo.ts:84).
  - **Change:** Merge each missing limit with its prior validated value; the current spread is followed by undefined assignments that erase previous limits.
  - **Done when:** A partial metadata refresh cannot unexpectedly reset known limits to generic fallbacks.
  - Evidence: `mapInstanceConfig` falls back to the previous value for every limit (characters, media, profile fields, poll limits) when a refresh omits it.

- [ ] **NS-075 · P3 · I — Give persisted capabilities a freshness policy.**
  - **Target:** [app/utils/serverCapabilities.ts:23](/Users/powerox/neospace/app/utils/serverCapabilities.ts:23).
  - **Change:** Record probe time/version and refresh or invalidate stale capabilities after a server upgrade or endpoint evidence.
  - **Done when:** An outdated unsupported flag does not permanently hide a newly available feature.

- [x] **NS-076 · P2 · I — Include OAuth registration inputs in cache identity.**
  - **Target:** [app/utils/oauthApp.ts:5](/Users/powerox/neospace/app/utils/oauthApp.ts:5).
  - **Change:** Key cached applications by normalized server, callback URI, and requested scopes or store those inputs and validate them before reuse.
  - **Done when:** A changed callback or scope requirement triggers safe re-registration rather than incompatible cache reuse.
  - Evidence: OAuth app cache entries store the callback URI and scopes; `readCachedOAuthApp(host, identity)` ignores mismatched or legacy entries so the app is re-registered; the cache is also pruned to 32 hosts.

- [x] **NS-077 · P2 · C — Validate token-response object shape.**
  - **Target:** [app/utils/oauthApp.ts:59](/Users/powerox/neospace/app/utils/oauthApp.ts:59).
  - **Change:** Reject null, arrays, and wrong field types before returning a token response to completeAuth.
  - **Done when:** Malformed JSON produces a friendly protocol error without partially persisting credentials.
  - Evidence: `parseOAuthResponse` rejects null/array/scalar JSON and `requireAccessToken` rejects non-string/blank tokens and non-string `token_type` before `completeAuth` persists anything; tested.

- [x] **NS-078 · P2 · C — Preserve caller cancellation in OAuth requests.**
  - **Target:** [app/utils/oauthApp.ts:52](/Users/powerox/neospace/app/utils/oauthApp.ts:52).
  - **Change:** Combine the caller's signal with the timeout signal instead of overwriting init.signal.
  - **Done when:** Navigating away cancels a token request promptly while timeout behavior remains intact.
  - Evidence: `oauthFetch` combines the caller's signal with the timeout (`AbortSignal.any`, manual fallback); `completeAuth` takes `{ signal }` and the callback page aborts it on unmount; tested.

- [x] **NS-079 · P2 · I — Test recovery from an invalid cached OAuth client.**
  - **Target:** [app/utils/oauthApp.ts:39](/Users/powerox/neospace/app/utils/oauthApp.ts:39).
  - **Change:** Exercise cache invalidation and one bounded re-registration retry with server error fixtures.
  - **Done when:** An invalid client can recover without an infinite login loop or reusing the rejected registration.
  - Evidence: `tests/oauthApp.test.ts` covers rejected-client recovery (clear once → single re-registration, rejected registration never reused), legacy/mismatched identity, corrupt blobs and pruning.

- [ ] **NS-080 · P3 · C — Bound the persisted OAuth application cache.**
  - **Target:** [app/utils/oauthApp.ts:26](/Users/powerox/neospace/app/utils/oauthApp.ts:26).
  - **Change:** Add TTL/LRU pruning and schema validation rather than allowing unlimited host entries.
  - **Done when:** Repeated probes cannot grow the application-cache blob without bound.

## New pass: appearance, accessibility, and extracted panels

- [x] **NS-081 · P2 · I — Reduce font subset payloads in generated output.**
  - **Target:** [app/utils/loadFonts.ts:9](/Users/powerox/neospace/app/utils/loadFonts.ts:9).
  - **Change:** Choose needed scripts/subsets and weights explicitly, measure emitted font files, and avoid caching every optional face on first installation.
  - **Done when:** A recorded artifact budget demonstrates the reduction while supported scripts still render correctly.
  - **Done:** Measured, then cut the install-time download: fonts are no longer precached (`nuxt.config.ts` `globPatterns` drops `woff2`; a `CacheFirst` runtime cache `neo-fonts` stores only the faces/subsets actually used, still offline-capable afterwards). Precache went from 292 entries / 4,425 KiB to 158 entries / ~2,670 KiB (−40%); all @fontsource subsets are kept, so every supported script still renders (browsers fetch by `unicode-range`). Budget recorded and enforced by `scripts/precache-budget.mjs` (`npm run budget`, run in CI after `generate`; `tests/precache-budget.test.ts`). The e2e font journeys (NS-084) still load the right families.

- [ ] **NS-082 · P3 · C — Provide real bold weights for active font families.**
  - **Target:** [app/utils/loadFonts.ts:10](/Users/powerox/neospace/app/utils/loadFonts.ts:10).
  - **Change:** Load the bold weight used by the UI where available, or intentionally reduce bold styling instead of relying silently on synthesized 700 from 400/500.
  - **Done when:** Representative headings and badges use an intentional weight across each supported family.

- [ ] **NS-083 · P3 · I — Retry a failed active font without toggling appearance.**
  - **Target:** [app/utils/loadFonts.ts:140](/Users/powerox/neospace/app/utils/loadFonts.ts:140).
  - **Change:** Provide a bounded retry on online/focus recovery for the active family after load failure.
  - **Done when:** The chosen font can recover after a connection failure without changing the selected theme or font.

- [x] **NS-084 · P2 · I — Verify font privacy through actual network requests.**
  - **Target:** [tests/loadFonts.test.ts:4](/Users/powerox/neospace/tests/loadFonts.test.ts:4).
  - **Change:** Add a browser network assertion across selected chrome/font combinations; a list of loader names alone does not prove no external font request occurs.
  - **Done when:** The test fails if Google Fonts or another undeclared font origin is contacted.
  - **Done:** `e2e/journeys/fonts-privacy.spec.ts` records every network request for 16 chrome × face combinations (signed-in session, mocked server): fails on any font-CDN host (Google Fonts, Bunny, Typekit, jsdelivr, unpkg…), any undeclared origin, any font file not from the app origin, and — for @fontsource chromes — requires the expected family's `.woff2` to load from the app origin so it can't pass by loading nothing. Proved it fails by injecting a Google Fonts `<link>`. 16/16 pass against the generated build.

- [ ] **NS-085 · P3 · I — Preload only the active critical font.**
  - **Target:** [app/utils/loadFonts.ts:128](/Users/powerox/neospace/app/utils/loadFonts.ts:128).
  - **Change:** Coordinate prepaint and boot with a minimal active-face preload rather than loading all appearance fonts eagerly.
  - **Done when:** A cold load reduces text swapping without downloading unused families.

- [x] **NS-086 · P1 · R — Define the shared focus color for every theme.**
  - **Target:** [app/assets/css/_themes.scss:24](/Users/powerox/neospace/app/assets/css/_themes.scss:24).
  - **Change:** Define --neo-focus in the base theme mixin; local browser inspection found it empty in light and Y themes, including controls that use it without fallback.
  - **Done when:** Keyboard focus outlines remain visible in every theme and chrome combination.
  - Evidence: `--neo-focus: var(--neo-accent)` is now set in the shared `neo-from-braun` mixin (beta keeps its own override), so every theme defines it, including rules without a fallback.

- [x] **NS-087 · P1 · R — Fix Y-theme badge and logo contrast.**
  - **Target:** [app/assets/css/_themes.scss:394](/Users/powerox/neospace/app/assets/css/_themes.scss:394).
  - **Change:** Adjust accent foreground/background tokens or local badge styling; loaded Y-home axe checks flagged the logo and navigation badges.
  - **Done when:** Those controls meet the relevant contrast check with their actual computed colors.
  - Evidence: Y theme `--neo-text-on-accent` changed from white (≈3:1 on #1d9bf0) to #0f1419 (≈6.2:1), fixing the logo mark and nav badges. Computed from tokens; not re-run in axe.

- [x] **NS-088 · P1 · R — Make all profile tabs reachable at 375px.**
  - **Target:** [app/pages/profile.vue:1060](/Users/powerox/neospace/app/pages/profile.vue:1060).
  - **Change:** Make the own-profile tablist scrollable or adapt its layout; inspection measured 465px of content inside a 360px container with visible overflow and clipped page chrome.
  - **Done when:** All tabs can be reached by touch and keyboard at 375px and with enlarged text.
  - Evidence: Profile tablist scrolls horizontally (`overflow-x:auto`, tabs `flex:1 0 auto`, `min-height`, no wrap) and `NeoTabs` scrolls the selected tab into view. Not re-measured in a browser at 375px.

- [ ] **NS-089 · P3 · I — Consolidate duplicated poll styling.**
  - **Target:** [app/components/RealPostCard.vue:1672](/Users/powerox/neospace/app/components/RealPostCard.vue:1672).
  - **Change:** Remove stale parent poll rules after checking scoped interactions and make PostPoll own its standard layout variants.
  - **Done when:** Poll appearance is controlled in one clear place without changing CW or Flick behavior.

- [ ] **NS-090 · P2 · I — Finish extracting settings panels incrementally.**
  - **Target:** [app/components/SettingsModal.vue:1](/Users/powerox/neospace/app/components/SettingsModal.vue:1).
  - **Change:** Extract remaining privacy, notification, posting, filters, profile, and account sections behind typed interfaces; appearance extraction alone leaves a large orchestration component.
  - **Done when:** The host owns navigation/lifecycle while each panel owns its form and local errors.
  - Partial (left unchecked): Extracted `SettingsPostingPanel.vue` and `SettingsNotificationsPanel.vue` (posting owns form + dirty via `v-model:dirty`; notifications is instance-link only). Profile, privacy, filters, and account sections remain inline in `SettingsModal.vue`. Tests: `tests/settings-posting.test.ts`.

## New pass: release engineering and trustworthy diagnostics

- [x] **NS-091 · P1 · C — Run the configured mobile browser in CI.**
  - **Target:** [.github/workflows/ci.yml:48](/Users/powerox/neospace/.github/workflows/ci.yml:48).
  - **Change:** Install the mobile project's WebKit dependency and run that project, or explicitly configure a supported Chromium mobile project. Current CI runs only chromium.
  - **Done when:** Mobile journeys execute in CI; missing WebKit is reported as setup failure, not product failure.
  - Evidence: there was no Chromium mobile project — `mobile` used WebKit `iPhone 13`. It is now Chromium (`Pixel 7`) running `*.mobile.spec.ts`; the desktop project ignores those specs; `ci.yml` runs `--project=chromium --project=mobile` with only the Chromium install. WebKit stays opt-in (`E2E_WEBKIT=1`, `mobile-webkit`) so a missing binary is a setup problem, not a product failure; WebKit was not run here. Local: 16 tests across both projects pass (also `--repeat-each=3`).

- [x] **NS-092 · P2 · C — Add actual lint rules instead of aliasing typechecks.**
  - **Target:** [package.json:21](/Users/powerox/neospace/package.json:21).
  - **Change:** Configure linting for Vue/TypeScript correctness and accessibility rules or rename the current typecheck alias accurately.
  - **Done when:** The lint command detects at least a representative rule violation that TypeScript alone misses.
  - **Done:** Added `eslint.config.mjs` (eslint 9 + eslint-plugin-vue essential + vuejs-accessibility + a few JS footguns) and `npm run lint:rules`; `lint` and `check` now run it before the typechecks, so it is also a CI gate. It found real issues TypeScript can't see — three hidden `<input type=file>` without a label (`ChatComposer`, `profile.vue` ×2, now labelled) — and a probe `<img>` without `alt` is rejected.

- [x] **NS-093 · P2 · C — Make deployment evidence identify a tested artifact.**
  - **Target:** [.github/workflows/ci.yml:29](/Users/powerox/neospace/.github/workflows/ci.yml:29).
  - **Change:** Persist the checked SHA with the build artifact and connect approved deployment to it; a job-local environment variable does not establish deployment provenance.
  - **Done when:** The deployed artifact can be tied to the commit and completed checks that produced it.
  - **Done:** `scripts/build-info.mjs write` runs after `generate` in the CI `check` job and stamps `.output/public/build-info.json` (commit, ref, run id, workflow, checks that gated it, file count and a sha256 digest of every emitted file). That tree is uploaded as artifact `site-<sha>`. A new opt-in `deploy` job (repo var `CF_PAGES_DEPLOY=true`, `production` environment for approvals, needs `check` + `e2e`, main only) downloads that artifact, runs `build-info.mjs verify` (commit matches `GITHUB_SHA` and digest unchanged) and uploads it with Wrangler — it never rebuilds. `tests/build-info.test.ts` covers stamping, tamper, wrong-commit and non-CI artifacts. The deploy job itself needs secrets and was not run here.

- [x] **NS-094 · P2 · C — Regenerate prepaint for development and build.**
  - **Target:** [package.json:11](/Users/powerox/neospace/package.json:11).
  - **Change:** Run the prepaint generator through dev/build hooks or detect stale output before those commands.
  - **Done when:** Changing the appearance catalog cannot leave development or build using stale boot options.
  - **Done:** `package.json` `predev`/`prebuild` run `scripts/build-prepaint.mjs`, which now also writes the theme-color map; `public/boot/prepaint.js` regenerated.
- [ ] **NS-095 · P3 · C — Avoid rebuilding the same app in each CI job.**
  - **Target:** [.github/workflows/ci.yml:36](/Users/powerox/neospace/.github/workflows/ci.yml:36).
  - **Change:** Upload generated output from the check job and reuse that exact artifact for browser verification.
  - **Done when:** Browser tests inspect the same built output that passed the build gate.

- [x] **NS-096 · P2 · C — Pin CI actions and bound job duration.**
  - **Target:** [.github/workflows/ci.yml:20](/Users/powerox/neospace/.github/workflows/ci.yml:20).
  - **Change:** Pin third-party actions to reviewed commit SHAs and add explicit job timeouts with a maintainable update policy.
  - **Done when:** CI cannot hang indefinitely and action updates are traceable.
  - **Done:** `.github/workflows/ci.yml` pins `checkout`, `setup-node` and `upload-artifact` to commit SHAs (tag in a comment), adds `timeout-minutes` to both jobs, and `.github/dependabot.yml` proposes weekly bumps.
- [x] **NS-097 · P2 · I — Typecheck e2e fixtures and configuration.**
  - **Target:** [playwright.config.ts:1](/Users/powerox/neospace/playwright.config.ts:1).
  - **Change:** Add a dedicated TypeScript project covering Playwright config, fixtures, helpers, and specs instead of relying only on runtime transpilation.
  - **Done when:** A fixture or assertion type error fails a named typecheck gate.
  - **Done:** Added `e2e/tsconfig.json` and `npm run typecheck:e2e` (included in `lint` and `check`, which CI runs); verified it flags a deliberate type error.
- [ ] **NS-098 · P3 · C — Make mocked status creation deterministic.**
  - **Target:** [e2e/helpers/mockApi.ts:39](/Users/powerox/neospace/e2e/helpers/mockApi.ts:39).
  - **Change:** Use a deterministic id sequence and assert submitted content/visibility rather than returning the same canned text for every mutation.
  - **Done when:** Identical runs produce stable fixtures and incorrect request payloads cannot pass unnoticed.

- [x] **NS-099 · P2 · C — Submit the exact diagnostic logs the user previewed.**
  - **Target:** [app/components/FeedbackNotes.vue:221](/Users/powerox/neospace/app/components/FeedbackNotes.vue:221).
  - **Change:** Capture an immutable redacted snapshot for preview and submission; createGitHubIssue currently rereads the live ring at submit time.
  - **Done when:** Public diagnostics match the reviewed snapshot even if new logs arrive before submit.
  - **Done:** `createGitHubIssue` accepts `logSnapshot` and `FeedbackNotes` sends exactly the previewed log text, so later log lines are never attached unseen. Tests: `tests/p2-shell-batch.test.ts`.
- [x] **NS-100 · P1 · C — Test suite handoffs under production opener policy.**
  - **Target:** [public/_headers:7](/Users/powerox/neospace/public/_headers:7).
  - **Change:** Exercise query fallback and message-based delivery under the actual COOP header; do not assume cross-origin window.opener survives.
  - **Done when:** Supported suite shares arrive once with the expected content under production headers.
  - Evidence: `tests/suite-handoff-coop.test.ts` asserts `public/_headers` ships COOP `same-origin`, then drives `useLoomHandoff` with `window.opener` severed: notebook, bruh and Loom shares each arrive exactly once via the `?compose=` fallback with the expected text (params dropped, signed-out shares wait behind login). Where the opener survives (local dev) a message share delivers once, every message is acked, duplicates never reopen compose, and foreign origins are ignored. No app change was needed — the fallback already worked; the test pins it. Loom chart images still need the story fetch (not postMessage) under COOP.

## Remaining candidates: Accounts, auth & server picking

- [x] **NS-101 · P1 · PERF · C · S — Give cachedClient a default timeout (~15s).**
  - **Target:** [app/composables/useMasto.ts:58](/Users/powerox/neospace/app/composables/useMasto.ts:58). **Area:** B. Token lifecycle, account switching & logout (instances.ts, useMasto.ts).
  - **Change:** Give `cachedClient` a default `timeout` (~15s).
  - **Prior observation to check:** `app/composables/useMasto.ts:58` — Cached clients are created without `timeout`, and masto only adds `AbortSignal.timeout` when `props.timeout` is set. `verifyAllInstances` (`instances.ts:1062-1063`) uses these clients and `initialize()` awaits it before setting `isInitialized` (`:1141`, `:1168`). One hung server keeps `TimelineColumn` waiting on `isInitialized` (`TimelineColumn.vue:1197-1201`), and every column stays blank.
  - **Provenance:** [October 9 candidate, line 1135](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1135); explicit source files unchanged at review time.
  - Evidence: `cachedClient` now passes `timeout: CLIENT_TIMEOUT_MS` (15s) in `app/composables/useMasto.ts`, so one hung server rejects in `verifyAllInstances` instead of holding `isInitialized`. No masto media uploads go through cached clients (uploads use raw fetch), so the ceiling doesn't cut long uploads.

- [x] **NS-102 · P1 · A11Y · A · S — Make Enter/Space open the sheet in nav placement, or add a separate labelled "Switch account" control, and…**
  - **Target:** [app/components/AccountSwitcher.vue:165](/Users/powerox/neospace/app/components/AccountSwitcher.vue:165). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Make Enter/Space open the sheet in nav placement, or add a separate labelled "Switch account" control, and fix the ARIA.
  - **Prior observation to check:** `app/components/AccountSwitcher.vue:165` — In nav placement the button is announced as "Name, switch accounts" with `aria-expanded` and `aria-haspopup="dialog"`, but activating it goes to Profile (`:83-86`). The keyboard path (`:128`) only works with 2+ accounts, so single-account keyboard and screen-reader users can't reach the sheet's Add or Manage actions.
  - **Provenance:** [October 9 candidate, line 1183](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1183); explicit source files unchanged at review time.
  - Evidence: Nav trigger no longer claims `aria-haspopup`/`aria-expanded` (it goes to Profile; label is now "Name, profile"); a separate labelled "Switch account" button (visually hidden until focus, in the tab order) opens the sheet, and ArrowDown / Shift+Enter now work for single-account users too (`AccountSwitcher.vue`). Sidebar label is "Name, accounts" for one account.

- [x] **NS-103 · P2 · UX · A · S — Capture pending in a ref before clearPendingAuth(), and route to /login?add=1&returnTo=… from it**
  - **Target:** [app/pages/auth/callback.vue:94](/Users/powerox/neospace/app/pages/auth/callback.vue:94). **Area:** A. OAuth flow & PKCE (instances.ts startAuth/completeAuth, oauthPkce.ts, auth/callback.vue).
  - **Change:** Capture `pending` in a ref before `clearPendingAuth()`, and route to `/login?add=1&returnTo=…` from it. Delete the sessionStorage flag.
  - **Prior observation to check:** `app/pages/auth/callback.vue:94` — `handleRetry` reads the legacy `sessionStorage 'neospace_auth_add'` (still written at `login.vue:89-92`) instead of `pending.addMode`, and it drops `returnTo`. In another context, or after the pending record is cleared, "Back to sign in" loses add mode.
  - **Provenance:** [October 9 candidate, line 1120](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1120); explicit source files unchanged at review time.
  - Evidence: `callback.vue` peeks the pending record by `state` before anything clears it and builds the retry link (`/login?add=1&returnTo=…`) from it; the `neospace_auth_add` sessionStorage flag is gone from both pages.

- [x] **NS-104 · P2 · UX · A · S — For access_denied, router.replace back to /login (keeping add/returnTo) with a neutral toast "Sign-in…**
  - **Target:** [app/pages/auth/callback.vue:35](/Users/powerox/neospace/app/pages/auth/callback.vue:35). **Area:** A. OAuth flow & PKCE (instances.ts startAuth/completeAuth, oauthPkce.ts, auth/callback.vue).
  - **Change:** For `access_denied`, `router.replace` back to `/login` (keeping add/returnTo) with a neutral toast "Sign-in cancelled".
  - **Prior observation to check:** `app/pages/auth/callback.vue:35` — `access_denied` (the user pressed "Deny") renders a red `role="alert"` "Couldn't sign in" page, treating a deliberate choice as a failure.
  - **Provenance:** [October 9 candidate, line 1121](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1121); explicit source files unchanged at review time.
  - Evidence: `access_denied` clears that attempt, shows a neutral “Sign-in cancelled” toast and `router.replace`s to `/login` keeping add/returnTo instead of an error page.

- [x] **NS-105 · P2 · CODE · A · S — Store pending records in a map keyed by state (with TTL pruning) instead of one slot.**
  - **Target:** [app/utils/oauthPkce.ts:150](/Users/powerox/neospace/app/utils/oauthPkce.ts:150). **Area:** A. OAuth flow & PKCE (instances.ts startAuth/completeAuth, oauthPkce.ts, auth/callback.vue).
  - **Change:** Store pending records in a map keyed by `state` (with TTL pruning) instead of one slot.
  - **Prior observation to check:** `app/utils/oauthPkce.ts:150` — Pending auth is a single localStorage slot. If two tabs start sign-in, tab A's callback falls back to its sessionStorage pair with `pending: null` (`:153-157`), so `addMode` and `returnTo` are lost. An add-mode link then lands on `/` saying "Now posting as …" (`callback.vue:69-84`).
  - **Provenance:** [October 9 candidate, line 1122](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1122); explicit source files unchanged at review time.
  - Evidence: Pending sign-ins are stored as a map keyed by `state` (TTL pruning, max 8, legacy single slot migrated); each tab's callback finds its own record and clears only itself; tested with two tabs.

- [x] **NS-106 · P2 · CODE · A · S — Prefer activeAccount when its host matches, otherwise any slot on that host with a token.**
  - **Target:** [app/composables/useMasto.ts:139](/Users/powerox/neospace/app/composables/useMasto.ts:139). **Area:** B. Token lifecycle, account switching & logout (instances.ts, useMasto.ts).
  - **Change:** Prefer `activeAccount` when its host matches, otherwise any slot on that host with a token.
  - **Prior observation to check:** `app/composables/useMasto.ts:139` — `publicClient` resolves the token with `getInstanceByUrl`, which returns the first slot for the host (`instances.ts:351-354`). With two accounts on one server, reads go out as account #1 while #2 is active, so relationship and following state are wrong. If #1 is expired (token null) on an auth-gated host, it falls through to the fosstodon guest client although #2 has a valid token.
  - **Prior verifier qualification:** `getInstanceByUrl` does return the first slot, but signed-in search uses `activeClient` (`useFediverseSearch.ts:171`). `publicClient` serves only group/tag timelines (`TimelineColumn.vue:59`, `groups.ts:575`), Edward trends, the public fallback and guest discovery. Corrected: "With two accounts on one host, publicClient reads (group/tag feeds, trends) carry account #1's viewer flags (favourited/boosted), and an expired #1 forces the guest remap although #2 has a token." Impact: Medium. Relationship/following state is not affected.
  - **Provenance:** [October 9 candidate, line 1132](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1132); explicit source files unchanged at review time.
  - Evidence: `readerForUrl` picks the active account when it lives on the host, else any slot on that host that still has a token; `publicClient` uses it for both lookups; tested.

- [x] **NS-107 · P2 · UX · A · S — Convert to punycode first with new URL('https://' + value).hostname, then validate.**
  - **Target:** [app/utils/instances.ts:62](/Users/powerox/neospace/app/utils/instances.ts:62). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Convert to punycode first with `new URL('https://' + value).hostname`, then validate.
  - **Prior observation to check:** `app/utils/instances.ts:62` — `normalizeServer`'s ASCII-only regex rejects IDN hosts (e.g. `bücher.social`, Cyrillic domains) with "Enter a server name like mastodon.social".
  - **Provenance:** [October 9 candidate, line 1157](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1157); explicit source files unchanged at review time.
  - Evidence: `normalizeServer` converts IDN hosts to punycode via the URL parser before validating (`bücher.social` → `xn--bcher-kva.social`); junk and spaces still rejected; tested.

- [x] **NS-108 · P2 · UX · A · S — Branch on err.name (MastoTimeoutError, MastoUnexpectedError) and /timed? ?out/, and map "unknown encoding"…**
  - **Target:** [app/utils/instances.ts:91](/Users/powerox/neospace/app/utils/instances.ts:91). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Branch on `err.name` (`MastoTimeoutError`, `MastoUnexpectedError`) and `/timed? ?out/`, and map "unknown encoding" to "That doesn't look like a Mastodon-compatible server."
  - **Prior observation to check:** `app/utils/instances.ts:91` — `friendlyServerError` echoes any message under 120 characters. masto's HTML-response error ("The server returned data with an unknown encoding. The server may be down.", e.g. a typo domain with a parking page) and "Request timed out" reach users verbatim. The `timeout` branch (`:88`) never matches masto's "timed out" wording.
  - **Provenance:** [October 9 candidate, line 1159](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1159); explicit source files unchanged at review time.
  - Evidence: `friendlyServerError` branches on error kind (`MastoTimeoutError`, `/timed? ?out/`, `MastoUnexpectedError`/“unknown encoding” → “That doesn't look like a Mastodon-compatible server.”) and never echoes client-library wording; tested.

- [x] **NS-109 · P2 · UX · A · S — Only peek after ~1s idle or on blur, use role="status" for failures, and don't cache failures for hosts…**
  - **Target:** [app/components/ServerPicker.vue:121](/Users/powerox/neospace/app/components/ServerPicker.vue:121). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Only peek after ~1s idle or on blur, use `role="status"` for failures, and don't cache failures for hosts the user is still typing.
  - **Prior observation to check:** `app/components/ServerPicker.vue:121` — Each keystroke schedules a peek (`:73-76`, 420ms). Partial hosts like `mastodon.s` and `mastodon.so` are fetched, and a red `role="alert"` "Couldn't reach mastodon.s" (`:215`) interrupts screen readers mid-typing. The failure is cached for 2 min (`instances.ts:167`).
  - **Provenance:** [October 9 candidate, line 1161](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1161); explicit source files unchanged at review time.
  - Evidence: Peek now runs after ~1s idle or on blur (or immediately for a catalog pick), failures render as `role=status`, and `fetchInstanceInfo(host, { cacheFailure: false })` keeps unfinished hosts out of the failure cache.

- [x] **NS-110 · P2 · UX · A · S — Delete the summary line.**
  - **Target:** [app/components/ServerPicker.vue:205](/Users/powerox/neospace/app/components/ServerPicker.vue:205). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Delete the summary line.
  - **Prior observation to check:** `app/components/ServerPicker.vue:205` — The summary line repeats the peek box stats (`:220-223`) in different words ("open registration" / "invite-only" vs "Registrations open" / "Registrations closed"). It isn't gated on `peekLoading`, so the previous server's stats show under a newly typed host.
  - **Provenance:** [October 9 candidate, line 1162](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1162); explicit source files unchanged at review time.
  - Evidence: Removed the duplicate peek-summary line (it was ungated and showed the previous server's stats).

- [x] **NS-111 · P2 · UX · A · S — "Sign-ups closed", plus "Approval required" from approval_required.**
  - **Target:** [app/components/ServerPicker.vue:208](/Users/powerox/neospace/app/components/ServerPicker.vue:208). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** "Sign-ups closed", plus "Approval required" from `approval_required`.
  - **Prior observation to check:** `app/components/ServerPicker.vue:208` — `registrations === false` is labelled "invite-only", and the same goes for `InstanceCard.vue:125` "Invite only". Closed sign-ups aren't invite-only (Mastodon invites are separate).
  - **Provenance:** [October 9 candidate, line 1163](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1163); explicit source files unchanged at review time.
  - Evidence: Closed registration now reads “Sign-ups closed” (picker, announcement and `InstanceCard`), and `approval_required` is mapped (`approvalRequired`) to show “Approval required”.

- [x] **NS-112 · P2 · UX · A · S — Standardise on "Add account" and "Accounts & servers".**
  - **Target:** [app/pages/login.vue:123](/Users/powerox/neospace/app/pages/login.vue:123). **Area:** D. Login page.
  - **Change:** Standardise on "Add account" and "Accounts & servers".
  - **Prior observation to check:** `app/pages/login.vue:123` — Add-account vocabulary drifts across screens: "Link a server" / "Link this server" (`:151`), tab title "Add account" (`:107`), sheet "Add / server" and "Add another server" (`AccountSwitcherSheet.vue:197-198`, `:254`), "Manage servers" (`:257`), and "+ Link server" (`InstanceManager.vue:185`). Adding a second account on the *same* server is still called "Link a server".
  - **Provenance:** [October 9 candidate, line 1175](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1175); explicit source files unchanged at review time.
  - Evidence: Standardised on “Add account” (login heading, submit label, sheet, manager button) and “Accounts & servers”.

- [x] **NS-113 · P2 · UX · A · S — Go to returnTo, or router.back() when history exists.**
  - **Target:** [app/pages/login.vue:136](/Users/powerox/neospace/app/pages/login.vue:136). **Area:** D. Login page.
  - **Change:** Go to `returnTo`, or `router.back()` when history exists.
  - **Prior observation to check:** `app/pages/login.vue:136` — In add mode the back link is hard-coded "← Back to profile", although add mode is reached from the switcher sheet and the Accounts manager on any page.
  - **Provenance:** [October 9 candidate, line 1176](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1176); explicit source files unchanged at review time.
  - Evidence: Add-mode back link goes to `returnTo`, else `router.back()` when there is history, else Profile.

- [x] **NS-114 · P2 · UX · A · S — Add a "Just browse" link to /.**
  - **Target:** [app/pages/login.vue:155](/Users/powerox/neospace/app/pages/login.vue:155). **Area:** D. Login page.
  - **Change:** Add a "Just browse" link to `/`.
  - **Prior observation to check:** `app/pages/login.vue:155` — A signed-out visitor gets no "Continue without signing in" path, though guest browsing exists (`DEFAULT_PUBLIC_INSTANCE`). The only exits are Explore and an external sign-up link.
  - **Provenance:** [October 9 candidate, line 1177](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1177); explicit source files unchanged at review time.
  - Evidence: Signed-out sign-in page has a “Just browse” link to `/`.

- [x] **NS-115 · P2 · UX · A · S — Show the gesture hints only when isNav.**
  - **Target:** [app/components/AccountSwitcher.vue:160](/Users/powerox/neospace/app/components/AccountSwitcher.vue:160). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Show the gesture hints only when `isNav`.
  - **Prior observation to check:** `app/components/AccountSwitcher.vue:160` — The tooltip "hold to switch accounts · double-tap to cycle" also shows in sidebar placement, where a tap toggles the sheet and double-tap does nothing.
  - **Provenance:** [October 9 candidate, line 1184](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1184); explicit source files unchanged at review time.
  - Evidence: Gesture hint in the trigger tooltip only shows for the nav placement; the sidebar says “Accounts”.

- [x] **NS-116 · P2 · UX · A · S — Drop double-tap cycling, or delay navigation until the double-tap window passes.**
  - **Target:** [app/components/AccountSwitcher.vue:70](/Users/powerox/neospace/app/components/AccountSwitcher.vue:70). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Drop double-tap cycling, or delay navigation until the double-tap window passes.
  - **Prior observation to check:** `app/components/AccountSwitcher.vue:70` — A double-tap first navigates to Profile on tap 1 (`:79`), then switches the posting account on tap 2. The page jumps *and* the identity changes, and the gesture is only discoverable from a tooltip that never shows on touch.
  - **Provenance:** [October 9 candidate, line 1185](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1185); explicit source files unchanged at review time.
  - Evidence: Dropped double-tap cycling (and `cycleAccount`): a nav tap only goes to Profile; switching stays on long-press / the labelled control.

- [x] **NS-117 · P2 · DESIGN · A · S — Route every account switch through useToastStore from a single setActiveAccount wrapper.**
  - **Target:** [app/components/AccountSwitcherSheet.vue:22](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:22). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Route every account switch through `useToastStore` from a single `setActiveAccount` wrapper.
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:22` — The sheet has its own bespoke toast pill (`:42-48`, `:115-119`). `AccountSwitcher.vue:52-53` uses the global toast store, and `InstanceManager.vue:142-144` "Use for posting" shows no feedback at all. That's three behaviours for one action.
  - **Provenance:** [October 9 candidate, line 1186](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1186); explicit source files unchanged at review time.
  - **Done:** New `app/composables/useSwitchAccount.ts` (`switchActiveAccount`, `cycleActiveAccountWithToast`, `instanceHandle`): the account switcher sheet, the Accounts manager ("use for posting") and the composer's account cycle all go through it and announce the new posting account in the global toast. The bespoke pill/CSS in `AccountSwitcherSheet` is gone.

- [x] **NS-118 · P2 · UX · A · S — Rewrite: "Switch which account you post and read as."**
  - **Target:** [app/components/AccountSwitcherSheet.vue:143](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:143). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Rewrite: "Switch which account you post and read as."
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:143` — The subtitle "Feeds still mix across signed-in accounts" is false, and so is `InstanceManager.vue:170-171` "For You merges their home feeds". `fetchMergedHomeTimeline` now uses only the active account (`instances.ts:1304-1308`).
  - **Provenance:** [October 9 candidate, line 1187](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1187); explicit source files unchanged at review time.
  - Evidence: Sheet subtitle is now “Switch which account you post and read as.” and the manager lede no longer claims merged home feeds.

- [x] **NS-119 · P2 · UX · A · S — Add the same action (or an overflow menu) to list rows.**
  - **Target:** [app/components/AccountSwitcherSheet.vue:178](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:178). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Add the same action (or an overflow menu) to list rows.
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:178` — Per-account "Sign out" exists only in the grid layout (≤4 accounts). The list layout for 5+ accounts (`:204-233`) has none.
  - **Provenance:** [October 9 candidate, line 1188](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1188); explicit source files unchanged at review time.
  - Evidence: List layout (5+ accounts) rows now have the same per-account Sign out button.

- [x] **NS-120 · P2 · UX · A · S — Put the host on its own line, or middle-truncate.**
  - **Target:** [app/components/AccountSwitcherSheet.vue:176](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:176). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Put the host on its own line, or middle-truncate.
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:176` — The full `@user@host` handle is end-truncated in a 5.5rem column, so it reads "@alice@mastod…". The server is often the only thing telling two "Alice" accounts apart. The toast does the same (`:284-287`).
  - **Provenance:** [October 9 candidate, line 1189](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1189); explicit source files unchanged at review time.
  - Evidence: Grid cells show the server host on its own line (full handle in the title); sign-out labels keep the full handle.

- [x] **NS-121 · P2 · DESIGN · A · S — Add a --neo-scrim token and use it in all three.**
  - **Target:** [app/components/AccountSwitcherSheet.vue:316](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:316). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Add a `--neo-scrim` token and use it in all three.
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:316` — The backdrop and shadows (`:331`, `:336`) are `color-mix` of `--neo-text-primary`, so in dark themes they become a light wash instead of a dim. `InstanceManager.vue:365` uses bg-primary and `InstancePreview.vue:310` uses `rgba(0,0,0,.85)`, so there are three scrim recipes.
  - **Provenance:** [October 9 candidate, line 1190](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1190); explicit source files unchanged at review time.
  - Evidence: Added `--neo-scrim` (= `--neo-bg-overlay`, a black scrim in every theme) in the theme mixin and used it for the account sheet, accounts manager and server preview backdrops.

- [x] **NS-122 · P2 · UX · A · S — Track signingOut[id], disable the button and show "Signing out…".**
  - **Target:** [app/components/AccountSwitcherSheet.vue:87](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:87). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Track `signingOut[id]`, disable the button and show "Signing out…".
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:87` — `signOutAccount` shows no pending state while revoke runs (up to 15s), and tapping "Sign out" again opens another confirm.
  - **Provenance:** [October 9 candidate, line 1191](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1191); explicit source files unchanged at review time.
  - Evidence: `signingOut[id]` disables that account's button, shows “Signing out…” and blocks a second confirm.

- [x] **NS-123 · P2 · UX · A · S — Render through the existing custom-emoji renderer, or strip shortcodes in plain-text contexts.**
  - **Target:** [app/components/AccountSwitcherSheet.vue:173](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:173). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Render through the existing custom-emoji renderer, or strip shortcodes in plain-text contexts.
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:173` — Display names are rendered as raw text, so custom-emoji shortcodes show literally ("Alice :blobcat:"). The same happens in `:220`, `InstanceManager.vue:219`, the switch toasts (`AccountSwitcher.vue:50-53`) and `InstancePreview.vue:230`.
  - **Provenance:** [October 9 candidate, line 1192](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1192); explicit source files unchanged at review time.
  - Evidence: `plainDisplayName` strips `:shortcode:` emoji in plain-text contexts (account sheet, manager, preview posts); the cycle toast that also showed it is gone.

- [x] **NS-124 · P2 · UX · A · S — Give "main" a meaning (default posting account on launch, the account for add-mode linking) or remove the…**
  - **Target:** [app/components/AccountSwitcherSheet.vue:240](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:240). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Give "main" a meaning (default posting account on launch, the account for add-mode linking) or remove the concept.
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:240` — "Make this main" and InstanceManager's "Make main" (`:245-252`) have no functional effect. `primaryAccount` is only read for badges and the login lede (`login.vue:28`), and nothing explains what "Main" means.
  - **Provenance:** [October 9 candidate, line 1193](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1193); explicit source files unchanged at review time.
  - **Done:** Decision: **main = the account the app posts as on a fresh launch** (new tab / PWA start); later reloads in the same session keep whatever the user switched to (`launchAccountId` in `stores/instances.ts`, session flag in sessionStorage). The Accounts manager says so ("Make main" toast/title). Tests: `tests/p2-final-batch.test.ts`.

- [x] **NS-125 · P2 · UX · A · S — Render instance.error on signed-in rows too.**
  - **Target:** [app/components/InstanceManager.vue:229](/Users/powerox/neospace/app/components/InstanceManager.vue:229). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Render `instance.error` on signed-in rows too.
  - **Prior observation to check:** `app/components/InstanceManager.vue:229` — Signed-in rows only ever show "Session expired". Verify errors such as "Offline — couldn't verify your session" or "Server error — try again later" (`instances.ts:1074-1080`) are only rendered for watching rows (`:328`), so a down server looks healthy.
  - **Provenance:** [October 9 candidate, line 1202](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1202); explicit source files unchanged at review time.
  - Evidence: Signed-in rows now render `instance.error` (when the session isn't expired) as a status line.

- [x] **NS-126 · P2 · UX · A · S — Use handleOf(instance).**
  - **Target:** [app/components/InstanceManager.vue:132](/Users/powerox/neospace/app/components/InstanceManager.vue:132). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Use `handleOf(instance)`.
  - **Prior observation to check:** `app/components/InstanceManager.vue:132` — The sign-out confirm and toast (`:139`) use `instance.name`, which is the server *title* ("Mastodon"), not the handle. With two accounts on one server it reads "Sign out of Mastodon?". Remove uses the handle (`:94`).
  - **Provenance:** [October 9 candidate, line 1203](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1203); explicit source files unchanged at review time.
  - Evidence: Manager sign-out confirm and toast use `handleOf(instance)` instead of the server title; “Use for posting” now toasts “Posting as @handle”.

- [x] **NS-127 · P2 · UX · A · S — Show the CW line with the body collapsed, and blur sensitive thumbnails.**
  - **Target:** [app/components/InstancePreview.vue:234](/Users/powerox/neospace/app/components/InstancePreview.vue:234). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Show the CW line with the body collapsed, and blur `sensitive` thumbnails.
  - **Prior observation to check:** `app/components/InstancePreview.vue:234` — Preview posts ignore `spoilerText` and `sensitive`, so content-warned text and sensitive media (`:237-246`) show unblurred in a pre-signup preview.
  - **Provenance:** [October 9 candidate, line 1214](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1214); explicit source files unchanged at review time.
  - Evidence: Server preview shows only `CW: <warning>` for content-warned posts (media hidden) and blurs sensitive thumbnails.

- [x] **NS-128 · P2 · A11Y · A · S — Use --neo-accent for surfaces and keep the curated colour as a thin stripe.**
  - **Target:** [app/components/InstancePreview.vue:122](/Users/powerox/neospace/app/components/InstancePreview.vue:122). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Use `--neo-accent` for surfaces and keep the curated colour as a thin stripe.
  - **Prior observation to check:** `app/components/InstancePreview.vue:122` — The header (`:341-342`), Watch button (`:636-637`) and Join outline (`:655-656`) are painted with the curated hex `color` under `--neo-text-on-accent`, and contrast is unchecked. Examples: `beige.party` `#c4a574` with light text is about 2:1. The `metalhead.club` `#2a2a2a` and `blacktwitter.io` `#3a3a3a` join text is invisible on dark cards (`useCuratedInstances.ts:168`, `:313`).
  - **Provenance:** [October 9 candidate, line 1215](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1215); explicit source files unchanged at review time.
  - Evidence: Preview header, Watch and Join use the theme `--neo-accent` for fills/text; the curated colour is a 4px header stripe.

- [x] **NS-129 · P2 · UX · A · S — Show friendlyServerError(e) in openPreview (instances.ts:1416).**
  - **Target:** [app/components/InstancePreview.vue:209](/Users/powerox/neospace/app/components/InstancePreview.vue:209). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Show `friendlyServerError(e)` in `openPreview` (`instances.ts:1416`).
  - **Prior observation to check:** `app/components/InstancePreview.vue:209` — `previewError` is the raw masto message ("Request timed out", "The server returned data with an unknown encoding…").
  - **Provenance:** [October 9 candidate, line 1216](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1216); explicit source files unchanged at review time.
  - Evidence: `openPreview` now stores `friendlyServerError(e)` instead of the raw masto message.

- [x] **NS-130 · P2 · UX · A · M — Add software and a scheduled script that checks /api/v2/instance for every entry and updates verifiedAt.**
  - **Target:** [app/composables/useCuratedInstances.ts:17](/Users/powerox/neospace/app/composables/useCuratedInstances.ts:17). **Area:** H. Curated catalogue (useCuratedInstances.ts).
  - **Change:** Add `software` and a scheduled script that checks `/api/v2/instance` for every entry and updates `verifiedAt`.
  - **Prior observation to check:** `app/composables/useCuratedInstances.ts:17` — `CuratedInstance` still has no `software` field and there is no CI probe script (old item 704 promised both). Nothing stops a non-Mastodon or dead server from shipping in Featured.
  - **Provenance:** [October 9 candidate, line 1227](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1227); explicit source files unchanged at review time.
  - **Done:** Added `software` to `CuratedInstance` and `scripts/probe-instances.mjs` (+ `scripts/instanceProbe.mjs`): probes every entry's `/api/v2/instance` (v1 fallback), classifies the software, and with `--write` rewrites `software` + `verifiedAt`. Weekly `.github/workflows/probe-instances.yml` fails on a dead / non-Mastodon-API entry. Ran it for real: 44 entries refreshed (verifiedAt 2026-10-12) and `gamers.town` removed (404 on both endpoints). `tests/curated-catalog.test.ts` checks every entry has a known `software` + date and none is `other`.

- [x] **NS-131 · P2 · UX · A · S — Treat only navigator.onLine === false as offline; otherwise say "Couldn't reach {server}".**
  - **Target:** [app/utils/friendlyError.ts:37](/Users/powerox/neospace/app/utils/friendlyError.ts:37). **Area:** I. Error mapping utils (friendlyError.ts, federation.ts, authErrors.ts, mastoGuard.ts).
  - **Change:** Treat only `navigator.onLine === false` as offline; otherwise say "Couldn't reach {server}".
  - **Prior observation to check:** `app/utils/friendlyError.ts:37` — Any `TypeError` matching "fetch/network/failed" is classified as offline, so CORS blocks, DNS failures and TLS errors on a dead remote show "You appear to be offline" to an online user. `federation.ts:33` does the same.
  - **Provenance:** [October 9 candidate, line 1231](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1231); explicit source files unchanged at review time.
  - Evidence: `isOffline` trusts only `navigator.onLine === false` (or `NETWORK_ERROR`); an online `TypeError: Failed to fetch` maps to “Couldn’t reach the server”. `federation.ts` left as-is on purpose: redraft's delete-outcome classification depends on its `offline` bucket.

- [x] **NS-132 · P2 · UX · A · S — Map MastoTimeoutError to "took too long" and MastoUnexpectedError to "unexpected response", and never echo…**
  - **Target:** [app/utils/friendlyError.ts:96](/Users/powerox/neospace/app/utils/friendlyError.ts:96). **Area:** I. Error mapping utils (friendlyError.ts, federation.ts, authErrors.ts, mastoGuard.ts).
  - **Change:** Map `MastoTimeoutError` to "took too long" and `MastoUnexpectedError` to "unexpected response", and never echo unknown messages.
  - **Prior observation to check:** `app/utils/friendlyError.ts:96` — The fallback echoes `err.message`: masto's "The server returned data with an unknown encoding…", "Request timed out", and `mastoGuard.ts:24` "Unsafe API path segment" all reach users.
  - **Provenance:** [October 9 candidate, line 1232](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1232); explicit source files unchanged at review time.
  - Evidence: `mapErrorToMessage` maps `MastoTimeoutError`/timeouts to “took too long” and `MastoUnexpectedError` to “unexpected response”, and never echoes masto/transport wording (app-authored messages still show).

- [x] **NS-133 · P2 · UX · A · S — Add invalid_scope and timeout cases, and rewrite invalid_client as "Try again — NeoSpace will reconnect to…**
  - **Target:** [app/utils/authErrors.ts:6](/Users/powerox/neospace/app/utils/authErrors.ts:6). **Area:** I. Error mapping utils (friendlyError.ts, federation.ts, authErrors.ts, mastoGuard.ts).
  - **Change:** Add `invalid_scope` and timeout cases, and rewrite `invalid_client` as "Try again — NeoSpace will reconnect to this server".
  - **Prior observation to check:** `app/utils/authErrors.ts:6` — Common cases are unmapped or mis-mapped. `invalid_scope` has no copy. Timeouts ("signal timed out" from `oauthFetch`) fall to the generic line. "Missing OAuth credentials" maps to "Something interrupted sign-in" (`:33-35`), and the `invalid_client` copy says "contact your server admin" although a retry re-registers (`instances.ts:866-881`).
  - **Provenance:** [October 9 candidate, line 1236](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1236); explicit source files unchanged at review time.
  - Evidence: Added `invalid_scope` and timeout copy; `invalid_client` is now “Try again — NeoSpace will reconnect to this server.”

- [x] **NS-134 · P3 · UX · A · S — Make it computed: "Sign-in failed | NeoSpace" when error is set.**
  - **Target:** [app/pages/auth/callback.vue:104](/Users/powerox/neospace/app/pages/auth/callback.vue:104). **Area:** A. OAuth flow & PKCE (instances.ts startAuth/completeAuth, oauthPkce.ts, auth/callback.vue).
  - **Change:** Make it computed: "Sign-in failed | NeoSpace" when `error` is set.
  - **Prior observation to check:** `app/pages/auth/callback.vue:104` — The page title stays "Signing in… | NeoSpace" on the error state.
  - **Provenance:** [October 9 candidate, line 1124](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1124); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-135 · P3 · UX · A · S — Use one status string and drop the redundant sub-line on success.**
  - **Target:** [app/pages/auth/callback.vue:17](/Users/powerox/neospace/app/pages/auth/callback.vue:17). **Area:** A. OAuth flow & PKCE (instances.ts startAuth/completeAuth, oauthPkce.ts, auth/callback.vue).
  - **Change:** Use one status string and drop the redundant sub-line on success.
  - **Prior observation to check:** `app/pages/auth/callback.vue:17` — The initial "Signing you in…" is replaced by "Finishing up…" (`:54`) synchronously, so it never shows. "Just a moment." (`:131`) then sits under "Now posting as … — opening NeoSpace…".
  - **Provenance:** [October 9 candidate, line 1125](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1125); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-136 · P3 · PERF · A · S — Skip verify for ids verified in the last minute, or let the callback run initialize() itself.**
  - **Target:** [app/pages/auth/callback.vue:55](/Users/powerox/neospace/app/pages/auth/callback.vue:55). **Area:** A. OAuth flow & PKCE (instances.ts startAuth/completeAuth, oauthPkce.ts, auth/callback.vue).
  - **Change:** Skip verify for ids verified in the last minute, or let the callback run `initialize()` itself.
  - **Prior observation to check:** `app/pages/auth/callback.vue:55` — The callback loads storage and verifies the new token. Right after `router.replace`, the layout's `initialize()` (`instances.ts:1141`) re-verifies every token, including the one just verified.
  - **Provenance:** [October 9 candidate, line 1126](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1126); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-137 · P3 · UX · A · S — Strip one trailing dot, and decide whether to allow ports.**
  - **Target:** [app/utils/instances.ts:59](/Users/powerox/neospace/app/utils/instances.ts:59). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Strip one trailing dot, and decide whether to allow ports.
  - **Prior observation to check:** `app/utils/instances.ts:59` — Valid inputs are rejected: a trailing-dot FQDN (`mastodon.social.`) and an explicit port (`example.social:8443`) both fail the regex.
  - **Provenance:** [October 9 candidate, line 1158](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1158); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [ ] **NS-138 · P3 · CODE · A · M — Learn it at runtime: on a 422 or 401 from timelines/public, remember the host (persisted with a TTL).**
  - **Target:** [app/utils/instances.ts:12](/Users/powerox/neospace/app/utils/instances.ts:12). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Learn it at runtime: on a 422 or 401 from `timelines/public`, remember the host (persisted with a TTL).
  - **Prior observation to check:** `app/utils/instances.ts:12` — `AUTH_GATED_PUBLIC_HOSTS` is a hand-kept list of 3 hosts. Since Mastodon 4.2 any server can gate public timelines.
  - **Provenance:** [October 9 candidate, line 1160](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1160); explicit source files unchanged at review time.

- [x] **NS-139 · P3 · UX · A · S — inputmode="email".**
  - **Target:** [app/components/ServerPicker.vue:190](/Users/powerox/neospace/app/components/ServerPicker.vue:190). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** `inputmode="email"`.
  - **Prior observation to check:** `app/components/ServerPicker.vue:190` — `inputmode="url"` gives an iOS keyboard without "@" on the primary layer, while the label and placeholder ask for `@you@server`.
  - **Provenance:** [October 9 candidate, line 1164](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1164); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-140 · P3 · UX · A · S — Search on the normalizeServer host when it parses.**
  - **Target:** [app/components/ServerPicker.vue:51](/Users/powerox/neospace/app/components/ServerPicker.vue:51). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Search on the `normalizeServer` host when it parses.
  - **Prior observation to check:** `app/components/ServerPicker.vue:51` — `catalogHits` searches the raw query, so `@alice@hachyderm.io` or `https://hachyderm.io/` shows no catalog match.
  - **Provenance:** [October 9 candidate, line 1165](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1165); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-141 · P3 · UX · A · S — Hide hits when the query exactly equals a hit's domain.**
  - **Target:** [app/components/ServerPicker.vue:232](/Users/powerox/neospace/app/components/ServerPicker.vue:232). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Hide hits when the query exactly equals a hit's domain.
  - **Prior observation to check:** `app/components/ServerPicker.vue:232` — After you tap a hit, the query equals its domain, so the hit list stays open showing the one item you just chose.
  - **Provenance:** [October 9 candidate, line 1166](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1166); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-142 · P3 · UX · A · S — Make both fill and peek, or both start sign-in.**
  - **Target:** [app/components/ServerPicker.vue:255](/Users/powerox/neospace/app/components/ServerPicker.vue:255). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Make both fill and peek, or both start sign-in.
  - **Prior observation to check:** `app/components/ServerPicker.vue:255` — Featured rows jump straight into OAuth, while typeahead hits only fill the input (`:147-151`), which is inconsistent. Featured rows also show no live stats or registration state.
  - **Provenance:** [October 9 candidate, line 1167](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1167); explicit source files unchanged at review time.
  - Evidence: ServerPicker catalog hits call `pick()` (same as featured rows).

- [x] **NS-143 · P3 · A11Y · A · S — Wrap the emoji in &lt;span aria-hidden="true"&gt;.**
  - **Target:** [app/components/ServerPicker.vue:235](/Users/powerox/neospace/app/components/ServerPicker.vue:235). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Wrap the emoji in `<span aria-hidden="true">`.
  - **Prior observation to check:** `app/components/ServerPicker.vue:235` — The hit button's emoji isn't `aria-hidden` (featured rows are, `:257`), so screen readers read "penguin fosstodon.org".
  - **Provenance:** [October 9 candidate, line 1168](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1168); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-144 · P3 · A11Y · A · S — Remove outline: none.**
  - **Target:** [app/components/ServerPicker.vue:314](/Users/powerox/neospace/app/components/ServerPicker.vue:314). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Remove `outline: none`.
  - **Prior observation to check:** `app/components/ServerPicker.vue:314` — Featured rows set `outline: none` on `:focus-visible`, overriding the global focus ring (`main.scss:739`). The only cue is a border and tint change.
  - **Provenance:** [October 9 candidate, line 1169](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1169); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-145 · P3 · DESIGN · A · S — Switch the token.**
  - **Target:** [app/components/ServerPicker.vue:514](/Users/powerox/neospace/app/components/ServerPicker.vue:514). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Switch the token.
  - **Prior observation to check:** `app/components/ServerPicker.vue:514` — The submit text uses `var(--neo-text-inverse, #fafaf8)`, while every other accent button uses `--neo-text-on-accent`.
  - **Provenance:** [October 9 candidate, line 1170](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1170); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-146 · P3 · CODE · A · S — Remove them.**
  - **Target:** [app/components/ServerPicker.vue:35](/Users/powerox/neospace/app/components/ServerPicker.vue:35). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Remove them.
  - **Prior observation to check:** `app/components/ServerPicker.vue:35` — `showCustom` is always true. `openCustom` (`:57-62`), its exposed API and the `.server-picker__toggle` styles (`:365-383`) are dead.
  - **Provenance:** [October 9 candidate, line 1171](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1171); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-147 · P3 · UX · A · S — Use one string, "1,234 active this month", built with Intl.PluralRules.**
  - **Target:** [app/components/ServerPicker.vue:115](/Users/powerox/neospace/app/components/ServerPicker.vue:115). **Area:** C. Server compatibility & input normalisation (utils/instances.ts, ServerPicker.vue).
  - **Change:** Use one string, "1,234 active this month", built with `Intl.PluralRules`.
  - **Prior observation to check:** `app/components/ServerPicker.vue:115` — "1,234 monthly active" has no noun or pluralisation (also `:206`, `:221`, `InstanceCard.vue:122`), and InstancePreview calls the same number "Active Users" (`InstancePreview.vue:162`).
  - **Provenance:** [October 9 candidate, line 1172](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1172); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-148 · P3 · UX · A · S — Gate the template on a checked ref set after the sync token check.**
  - **Target:** [app/pages/login.vue:53](/Users/powerox/neospace/app/pages/login.vue:53). **Area:** D. Login page.
  - **Change:** Gate the template on a `checked` ref set after the sync token check.
  - **Prior observation to check:** `app/pages/login.vue:53` — On the signed-in fast path the picker renders first (and autofocuses on desktop, `ServerPicker.vue:164`), then redirects, so it flashes.
  - **Provenance:** [October 9 candidate, line 1178](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1178); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-149 · P3 · UX · A · S — "New to the fediverse?"**
  - **Target:** [app/pages/login.vue:156](/Users/powerox/neospace/app/pages/login.vue:156). **Area:** D. Login page.
  - **Change:** "New to the fediverse?"
  - **Prior observation to check:** `app/pages/login.vue:156` — The footer says "New to Mastodon?" while the picker hint says "fediverse" and the app supports GoToSocial and others.
  - **Provenance:** [October 9 candidate, line 1179](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1179); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-150 · P3 · UX · A · S — Keep one.**
  - **Target:** [app/pages/login.vue:158](/Users/powerox/neospace/app/pages/login.vue:158). **Area:** D. Login page.
  - **Change:** Keep one.
  - **Prior observation to check:** `app/pages/login.vue:158` — Two links to the same Explore page sit on the page: "Browse servers by interest" here, and "Explore servers" in `ServerPicker.vue:266-269`.
  - **Provenance:** [October 9 candidate, line 1180](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1180); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-151 · P3 · DESIGN · A · S — Add an initials or placeholder avatar like AccountSwitcher.vue:192.**
  - **Target:** [app/components/AccountSwitcherSheet.vue:159](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:159). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Add an initials or placeholder avatar like `AccountSwitcher.vue:192`.
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:159` — There's no avatar fallback, so an account without an avatar shows an empty 72px ring (grid) or nothing at all (list `:212-217`), and the row text shifts left.
  - **Provenance:** [October 9 candidate, line 1194](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1194); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-152 · P3 · A11Y · A · S — Use aria-current only.**
  - **Target:** [app/components/AccountSwitcherSheet.vue:153](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:153). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Use `aria-current` only.
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:153` — Grid buttons carry both `aria-pressed` and `aria-current` (screen readers announce "toggle button, pressed, current"). List rows only have `aria-current`.
  - **Provenance:** [October 9 candidate, line 1195](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1195); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-153 · P3 · CODE · A · S — Remove them.**
  - **Target:** [app/components/AccountSwitcherSheet.vue:101](/Users/powerox/neospace/app/components/AccountSwitcherSheet.vue:101). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Remove them.
  - **Prior observation to check:** `app/components/AccountSwitcherSheet.vue:101` — The `acct-sheet-open` html class and its CSS (`:646-648`) duplicate the ref-counted `useScrollLock` that `useFocusTrap` already applies.
  - **Provenance:** [October 9 candidate, line 1196](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1196); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-154 · P3 · UX · A · S — Use activeAccount?.user directly.**
  - **Target:** [app/components/AccountSwitcher.vue:137](/Users/powerox/neospace/app/components/AccountSwitcher.vue:137). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Use `activeAccount?.user` directly.
  - **Prior observation to check:** `app/components/AccountSwitcher.vue:137` — `userDisplayName` returns "Guest" when there's no user, so the `|| username || 'Profile'` fallback is dead and the label can read "Guest".
  - **Provenance:** [October 9 candidate, line 1197](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1197); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-155 · P3 · DESIGN · A · S — Use a neutral style (bg-tertiary / text-secondary) or the stacked peeks alone.**
  - **Target:** [app/components/AccountSwitcher.vue:199](/Users/powerox/neospace/app/components/AccountSwitcher.vue:199). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Use a neutral style (bg-tertiary / text-secondary) or the stacked peeks alone.
  - **Prior observation to check:** `app/components/AccountSwitcher.vue:199` — The accent-filled account-count badge looks like an unread-notification badge on the avatar.
  - **Provenance:** [October 9 candidate, line 1198](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1198); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-156 · P3 · CODE · A · S — Move it into overlay.ts.**
  - **Target:** [app/composables/useAccountsManager.ts:4](/Users/powerox/neospace/app/composables/useAccountsManager.ts:4). **Area:** E. Account switcher (AccountSwitcher.vue, AccountSwitcherSheet.vue).
  - **Change:** Move it into `overlay.ts`.
  - **Prior observation to check:** `app/composables/useAccountsManager.ts:4` — The Accounts manager's open state is a module-level ref, unlike the switcher, which lives in the overlay store "for stacking with confirm/lightbox" (`useAccountSwitcher.ts:3`).
  - **Provenance:** [October 9 candidate, line 1199](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1199); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-157 · P3 · UX · A · S — Reset only in catch, and pick one error surface.**
  - **Target:** [app/components/InstanceManager.vue:118](/Users/powerox/neospace/app/components/InstanceManager.vue:118). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Reset only in `catch`, and pick one error surface.
  - **Prior observation to check:** `app/components/InstanceManager.vue:118` — `finally` resets `isConnecting` even on success, so the button flips back to "Sign in again" while the page navigates away. On failure the error shows twice, inline (`:116`) and as a toast (`:117`).
  - **Provenance:** [October 9 candidate, line 1204](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1204); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-158 · P3 · UX · A · S — Pass returnTo: route.fullPath.**
  - **Target:** [app/components/InstanceManager.vue:112](/Users/powerox/neospace/app/components/InstanceManager.vue:112). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Pass `returnTo: route.fullPath`.
  - **Prior observation to check:** `app/components/InstanceManager.vue:112` — `startAuth` is called with no `returnTo` (also `InstanceCard.vue:98`, `InstancePreview.vue:92`), so after OAuth you land on `/` instead of where you were.
  - **Provenance:** [October 9 candidate, line 1205](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1205); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-159 · P3 · UX · A · S — Copy the attributes and guard with !e.isComposing, or use a &lt;form @submit&gt;.**
  - **Target:** [app/components/InstanceManager.vue:287](/Users/powerox/neospace/app/components/InstanceManager.vue:287). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Copy the attributes and guard with `!e.isComposing`, or use a `<form @submit>`.
  - **Prior observation to check:** `app/components/InstanceManager.vue:287` — The Watch input lacks the `autocapitalize`, `autocorrect`, `spellcheck` and `inputmode` attributes ServerPicker sets. `@keydown.enter` (`:294`) also fires mid-IME-composition (Japanese, Chinese).
  - **Provenance:** [October 9 candidate, line 1206](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1206); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-160 · P3 · UX · A · S — Clear them in a watch(newServerUrl).**
  - **Target:** [app/components/InstanceManager.vue:305](/Users/powerox/neospace/app/components/InstanceManager.vue:305). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Clear them in a `watch(newServerUrl)`.
  - **Prior observation to check:** `app/components/InstanceManager.vue:305` — The "Watching x" and error messages persist after you start typing another server.
  - **Provenance:** [October 9 candidate, line 1207](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1207); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-161 · P3 · A11Y · A · S — Drop the role; the static text is enough.**
  - **Target:** [app/components/InstanceManager.vue:229](/Users/powerox/neospace/app/components/InstanceManager.vue:229). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Drop the role; the static text is enough.
  - **Prior observation to check:** `app/components/InstanceManager.vue:229` — Each expired row is its own `role="status"`, so opening the dialog with several expired accounts announces them all at once.
  - **Provenance:** [October 9 candidate, line 1208](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1208); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-162 · P3 · A11Y · A · S — Make it 44px.**
  - **Target:** [app/components/InstanceManager.vue:411](/Users/powerox/neospace/app/components/InstanceManager.vue:411). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Make it 44px.
  - **Prior observation to check:** `app/components/InstanceManager.vue:411` — The close button is 36×36, below the 44px target used by every other control in this dialog (`.action-label` min-height 2.75rem).
  - **Provenance:** [October 9 candidate, line 1209](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1209); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-163 · P3 · UX · A · S — Add it as a footer action.**
  - **Target:** [app/components/InstanceManager.vue:183](/Users/powerox/neospace/app/components/InstanceManager.vue:183). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Add it as a footer action.
  - **Prior observation to check:** `app/components/InstanceManager.vue:183` — There's no "Sign out of all accounts" here; it only exists in Settings (`SettingsModal.vue:55-67`). The old audit marked it "still open".
  - **Provenance:** [October 9 candidate, line 1210](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1210); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-164 · P3 · CODE · A · S — Delete both.**
  - **Target:** [app/components/InstanceManager.vue:710](/Users/powerox/neospace/app/components/InstanceManager.vue:710). **Area:** F. Accounts & Servers manager (InstanceManager.vue).
  - **Change:** Delete both.
  - **Prior observation to check:** `app/components/InstanceManager.vue:710` — A scoped `.sr-only` duplicates the global one (`main.scss:698`), and so does `InstanceCard.vue:367-377`.
  - **Provenance:** [October 9 candidate, line 1211](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1211); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-165 · P3 · UX · A · S — Show "Couldn't reach server" in muted text.**
  - **Target:** [app/components/InstanceCard.vue:36](/Users/powerox/neospace/app/components/InstanceCard.vue:36). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Show "Couldn't reach server" in muted text.
  - **Prior observation to check:** `app/components/InstanceCard.vue:36` — When the live fetch fails, "Checking server…" just disappears with no signal.
  - **Provenance:** [October 9 candidate, line 1217](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1217); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-166 · P3 · CODE · A · S — Use .some() over all rows with a token.**
  - **Target:** [app/components/InstanceCard.vue:26](/Users/powerox/neospace/app/components/InstanceCard.vue:26). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Use `.some()` over all rows with a token.
  - **Prior observation to check:** `app/components/InstanceCard.vue:26` — `instanceRow` and `isSignedIn` check only the first row for the host (same in `InstancePreview.vue:25-29`). If a watching or expired row comes first and a signed-in slot later, the card offers "Sign in" and creates another slot.
  - **Provenance:** [October 9 candidate, line 1218](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1218); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-167 · P3 · UX · A · S — Fall back to https://${d} (the server's landing page).**
  - **Target:** [app/components/InstancePreview.vue:58](/Users/powerox/neospace/app/components/InstancePreview.vue:58). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Fall back to `https://${d}` (the server's landing page).
  - **Prior observation to check:** `app/components/InstancePreview.vue:58` — The sign-up fallback is Mastodon-only (`/auth/sign_up`), so GoToSocial, Akkoma and Misskey 404.
  - **Provenance:** [October 9 candidate, line 1219](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1219); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-168 · P3 · UX · A · S — Use undefined (the user's locale) or the app's formatter.**
  - **Target:** [app/components/InstancePreview.vue:102](/Users/powerox/neospace/app/components/InstancePreview.vue:102). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Use `undefined` (the user's locale) or the app's formatter.
  - **Prior observation to check:** `app/components/InstancePreview.vue:102` — Dates are hard-coded to `'en-US'`.
  - **Provenance:** [October 9 candidate, line 1220](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1220); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-169 · P3 · UX · A · S — new Intl.DisplayNames([], { type: 'language' }).**
  - **Target:** [app/components/InstancePreview.vue:179](/Users/powerox/neospace/app/components/InstancePreview.vue:179). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** `new Intl.DisplayNames([], { type: 'language' })`.
  - **Prior observation to check:** `app/components/InstancePreview.vue:179` — Languages show as raw ISO codes ("en, de, ja").
  - **Provenance:** [October 9 candidate, line 1221](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1221); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-170 · P3 · UX · A · S — Add "+N more rules", linking to https://${domain}/about.**
  - **Target:** [app/components/InstancePreview.vue:187](/Users/powerox/neospace/app/components/InstancePreview.vue:187). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Add "+N more rules", linking to `https://${domain}/about`.
  - **Prior observation to check:** `app/components/InstancePreview.vue:187` — Rules are silently capped at 5, so users who are vetting a server miss the rest.
  - **Provenance:** [October 9 candidate, line 1222](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1222); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-171 · P3 · UX · A · S — Gate on userCount != null.**
  - **Target:** [app/components/InstancePreview.vue:160](/Users/powerox/neospace/app/components/InstancePreview.vue:160). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Gate on `userCount != null`.
  - **Prior observation to check:** `app/components/InstancePreview.vue:160` — `stats` is always an object (`mapV2InstanceInfo` sets `stats: {}`), so the grid always renders and shows "N/A" when the count is missing.
  - **Provenance:** [October 9 candidate, line 1223](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1223); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-172 · P3 · UX · A · S — Fix the copy.**
  - **Target:** [app/components/InstancePreview.vue:206](/Users/powerox/neospace/app/components/InstancePreview.vue:206). **Area:** G. Explore cards & server preview (InstanceCard.vue, InstancePreview.vue).
  - **Change:** Fix the copy.
  - **Prior observation to check:** `app/components/InstancePreview.vue:206` — "Loading timeline..." uses ASCII dots where the rest of the app uses "…". `:253` reads "You can still Sign in or create an account" with a stray capital S.
  - **Provenance:** [October 9 candidate, line 1224](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1224); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-173 · P3 · CODE · A · S — Use it in the CI probe, or hide entries older than N days.**
  - **Target:** [app/composables/useCuratedInstances.ts:28](/Users/powerox/neospace/app/composables/useCuratedInstances.ts:28). **Area:** H. Curated catalogue (useCuratedInstances.ts).
  - **Change:** Use it in the CI probe, or hide entries older than N days.
  - **Prior observation to check:** `app/composables/useCuratedInstances.ts:28` — `verifiedAt` is set on six entries (`:49`…`:235`) and never read anywhere in `app/`, so it gives no freshness signal.
  - **Provenance:** [October 9 candidate, line 1228](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1228); explicit source files unchanged at review time.
  - Evidence: `useCuratedInstances()` omits catalogue entries whose `verifiedAt` is older than 120 days.

- [x] **NS-174 · P3 · PERF · A · S — Memoise wrapped children per target in a WeakMap.**
  - **Target:** [app/utils/mastoGuard.ts:42](/Users/powerox/neospace/app/utils/mastoGuard.ts:42). **Area:** I. Error mapping utils (friendlyError.ts, federation.ts, authErrors.ts, mastoGuard.ts).
  - **Change:** Memoise wrapped children per target in a `WeakMap`.
  - **Prior observation to check:** `app/utils/mastoGuard.ts:42` — Every property access allocates a new `Proxy` (no cache), so each `client.v1.accounts.$select(id).fetch()` chain builds several proxies, on hot timeline paths.
  - **Provenance:** [October 9 candidate, line 1237](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1237); explicit source files unchanged at review time.

## Remaining candidates: App shell, navigation & shared UI primitives
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-175 · P1 · UX · C · S — Mount it when isDesk || !isMobileSubview.**
  - **Target:** [app/layouts/default.vue:247](/Users/powerox/neospace/app/layouts/default.vue:247). **Area:** Layout (`app/layouts/default.vue`).
  - **Change:** Mount it when `isDesk || !isMobileSubview`.
  - **Prior observation to check:** `app/layouts/default.vue:247`: `<FeedbackNotes v-if="!isMobileSubview">` depends on the route only, not the breakpoint. On desktop, the sidebar's "Leave a note" (`DesktopSidebar.vue:583-591`) does nothing on /notifications, /messages, /status/*, /profile* and /groups/*. `useFeedbackNotes.ts:48-53` still pushes a phantom history entry, so Back seems to do nothing once. The dialog then pops up unprompted when the user navigates Home (`open` is still true).
  - **Provenance:** [October 9 candidate, line 690](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:690); explicit source files unchanged at review time.
  - Evidence: `FeedbackNotes` now mounts on `isDesk || !isMobileSubview` in `app/layouts/default.vue`, so the desktop sidebar's "Leave a note" works on notifications, messages, status, profile and group routes.

- [x] **NS-176 · P2 · UX · A · M — Hide .mobile-nav and .neo-bottom-dock while html[data-keyboard-open].**
  - **Target:** [app/composables/useAppShellHeight.ts:18](/Users/powerox/neospace/app/composables/useAppShellHeight.ts:18). **Area:** Layout (`app/layouts/default.vue`).
  - **Change:** Hide `.mobile-nav` and `.neo-bottom-dock` while `html[data-keyboard-open]`.
  - **Prior observation to check:** `app/composables/useAppShellHeight.ts:18-25` + `app/layouts/default.vue:240,251-261`: with the iOS overlay keyboard, `--neo-app-height` shrinks to `visualViewport.height`. The in-flow tab bar and the bottom dock (waffle + install banner) then ride up above the keyboard on any page with an input (Explore search, group search). `html[data-keyboard-open]` is only used by `pages/status/[id].vue:1418`.
  - **Provenance:** [October 9 candidate, line 691](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:691); explicit source files unchanged at review time.
  - **Done:** `main.scss` hides `.mobile-nav` / `.neo-bottom-dock` under `html[data-keyboard-open]` at ≤1023px.
- [x] **NS-177 · P2 · UX · A · S — Make the notice non-sticky at ≥1024px, or offset .subview-chrome by the notice height.**
  - **Target:** [app/layouts/default.vue:268](/Users/powerox/neospace/app/layouts/default.vue:268). **Area:** Layout (`app/layouts/default.vue`).
  - **Change:** Make the notice non-sticky at ≥1024px, or offset `.subview-chrome` by the notice height.
  - **Prior observation to check:** `app/layouts/default.vue:268-281` + `app/components/SubviewChrome.vue:59-62`: on desktop the auth notice is `position:sticky; top:0; z-index:90`, and SubviewChrome is also sticky at `top:0`. When the notice is showing, the Back bar slides underneath it as you scroll.
  - **Provenance:** [October 9 candidate, line 692](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:692); explicit source files unchanged at review time.
  - **Done:** `default.vue`: the auth-notice region is `position: static` at ≥1024px so it no longer overlaps `.subview-chrome`.
- [x] **NS-178 · P2 · PERF · A · S — Add !isDesk && to both v-ifs.**
  - **Target:** [app/layouts/default.vue:219](/Users/powerox/neospace/app/layouts/default.vue:219). **Area:** Layout (`app/layouts/default.vue`).
  - **Change:** Add `!isDesk &&` to both v-ifs.
  - **Prior observation to check:** `app/layouts/default.vue:219-222,240`: the comment says only the active breakpoint's nav is rendered, but `MobileHeader` and `MobileTabBar` have no `!isDesk` guard. They mount on desktop and are only hidden with CSS. The tab bar's `useAutoHideNav` adds a capture-phase scroll listener (with a `matchMedia` call on every scroll event), a second `AccountSwitcher` instance and badge computeds.
  - **Provenance:** [October 9 candidate, line 693](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:693); explicit source files unchanged at review time.
  - **Done:** `default.vue`: `MobileHeader` and `MobileTabBar` are now `v-if="!isDesk && …"`, so they are not mounted on desktop.
- [x] **NS-179 · P2 · UX · A · M — Decide whether tab destinations keep the tab bar (as Profile already does at line 85).**
  - **Target:** [app/layouts/default.vue:85](/Users/powerox/neospace/app/layouts/default.vue:85). **Area:** Layout (`app/layouts/default.vue`).
  - **Change:** Decide whether tab destinations keep the tab bar (as Profile already does at line 85).
  - **Prior observation to check:** `app/layouts/default.vue:85` + `MobileTabBar.vue:88-151`: the Messages and Activity tabs route to `/messages` and `/notifications`. Both are `isMobileSubview`, so `showMobileNav` turns false and tapping a tab removes the tab bar. Users can't go Messages → Activity directly and must press Back first.
  - **Provenance:** [October 9 candidate, line 694](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:694); explicit source files unchanged at review time.
  - **Done:** Decision: **tab destinations (Home, Explore, Notifications, Messages, Profile tab…) keep the tab bar**; only true sub-views (a thread, a group page) hide it. `layouts/default.vue` `isTabRoute` drives the nav and padding; the dock follows the same rule.

- [x] **NS-180 · P2 · UX · A · M — Show an "Offline: showing cached posts" notice in the always-mounted status region.**
  - **Target:** [app/layouts/default.vue:227](/Users/powerox/neospace/app/layouts/default.vue:227). **Area:** Layout (`app/layouts/default.vue`).
  - **Change:** Show an "Offline: showing cached posts" notice in the always-mounted status region.
  - **Prior observation to check:** `app/layouts/default.vue:227-234`: the shell has no offline indicator. No `online`/`offline` listener exists anywhere in `app/`, so losing the network only shows up as scattered per-request failure toasts.
  - **Provenance:** [October 9 candidate, line 695](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:695); explicit source files unchanged at review time.
  - **Done:** `default.vue`: online/offline listeners drive an “Offline — showing cached posts” notice in the always-mounted status region.
- [x] **NS-181 · P2 · UX · A · M — Hold the reload until nothing is open (no compose sheet or dialog) or the tab is hidden, or show an…**
  - **Target:** [app/plugins/pwa-rescue.client.ts:23](/Users/powerox/neospace/app/plugins/pwa-rescue.client.ts:23). **Area:** App root, error page & plugins.
  - **Change:** Hold the reload until nothing is open (no compose sheet or dialog) or the tab is hidden, or show an "Update ready" toast with a Reload button.
  - **Prior observation to check:** `app/plugins/pwa-rescue.client.ts:23-38` + `nuxt.config.ts:43`: every refocus (throttled to 60s) calls `reg.update()`. With `registerType:'autoUpdate'`, a new service worker activates and the page reloads straight away, so a half-written compose sheet, column scroll positions and open threads disappear mid-use.
  - **Provenance:** [October 9 candidate, line 700](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:700); explicit source files unchanged at review time.
  - **Done:** Service worker is now `registerType: 'prompt'` with `skipWaiting: false`. `app/plugins/pwa-update.client.ts` applies a waiting update only when the tab is hidden and nothing modal is open (`canApplyUpdateNow`, `utils/pwaUpdate.ts`); otherwise it shows an "Update ready" toast with a Reload button. Tests: `tests/p2-final-batch.test.ts`. README/ARCHITECTURE wording updated.

- [x] **NS-182 · P2 · UX · A · M — Add small "Error 500 · &lt;message&gt;" text and a "Copy details / Send report" action that includes…**
  - **Target:** [app/error.vue:35](/Users/powerox/neospace/app/error.vue:35). **Area:** App root, error page & plugins.
  - **Change:** Add small "Error 500 · <message>" text and a "Copy details / Send report" action that includes `formatLogRingForFeedback()`.
  - **Prior observation to check:** `app/error.vue:35-45`: the crash page shows no status or message and has no way to report the problem. Yet `plugins/error-report.client.ts:3` keeps a log ring "for feedback" (`utils/feedback.ts:73`).
  - **Provenance:** [October 9 candidate, line 701](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:701); explicit source files unchanged at review time.
  - **Done:** `error.vue` shows the status code and message plus a “Copy details” action that copies the message and `formatLogRingForFeedback()` output.
- [x] **NS-183 · P2 · UX · A · M — A small listbox or menu of themes, including Auto.**
  - **Target:** [app/utils/appearance.ts:282](/Users/powerox/neospace/app/utils/appearance.ts:282). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** A small listbox or menu of themes, including Auto.
  - **Prior observation to check:** `DesktopSidebar.vue:519-527` + `MobileDrawer.vue:326-335` + `app/utils/appearance.ts:282-286`: old item 182 ("listbox popover that includes Auto") is marked fixed, but both shells still call one-way `cycleTheme()`. `nextTheme` never returns `'auto'`, so after one click you can't get back to Auto from the shell, and there's no way to step backwards through the themes.
  - **Provenance:** [October 9 candidate, line 709](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:709); explicit source files unchanged at review time.
  - **Done:** New `shell/ThemeMenu.vue` (NeoMenu, menuitemradio: Auto + each theme) used by the desktop sidebar and mobile drawer instead of cycling; `useShellAppearance.setTheme` sets a specific theme.

- [x] **NS-184 · P2 · UX · A · S — Limit inboxActive to messages plus isMentions.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:126](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:126). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Limit `inboxActive` to messages plus `isMentions`.
  - **Prior observation to check:** `DesktopSidebar.vue:126-132,224-227`: on /notifications, both the Activity heart and Inbox show the active state and `aria-current="page"`, because `inboxActive` includes `/notifications` and the notifications column. That makes two "current page" items.
  - **Provenance:** [October 9 candidate, line 710](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:710); explicit source files unchanged at review time.
  - **Done:** `DesktopSidebar` `inboxActive` is limited to `/messages`, mentions or the messages board column, so Activity alone owns plain `/notifications`.
- [x] **NS-185 · P2 · UX · A · S — Badge the DM count (plus a mentions count if one is available), never the total notification count.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:133](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:133). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Badge the DM count (plus a mentions count if one is available), never the total notification count.
  - **Prior observation to check:** `DesktopSidebar.vue:133,305,313`: the Inbox badge falls back to the notification count (`messagesBadge || notifBadge`) and is announced as "Inbox, N unread". It duplicates the Activity badge, although Inbox only holds DMs and Mentions. When DMs are unread, the mentions count is hidden.
  - **Provenance:** [October 9 candidate, line 711](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:711); explicit source files unchanged at review time.
  - **Done:** The inbox badge now shows the DM count only, never the total notification count.
- [x] **NS-186 · P2 · UX · A · S — Keep icon versions ("+", "⋯ more") in rail, or a single overflow menu.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:664](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:664). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Keep icon versions ("+", "⋯ more") in rail, or a single overflow menu.
  - **Prior observation to check:** `DesktopSidebar.vue:664-668`: rail mode hides `.sidebar__section-action` and `.sidebar__more`. Algorithms after the first 5, groups after the first 5, "New algorithm" and "All groups" can't be reached in rail mode.
  - **Provenance:** [October 9 candidate, line 712](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:712); explicit source files unchanged at review time.
  - **Done:** `DesktopSidebar` rail: section actions stay visible as compact controls and “Show more/less” collapses to a “⋯”/“−” glyph (full label kept `sr-only`) instead of `display: none`.
- [x] **NS-187 · P2 · UX · A · S — Mirror the route and boardColumnIs checks.**
  - **Target:** [app/components/shell/MobileDrawer.vue:175](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:175). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Mirror the route and `boardColumnIs` checks.
  - **Prior observation to check:** `MobileDrawer.vue:175-211`: only Home and Groups get an active style (`.router-link-active`). Search, Messages and Activity are buttons with no active styling or `aria-current` on /explore, /messages and /notifications, whereas the desktop sidebar marks them (`DesktopSidebar.vue:286-289`).
  - **Provenance:** [October 9 candidate, line 729](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:729); explicit source files unchanged at review time.
  - **Done:** `MobileDrawer` Search / Inbox / Activity links now get `router-link-active` and `aria-current` from the route plus `boardColumnIs` checks, matching the tab bar.
- [x] **NS-188 · P2 · A11Y · A · S — min-height:44px (or at least 24px plus spacing) and padding.**
  - **Target:** [app/components/shell/MobileDrawer.vue:235](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:235). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** `min-height:44px` (or at least 24px plus spacing) and padding.
  - **Prior observation to check:** `MobileDrawer.vue:235-241,270-272,572-583`: "New" and "See all" are bare 0.75rem text with no padding or min-height, giving a touch target about 16px tall.
  - **Provenance:** [October 9 candidate, line 730](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:730); explicit source files unchanged at review time.
  - **Done:** `MobileDrawer` section actions (“New”, “See all”) are ≥44×44 touch targets and the icon buttons grew from 36px to 44px.
- [x] **NS-189 · P2 · UX · A · S — padding-left: max(0.35rem, env(safe-area-inset-left)) and the same on the right.**
  - **Target:** [app/components/shell/MobileHeader.vue:72](/Users/powerox/neospace/app/components/shell/MobileHeader.vue:72). **Area:** MobileHeader (`app/components/shell/MobileHeader.vue`).
  - **Change:** `padding-left: max(0.35rem, env(safe-area-inset-left))` and the same on the right.
  - **Prior observation to check:** `MobileHeader.vue:72`: padding includes no `env(safe-area-inset-left/right)`. On a landscape iPhone the hamburger sits under the notch or rounded corner (the tab bar handles this at `MobileTabBar.vue:220-221`).
  - **Provenance:** [October 9 candidate, line 745](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:745); explicit source files unchanged at review time.
  - **Done:** `MobileHeader` padding uses `max(0.35rem, env(safe-area-inset-left/right))`.
- [x] **NS-190 · P2 · PERF · A · S — Use a solid var(--neo-bg-primary) like the header.**
  - **Target:** [app/components/shell/MobileTabBar.vue:213](/Users/powerox/neospace/app/components/shell/MobileTabBar.vue:213). **Area:** MobileTabBar (`app/components/shell/MobileTabBar.vue`).
  - **Change:** Use a solid `var(--neo-bg-primary)` like the header.
  - **Prior observation to check:** `MobileTabBar.vue:213-215` + `useAutoHideNav.ts:82-88`: the bar is translucent with `backdrop-filter: blur(14px)` and is transform-animated by auto-hide. The shell already documents that blurred chrome flashes black on iOS while translating (`MobileHeader.vue:73`, `SubviewChrome.vue:72`).
  - **Provenance:** [October 9 candidate, line 749](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:749); explicit source files unchanged at review time.
  - **Done:** `MobileTabBar` uses a solid `var(--neo-bg-primary)` fill (no translucent `backdrop-filter`), like the header.
- [x] **NS-191 · P2 · A11Y · A · S — Pass a focusLast intent into onOpen instead of racing it.**
  - **Target:** [app/components/NeoMenu.vue:128](/Users/powerox/neospace/app/components/NeoMenu.vue:128). **Area:** NeoMenu (`app/components/NeoMenu.vue`).
  - **Change:** Pass a `focusLast` intent into `onOpen` instead of racing it.
  - **Prior observation to check:** `NeoMenu.vue:128-135` vs `98-109`: pressing ArrowUp on the trigger schedules `nextTick(() => last.focus())`. The `flush:'post'` watcher's `onOpen` then awaits its own `nextTick` (queued later) and focuses `filter || list[0]`, so focus ends on the first item; the APG pattern wants the last.
  - **Provenance:** [October 9 candidate, line 755](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:755); explicit source files unchanged at review time.
  - **Done:** `NeoMenu` keeps a `pendingFocus` intent (`'last'` for ArrowUp on the trigger) that `onOpen` consumes, replacing the `nextTick` race.
- [x] **NS-192 · P2 · PERF · A · M — Render items with v-if="open" inside an always-present panel element (keeps aria-controls valid).**
  - **Target:** [app/components/NeoMenu.vue:334](/Users/powerox/neospace/app/components/NeoMenu.vue:334). **Area:** NeoMenu (`app/components/NeoMenu.vue`).
  - **Change:** Render items with `v-if="open"` inside an always-present panel element (keeps `aria-controls` valid).
  - **Prior observation to check:** `NeoMenu.vue:334-349`: the non-sheet panel uses `v-show`, so every menu's `#items` slot is fully rendered while closed. That includes the ⋯ menu on every post card, so a feed holds thousands of hidden buttons.
  - **Provenance:** [October 9 candidate, line 756](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:756); explicit source files unchanged at review time.
  - **Done:** `NeoMenu` keeps the panel element mounted (so `aria-controls` stays valid) and renders the items slot with `v-if="open"`.
- [x] **NS-193 · P2 · DESIGN · A · S — Cap max-width (e.g**
  - **Target:** [app/components/NeoSheet.vue:84](/Users/powerox/neospace/app/components/NeoSheet.vue:84). **Area:** NeoSheet / NeoSheetHeader.
  - **Change:** Cap `max-width` (e.g. 640px, centred) at ≥768px even on touch.
  - **Prior observation to check:** `NeoSheet.vue:84-88,135-147`: the centred-card layout requires `(hover:hover) and (pointer:fine)`. Touch iPads at ≥1024px (a landscape iPad Pro is 1366px wide) get a bottom sheet stretched across the full width.
  - **Provenance:** [October 9 candidate, line 770](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:770); explicit source files unchanged at review time.
  - **Done:** `NeoSheet` caps `max-width` (640px, centred) at ≥768px, including touch devices.
- [x] **NS-194 · P2 · UX · A · S — Add kind: 'info'|'success'|'error', cap the queue at 3, and merge identical messages.**
  - **Target:** [app/stores/toast.ts:7](/Users/powerox/neospace/app/stores/toast.ts:7). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** Add `kind: 'info'|'success'|'error'`, cap the queue at 3, and merge identical messages.
  - **Prior observation to check:** `app/stores/toast.ts:7-12,32-43`: toasts have no severity. Errors and confirmations look identical (no icon or colour) and are both announced politely. There's no cap or dedupe, so repeated failures (offline, rate limits) pile up across the screen.
  - **Provenance:** [October 9 candidate, line 782](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:782); explicit source files unchanged at review time.
  - **Done:** `toast.ts` gained `kind` (`inferToastKind` from copy when omitted), a cap of `MAX_TOASTS = 3` and merging of identical messages; `NeoToastHost` styles kinds and announces errors assertively. Tests: `tests/p2-shell-batch.test.ts`.
- [x] **NS-195 · P2 · UX · A · S — Add var(--neo-keyboard-inset, 0px) and a reply-dock offset.**
  - **Target:** [app/components/NeoToastHost.vue:93](/Users/powerox/neospace/app/components/NeoToastHost.vue:93). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** Add `var(--neo-keyboard-inset, 0px)` and a reply-dock offset.
  - **Prior observation to check:** `NeoToastHost.vue:93-103`: the mobile bottom offset ignores `--neo-keyboard-inset` and the thread reply dock. A toast such as "Reply failed" renders under the iOS keyboard, or on top of the Send bar on /status (where `--neo-bottom-chrome-h` is 0).
  - **Provenance:** [October 9 candidate, line 783](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:783); explicit source files unchanged at review time.
  - **Done:** `NeoToastHost` offsets by `var(--neo-keyboard-inset, 0px)` and the reply dock when a thread route is active (`neo-route-thread`).
- [x] **NS-196 · P2 · A11Y · A · S — Remember document.activeElement from before focus entered the toast and restore it on dismiss.**
  - **Target:** [app/components/NeoToastHost.vue:31](/Users/powerox/neospace/app/components/NeoToastHost.vue:31). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** Remember `document.activeElement` from before focus entered the toast and restore it on dismiss.
  - **Prior observation to check:** `NeoToastHost.vue:31-42`: activating Undo or Dismiss removes the focused button, so focus drops to `<body>` and keyboard users lose their place.
  - **Provenance:** [October 9 candidate, line 784](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:784); explicit source files unchanged at review time.
  - **Done:** `NeoToastHost` remembers the element focused before focus entered a toast and restores it on dismiss.
- [x] **NS-197 · P2 · UX · A · S — html { scrollbar-gutter: stable } at ≥1024px.**
  - **Target:** [app/composables/useScrollLock.ts:8](/Users/powerox/neospace/app/composables/useScrollLock.ts:8). **Area:** Focus trap, scroll lock, keyboard & viewport composables.
  - **Change:** `html { scrollbar-gutter: stable }` at ≥1024px.
  - **Prior observation to check:** `app/composables/useScrollLock.ts:8-11` + `app/assets/css/main.scss:818-827`: the lock puts `overflow:hidden` on html/body with no scrollbar compensation. On desktops with classic scrollbars (Windows/Linux), the board and page shift sideways whenever a dialog or sheet opens or closes.
  - **Provenance:** [October 9 candidate, line 794](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:794); explicit source files unchanged at review time.
  - **Done:** `main.scss`: `html { scrollbar-gutter: stable }` at ≥1024px.
- [x] **NS-198 · P2 · UX · A · M — Move the suite menu into the drawer at ≤1023px.**
  - **Target:** [app/layouts/default.vue:394](/Users/powerox/neospace/app/layouts/default.vue:394). **Area:** SuiteMenu.
  - **Change:** Move the suite menu into the drawer at ≤1023px.
  - **Prior observation to check:** `app/layouts/default.vue:394-404` + `SuiteMenu.vue:187-194`: on phones, the 44px waffle floats permanently over the right edge of the content above the tab bar on every page except threads. It covers right-aligned controls (post ⋯ menus, counts) as you scroll.
  - **Provenance:** [October 9 candidate, line 810](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:810); explicit source files unchanged at review time.
  - **Done:** At ≤1023px the suite menu lives in the drawer as a "Tools" section (with the suggest-a-tool entry); `useSuiteGroups.ts` is the single source for both the desktop `SuiteMenu` and the drawer, and the desktop waffle only renders on desktop.

- [x] **NS-199 · P3 · A11Y · A · S — min-height:44px at ≤1023px (or padding plus a larger hit area).**
  - **Target:** [app/layouts/default.vue:301](/Users/powerox/neospace/app/layouts/default.vue:301). **Area:** Layout (`app/layouts/default.vue`).
  - **Change:** `min-height:44px` at ≤1023px (or padding plus a larger hit area).
  - **Prior observation to check:** `app/layouts/default.vue:301-313`: the auth-notice "Dismiss" button is `min-height:24px` at 0.75rem, well under a 44px touch target on phones.
  - **Provenance:** [October 9 candidate, line 696](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:696); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-200 · P3 · UX · A · S — Use min-height: auto on desktop (the layout already has min-height:100dvh).**
  - **Target:** [app/layouts/default.vue:424](/Users/powerox/neospace/app/layouts/default.vue:424). **Area:** Layout (`app/layouts/default.vue`).
  - **Change:** Use `min-height: auto` on desktop (the layout already has `min-height:100dvh`).
  - **Prior observation to check:** `app/layouts/default.vue:424-427,472-480`: on desktop, `main` keeps `min-height:100dvh` while the auth notice takes its own flex line above it. The page always scrolls by the notice's height, even when the content is short.
  - **Provenance:** [October 9 candidate, line 697](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:697); explicit source files unchanged at review time.
  - **Done:** `.main-content` uses `min-height: auto` from 1024px up; mobile keeps flex fill behavior.

- [x] **NS-201 · P3 · A11Y · A · S — Put role="alert" on the title and description only (or focus the &lt;main&gt;).**
  - **Target:** [app/error.vue:36](/Users/powerox/neospace/app/error.vue:36). **Area:** App root, error page & plugins.
  - **Change:** Put `role="alert"` on the title and description only (or focus the `<main>`).
  - **Prior observation to check:** `app/error.vue:36`: `role="alert"` sits on the whole card, buttons included, so screen readers read the eyebrow, title, description and both button labels as one assertive burst.
  - **Provenance:** [October 9 candidate, line 702](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:702); explicit source files unchanged at review time.
  - **Done:** `error.vue`: `role="alert"` moved from the whole card to the description paragraph, so the buttons aren't read in the assertive burst.

- [x] **NS-202 · P3 · UX · A · S — Add a "Go back" button when router.options.history.state.back exists.**
  - **Target:** [app/error.vue:29](/Users/powerox/neospace/app/error.vue:29). **Area:** App root, error page & plugins.
  - **Change:** Add a "Go back" button when `router.options.history.state.back` exists.
  - **Prior observation to check:** `app/error.vue:29-31`: the 404 card offers only "Back home". Someone who followed a stale in-app link loses their place.
  - **Provenance:** [October 9 candidate, line 703](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:703); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-203 · P3 · DESIGN · A · S — var(--neo-radius-lg).**
  - **Target:** [app/error.vue:67](/Users/powerox/neospace/app/error.vue:67). **Area:** App root, error page & plugins.
  - **Change:** `var(--neo-radius-lg)`.
  - **Prior observation to check:** `app/error.vue:67`: `border-radius:16px` is hard-coded, so the user's Corners setting doesn't reach the error card.
  - **Provenance:** [October 9 candidate, line 704](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:704); explicit source files unchanged at review time.
  - **Done:** `error.vue` card radius is now `var(--neo-radius-lg, 16px)`, so the Corners setting reaches it.

- [x] **NS-204 · P3 · DESIGN · A · S — Choose one spelling for spoken and visible names.**
  - **Target:** [app/error.vue:15](/Users/powerox/neospace/app/error.vue:15). **Area:** App root, error page & plugins.
  - **Change:** Choose one spelling for spoken and visible names.
  - **Prior observation to check:** `app/error.vue:15,28` vs `app/components/NeoMark.vue:17,50` / `shell/MobileHeader.vue:38` / `DesktopSidebar.vue:213`: the brand is "NeoSpace" in titles, the error page and the install banner, but "neospace" in the wordmark and in aria-labels ("neospace home").
  - **Provenance:** [October 9 candidate, line 705](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:705); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-205 · P3 · UX · A · S — Also cancel on pointerdown.**
  - **Target:** [app/app.vue:44](/Users/powerox/neospace/app/app.vue:44). **Area:** App root, error page & plugins.
  - **Change:** Also cancel on `pointerdown`.
  - **Prior observation to check:** `app/app.vue:44-50`: scroll restore stops only on wheel, touchstart or keydown. Dragging the scrollbar, or a trackpad/mouse pointer on iPads (768–1023px, where `main` scrolls), fights the saved offset for up to 60 frames.
  - **Provenance:** [October 9 candidate, line 706](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:706); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-206 · P3 · A11Y · A · S — Use stable names ("Board density"), keep the value in the text, and announce changes.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:485](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:485). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Use stable names ("Board density"), keep the value in the text, and announce changes.
  - **Prior observation to check:** `DesktopSidebar.vue:485,522,532,542,552,562`: aria-labels still end in "Click to cycle." (old item 165), which assumes a mouse and is repeated on every row. Board density changes (`toggleDeskDensity`, line 487) are also never sent to the `lookAnnounce` live region (line 516).
  - **Provenance:** [October 9 candidate, line 713](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:713); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-207 · P3 · A11Y · A · S — Use a stable label ("Compact sidebar") with aria-pressed, or aria-expanded.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:241](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:241). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Use a stable label ("Compact sidebar") with `aria-pressed`, or `aria-expanded`.
  - **Prior observation to check:** `DesktopSidebar.vue:241-243`: the rail toggle changes its aria-label ("Expand/Collapse sidebar") and also sets `aria-pressed`, so it reads as "Collapse sidebar, toggle button, pressed", which contradicts itself.
  - **Provenance:** [October 9 candidate, line 714](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:714); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-208 · P3 · A11Y · A · S — Render an icon-only Home link in rail.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:255](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:255). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Render an icon-only Home link in rail.
  - **Prior observation to check:** `DesktopSidebar.vue:255`: in rail mode the Home link is removed (`v-if="!sidebarRail"`). The "Main menu" nav landmark then has no Home item; only the logo (outside the nav, with no aria-current) goes home.
  - **Provenance:** [October 9 candidate, line 715](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:715); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-209 · P3 · A11Y · A · S — aria-label "New algorithm" and "All groups".**
  - **Target:** [app/components/shell/DesktopSidebar.vue:372](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:372). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** aria-label "New algorithm" and "All groups".
  - **Prior observation to check:** `DesktopSidebar.vue:372-375,415` + `MobileDrawer.vue:235-241`: the "New" and "All" controls have accessible names "New" and "All". `title` isn't used as the name, so they're ambiguous out of context.
  - **Provenance:** [October 9 candidate, line 716](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:716); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-210 · P3 · A11Y · A · S — Use aria-labelledby pointing at the h2 ids, or drop the labels.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:365](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:365). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Use `aria-labelledby` pointing at the h2 ids, or drop the labels.
  - **Prior observation to check:** `DesktopSidebar.vue:365,411,472,499`: four `<section aria-label>` elements create region landmarks (Algorithms, Groups, Board, Look) next to the nav, which is landmark noise.
  - **Provenance:** [October 9 candidate, line 717](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:717); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-211 · P3 · DESIGN · A · S — Drop title where .neo-tip or the foot-btn tooltip applies.**
  - **Target:** [app/assets/css/main.scss:350](/Users/powerox/neospace/app/assets/css/main.scss:350). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Drop `title` where `.neo-tip` or the foot-btn tooltip applies.
  - **Prior observation to check:** `DesktopSidebar.vue:576-611` + `app/assets/css/main.scss:350-353`: the foot buttons have both `title` and `aria-label`, and main.scss draws a CSS tooltip from the aria-label. Hovering shows two tooltips (the CSS tip, then the native one after a delay). ChromeButton has the same problem (`ChromeButton.vue:26,36`, e.g. SubviewChrome's "Back").
  - **Provenance:** [October 9 candidate, line 718](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:718); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-212 · P3 · DESIGN · A · S — Set title only in rail mode or when the label is truncated.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:384](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:384). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Set `title` only in rail mode or when the label is truncated.
  - **Prior observation to check:** `DesktopSidebar.vue:384,424,447`: every row has a `title` that repeats its visible label, so expanded mode shows a native tooltip on every hover.
  - **Provenance:** [October 9 candidate, line 719](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:719); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [ ] **NS-213 · P3 · DESIGN · A · S — Give each its own glyph.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:101](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:101). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Give each its own glyph.
  - **Prior observation to check:** `DesktopSidebar.vue:101,230,97,600,331,590`: icons mean different things in the same sidebar. The heart is both Activity and the "Liked" feed, `servers` is both Federated and "Accounts & servers", and `message` is both "Leave a note" and "Direct messages".
  - **Provenance:** [October 9 candidate, line 720](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:720); explicit source files unchanged at review time.

- [x] **NS-214 · P3 · UX · A · S — Rename Look's control to "Spacing" and use "Show/Hide".**
  - **Target:** [app/components/shell/DesktopSidebar.vue:472](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:472). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Rename Look's control to "Spacing" and use "Show/Hide".
  - **Prior observation to check:** `DesktopSidebar.vue:472-495` vs `513-515,548-557`: "Board density" (Packed/Roomy/Focused) sits right above Look's "Density" (text spacing), so two different "density" controls are next to each other. The Look toggle also pairs "Try" with "Hide" (line 510).
  - **Provenance:** [October 9 candidate, line 721](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:721); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-215 · P3 · CODE · A · S — Use path and inboxActive throughout.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:286](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:286). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Use `path` and `inboxActive` throughout.
  - **Prior observation to check:** `DesktopSidebar.vue:286-295,319,350-359`: these use raw `route.path`, although the normalized `path` (line 31) exists, so trailing-slash URLs lose the active state. The Inbox icon's `filled` (line 319) checks only `route.path==='/messages'`, while its stroke uses `inboxActive`, so the fill and stroke disagree when the messages board column is active.
  - **Provenance:** [October 9 candidate, line 722](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:722); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-216 · P3 · CODE · A · S — Delete them, and move the rail ring to .neo-mark__glyph.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:652](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:652). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Delete them, and move the rail ring to `.neo-mark__glyph`.
  - **Prior observation to check:** `DesktopSidebar.vue:652,684,765-791,930-971,1252-1262,1359-1365`: dead CSS. `.sidebar__brand`; `.sidebar__mark` (NeoMark renders `.neo-mark__glyph`, so the rail "logo on" ring at line 684 never applies); `__rail-btn`; `__micro*` (the old Inbox popover); `__theme-swatch` (now `<ThemeSwatch>`); `.nav-badge--inline`.
  - **Provenance:** [October 9 candidate, line 723](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:723); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-217 · P3 · CODE · A · S — One label source shared by both shells.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:96](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:96). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** One label source shared by both shells.
  - **Prior observation to check:** `DesktopSidebar.vue:96,384,390-393` vs `MobileDrawer.vue:76`: the label is `` `Local` ``, then the template special-cases `item.key==='local'` to print "Local" again (a dead branch). The drawer labels the same feed "Local (host)".
  - **Provenance:** [October 9 candidate, line 724](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:724); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-218 · P3 · CODE · A · S — Move it into useComposeSheetStore/useBoardNav.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:174](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:174). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Move it into `useComposeSheetStore`/`useBoardNav`.
  - **Prior observation to check:** `DesktopSidebar.vue:174-189` and `MobileTabBar.vue:57-72`: `openCompose` (login redirect plus group-tag inference) is copied verbatim in both.
  - **Provenance:** [October 9 candidate, line 725](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:725); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-219 · P3 · CODE · A · S — Hydrate once at store init or in the layout.**
  - **Target:** [app/components/shell/DesktopSidebar.vue:24](/Users/powerox/neospace/app/components/shell/DesktopSidebar.vue:24). **Area:** DesktopSidebar (`app/components/shell/DesktopSidebar.vue`).
  - **Change:** Hydrate once at store init or in the layout.
  - **Prior observation to check:** `DesktopSidebar.vue:24` + `MobileDrawer.vue:23`: `algorithmsStore.hydrate()` runs as a side effect in two components' setup.
  - **Provenance:** [October 9 candidate, line 726](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:726); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-220 · P3 · DESIGN · A · S — Use &lt;NeoMark&gt;, aria-label "NeoSpace home", and no exact-active state on the logo.**
  - **Target:** [app/components/shell/MobileDrawer.vue:164](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:164). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Use `<NeoMark>`, aria-label "NeoSpace home", and no exact-active state on the logo.
  - **Prior observation to check:** `MobileDrawer.vue:164-166,439-451`: the drawer still hand-builds the "ns" mark and wordmark instead of using `<NeoMark>` (old item 190). The link's name reads "ns neospace". Both the logo and the Home `NuxtLink to="/"` get `aria-current="page"` (old item 169 was fixed only on desktop).
  - **Provenance:** [October 9 candidate, line 731](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:731); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-221 · P3 · UX · A · S — Call goHome().**
  - **Target:** [app/components/shell/MobileDrawer.vue:175](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:175). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Call `goHome()`.
  - **Prior observation to check:** `MobileDrawer.vue:175`: the drawer's Home is a plain NuxtLink. Unlike the tab bar and the header logo (`goHome`), when you're already on '/' it doesn't clear column focus or jump to the Home column.
  - **Provenance:** [October 9 candidate, line 732](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:732); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-222 · P3 · A11Y · A · S — 44×44.**
  - **Target:** [app/components/shell/MobileDrawer.vue:168](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:168). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** 44×44.
  - **Prior observation to check:** `MobileDrawer.vue:168,453-455`: the close button is 36×36, below the 44px target on a touch-only surface.
  - **Provenance:** [October 9 candidate, line 733](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:733); explicit source files unchanged at review time.
  - **Done:** `MobileDrawer.vue` close button is now 44×44.

- [x] **NS-223 · P3 · UX · A · S — Keep one.**
  - **Target:** [app/components/shell/MobileDrawer.vue:218](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:218). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Keep one.
  - **Prior observation to check:** `MobileDrawer.vue:218-228,367-372`: guests see two "Sign in" calls to action in the same drawer (the guest card and the footer).
  - **Provenance:** [October 9 candidate, line 734](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:734); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-224 · P3 · UX · A · S — Stay on the current page (or change the copy).**
  - **Target:** [app/components/shell/MobileDrawer.vue:121](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:121). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Stay on the current page (or change the copy).
  - **Prior observation to check:** `MobileDrawer.vue:121,130`: the sign-out confirm says "You can keep browsing public posts.", then immediately runs `router.push('/login')`.
  - **Provenance:** [October 9 candidate, line 735](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:735); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-225 · P3 · A11Y · A · S — Add an sr-only aria-live="polite" element bound to lookAnnounce.**
  - **Target:** [app/components/shell/MobileDrawer.vue:326](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:326). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Add an sr-only `aria-live="polite"` element bound to `lookAnnounce`.
  - **Prior observation to check:** `MobileDrawer.vue:326-335`: cycling the theme in the drawer isn't announced. The `lookAnnounce` live region exists only in `DesktopSidebar.vue:516`.
  - **Provenance:** [October 9 candidate, line 736](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:736); explicit source files unchanged at review time.
  - **Done:** `MobileDrawer.vue` renders an sr-only `aria-live="polite"` region bound to `lookAnnounce` next to the theme button.

- [x] **NS-226 · P3 · UX · A · S — Add an active state and the same cap/toggle.**
  - **Target:** [app/components/shell/MobileDrawer.vue:243](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:243). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Add an active state and the same cap/toggle.
  - **Prior observation to check:** `MobileDrawer.vue:243-257`: algorithm rows have no active state or `aria-current` (desktop has `sidebar__row--on`). The list is also unbounded (desktop shows 5 plus Show more), so with many recipes the groups end up below the fold.
  - **Provenance:** [October 9 candidate, line 737](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:737); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-227 · P3 · UX · A · S — Same rule on both.**
  - **Target:** [app/components/shell/MobileDrawer.vue:296](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:296). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Same rule on both.
  - **Prior observation to check:** `MobileDrawer.vue:296-321`: Suggested groups always show in the drawer. Desktop shows them only when fewer than 4 groups are joined (`DesktopSidebar.vue:69-71`).
  - **Provenance:** [October 9 candidate, line 738](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:738); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-228 · P3 · DESIGN · A · S — "Posting on host"; truncate the name.**
  - **Target:** [app/components/shell/MobileDrawer.vue:357](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:357). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** "Posting on host"; truncate the name.
  - **Prior observation to check:** `MobileDrawer.vue:357-360,799-804`: "Posting as · host" has a stray middot. The display name has no nowrap or ellipsis, so long names wrap onto several lines in the footer.
  - **Provenance:** [October 9 candidate, line 739](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:739); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [ ] **NS-229 · P3 · UX · A · M — Track horizontal drag on the panel and close past a threshold (respecting reduced motion).**
  - **Target:** [app/components/shell/MobileDrawer.vue:149](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:149). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Track horizontal drag on the panel and close past a threshold (respecting reduced motion).
  - **Prior observation to check:** `MobileDrawer.vue:149-162`: the 280px drawer has no swipe-to-close (or edge-swipe-to-open) gesture; only tapping the overlay or the X closes it.
  - **Provenance:** [October 9 candidate, line 740](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:740); explicit source files unchanged at review time.

- [ ] **NS-230 · P3 · CODE · A · S — Move them to one shared partial and delete the dead rules.**
  - **Target:** [app/components/shell/MobileDrawer.vue:840](/Users/powerox/neospace/app/components/shell/MobileDrawer.vue:840). **Area:** MobileDrawer (`app/components/shell/MobileDrawer.vue`).
  - **Change:** Move them to one shared partial and delete the dead rules.
  - **Prior observation to check:** `MobileDrawer.vue:840-892`, `MobileTabBar.vue:247-300,303-355`, `DesktopSidebar.vue:1340-1366`: `.nav-badge` is copied three times and `.chrome-hint` with its `@keyframes` twice. The drawer's `:deep(.acct-switch.chrome-hint …)` (lines 876-882) targets nothing, since the drawer has no AccountSwitcher. The tab bar's `&--avatar` and `__avatar*` rules are dead.
  - **Provenance:** [October 9 candidate, line 741](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:741); explicit source files unchanged at review time.

- [x] **NS-231 · P3 · DESIGN · A · S — Guard the hover rules (as MobileDrawer.vue:465 already does).**
  - **Target:** [app/components/shell/MobileHeader.vue:110](/Users/powerox/neospace/app/components/shell/MobileHeader.vue:110). **Area:** MobileHeader (`app/components/shell/MobileHeader.vue`).
  - **Change:** Guard the hover rules (as `MobileDrawer.vue:465` already does).
  - **Prior observation to check:** `MobileHeader.vue:110-112`, `NeoSheetHeader.vue:81-83`, `ChromeButton.vue:59-61`, `NeoTabs.vue:154-157`: `:hover` has no `@media (hover:hover)` guard, so on iOS the grey hover fill stays on after a tap.
  - **Provenance:** [October 9 candidate, line 746](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:746); explicit source files unchanged at review time.
  - **Done:** `MobileHeader.vue` button hover fill is wrapped in `@media (hover: hover)`, with an `:active` fill for touch (same for `NeoSheetHeader.vue`). `ChromeButton.vue`/`NeoTabs.vue` left alone (shared hot files).

- [x] **NS-232 · P3 · UX · A · S — Only the Sign-in tab should be active.**
  - **Target:** [app/components/shell/MobileTabBar.vue:108](/Users/powerox/neospace/app/components/shell/MobileTabBar.vue:108). **Area:** MobileTabBar (`app/components/shell/MobileTabBar.vue`).
  - **Change:** Only the Sign-in tab should be active.
  - **Prior observation to check:** `MobileTabBar.vue:108-119,172-183`: guests on /login see two tabs highlighted: "Messages — sign in" (`active: path==='/login'`) and "Sign in".
  - **Provenance:** [October 9 candidate, line 750](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:750); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-233 · P3 · A11Y · A · S — Add an :active background or scale.**
  - **Target:** [app/components/shell/MobileTabBar.vue:227](/Users/powerox/neospace/app/components/shell/MobileTabBar.vue:227). **Area:** MobileTabBar (`app/components/shell/MobileTabBar.vue`).
  - **Change:** Add an `:active` background or scale.
  - **Prior observation to check:** `MobileTabBar.vue:227-245`: tab items give no pressed (`:active`) feedback; only compose scales (lines 265-267). On a touch-only bar, taps feel dead.
  - **Provenance:** [October 9 candidate, line 751](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:751); explicit source files unchanged at review time.
  - **Done:** `MobileTabBar.vue` tab items get an `:active` background.

- [ ] **NS-234 · P3 · UX · A · M — Decide on labels, or on distinct icons.**
  - **Target:** [app/components/shell/MobileTabBar.vue:76](/Users/powerox/neospace/app/components/shell/MobileTabBar.vue:76). **Area:** MobileTabBar (`app/components/shell/MobileTabBar.vue`).
  - **Change:** Decide on labels, or on distinct icons.
  - **Prior observation to check:** `MobileTabBar.vue:76-184`: the tabs are icons only, with no visible labels. The heart means "Activity" here but "Liked" in the drawer and sidebar algorithm lists.
  - **Provenance:** [October 9 candidate, line 752](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:752); explicit source files unchanged at review time.

- [x] **NS-235 · P3 · A11Y · A · S — Make them match (menu).**
  - **Target:** [app/components/NeoMenu.vue:301](/Users/powerox/neospace/app/components/NeoMenu.vue:301). **Area:** NeoMenu (`app/components/NeoMenu.vue`).
  - **Change:** Make them match (`menu`).
  - **Prior observation to check:** `NeoMenu.vue:301,325`: sheet mode declares `aria-haspopup="dialog"`, but the popup is `role="menu"` with no `aria-modal`.
  - **Provenance:** [October 9 candidate, line 757](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:757); explicit source files unchanged at review time.
  - **Done:** `NeoMenu.vue`: trigger always declares `aria-haspopup="menu"` (sheet mode too), matching the `role="menu"` popup.

- [x] **NS-236 · P3 · A11Y · A · S — Handle Escape and Tab first.**
  - **Target:** [app/components/NeoMenu.vue:155](/Users/powerox/neospace/app/components/NeoMenu.vue:155). **Area:** NeoMenu (`app/components/NeoMenu.vue`).
  - **Change:** Handle Escape and Tab first.
  - **Prior observation to check:** `NeoMenu.vue:155-158`: `if (!list.length) return` runs before the Escape branch, so an empty or still-loading menu can't be closed with Escape.
  - **Provenance:** [October 9 candidate, line 758](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:758); explicit source files unchanged at review time.
  - **Done:** `NeoMenu.vue`: Escape and Tab are handled before the empty-list early return.

- [x] **NS-237 · P3 · UX · A · S — Add max-height: calc(100vh - 16px); overflow:auto and a left clamp.**
  - **Target:** [app/components/NeoMenu.vue:65](/Users/powerox/neospace/app/components/NeoMenu.vue:65). **Area:** NeoMenu (`app/components/NeoMenu.vue`).
  - **Change:** Add `max-height: calc(100vh - 16px); overflow:auto` and a left clamp.
  - **Prior observation to check:** `NeoMenu.vue:65-96`: positioning clamps only right-edge overflow and flips upward. There's no max-height or scrolling when the menu fits neither below nor above (long menus on short landscape screens run off-screen), and no left-edge or RTL clamp.
  - **Provenance:** [October 9 candidate, line 759](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:759); explicit source files unchanged at review time.
  - **Done:** `NeoMenu.vue`: portal panel gets `max-height: calc(100vh - 16px)` + `overflow-y:auto` and a left-edge clamp.

- [x] **NS-238 · P3 · DESIGN · A · S — Wrap it in a &lt;Transition&gt; with a translateY slide.**
  - **Target:** [app/components/NeoMenu.vue:308](/Users/powerox/neospace/app/components/NeoMenu.vue:308). **Area:** NeoMenu (`app/components/NeoMenu.vue`).
  - **Change:** Wrap it in a `<Transition>` with a translateY slide.
  - **Prior observation to check:** `NeoMenu.vue:308-333,414,455-462`: the sheet enters with an opacity fade only and has no exit animation (`v-if` removes it instantly). It feels abrupt next to NeoSheet's slide.
  - **Provenance:** [October 9 candidate, line 760](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:760); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-239 · P3 · DESIGN · A · S — var(--neo-radius-lg) and shadow tokens.**
  - **Target:** [app/components/NeoMenu.vue:438](/Users/powerox/neospace/app/components/NeoMenu.vue:438). **Area:** NeoMenu (`app/components/NeoMenu.vue`).
  - **Change:** `var(--neo-radius-lg)` and shadow tokens.
  - **Prior observation to check:** `NeoMenu.vue:438-439`, `NeoSheet.vue:107,120,139`: sheet radii (16px/12px) and the rgba shadow are hard-coded, so the Corners setting doesn't reach sheets.
  - **Provenance:** [October 9 candidate, line 761](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:761); explicit source files unchanged at review time.
  - **Done:** `NeoMenu.vue` sheet top radius uses `var(--neo-radius-lg, 16px)`. `NeoSheet.vue` radii/shadows and shadow tokens not touched.

- [x] **NS-240 · P3 · CODE · A · S — Use Vue's useId().**
  - **Target:** [app/components/NeoMenu.vue:36](/Users/powerox/neospace/app/components/NeoMenu.vue:36). **Area:** NeoMenu (`app/components/NeoMenu.vue`).
  - **Change:** Use Vue's `useId()`.
  - **Prior observation to check:** `NeoMenu.vue:36`, `NeoTabs.vue:34`: ids come from `Math.random()`.
  - **Provenance:** [October 9 candidate, line 762](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:762); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-241 · P3 · CODE · A · M — Build in overflow-x:auto; scrollbar-width:none and keep the active tab scrolled into view.**
  - **Target:** [app/components/NeoTabs.vue:129](/Users/powerox/neospace/app/components/NeoTabs.vue:129). **Area:** NeoTabs (`app/components/NeoTabs.vue`).
  - **Change:** Build in `overflow-x:auto; scrollbar-width:none` and keep the active tab scrolled into view.
  - **Prior observation to check:** `NeoTabs.vue:129-133`: the tab list has no overflow handling (flex with no wrap or scroll), so six consumers each re-implement it with `:deep(.neo-tabs__list)` (explore.vue:1154, profile.vue:1864, notifications.vue:840, FollowersModal.vue:428, AlgorithmSheet.vue:681, index.vue:2759).
  - **Provenance:** [October 9 candidate, line 765](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:765); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-242 · P3 · DESIGN · A · S — Use --neo-text-primary on hover.**
  - **Target:** [app/components/NeoTabs.vue:139](/Users/powerox/neospace/app/components/NeoTabs.vue:139). **Area:** NeoTabs (`app/components/NeoTabs.vue`).
  - **Change:** Use `--neo-text-primary` on hover.
  - **Prior observation to check:** `NeoTabs.vue:139,154-156`: hover switches the colour to `--neo-text-secondary`, which is lighter than the resting `--neo-text-tertiary` (tertiary is mute mixed 12% toward ink, `_themes.scss:48`). Hovering a tab lowers its contrast.
  - **Provenance:** [October 9 candidate, line 766](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:766); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-243 · P3 · A11Y · A · S — Swap arrow handling based on the computed direction.**
  - **Target:** [app/components/NeoTabs.vue:59](/Users/powerox/neospace/app/components/NeoTabs.vue:59). **Area:** NeoTabs (`app/components/NeoTabs.vue`).
  - **Change:** Swap arrow handling based on the computed `direction`.
  - **Prior observation to check:** `NeoTabs.vue:59-65`: ArrowRight always moves to the next tab, so the order is reversed under `dir="rtl"`. NeoMenu's `align` and the Back `chevron-left` (`SubviewChrome.vue:43`) don't account for RTL either.
  - **Provenance:** [October 9 candidate, line 767](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:767); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-244 · P3 · CODE · A · S — Read the token.**
  - **Target:** [app/components/NeoSheet.vue:21](/Users/powerox/neospace/app/components/NeoSheet.vue:21). **Area:** NeoSheet / NeoSheetHeader.
  - **Change:** Read the token.
  - **Prior observation to check:** `NeoSheet.vue:21`: the default `zIndex: 200` is hard-coded instead of using the `--neo-z-sheet` token (`_structural.scss:138`).
  - **Provenance:** [October 9 candidate, line 772](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:772); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-245 · P3 · A11Y · A · S — Drop title; drop the aria-label when the visible label shows.**
  - **Target:** [app/components/NeoSheetHeader.vue:28](/Users/powerox/neospace/app/components/NeoSheetHeader.vue:28). **Area:** NeoSheet / NeoSheetHeader.
  - **Change:** Drop `title`; drop the aria-label when the visible label shows.
  - **Prior observation to check:** `NeoSheetHeader.vue:28-34`: the close button has `aria-label="Cancel"`, `title="Cancel"` and, on desktop, visible "Cancel" text, so the title adds a redundant native tooltip.
  - **Provenance:** [October 9 candidate, line 773](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:773); explicit source files unchanged at review time.
  - **Done:** `NeoSheetHeader.vue`: dropped the redundant `title`. The `aria-label` stays because the visible label is hidden below 1024px.

- [x] **NS-246 · P3 · UX · A · S — Offset it by the dock height or move toasts to bottom centre.**
  - **Target:** [app/layouts/default.vue:406](/Users/powerox/neospace/app/layouts/default.vue:406). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** Offset it by the dock height or move toasts to bottom centre.
  - **Prior observation to check:** `NeoToastHost.vue:83-91` vs `app/layouts/default.vue:406-409`: on desktop the toast stack sits in the same bottom-right corner as the bottom dock (SuiteMenu waffle + install banner) and covers it (z 1100 vs 90).
  - **Provenance:** [October 9 candidate, line 785](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:785); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-247 · P3 · UX · A · S — Add a matching html.neo-nav-hidden .neo-toast-host translate.**
  - **Target:** [app/assets/css/_structural.scss:224](/Users/powerox/neospace/app/assets/css/_structural.scss:224). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** Add a matching `html.neo-nav-hidden .neo-toast-host` translate.
  - **Prior observation to check:** `NeoToastHost.vue:98-101` vs `app/assets/css/_structural.scss:224-229`: the dock and notes FAB slide down with the hidden tab bar, but the toast host doesn't, so toasts float 56px above an empty strip.
  - **Provenance:** [October 9 candidate, line 786](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:786); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-248 · P3 · UX · A · S — Pause all toasts on visibilitychange and resume them on return.**
  - **Target:** [app/stores/toast.ts:55](/Users/powerox/neospace/app/stores/toast.ts:55). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** Pause all toasts on `visibilitychange` and resume them on return.
  - **Prior observation to check:** `app/stores/toast.ts:55-61`: timers keep running while the tab is hidden, so a 10s "Undo" expires unseen while the user is in another app.
  - **Provenance:** [October 9 candidate, line 787](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:787); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-249 · P3 · A11Y · A · S — &lt;NeoIcon name="x"&gt; (aria-hidden).**
  - **Target:** [app/components/NeoToastHost.vue:68](/Users/powerox/neospace/app/components/NeoToastHost.vue:68). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** `<NeoIcon name="x">` (aria-hidden).
  - **Prior observation to check:** `NeoToastHost.vue:68-75`: the dismiss button contains a literal "×" inside the live region, and some screen readers say "times" with every toast. It also doesn't match the icon set.
  - **Provenance:** [October 9 candidate, line 788](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:788); explicit source files unchanged at review time.
  - **Done:** `NeoToastHost.vue` dismiss button uses `<NeoIcon name="x">` (decorative) instead of a literal ×.

- [x] **NS-250 · P3 · UX · A · S — overflow-wrap:anywhere.**
  - **Target:** [app/components/NeoToastHost.vue:120](/Users/powerox/neospace/app/components/NeoToastHost.vue:120). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** `overflow-wrap:anywhere`.
  - **Prior observation to check:** `NeoToastHost.vue:120-123`: `.neo-toast__msg` has `min-width:0` but no `overflow-wrap`, so long handles or URLs overflow the toast.
  - **Provenance:** [October 9 candidate, line 789](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:789); explicit source files unchanged at review time.
  - **Done:** `NeoToastHost.vue` `.neo-toast__msg` gets `overflow-wrap:anywhere`.

- [x] **NS-251 · P3 · CODE · A · S — Clear toasts on active-account change and on logout.**
  - **Target:** [app/stores/toast.ts:70](/Users/powerox/neospace/app/stores/toast.ts:70). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** Clear toasts on active-account change and on logout.
  - **Prior observation to check:** `app/stores/toast.ts:70-76`: `clear()` is never called. Toasts, including Undo closures created under the previous account, survive an account switch or logout.
  - **Provenance:** [October 9 candidate, line 790](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:790); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-252 · P3 · A11Y · A · S — Exempt .neo-toast-host, as teleported menus are exempted.**
  - **Target:** [app/composables/useFocusTrap.ts:94](/Users/powerox/neospace/app/composables/useFocusTrap.ts:94). **Area:** Toasts (`NeoToastHost.vue`, `stores/toast.ts`).
  - **Change:** Exempt `.neo-toast-host`, as teleported menus are exempted.
  - **Prior observation to check:** `app/composables/useFocusTrap.ts:94-107`: the focusin guard pulls focus out of the toast host, so keyboard users can't reach a toast's Undo while any dialog is open (e.g. after "Remove follower" in FollowersModal).
  - **Provenance:** [October 9 candidate, line 791](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:791); explicit source files unchanged at review time.
  - **Done:** `useFocusTrap.ts` focusin guard lets focus into `.neo-toast-host`, so toast Undo is reachable while a dialog is open.

- [x] **NS-253 · P3 · A11Y · A · S — Drop checkOpacity (keep visibility/display).**
  - **Target:** [app/composables/useFocusTrap.ts:25](/Users/powerox/neospace/app/composables/useFocusTrap.ts:25). **Area:** Focus trap, scroll lock, keyboard & viewport composables.
  - **Change:** Drop `checkOpacity` (keep `visibility`/`display`).
  - **Prior observation to check:** `app/composables/useFocusTrap.ts:25-30,74-78`: `isVisible` uses `checkVisibility({checkOpacity:true})`. During an enter transition (`NeoSheet.vue:159-162`, the drawer fade) every control counts as invisible, so Tab focuses the container, and the "first focusable" fallback at line 167 only works because every consumer passes `initialFocus`.
  - **Provenance:** [October 9 candidate, line 795](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:795); explicit source files unchanged at review time.
  - **Done:** `useFocusTrap.ts` `isVisible` no longer passes `checkOpacity`, so controls mid-fade-in are focusable.

- [x] **NS-254 · P3 · CODE · A · S — Return early when the value is unchanged.**
  - **Target:** [app/composables/useKeyboardViewport.ts:30](/Users/powerox/neospace/app/composables/useKeyboardViewport.ts:30). **Area:** Focus trap, scroll lock, keyboard & viewport composables.
  - **Change:** Return early when the value is unchanged.
  - **Prior observation to check:** `app/composables/useKeyboardViewport.ts:30,33-38,261`: `lastOpen` is written but never read. `publishKeyboardOpen` sets the ref and toggles the html attribute on every visualViewport scroll, even when nothing changed.
  - **Provenance:** [October 9 candidate, line 796](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:796); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-255 · P3 · CODE · A · S — Track and clear the timer.**
  - **Target:** [app/composables/useKeyboardViewport.ts:251](/Users/powerox/neospace/app/composables/useKeyboardViewport.ts:251). **Area:** Focus trap, scroll lock, keyboard & viewport composables.
  - **Change:** Track and clear the timer.
  - **Prior observation to check:** `app/composables/useKeyboardViewport.ts:251-256`: the 80ms `onInsetFocusOut` timer isn't cleared in `detachKeyboardInset`, so it re-publishes the inset after the last subscriber unmounts.
  - **Provenance:** [October 9 candidate, line 797](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:797); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-256 · P3 · PERF · A · S — Reuse useMobileViewport() or cached MQLs.**
  - **Target:** [app/composables/useKeyboardViewport.ts:104](/Users/powerox/neospace/app/composables/useKeyboardViewport.ts:104). **Area:** Focus trap, scroll lock, keyboard & viewport composables.
  - **Change:** Reuse `useMobileViewport()` or cached MQLs.
  - **Prior observation to check:** `useKeyboardViewport.ts:104-106`, `utils/keyboardDetect.ts:59-61`, `useAutoHideNav.ts:34-39,163`: a new `MediaQueryList` (one or two `matchMedia` calls) is created on every scroll or visualViewport event.
  - **Provenance:** [October 9 candidate, line 798](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:798); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-257 · P3 · PERF · A · S — Cache the last value and skip identical writes.**
  - **Target:** [app/composables/useAppShellHeight.ts:11](/Users/powerox/neospace/app/composables/useAppShellHeight.ts:11). **Area:** Focus trap, scroll lock, keyboard & viewport composables.
  - **Change:** Cache the last value and skip identical writes.
  - **Prior observation to check:** `app/composables/useAppShellHeight.ts:11-27`: `--neo-app-height` is rewritten on every visualViewport scroll frame, even when unchanged, invalidating style on `<html>` during iOS scrolling.
  - **Provenance:** [October 9 candidate, line 799](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:799); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-258 · P3 · UX · A · S — Show the bar when within about 24px of scrollHeight.**
  - **Target:** [app/composables/useAutoHideNav.ts:174](/Users/powerox/neospace/app/composables/useAutoHideNav.ts:174). **Area:** Focus trap, scroll lock, keyboard & viewport composables.
  - **Change:** Show the bar when within about 24px of `scrollHeight`.
  - **Prior observation to check:** `app/composables/useAutoHideNav.ts:174-185`: the tab bar only comes back on scroll-up or near the top. Reaching the end of a list leaves it hidden (and line 180 ignores the bounce there).
  - **Provenance:** [October 9 candidate, line 800](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:800); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-259 · P3 · PERF · A · S — Have the settings store push the flag directly instead of observing.**
  - **Target:** [app/composables/usePrefersReducedMotion.ts:28](/Users/powerox/neospace/app/composables/usePrefersReducedMotion.ts:28). **Area:** Focus trap, scroll lock, keyboard & viewport composables.
  - **Change:** Have the settings store push the flag directly instead of observing.
  - **Prior observation to check:** `app/composables/usePrefersReducedMotion.ts:28-33`: the MutationObserver on `<html>` `class` fires on every shell class flip (`neo-nav-hidden` on each scroll-direction change, `neo-dialog-open`, `neo-route-board`) just to watch `reduce-motion`.
  - **Provenance:** [October 9 candidate, line 801](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:801); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-260 · P3 · UX · A · S — Rename it "Don't show again", or expire the dismissal after N days, and add an "Install app" entry in…**
  - **Target:** [app/composables/useInstallApp.ts:73](/Users/powerox/neospace/app/composables/useInstallApp.ts:73). **Area:** Install banner / standalone.
  - **Change:** Rename it "Don't show again", or expire the dismissal after N days, and add an "Install app" entry in Settings.
  - **Prior observation to check:** `InstallAppBanner.vue:56-58` + `app/composables/useInstallApp.ts:73-90`: "Not now" dismisses the banner permanently (localStorage, forever), and `clearDismiss()` is never called anywhere, so the install steps can't be brought back.
  - **Provenance:** [October 9 candidate, line 804](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:804); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-261 · P3 · UX · A · S — Also match /Macintosh/ with navigator.maxTouchPoints &gt; 1.**
  - **Target:** [app/composables/useInstallApp.ts:48](/Users/powerox/neospace/app/composables/useInstallApp.ts:48). **Area:** Install banner / standalone.
  - **Change:** Also match `/Macintosh/` with `navigator.maxTouchPoints > 1`.
  - **Prior observation to check:** `app/composables/useInstallApp.ts:48-51`: iPadOS 13+ reports a Mac user agent, so `isIos` is false and iPads get no promo or steps.
  - **Provenance:** [October 9 candidate, line 805](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:805); explicit source files unchanged at review time.
  - **Done:** `useInstallApp.ts` `isIos` also matches a Mac UA with `navigator.maxTouchPoints > 1` (iPadOS).

- [x] **NS-262 · P3 · UX · A · S — Reuse STANDALONE_MQ and the navigator.standalone check.**
  - **Target:** [app/composables/useInstallApp.ts:29](/Users/powerox/neospace/app/composables/useInstallApp.ts:29). **Area:** Install banner / standalone.
  - **Change:** Reuse `STANDALONE_MQ` and the `navigator.standalone` check.
  - **Prior observation to check:** `app/composables/useInstallApp.ts:29,53-55` vs `useStandaloneShell.ts:6-18`: the promo checks only `(display-mode: standalone)`, not minimal-ui, fullscreen or `navigator.standalone`. The manifest's `display_override` includes minimal-ui, so the banner can show inside the installed app.
  - **Provenance:** [October 9 candidate, line 806](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:806); explicit source files unchanged at review time.
  - **Done:** `useInstallApp.ts` reuses `STANDALONE_MQ` / `isStandaloneNow()` (now exported from `useStandaloneShell.ts`), covering minimal-ui, fullscreen and iOS standalone.

- [x] **NS-263 · P3 · DESIGN · A · S — "Add it from Chrome's ⋮ menu — see how."**
  - **Target:** [app/components/InstallAppBanner.vue:29](/Users/powerox/neospace/app/components/InstallAppBanner.vue:29). **Area:** Install banner / standalone.
  - **Change:** "Add it from Chrome's ⋮ menu — see how."
  - **Prior observation to check:** `InstallAppBanner.vue:29`: "Chrome may hide Install in the menu — tap below for steps." On wider screens the button sits beside the text, not below it, and the sentence reads like an error.
  - **Provenance:** [October 9 candidate, line 807](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:807); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-264 · P3 · DESIGN · A · S — max(0.6875rem, 11px) and var(--neo-radius-sm).**
  - **Target:** [app/components/SuiteMenu.vue:197](/Users/powerox/neospace/app/components/SuiteMenu.vue:197). **Area:** SuiteMenu.
  - **Change:** `max(0.6875rem, 11px)` and `var(--neo-radius-sm)`.
  - **Prior observation to check:** `SuiteMenu.vue:197,210,244,296,328-331`: the 2px radii and 0.625rem (10px) tile blurbs are still there (old item 238 asked for an 11px minimum and radius tokens).
  - **Provenance:** [October 9 candidate, line 811](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:811); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-265 · P3 · UX · A · S — Render the current tile as non-interactive (or as close-only).**
  - **Target:** [app/components/SuiteMenu.vue:142](/Users/powerox/neospace/app/components/SuiteMenu.vue:142). **Area:** SuiteMenu.
  - **Change:** Render the current tile as non-interactive (or as close-only).
  - **Prior observation to check:** `SuiteMenu.vue:142-155`: the "current" neospace tile is still a link to https://neospace.ibm.io/, so clicking it reloads the whole app and loses open columns and drafts.
  - **Provenance:** [October 9 candidate, line 812](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:812); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-266 · P3 · UX · A · S — Clearer label and blurb.**
  - **Target:** [app/components/SuiteMenu.vue:24](/Users/powerox/neospace/app/components/SuiteMenu.vue:24). **Area:** SuiteMenu.
  - **Change:** Clearer label and blurb.
  - **Prior observation to check:** `SuiteMenu.vue:24-34`: the extra "play" group shows "edward" with the blurb "stream · balls", which tells a new user nothing about what clicking it does (it takes over the screen).
  - **Provenance:** [October 9 candidate, line 813](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:813); explicit source files unchanged at review time.
  - Evidence: N/A — already reads "lean back · watch posts float by" (`EDWARD_BLURB` in `useSuiteGroups.ts`) — no change needed.

- [x] **NS-267 · P3 · A11Y · A · S — Only primary loaders get role=status; columns use aria-hidden plus aria-busy on the feed.**
  - **Target:** [app/components/FunLoader.vue:490](/Users/powerox/neospace/app/components/FunLoader.vue:490). **Area:** FunLoader / sharedRaf / icons / time.
  - **Change:** Only primary loaders get `role=status`; columns use aria-hidden plus `aria-busy` on the feed.
  - **Prior observation to check:** `FunLoader.vue:490,499-504`: every instance is `role="status"` with "Loading", so a board with five loading columns queues five identical announcements.
  - **Provenance:** [October 9 candidate, line 816](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:816); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-268 · P3 · UX · A · S — Call drawStill() after applySize when motion is reduced.**
  - **Target:** [app/components/FunLoader.vue:382](/Users/powerox/neospace/app/components/FunLoader.vue:382). **Area:** FunLoader / sharedRaf / icons / time.
  - **Change:** Call `drawStill()` after `applySize` when motion is reduced.
  - **Prior observation to check:** `FunLoader.vue:382-389,446-450`: with reduced motion on, the canvas redraws only at mount and when the setting toggles. ResizeObserver resizes (`applySize`) and theme changes don't redraw, leaving a stretched or wrongly coloured still frame.
  - **Provenance:** [October 9 candidate, line 817](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:817); explicit source files unchanged at review time.
  - **Done:** `FunLoader.vue` `applySize` redraws the still frame after a resize when motion is reduced.

- [x] **NS-269 · P3 · CODE · A · S — Wrap each callback in try/catch.**
  - **Target:** [app/utils/sharedRaf.ts:8](/Users/powerox/neospace/app/utils/sharedRaf.ts:8). **Area:** FunLoader / sharedRaf / icons / time.
  - **Change:** Wrap each callback in try/catch.
  - **Prior observation to check:** `app/utils/sharedRaf.ts:8-16`: if one subscriber throws, the loop dies before it re-requests a frame, and every loader freezes.
  - **Provenance:** [October 9 candidate, line 819](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:819); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-270 · P3 · CODE · A · S — Fall back to () =&gt; [] with a dev warning.**
  - **Target:** [app/utils/neoIcons.ts:49](/Users/powerox/neospace/app/utils/neoIcons.ts:49). **Area:** FunLoader / sharedRaf / icons / time.
  - **Change:** Fall back to `() => []` with a dev warning.
  - **Prior observation to check:** `app/utils/neoIcons.ts:49-59` + `NeoIcon.vue:56`: an unknown name (dynamic strings bypass the type) makes `resolveIcon` return undefined, and NeoIcon throws during render, blanking the parent.
  - **Provenance:** [October 9 candidate, line 820](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:820); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-271 · P3 · UX · A · S — Use Math.floor (or compare against the rounded value).**
  - **Target:** [app/utils/relativeTime.ts:60](/Users/powerox/neospace/app/utils/relativeTime.ts:60). **Area:** FunLoader / sharedRaf / icons / time.
  - **Change:** Use `Math.floor` (or compare against the rounded value).
  - **Prior observation to check:** `app/utils/relativeTime.ts:60-63,97`: `Math.round` at unit boundaries gives "60 seconds ago", "24 hours ago", "7 days ago" and the compact forms "60m" and "24h" instead of moving to the next unit.
  - **Provenance:** [October 9 candidate, line 821](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:821); explicit source files unchanged at review time.
  - **Done:** `relativeTime.ts` truncates/floors at unit boundaries; covered by `tests/p3-ux-polish.test.ts`.

- [x] **NS-272 · P3 · UX · A · S — Show a short date for future times, or "in 3d".**
  - **Target:** [app/utils/relativeTime.ts:89](/Users/powerox/neospace/app/utils/relativeTime.ts:89). **Area:** FunLoader / sharedRaf / icons / time.
  - **Change:** Show a short date for future times, or "in 3d".
  - **Prior observation to check:** `app/utils/relativeTime.ts:89-100`: the compact form clamps future dates to zero elapsed, so a scheduled post (or one with clock skew over 60s) shows "now".
  - **Provenance:** [October 9 candidate, line 822](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:822); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-273 · P3 · CODE · A · S — Render a &lt;button disabled&gt; (or aria-disabled + pointer-events:none) when disabled.**
  - **Target:** [app/components/ChromeButton.vue:21](/Users/powerox/neospace/app/components/ChromeButton.vue:21). **Area:** SubviewChrome / ChromeButton / overlay host.
  - **Change:** Render a `<button disabled>` (or `aria-disabled` + `pointer-events:none`) when `disabled`.
  - **Prior observation to check:** `ChromeButton.vue:21-30`: `disabled` is ignored on the `to` (NuxtLink) variant, so a disabled link button stays clickable and looks active.
  - **Provenance:** [October 9 candidate, line 825](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:825); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-274 · P3 · PERF · A · S — Use LazyNeoReport/LazyNeoLightbox behind a sticky v-if, as the layout does for its sheets.**
  - **Target:** [app/components/NeoOverlayHost.vue:8](/Users/powerox/neospace/app/components/NeoOverlayHost.vue:8). **Area:** SubviewChrome / ChromeButton / overlay host.
  - **Change:** Use `LazyNeoReport`/`LazyNeoLightbox` behind a sticky v-if, as the layout does for its sheets.
  - **Prior observation to check:** `NeoOverlayHost.vue:8-11`: `NeoReport` and `NeoLightbox` are imported and mounted eagerly on every boot, although they only render when opened (`NeoLightbox.vue:108`).
  - **Provenance:** [October 9 candidate, line 826](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:826); explicit source files unchanged at review time.

## Remaining candidates: Board & columns
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-275 · P2 · CODE · A · M — Build one &lt;FeedMenuItems&gt; from FEED_CATALOG (with sections and gates) and use it in all four places.**
  - **Target:** [app/pages/index.vue:1366](/Users/powerox/neospace/app/pages/index.vue:1366). **Area:** B. Feed menus & feed switching.
  - **Change:** Build one `<FeedMenuItems>` from `FEED_CATALOG` (with sections and gates) and use it in all four places.
  - **Prior observation to check:** `app/pages/index.vue:1366` — NOT FIXED: `FEED_CATALOG` (`columns.ts:42`) isn't used anywhere outside the store. The feed menu is still hand-copied four times: desk-tabs (`index.vue:1366-1410`), mobile sheet (1494–1603), desktop panel (1963–2124) and the column switcher (`TimelineColumn.vue:1370-1594`). The copies have already drifted on items, icons, titles and gating.
  - **Prior verifier qualification:** Confirmed: `FEED_CATALOG` is used only to build `FEED_LABELS` in the store, and four hand-written menus exist. This is maintainability debt with no specific user-facing breakage shown. [Impact Medium.]
  - **Provenance:** [October 9 candidate, line 228](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:228); explicit source files unchanged at review time.
  - **Done:** `FeedMenuItems.vue` drives labels from `FEED_LABELS` / `FEED_CATALOG`; wired into desk-tab add menu, mobile + desktop add menus (`index.vue`), and column switcher (`TimelineColumn.vue`). Group pickers on add menus stay local. `npm test` pass.

- [x] **NS-276 · P2 · UX · A · S — Use a "Timelines" section for the built-in feeds and keep "Algorithms" for recipes only.**
  - **Target:** [app/pages/index.vue:1370](/Users/powerox/neospace/app/pages/index.vue:1370). **Area:** B. Feed menus & feed switching.
  - **Change:** Use a "Timelines" section for the built-in feeds and keep "Algorithms" for recipes only.
  - **Prior observation to check:** `app/pages/index.vue:1370` — The "Algorithms" section header (also at 1498, 1972 and `TimelineColumn.vue:1393`) groups Local, Federated, Liked and Saved, none of which are algorithms.
  - **Provenance:** [October 9 candidate, line 231](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:231); explicit source files unchanged at review time.
  - **Done:** `pages/index.vue` and `TimelineColumn.vue` label built-in feeds “Timelines” and keep “Algorithms” for recipes (`feed-dropdown__subhead`).
- [x] **NS-277 · P2 · UX · A · S — Use /^[\p{L}\p{N}_]+$/u.**
  - **Target:** [app/pages/index.vue:302](/Users/powerox/neospace/app/pages/index.vue:302). **Area:** B. Feed menus & feed switching.
  - **Change:** Use `/^[\p{L}\p{N}_]+$/u`.
  - **Prior observation to check:** `app/pages/index.vue:302` — Custom tags must match `/^[a-z0-9_]+$/i`, so #café, #日本語 and #ÜberTag can't be added as columns even though Mastodon supports Unicode hashtags.
  - **Provenance:** [October 9 candidate, line 235](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:235); explicit source files unchanged at review time.
  - **Done:** Custom tag input in `app/pages/index.vue` now validates with a Unicode `/^[\p{L}\p{N}_]+$/u` rule, so #café / #日本語 are accepted.

- [x] **NS-278 · P2 · UX · A · S — Keep the button but disable it, labelled "Board full (8/8) — remove a column to add another".**
  - **Target:** [app/pages/index.vue:1355](/Users/powerox/neospace/app/pages/index.vue:1355). **Area:** B. Feed menus & feed switching.
  - **Change:** Keep the button but disable it, labelled "Board full (8/8) — remove a column to add another".
  - **Prior observation to check:** `app/pages/index.vue:1355` — At 8/8 columns every Add button just disappears (`v-if="columnsStore.canAddColumn"` at 1355, 1481 and 1948), with no hint why or that a limit exists.
  - **Provenance:** [October 9 candidate, line 236](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:236); explicit source files unchanged at review time.
  - **Done:** The add-column button stays visible but disabled when full, labelled “Board full (8/8) — remove a column to add another”.
- [x] **NS-279 · P2 · UX · A · S — After the toggle, nextTick(() =&gt; scrollToColumn(idx, 'auto')) on desktop.**
  - **Target:** [app/pages/index.vue:621](/Users/powerox/neospace/app/pages/index.vue:621). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** After the toggle, `nextTick(() => scrollToColumn(idx, 'auto'))` on desktop.
  - **Prior observation to check:** `app/pages/index.vue:621` — Leaving focus mode (`toggleColumnFocus`) doesn't scroll the strip back to that column. While focused, the other columns are 1px and absolute, so the scroller's `scrollLeft` clamps to 0. Unfocusing the 6th column drops you at columns 1–3.
  - **Provenance:** [October 9 candidate, line 244](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:244); explicit source files unchanged at review time.
  - **Done:** `onColumnFocus` re-scrolls the toggled column into view after `nextTick` on desktop.
- [x] **NS-280 · P2 · UX · A · S — Skip when e.target has a horizontally scrollable ancestor inside the column that can still scroll in that…**
  - **Target:** [app/pages/index.vue:945](/Users/powerox/neospace/app/pages/index.vue:945). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Skip when `e.target` has a horizontally scrollable ancestor inside the column that can still scroll in that direction.
  - **Prior observation to check:** `app/pages/index.vue:945` — The capture-phase wheel handler takes every horizontal-dominant wheel gesture inside the board. A horizontal trackpad swipe over nested horizontal scrollers, such as the linked-accounts strip (`PanelColumn.vue:1323-1334`) or wide media and code in posts, pans the board instead.
  - **Provenance:** [October 9 candidate, line 245](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:245); explicit source files unchanged at review time.
  - **Done:** `nestedHorizontalScroller` skips the wheel-to-horizontal handler when the target sits in a nested scroller that can still scroll that way.
- [x] **NS-281 · P2 · UX · A · S — Call ensureTabsFocus() at the end of initialize().**
  - **Target:** [app/pages/index.vue:1210](/Users/powerox/neospace/app/pages/index.vue:1210). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Call `ensureTabsFocus()` at the end of `initialize()`.
  - **Prior observation to check:** `app/pages/index.vue:1210` — On an account switch, `initialize()` may null `focusedColumnId` (`columns.ts:750-757`). Nothing calls `ensureTabsFocus()` unless the column count changes (1188–1200), so Tabs density is left with no selected tab and no column hidden.
  - **Provenance:** [October 9 candidate, line 246](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:246); explicit source files unchanged at review time.
  - **Done:** `index.vue` calls `ensureTabsFocus()` after the account-switch `initialize()`.

- [x] **NS-282 · P2 · UX · A · M — Track the gesture from links and buttons too (exclude only form fields and menus), and swallow the click…**
  - **Target:** [app/pages/index.vue:991](/Users/powerox/neospace/app/pages/index.vue:991). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Track the gesture from links and buttons too (exclude only form fields and menus), and swallow the click if the gesture locked to x.
  - **Prior observation to check:** `app/pages/index.vue:991` — Carousel `touchstart` ignores gestures that start on any `a, button, [role="button"]`. Display names, reblog labels, links in post text and the whole action bar are excluded, so on Chrome Android a horizontal swipe that starts on much of a card never switches feeds.
  - **Provenance:** [October 9 candidate, line 248](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:248); explicit source files unchanged at review time.
  - **Done:** `pages/index.vue` carousel swipe now starts from links and buttons too (it excludes only form fields, menus and horizontally scrollable children via `insideHorizontalScroller`) and swallows the click that ends a swipe.

- [x] **NS-283 · P2 · UX · A · S — Use justify-content: safe center, or margin-block: auto on a wrapper.**
  - **Target:** [app/pages/index.vue:2417](/Users/powerox/neospace/app/pages/index.vue:2417). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Use `justify-content: safe center`, or `margin-block: auto` on a wrapper.
  - **Prior observation to check:** `app/pages/index.vue:2417` — The portal slides use `justify-content: center` with `overflow-y: auto` (2421). On landscape phones the Inbox and Activity portals overflow, and the centred overflow makes the title and kicker unreachable at the top.
  - **Provenance:** [October 9 candidate, line 249](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:249); explicit source files unchanged at review time.
  - **Done:** The board uses `justify-content: safe center` so a single narrow column cannot clip its start edge.
- [x] **NS-284 · P2 · UX · A · S — Pass the conversation and void conversationsStore.markRead(c.id) when it's unread.**
  - **Target:** [app/pages/index.vue:769](/Users/powerox/neospace/app/pages/index.vue:769). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Pass the conversation and `void conversationsStore.markRead(c.id)` when it's unread.
  - **Prior observation to check:** `app/pages/index.vue:769` — Opening a DM from the Inbox portal goes straight to `/status/:id` without `markRead`, unlike `PanelColumn.vue:399`, so the unread badge and dot stay.
  - **Provenance:** [October 9 candidate, line 250](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:250); explicit source files unchanged at review time.
  - **Done:** Opening an inbox row in the Activity portal now calls `conversationsStore.markRead(c.id)` for unread conversations.

- [x] **NS-285 · P2 · CODE · A · S — Use notifLabel(n.type) and the same phrasing as the Notifications column.**
  - **Target:** [app/pages/index.vue:686](/Users/powerox/neospace/app/pages/index.vue:686). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Use `notifLabel(n.type)` and the same phrasing as the Notifications column.
  - **Prior observation to check:** `app/pages/index.vue:686` — The Activity portal builds its own verb map. It produces "Alice poll ended" and "boosted you", and every other type (`status`, `update`, `follow_request`, quotes, admin) becomes "interacted". `notifLabel` in `utils/notifHelpers.ts:25` already covers all of these.
  - **Provenance:** [October 9 candidate, line 251](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:251); explicit source files unchanged at review time.
  - **Done:** Activity portal rows use `notifLabel(n.type)` so wording matches the Notifications column.

- [x] **NS-286 · P2 · A11Y · A · M — ) in index.vue to focus the next or previous column's feed root, and park it on mobile.**
  - **Target:** [app/composables/useFeedKeyboard.ts:14](/Users/powerox/neospace/app/composables/useFeedKeyboard.ts:14). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** ) in `index.vue` to focus the next or previous column's feed root, and park it on mobile.
  - **Prior observation to check:** `app/composables/useFeedKeyboard.ts:14` — keyboard users have no way to move between columns. j/k work only inside the focused column's `role=feed`, and reaching the next column means tabbing through every card and action. → Add board-level `[`/`]` (or Alt+←/
  - **Provenance:** [October 9 candidate, line 260](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:260); explicit source files unchanged at review time.
  - **Done:** `onBoardKeydown` in `pages/index.vue`: `[` / `]` focus the previous/next column's feed root (ignored while typing, parked on mobile).
- [x] **NS-287 · P2 · UX · A · S — Give the column its own filter (or show and reset the active filter in the panel toolbar).**
  - **Target:** [app/components/PanelColumn.vue:96](/Users/powerox/neospace/app/components/PanelColumn.vue:96). **Area:** E. PanelColumn.
  - **Change:** Give the column its own filter (or show and reset the active filter in the panel toolbar).
  - **Prior observation to check:** `app/components/PanelColumn.vue:96` — The Notifications column reads `notificationsStore.filteredNotifications`, which applies the global filter *and* sort order from `/notifications`. The Activity portal chips (`index.vue:1863-1871`) set that filter too. After tapping "Mentions" once, the board column shows only mentions, possibly oldest-first, with no indicator.
  - **Provenance:** [October 9 candidate, line 273](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:273); explicit source files unchanged at review time.
  - **Done:** The notifications panel column shows the active Activity filter/sort as a chip (`notificationViewLabel`, `panel-view-chip`) with a "Show all" reset, so a shared filter can't silently narrow the column. Tests: `tests/p2-final-batch.test.ts`.

- [x] **NS-288 · P2 · UX · A · S — Show the error with a Retry button before the empty message.**
  - **Target:** [app/components/PanelColumn.vue:816](/Users/powerox/neospace/app/components/PanelColumn.vue:816). **Area:** E. PanelColumn.
  - **Change:** Show the error with a Retry button before the empty message.
  - **Prior observation to check:** `app/components/PanelColumn.vue:816` — The panel never shows `notificationsStore.error`. When the fetch fails (expired token, 5xx), the list is empty and it says "All caught up."
  - **Provenance:** [October 9 candidate, line 274](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:274); explicit source files unchanged at review time.
  - **Done:** `PanelColumn.vue` notifications panel shows `notificationsStore.error` with a Retry button before "All caught up.".

- [x] **NS-289 · P2 · UX · A · S — Show the CW text when one is set, and add "…" on truncation.**
  - **Target:** [app/components/PanelColumn.vue:775](/Users/powerox/neospace/app/components/PanelColumn.vue:775). **Area:** E. PanelColumn.
  - **Change:** Show the CW text when one is set, and add "…" on truncation.
  - **Prior observation to check:** `app/components/PanelColumn.vue:775` — Post search results show `stripHtml(status.content).slice(0,120)` and ignore `spoilerText` and `sensitive`. Content-warned text is revealed in the results, and it's cut off with no ellipsis.
  - **Provenance:** [October 9 candidate, line 275](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:275); explicit source files unchanged at review time.
  - **Done:** `PanelColumn.vue` `searchStatusPreview` shows `CW: …` for content-warned posts and clips with an ellipsis via `clipGraphemes`.

- [x] **NS-290 · P2 · UX · A · S — Also resolve when the query matches ^https?://.**
  - **Target:** [app/components/PanelColumn.vue:298](/Users/powerox/neospace/app/components/PanelColumn.vue:298). **Area:** E. PanelColumn.
  - **Change:** Also resolve when the query matches `^https?://`.
  - **Prior observation to check:** `app/components/PanelColumn.vue:298` — `resolve` is only sent for `@user@host`. Pasting a post or profile URL, the most common way to pull in a remote object, returns nothing.
  - **Provenance:** [October 9 candidate, line 276](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:276); explicit source files unchanged at review time.
  - **Done:** `runSearch` sends `resolve` for `^https?://` queries as well as `@user@host`.

- [x] **NS-291 · P2 · CODE · A · S — Watch instancesStore.activeAccountId, re-run the search, and reload the peek.**
  - **Target:** [app/components/PanelColumn.vue:458](/Users/powerox/neospace/app/components/PanelColumn.vue:458). **Area:** E. PanelColumn.
  - **Change:** Watch `instancesStore.activeAccountId`, re-run the search, and reload the peek.
  - **Prior observation to check:** `app/components/PanelColumn.vue:458` — Panels don't react to an account switch. Search results stay from the old account, and a remote peek keeps `remoteAccount.id` from the old server while `loadRemoteStatuses` (247–248) now calls the new account's client, so "Load more" fails or fetches the wrong person.
  - **Provenance:** [October 9 candidate, line 277](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:277); explicit source files unchanged at review time.
  - **Done:** `PanelColumn.vue` watches `instancesStore.activeAccountId`, re-runs the search and reloads a remote profile peek. Not exercised in a browser.

- [x] **NS-292 · P2 · UX · A · S — Route with ?account= the way openNotification does.**
  - **Target:** [app/components/PanelColumn.vue:143](/Users/powerox/neospace/app/components/PanelColumn.vue:143). **Area:** E. PanelColumn.
  - **Change:** Route with `?account=` the way `openNotification` does.
  - **Prior observation to check:** `app/components/PanelColumn.vue:143` — "Open full profile" on the own-profile column, with a non-active linked account selected, calls `setActiveAccount(peekId)`. That silently switches the global account and refetches every column, the same side effect the previous audit removed from notification clicks.
  - **Provenance:** [October 9 candidate, line 278](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:278); explicit source files unchanged at review time.
  - **Done:** `PanelColumn.openFullProfile` routes with `?account=<viewer>` when the peeked account differs from the active one (same convention as `openNotification`), and `profileStore.isOwnProfile` honours that read-account override.

- [x] **NS-293 · P2 · DESIGN · A · S — Render names through emojify with the account's emojis.**
  - **Target:** [app/components/PanelColumn.vue:846](/Users/powerox/neospace/app/components/PanelColumn.vue:846). **Area:** E. PanelColumn.
  - **Change:** Render names through `emojify` with the account's emojis.
  - **Prior observation to check:** `app/components/PanelColumn.vue:846` — Display names are interpolated as plain text in notification rows (846), search people (744), search posts (774) and chats (917), and in `index.vue:688`/`1674`. Custom emoji show up as raw `:blobcat:` shortcodes, while cards use `emojify` (`utils/emojify.ts`).
  - **Provenance:** [October 9 candidate, line 279](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:279); explicit source files unchanged at review time.
  - **Done:** `PanelColumn.vue` and the portal user card render names via `richDisplayName` (sanitised, custom emoji) with matching emoji CSS.
- [x] **NS-294 · P2 · UX · A · S — With no focused card, start from the first card that intersects the scroller's viewport.**
  - **Target:** [app/composables/useFeedKeyboard.ts:33](/Users/powerox/neospace/app/composables/useFeedKeyboard.ts:33). **Area:** F. Column chrome, DnD, composables & utils.
  - **Change:** With no focused card, start from the first card that intersects the scroller's viewport.
  - **Prior observation to check:** `app/composables/useFeedKeyboard.ts:33` — When focus is on the feed root (for example after Escape, or tabbing in), `j` sets `idx = -1` and focuses card 0. `scrollIntoView` then yanks a reader who had scrolled 50 posts down back to the top.
  - **Provenance:** [October 9 candidate, line 286](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:286); explicit source files unchanged at review time.
  - **Done:** `firstVisibleCardIndex` / `visibleBand` in `useFeedKeyboard.ts`: with no focused card, `j`/`k` start at the first card inside the scroller's visible band. Tests: `tests/p2-shell-batch.test.ts`.
- [x] **NS-295 · P2 · DESIGN · A · S — Drop the title attributes on .neo-chrome-btn.**
  - **Target:** [app/components/ColumnChrome.vue:42](/Users/powerox/neospace/app/components/ColumnChrome.vue:42). **Area:** F. Column chrome, DnD, composables & utils.
  - **Change:** Drop the `title` attributes on `.neo-chrome-btn`.
  - **Prior observation to check:** `app/components/ColumnChrome.vue:42` — Icon buttons set both `title` and `aria-label`. The global `.neo-chrome-btn[aria-label]::after` pill (`main.scss:347-351`, "aria-label only (no title) avoids double tooltips") then shows two tooltips on hover. This affects `ColumnChrome.vue:42`, `71` and `84`; `TimelineColumn.vue:1323`, `1602`, `1614`, `1669` and `1687`; and `PanelColumn.vue:514`, `531` and `550`.
  - **Provenance:** [October 9 candidate, line 288](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:288); explicit source files unchanged at review time.
  - **Done:** Dropped the `title` attributes on `.neo-chrome-btn` in `ColumnChrome`, `PanelColumn` and `TimelineColumn` (the buttons keep their `aria-label`s).

- [x] **NS-296 · P2 · UX · A · S — Also observe the rail's children (or use a MutationObserver), and call update() when items change.**
  - **Target:** [app/composables/useHorizontalRail.ts:48](/Users/powerox/neospace/app/composables/useHorizontalRail.ts:48). **Area:** F. Column chrome, DnD, composables & utils.
  - **Change:** Also observe the rail's children (or use a MutationObserver), and call `update()` when items change.
  - **Prior observation to check:** `app/composables/useHorizontalRail.ts:48` — The ResizeObserver watches only the scroller's own box. Items appended later (load more, async trending) change `scrollWidth` without resizing the box, so the next arrow never appears.
  - **Provenance:** [October 9 candidate, line 291](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:291); explicit source files unchanged at review time.
  - **Evidence (N/A):** Not reproducible: `useHorizontalRail.ts` already observes the rail's children with a `MutationObserver` and calls `update()` on change.
- [x] **NS-297 · P3 · UX · A · S — Gate For You with hasAuthenticatedInstance everywhere, and pick one convention (hide or disable) for both…**
  - **Target:** [app/pages/index.vue:1368](/Users/powerox/neospace/app/pages/index.vue:1368). **Area:** B. Feed menus & feed switching.
  - **Change:** Gate For You with `hasAuthenticatedInstance` everywhere, and pick one convention (hide or disable) for both menus.
  - **Prior observation to check:** `app/pages/index.vue:1368` — "For You" is offered to guests in all three Add menus (1368, 1496, 1965), and adding it lands on the error state. Meanwhile the column switcher disables Home for guests (`TimelineColumn.vue:1377`) and hides Liked, Saved, Notifications and Messages (1430, 1442, 1551, 1566).
  - **Provenance:** [October 9 candidate, line 237](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:237); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-298 · P3 · DESIGN · A · S — Pick one term with sentence case throughout.**
  - **Target:** [app/pages/index.vue:1367](/Users/powerox/neospace/app/pages/index.vue:1367). **Area:** B. Feed menus & feed switching.
  - **Change:** Pick one term with sentence case throughout.
  - **Prior observation to check:** `app/pages/index.vue:1367` — The menu title is "Add feed" in tabs (1367), "Add Feed" on mobile (1495) and "Add Column" on desktop (1964). The footer says "feeds on this device" (1601) in one and "columns on this device" (2122) in another, and the trigger labels mix "Add feed" and "Add column".
  - **Provenance:** [October 9 candidate, line 240](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:240); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-299 · P3 · UX · A · S — Reuse PanelColumn's openNotification routing, and mark unread rows with notificationsStore.isUnread.**
  - **Target:** [app/pages/index.vue:1874](/Users/powerox/neospace/app/pages/index.vue:1874). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Reuse PanelColumn's `openNotification` routing, and mark unread rows with `notificationsStore.isUnread`.
  - **Prior observation to check:** `app/pages/index.vue:1874` — Each Activity portal row opens the generic `/notifications` page, not the post or profile it refers to, and rows show no unread state.
  - **Provenance:** [October 9 candidate, line 252](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:252); explicit source files unchanged at review time.
  - Evidence: Board Activity portal rows deep-link via `notificationRoute()` and show unread dots.

- [x] **NS-300 · P3 · DESIGN · A · S — Use the app's compact number formatter and singular/plural labels.**
  - **Target:** [app/pages/index.vue:1677](/Users/powerox/neospace/app/pages/index.vue:1677). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Use the app's compact number formatter and singular/plural labels.
  - **Prior observation to check:** `app/pages/index.vue:1677` — Profile portal stats print raw integers with fixed plurals: "1 posts", "1234567 followers".
  - **Provenance:** [October 9 candidate, line 253](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:253); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-301 · P3 · DESIGN · A · S — Remove it, or replace it with a hint like "Swipe back for your feeds".**
  - **Target:** [app/pages/index.vue:1622](/Users/powerox/neospace/app/pages/index.vue:1622). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Remove it, or replace it with a hint like "Swipe back for your feeds".
  - **Prior observation to check:** `app/pages/index.vue:1622` — Every portal shows the kicker "Edge" (1622, 1664, 1748, 1799, 1847, 1901). It's an internal layout term with no meaning to users.
  - **Provenance:** [October 9 candidate, line 254](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:254); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-302 · P3 · DESIGN · A · S — Use one name per destination across the chrome, portals and aria-labels.**
  - **Target:** [app/pages/index.vue:135](/Users/powerox/neospace/app/pages/index.vue:135). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Use one name per destination across the chrome, portals and aria-labels.
  - **Prior observation to check:** `app/pages/index.vue:135` — Naming drifts between surfaces: the chrome title says "Messages" where the portal h2 says "Inbox" (1801). The Activity portal stands in for Notifications. The communities slide has aria-label "Find communities" (1899) while its heading says "Groups" (1902).
  - **Provenance:** [October 9 candidate, line 255](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:255); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-303 · P3 · UX · A · S — Open /groups/fediverse, or search #fediverse.**
  - **Target:** [app/pages/index.vue:1769](/Users/powerox/neospace/app/pages/index.vue:1769). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Open `/groups/fediverse`, or search `#fediverse`.
  - **Prior observation to check:** `app/pages/index.vue:1769` — The "#fediverse" chip searches the plain word "fediverse", not the tag.
  - **Provenance:** [October 9 candidate, line 256](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:256); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-304 · P3 · UX · A · S — Call openGroup(group.tag).**
  - **Target:** [app/pages/index.vue:1917](/Users/powerox/neospace/app/pages/index.vue:1917). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Call `openGroup(group.tag)`.
  - **Prior observation to check:** `app/pages/index.vue:1917` — Portal group chips `router.push('/groups/…')` directly, bypassing `useBoardNav().openGroup` (`useBoardNav.ts:95-98`), which reuses an existing board column for that tag.
  - **Provenance:** [October 9 candidate, line 257](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:257); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-305 · P3 · UX · A · S — Disable it when !isTimelineFeed(activeColumn.feedType).**
  - **Target:** [app/pages/index.vue:1417](/Users/powerox/neospace/app/pages/index.vue:1417). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Disable it when `!isTimelineFeed(activeColumn.feedType)`.
  - **Prior observation to check:** `app/pages/index.vue:1417` — The mobile Flick toggle stays enabled when the parked column is a panel (Notifications, Messages, Search, Profile). It does nothing visible but still persists `viewMode: 'flip'` to storage.
  - **Provenance:** [October 9 candidate, line 258](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:258); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-306 · P3 · DESIGN · A · S — Settle on one user-facing pair and make the tooltip follow aria-pressed.**
  - **Target:** [app/pages/index.vue:1421](/Users/powerox/neospace/app/pages/index.vue:1421). **Area:** C. Board page — carousel, focus, tabs, portals (`index.vue`).
  - **Change:** Settle on one user-facing pair and make the tooltip follow `aria-pressed`.
  - **Prior observation to check:** `app/pages/index.vue:1421` — The toggle's tooltip says "Feed — scroll a list" while its aria-label says "Flick view". The code and comments call the mode Flip/Flow while the UI says Flick/Feed.
  - **Provenance:** [October 9 candidate, line 259](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:259); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-307 · P3 · UX · A · S — Allow length 1 when the character is non-Latin, or adjust the hint.**
  - **Target:** [app/components/PanelColumn.vue:282](/Users/powerox/neospace/app/components/PanelColumn.vue:282). **Area:** E. PanelColumn.
  - **Change:** Allow length 1 when the character is non-Latin, or adjust the hint.
  - **Prior observation to check:** `app/components/PanelColumn.vue:282` — Search needs at least 2 characters, which blocks meaningful single-character CJK queries.
  - **Provenance:** [October 9 candidate, line 280](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:280); explicit source files unchanged at review time.
  - Evidence: PanelColumn search uses `searchQueryTooShort()` (1 non-Latin char OK).

- [x] **NS-308 · P3 · UX · A · S — Bind :disabled and aria-busy to notificationsStore.isLoading and spin the icon.**
  - **Target:** [app/components/PanelColumn.vue:789](/Users/powerox/neospace/app/components/PanelColumn.vue:789). **Area:** E. PanelColumn.
  - **Change:** Bind `:disabled` and `aria-busy` to `notificationsStore.isLoading` and spin the icon.
  - **Prior observation to check:** `app/components/PanelColumn.vue:789` — The notifications Refresh button gives no feedback: no busy state, no spin, no disabled state while `isLoading`. Repeated clicks fire repeated fetches.
  - **Provenance:** [October 9 candidate, line 281](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:281); explicit source files unchanged at review time.
  - Evidence: Notifications Refresh binds `:disabled`, `aria-busy`, and spin to `isLoading`.

- [x] **NS-309 · P3 · DESIGN · A · S — Move these rules into ColumnChrome.vue.**
  - **Target:** [app/components/PanelColumn.vue:988](/Users/powerox/neospace/app/components/PanelColumn.vue:988). **Area:** E. PanelColumn.
  - **Change:** Move these rules into `ColumnChrome.vue`.
  - **Prior observation to check:** `app/components/PanelColumn.vue:988` — The `.column-drag-handle` (988–991) and `.column-reorder` (1003–1008) rules are scoped to PanelColumn and can't reach ColumnChrome's internal elements. The panel drag handle has no `cursor: grab` or `touch-action: none`, and the reorder arrows lack the flex, gap and margin TimelineColumn applies, so headers don't line up.
  - **Provenance:** [October 9 candidate, line 282](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:282); explicit source files unchanged at review time.
  - Evidence: Drag/reorder chrome styles moved to `ColumnChrome.vue`.

- [x] **NS-310 · P3 · DESIGN · A · S — Share the same card rule (token radius plus containment).**
  - **Target:** [app/components/PanelColumn.vue:1397](/Users/powerox/neospace/app/components/PanelColumn.vue:1397). **Area:** E. PanelColumn.
  - **Change:** Share the same card rule (token radius plus containment).
  - **Prior observation to check:** `app/components/PanelColumn.vue:1397` — Profile post cards use `border-radius: 4px`, while TimelineColumn uses `var(--neo-radius-md)` (2421) along with `content-visibility: auto`.
  - **Provenance:** [October 9 candidate, line 283](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:283); explicit source files unchanged at review time.
  - Evidence: Profile column post cards match TimelineColumn radius + `content-visibility`.

- [x] **NS-311 · P3 · A11Y · A · S — Compare e.key.toLowerCase() and ignore when Shift is held.**
  - **Target:** [app/composables/useFeedKeyboard.ts:31](/Users/powerox/neospace/app/composables/useFeedKeyboard.ts:31). **Area:** F. Column chrome, DnD, composables & utils.
  - **Change:** Compare `e.key.toLowerCase()` and ignore when Shift is held.
  - **Prior observation to check:** `app/composables/useFeedKeyboard.ts:31` — Only lowercase `j`/`k`/`o` match, so the shortcuts silently stop working with Caps Lock on.
  - **Provenance:** [October 9 candidate, line 287](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:287); explicit source files unchanged at review time.
  - **Done:** `useFeedKeyboard.ts` lowercases single-char keys (Caps Lock safe) and ignores Shift+letter.

- [x] **NS-312 · P3 · UX · A · S — Only preventDefault when e.dataTransfer.types.includes('application/x-neospace-column'), and drop the…**
  - **Target:** [app/composables/useColumnDnd.ts:24](/Users/powerox/neospace/app/composables/useColumnDnd.ts:24). **Area:** F. Column chrome, DnD, composables & utils.
  - **Change:** Only `preventDefault` when `e.dataTransfer.types.includes('application/x-neospace-column')`, and drop the `text/plain` fallback on read.
  - **Prior observation to check:** `app/composables/useColumnDnd.ts:24` — `dragover` accepts any drag (selected text, links, images from posts, files) and sets `dropEffect='move'`. `drop` then falls back to `text/plain` (35–36), so dragged text is treated as a column id. Every column advertises itself as a drop target for content it can't take.
  - **Provenance:** [October 9 candidate, line 289](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:289); explicit source files unchanged at review time.
  - **Done:** `useColumnDnd.ts` only accepts/handles drags carrying `application/x-neospace-column`; the `text/plain` fallback on drop is removed.

- [x] **NS-313 · P3 · CODE · A · S — Default it to false.**
  - **Target:** [app/components/ColumnChrome.vue:14](/Users/powerox/neospace/app/components/ColumnChrome.vue:14). **Area:** F. Column chrome, DnD, composables & utils.
  - **Change:** Default it to `false`.
  - **Prior observation to check:** `app/components/ColumnChrome.vue:14` — `isLast` defaults to `true`, while both parents default it to `false`. Any caller that omits the prop gets a permanently disabled "Move right" and a dead ArrowRight.
  - **Provenance:** [October 9 candidate, line 290](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:290); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-314 · P3 · UX · A · S — Use Math.abs(el.scrollLeft) and flip the scrollBy sign when getComputedStyle(el).direction === 'rtl'.**
  - **Target:** [app/composables/useHorizontalRail.ts:21](/Users/powerox/neospace/app/composables/useHorizontalRail.ts:21). **Area:** F. Column chrome, DnD, composables & utils.
  - **Change:** Use `Math.abs(el.scrollLeft)` and flip the `scrollBy` sign when `getComputedStyle(el).direction === 'rtl'`.
  - **Prior observation to check:** `app/composables/useHorizontalRail.ts:21` — In RTL `scrollLeft` is ≤ 0, so `canScrollBack` is always false and `canScrollForward` is wrong.
  - **Provenance:** [October 9 candidate, line 292](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:292); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-315 · P3 · CODE · A · S — Resolve against a base: new URL(match[1], 'https://x.invalid')**
  - **Target:** [app/utils/linkHeader.ts:28](/Users/powerox/neospace/app/utils/linkHeader.ts:28). **Area:** F. Column chrome, DnD, composables & utils.
  - **Change:** Resolve against a base: `new URL(match[1], 'https://x.invalid')`. Only the query is read.
  - **Prior observation to check:** `app/utils/linkHeader.ts:28` — `new URL(match[1])` throws on a relative `Link` target, which some proxies and servers send. The catch returns null and pagination silently stops after page 1.
  - **Provenance:** [October 9 candidate, line 293](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:293); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [ ] **NS-316 · P3 · UX · A · M — Collapse within a sliding window (say 20 rows), keeping the first occurrence's position.**
  - **Target:** [app/utils/statusIdentity.ts:108](/Users/powerox/neospace/app/utils/statusIdentity.ts:108). **Area:** F. Column chrome, DnD, composables & utils.
  - **Change:** Collapse within a sliding window (say 20 rows), keeping the first occurrence's position.
  - **Prior observation to check:** `app/utils/statusIdentity.ts:108` — Reblogs collapse only when they are *consecutive*. The same post boosted by three followees a few posts apart still repeats in Home, which is the complaint the earlier "A and 2 others reposted" item was meant to fix.
  - **Provenance:** [October 9 candidate, line 294](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:294); explicit source files unchanged at review time.

## Remaining candidates: Edward (lean-back 3D discovery mode)

- [x] **NS-317 · P1 · UX · C · M — Match full user@host (qualify bare handles with the source host, as lookupAcctFor does), and keep…**
  - **Target:** [app/utils/edwardAffinity.ts:108](/Users/powerox/neospace/app/utils/edwardAffinity.ts:108). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** Match full `user@host` (qualify bare handles with the source host, as `lookupAcctFor` does), and keep local-part matching only for posts from your own server.
  - **Prior observation to check:** `app/utils/edwardAffinity.ts:108-137` — "You posted this", "you follow" and "mentions you" match on the part of the handle before `@` alone (`authorLocal === selfLocal`, `followingLocalParts(...).has(authorLocal)`, `localPart(mn) === selfLocal`). In a multi-server firehose, every `alice@anywhere` gets "★ you posted this" or "♥ you follow @alice", a +0.55/+0.38 size boost, and passes the "you" filter.
  - **Provenance:** [October 9 candidate, line 547](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:547); explicit source files unchanged at review time.
  - Evidence: `edwardAffinity.ts` compares full handles: `EdwardAffinityContext.homeHost` (set from the primary server in `useEdwardStream`) makes bare handles mean "your server"; `statusToEdwardBall` qualifies author and mentions with `lookupAcctFor` before scoring. Local-part matching is gone, so `alice@elsewhere` no longer gets "you posted this" / "you follow" / "mentions you". Tests in `tests/edward.test.ts` (updated the old local-part expectation).

- [x] **NS-318 · P2 · UX · A · M — Add an onError that calls useEdwardStore().exit() and shows a toast ("Couldn't load Edward — check your…**
  - **Target:** [app/layouts/default.vue:26](/Users/powerox/neospace/app/layouts/default.vue:26). **Area:** Entry / exit / shell.
  - **Change:** Add an `onError` that calls `useEdwardStore().exit()` and shows a toast ("Couldn't load Edward — check your connection").
  - **Prior observation to check:** `app/layouts/default.vue:26-28` — `defineAsyncComponent(() => import(EdwardMode.vue))` has no `errorComponent`/`onError`. If the chunk fails (offline, or a deploy changed chunk hashes), `edwardActive` stays true and nothing renders. The waffle then shows Edward as "current" and the first tap only turns it off.
  - **Provenance:** [October 9 candidate, line 451](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:451); explicit source files unchanged at review time.
  - **Done:** `default.vue` async Edward component has `onError` → `useEdwardStore().exit()` plus a toast.
- [x] **NS-319 · P2 · UX · A · M — Add a shortcut or palette entry and better blurb copy (e.g**
  - **Target:** [app/components/SuiteMenu.vue:28](/Users/powerox/neospace/app/components/SuiteMenu.vue:28). **Area:** Entry / exit / shell.
  - **Change:** Add a shortcut or palette entry and better blurb copy (e.g. "lean back · watch the fediverse float by").
  - **Prior observation to check:** `app/components/SuiteMenu.vue:28-32` — The only way in is the bottom-right waffle, which is hidden while compose is open (`layouts/default.vue:252`). There's no keyboard shortcut, command-palette entry or route, and the blurb "stream · balls" doesn't explain the feature.
  - **Provenance:** [October 9 candidate, line 453](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:453); explicit source files unchanged at review time.
  - **Done:** Alt+Shift+E toggles Edward from anywhere (listener in `layouts/default.vue`, `isEdwardShortcut` in `useSuiteGroups.ts`) and the suite-menu blurb now explains it ("lean back · watch the fediverse float by").

- [ ] **NS-320 · P2 · PERF · A · M — Render on demand: skip render when there's no sim, camera, hover or drag change, or throttle to ~10 fps…**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1496](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1496). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Render on demand: skip `render` when there's no sim, camera, hover or drag change, or throttle to ~10 fps when idle, recessed, or while `selectedIdentity` is set.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1496-1525` — `frame()` calls `renderer.render` at display rate unconditionally. With speed `still`, under reduced motion (`integrateBubblePhysics` early-returns at `:731`), behind the peek modal, or while recessed, it re-renders an identical transmission-glass scene 60–120 times a second, which drains laptops and phones.
  - **Prior verifier qualification:** Rendering every frame unconditionally is real, but the scene isn't "identical". Even at `still` (mul 0), bubbles breathe on wall-clock `t` (`:1127`) and stars rotate unless reduced motion is on. The real waste is continuous transmission-glass rendering while recessed or behind the peek modal, and under reduced motion. [Corrected: "Canvas renders at display rate even while recessed, behind the peek, or under reduced motion. Throttle or render on demand in those states." Impact Medium.]
  - **Provenance:** [October 9 candidate, line 481](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:481); explicit source files unchanged at review time.
  - Partial (left unchecked): Throttled (~10 fps via `utils/edwardRender.ts` `renderIntervalMs`) while recessed, peek-open, reduced motion with no interaction, **and** at `still` speed (`speedMul <= 0`) unless hovering/dragging; skipped frames keep `lastFrameT`. Tests: `tests/edwardRender.test.ts`. Unchecked: skip `renderer.render` when the scene is bitwise unchanged; no GPU frame-time measurement.

- [ ] **NS-321 · P2 · PERF · A · M — Share one shell material per dialect accent (tint via instance color), pack faces into an atlas, and add…**
  - **Target:** [app/components/edward/EdwardCanvas.vue:489](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:489). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Share one shell material per dialect accent (tint via instance color), pack faces into an atlas, and add an adaptive quality tier (drop transmission or iridescence when frame time is above 20 ms).
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:489-508` — Every ball creates its own `MeshPhysicalMaterial` with `transmission`, `iridescence` and `clearcoat`, plus its own 512² `CanvasTexture` with `anisotropy=4` (`:353-378`). With 72 desktop / 38 phone balls that's about 1.3 MB of GPU texture per ball, and every transmissive mesh forces the extra transmission pass. Low-end GPUs stutter.
  - **Provenance:** [October 9 candidate, line 483](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:483); explicit source files unchanged at review time.
  - Partial (left unchecked): `EdwardCanvas.vue` caches one `MeshPhysicalMaterial` per dialect tint + fill + quality tier (`full` vs `lean`); lean drops transmission/iridescence after sustained >20 ms frames. Face textures are still per-ball 512² canvases (no atlas). Unchecked: instance-color tinting on one global material; GPU validation.

- [x] **NS-322 · P2 · PERF · A · L — Use 'default' (or 'low-power' when edwardIsCompact()).**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1696](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1696). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Use `'default'` (or `'low-power'` when `edwardIsCompact()`).
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1696-1699` — `powerPreference: 'high-performance'` forces the discrete GPU on dual-GPU MacBooks for a lean-back ambient mode, a big battery hit.
  - **Provenance:** [October 9 candidate, line 484](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:484); explicit source files unchanged at review time.
  - **Done:** `EdwardCanvas.vue`: `powerPreference` is `'low-power'` when compact, otherwise `'default'`.
- [x] **NS-323 · P2 · PERF · A · M — Cache host size from the existing ResizeObserver, and update bubble and caption transforms imperatively…**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1105](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1105). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Cache host size from the existing ResizeObserver, and update bubble and caption transforms imperatively via refs instead of reactive arrays.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1105-1106` — Each frame reads `hostEl.clientWidth/clientHeight` right after the previous frame wrote reactive `bubbles` (every frame, `:1207`) and `captions` (every 2nd frame, `:1100`). That's a forced synchronous layout per frame, plus Vue patching up to 16 absolutely-positioned nodes at 30–60 Hz.
  - **Provenance:** [October 9 candidate, line 485](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:485); explicit source files unchanged at review time.
  - **Done:** Host size stays on the `ResizeObserver` cache; bubble and caption overlays update imperatively (`syncBubbleLayer` / `syncCaptionLayer` on ref'd layers) instead of `v-for` reactive arrays. Hover card was already imperative (`hoverEl`). Tests: `npm test` (no GPU run).

- [x] **NS-324 · P2 · PERF · A · L — Only replace hoverCard when the identity changes, and move it with a transform on a ref'd element.**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1515](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1515). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Only replace `hoverCard` when the identity changes, and move it with a transform on a ref'd element.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1515-1518` — While hovering, `projectHover` runs every frame. It calls `getBoundingClientRect()` (`:1248`) and assigns a brand-new `hoverCard` object, re-rendering the whole hover card DOM at 60 fps.
  - **Provenance:** [October 9 candidate, line 486](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:486); explicit source files unchanged at review time.
  - **Done:** Done in app code (not measured on a GPU): `hoverCard` now holds only the card's content and is replaced when the hovered ball or its flip side changes; the card follows the ball through an imperative `transform` on a ref'd element (`hoverEl`) and no longer calls `getBoundingClientRect` per frame (cached host size).

- [x] **NS-325 · P2 · UX · A · M — Fade or shrink the outgoing ball over ~400 ms, or prefer evicting balls that are off-stage.**
  - **Target:** [app/components/edward/EdwardCanvas.vue:664](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:664). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Fade or shrink the outgoing ball over ~400 ms, or prefer evicting balls that are off-stage.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:664-669` — When a newer post pushes the 73rd ball past `maxBalls()`, `disposeBall` removes it instantly wherever it is, often mid-screen or inside the lens. Bubbles visibly pop out of existence every drip.
  - **Provenance:** [October 9 candidate, line 488](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:488); explicit source files unchanged at review time.
  - **Done:** Outgoing balls (evicted by `maxBalls`) are retired instead of disposed on the spot: they shrink over 400 ms (ease-in) and are then disposed, capped at 24 concurrent leavers; reduced motion disposes immediately; scene teardown disposes any leavers.

- [x] **NS-326 · P2 · UX · A · L — try/catch around the import, then edward.setError('Couldn't load the 3D view — check your connection and…**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1676](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1676). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** try/catch around the import, then `edward.setError('Couldn't load the 3D view — check your connection and reopen Edward.')`.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1676-1679` — `await import('three')` isn't wrapped. A chunk-load failure is an unhandled rejection, leaving a blank purple void with no message.
  - **Provenance:** [October 9 candidate, line 489](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:489); explicit source files unchanged at review time.
  - **Done:** `EdwardCanvas.vue` wraps `import('three')` in try/catch and calls `edward.setError('Couldn’t load the 3D view — check your connection and reopen Edward.')`.
- [x] **NS-327 · P2 · UX · A · M — Without WebGL, fall back to a 2D mode: show the __list panel visibly and let tour drive the deck, or exit…**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1700](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1700). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Without WebGL, fall back to a 2D mode: show the `__list` panel visibly and let tour drive the deck, or exit with a toast.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1700-1703` — Without WebGL, Edward shows one error line but keeps polling every server. The lens never runs (`updateBalls` never fires), so the watch deck never fills. The user gets an error over an empty void plus a hidden list.
  - **Provenance:** [October 9 candidate, line 490](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:490); explicit source files unchanged at review time.
  - **Done:** Decision: **exit with a toast.** There is no 2D stage to fall back to, so when `WebGLRenderer` can't start, `EdwardCanvas` emits `unsupported` and `EdwardMode` shows "Edward needs WebGL, which this browser or device can’t start." and leaves, which also stops the stream (no more polling every server behind an empty void).

- [x] **NS-328 · P2 · UX · A · L — Return early unless e.button === 0 (or pointerType !== 'mouse').**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1329](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1329). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Return early unless `e.button === 0` (or `pointerType !== 'mouse'`).
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1329-1346` — `onPointerDown` ignores `e.button`. A right click (no movement) reaches `onPointerUp` and emits `pick` (`:1423-1424`), so the browser context menu opens on top of the peek. Middle-click does the same.
  - **Provenance:** [October 9 candidate, line 492](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:492); explicit source files unchanged at review time.
  - **Done:** `EdwardCanvas.vue` pointer-down returns early for non-primary mouse buttons.
- [x] **NS-329 · P2 · UX · A · L — Require a drag or wheel to scrub, or show a visible chevron cue while the edge is active.**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1459](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1459). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Require a drag or wheel to scrub, or show a visible chevron cue while the edge is active.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1459-1473` — `applyEdgeHoverScroll` scrubs the stream whenever the mouse rests in the outer 13%/11% bands. Nothing visible explains it (the edge gradients are 8–10% alpha), so a parked cursor makes the stream "run away".
  - **Provenance:** [October 9 candidate, line 493](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:493); explicit source files unchanged at review time.
  - **Done:** Resting the pointer in the rim now needs a dwell (0.6 s) before anything scrubs, then eases in over 0.5 s; a chevron cue and brighter rim appear at 0.25 s so the behaviour is explained before it happens (`edgeDwellStep` / `edgeScrubGain` in `utils/edwardRender.ts`, `is-edge-active` styles). Drag and wheel scrubbing are unchanged. Tests: `tests/edwardRender.test.ts`.

- [x] **NS-330 · P2 · UX · A · L — Require a word or @ boundary (\b@?name\b) and at least 4 characters.**
  - **Target:** [app/utils/edwardAffinity.ts:150](/Users/powerox/neospace/app/utils/edwardAffinity.ts:150). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** Require a word or `@` boundary (`\b@?name\b`) and at least 4 characters.
  - **Prior observation to check:** `app/utils/edwardAffinity.ts:150-153` — The "your handle appears in plain text" bonus is a substring test for any username longer than 2 characters. Users named `the`, `art` or `dev` get an affinity bump on most posts.
  - **Provenance:** [October 9 candidate, line 548](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:548); explicit source files unchanged at review time.
  - **Done:** `handleInText` in `edwardAffinity.ts` requires a Unicode word boundary (optional `@`) and ≥4 characters. Tests: `tests/p2-shell-batch.test.ts`.
- [x] **NS-331 · P2 · UX · A · L — Drop the cat emoji, "kitty", "cake" and "peach" from the spicy sets (keep explicit terms), or require two…**
  - **Target:** [app/utils/edwardFaces.ts:116](/Users/powerox/neospace/app/utils/edwardFaces.ts:116). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** Drop the cat emoji, "kitty", "cake" and "peach" from the spicy sets (keep explicit terms), or require two cues.
  - **Prior observation to check:** `app/utils/edwardFaces.ts:116-117` — The spicy lexicon flags ordinary content: `KITTY_RE` matches 🐱 😻 🐈 and "kitty" (every #caturday post), `PEACH_RE` matches "cake"/"peach" (`:115`), `\bcock\b` roosters, and `\btits?\b` birds (`:119`). Spicy also overrides the CW face and dimming (`edwardSemantics.ts:263`). Cat photos get hovered as "SPICY".
  - **Provenance:** [October 9 candidate, line 549](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:549); explicit source files unchanged at review time.
  - **Done:** `edwardFaces.ts` no longer treats the cat emoji, “kitty”, “peach” or “cake” as spicy cues; explicit terms remain.
- [x] **NS-332 · P2 · UX · A · L — Use /[^\p{L}\p{N}_]/gu.**
  - **Target:** [app/utils/edwardExplore.ts:348](/Users/powerox/neospace/app/utils/edwardExplore.ts:348). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** Use `/[^\p{L}\p{N}_]/gu`.
  - **Prior observation to check:** `app/utils/edwardExplore.ts:348` — `#tag` search strips everything outside `[a-z0-9_]`, so `#日本語` becomes empty (ignored) and `#café` becomes `#caf`. Non-Latin and accented hashtags can't be searched.
  - **Provenance:** [October 9 candidate, line 553](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:553); explicit source files unchanged at review time.
  - **Done:** Tag/handle sanitising uses Unicode-aware `/[^\p{L}\p{N}_]/gu` so non-Latin tags survive.
- [x] **NS-333 · P2 · UX · A · L — Have setSort strip any sort: token from the query.**
  - **Target:** [app/utils/edwardExplore.ts:518](/Users/powerox/neospace/app/utils/edwardExplore.ts:518). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** Have `setSort` strip any `sort:` token from the query.
  - **Prior observation to check:** `app/utils/edwardExplore.ts:518` — A `sort:x` token in the query always wins over `exploreSort`. After typing `sort:loud` (or picking a placeholder example), clicking another sort pill (`EdwardMode.vue:1330`) changes `exploreSort`, but nothing moves and the pill doesn't light up (`sortActive` reads the query first, `:383-384`).
  - **Provenance:** [October 9 candidate, line 554](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:554); explicit source files unchanged at review time.
  - **Done:** `stores/edward.ts` `setSort` strips `sort:` / bare sort tokens via `stripSortTokens` (`edwardExplore.ts`). Tests: `tests/p2-shell-batch.test.ts`.
- [x] **NS-334 · P2 · TOOLING · A · M — Flip that test to assert no match from a foreign server, and add store and composable specs for those…**
  - **Target:** [tests/edward.test.ts:48](/Users/powerox/neospace/tests/edward.test.ts:48). **Area:** Tests (gaps).
  - **Change:** Flip that test to assert no match from a foreign server, and add store and composable specs for those three behaviours with fake timers.
  - **Prior observation to check:** `tests/edward.test.ts:48` — The test "matches followed accounts by local part as before" encodes the cross-server false positive (bare `alice` matches `alice@far.example`). There are also no tests for `useEdwardStream` (re-seed backoff, backpack shed/release order, ghost purge), for the recessed restore after the compose sheet closes, or for `mergeNewer` keeping the selected post.
  - **Provenance:** [October 9 candidate, line 564](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:564); explicit source files unchanged at review time.
  - **Done:** Flipped the cross-server assertion earlier; now added `tests/edwardStream.test.ts` (fake timers): backpack seeds/releases at stream pace and clears on stop, ghosted author purged from the queue and never dripped, deleted post purged, re-seed backoff after a rate limit (calm 12 s → 24 s), `mergeNewer` keeps the selected post, and the recess restore. The recess restore was extracted to `composables/useEdwardRecess.ts` so it is testable; `stop()` now also zeroes the store's backpack count (a bug the test found).
- [ ] **NS-335 · P3 · PERF · A · M — Keep one preallocated Float32BufferAttribute (180×6), rewrite the pairs each frame, and set needsUpdate.**
  - **Target:** [app/components/edward/EdwardCanvas.vue:851](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:851). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Keep one preallocated `Float32BufferAttribute` (180×6), rewrite the pairs each frame, and set `needsUpdate`.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:851-887` — `rebuildFilaments` allocates a new `BufferGeometry` (GPU buffer create plus dispose) every 30 frames and on every sync. Between rebuilds the lines stay frozen at old positions while the balls move, so filaments visibly detach.
  - **Provenance:** [October 9 candidate, line 487](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:487); explicit source files unchanged at review time.

- [ ] **NS-336 · P3 · UX · A · L — Add a "Restart 3D" action that disposes and re-inits the scene, or use WEBGL_lose_context.restoreContext().**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1582](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1582). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Add a "Restart 3D" action that disposes and re-inits the scene, or use `WEBGL_lose_context.restoreContext()`.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1582-1583` — The context-lost copy says it "resumes when the device allows", but there's no retry and it stays up indefinitely if Chrome refuses to restore.
  - **Provenance:** [October 9 candidate, line 491](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:491); explicit source files unchanged at review time.

- [ ] **NS-337 · P3 · PERF · A · L — Keep only the visibleBalls watcher.**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1846](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1846). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Keep only the `visibleBalls` watcher.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1846-1861` — Three watchers call `syncBallsFromStore`. A filter change fires both the `visibleBalls` watcher and the `[exploreQuery, exploreSort]` watcher, and an affinity change fires both `affinity` and `visibleBalls`. Each sync rebuilds filaments.
  - **Provenance:** [October 9 candidate, line 494](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:494); explicit source files unchanged at review time.

- [ ] **NS-338 · P3 · PERF · A · L — Keep a cached pick-mesh array, rebuilt in syncBallsFromStore.**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1278](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1278). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Keep a cached pick-mesh array, rebuilt in `syncBallsFromStore`.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1278` — `hitTest` allocates `balls.flatMap(...)` (about 150 elements) on every `pointermove`.
  - **Provenance:** [October 9 candidate, line 495](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:495); explicit source files unchanged at review time.

- [ ] **NS-339 · P3 · CODE · A · L — Pass the header and console rects (or their heights, already measured as headerH/exploreH) as props.**
  - **Target:** [app/components/edward/EdwardCanvas.vue:956](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:956). **Area:** 3D canvas — GPU, perf & lifecycle (`EdwardCanvas.vue`).
  - **Change:** Pass the header and console rects (or their heights, already measured as `headerH`/`exploreH`) as props.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:956-957` — `measureLens` reaches into the parent with global `document.querySelector('.edward-mode__header' / '__explore')`, coupling the canvas to the parent's class names.
  - **Provenance:** [October 9 candidate, line 496](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:496); explicit source files unchanged at review time.

- [ ] **NS-340 · P3 · UX · A · L — Change it to "click to open".**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1950](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1950). **Area:** Canvas overlays — hover card & captions.
  - **Change:** Change it to "click to open".
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1950` — The hover footer promises "click to open · heart · reply · follow", but the hover card can't do any of those and clicking only opens the peek.
  - **Provenance:** [October 9 candidate, line 499](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:499); explicit source files unchanged at review time.

- [ ] **NS-341 · P3 · UX · A · L — Show why only, or map moods to user-facing labels.**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1923](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1923). **Area:** Canvas overlays — hover card & captions.
  - **Change:** Show `why` only, or map moods to user-facing labels.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1923` — The hover header prints the internal mood id (`{{ hoverCard.mood }}` such as `yapping`, `linky`, `eggplant`, `booby`) uppercased next to the `why` label, which often repeats it ("REPLY · YAPPING").
  - **Provenance:** [October 9 candidate, line 500](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:500); explicit source files unchanged at review time.

- [ ] **NS-342 · P3 · DESIGN · A · L — Use one Intl.NumberFormat(undefined, { notation: 'compact' }) helper everywhere.**
  - **Target:** [app/components/edward/EdwardCanvas.vue:1944](/Users/powerox/neospace/app/components/edward/EdwardCanvas.vue:1944). **Area:** Canvas overlays — hover card & captions.
  - **Change:** Use one `Intl.NumberFormat(undefined, { notation: 'compact' })` helper everywhere.
  - **Prior observation to check:** `app/components/edward/EdwardCanvas.vue:1944-1946` — Hover counts print raw (`♥ 12345`) while the coin texture uses `compact()` (`:351`). The deck (`EdwardMode.vue:1027-1029`) and peek (`EdwardPostModal.vue:399,411,421`) also print raw numbers.
  - **Provenance:** [October 9 candidate, line 501](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:501); explicit source files unchanged at review time.

- [ ] **NS-343 · P3 · UX · A · L — Anchor www as \bw{3,}\b (JP-style laughter, without a following dot), and skip ? inside URLs (strip URLs…**
  - **Target:** [app/utils/edwardFaces.ts:87](/Users/powerox/neospace/app/utils/edwardFaces.ts:87). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** Anchor `www` as `\bw{3,}\b` (JP-style laughter, without a following dot), and skip `?` inside URLs (strip URLs before cue matching).
  - **Prior observation to check:** `app/utils/edwardFaces.ts:87` — `LAUGH_RE` contains an unanchored `www+`, so any post whose text includes a "www." link becomes a laughing "giggle" face. `ASK_RE` (`:110`) matches any `?`, including URL query strings, so link posts read as "asking something".
  - **Provenance:** [October 9 candidate, line 550](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:550); explicit source files unchanged at review time.

- [ ] **NS-344 · P3 · UX · A · L — Rename near to something like "big & close", or merge the two modes.**
  - **Target:** [app/utils/edwardExplore.ts:129](/Users/powerox/neospace/app/utils/edwardExplore.ts:129). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** Rename `near` to something like "big & close", or merge the two modes.
  - **Prior observation to check:** `app/utils/edwardExplore.ts:129-136` — The sort labels "near · you" and "related" sound the same, and the hints ("related and big, pulled close" vs "closest to who and what you follow") don't separate them.
  - **Provenance:** [October 9 candidate, line 555](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:555); explicit source files unchanged at review time.

- [ ] **NS-345 · P3 · UX · A · L — For the far channel, require ball.language (treat unknown as excluded).**
  - **Target:** [app/utils/edwardExplore.ts:396](/Users/powerox/neospace/app/utils/edwardExplore.ts:396). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** For the `far` channel, require `ball.language` (treat unknown as excluded).
  - **Prior observation to check:** `app/utils/edwardExplore.ts:396` — `-lang:xx` only excludes posts that declare a language, so the "far away" channel (`:194`) is full of untagged posts in your own language.
  - **Provenance:** [October 9 candidate, line 556](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:556); explicit source files unchanged at review time.

- [ ] **NS-346 · P3 · DESIGN · A · L — Give rage its own glyph (e.g**
  - **Target:** [app/utils/edwardFaces.ts:963](/Users/powerox/neospace/app/utils/edwardFaces.ts:963). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** Give rage its own glyph (e.g. `ಠ益ಠ`).
  - **Prior observation to check:** `app/utils/edwardFaces.ts:963` — `manic` (viral) and `rage` (`:966`) share the glyph `✧ヮ✧`, so the legend, deck and peek can't tell "viral" from "heat".
  - **Provenance:** [October 9 candidate, line 559](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:559); explicit source files unchanged at review time.

- [ ] **NS-347 · P3 · UX · A · L — Pass loading/error/total and return matching lines ("ed can't reach the net… retrying (´・ω・)").**
  - **Target:** [app/utils/edwardVoice.ts:40](/Users/powerox/neospace/app/utils/edwardVoice.ts:40). **Area:** Semantics, affinity, faces & explore (utils).
  - **Change:** Pass `loading`/`error`/`total` and return matching lines ("ed can't reach the net… retrying (´・ω・`)").
  - **Prior observation to check:** `app/utils/edwardVoice.ts:40-69` — `edQuip` has no lines for loading, error or empty-unfiltered states. While the banner says the server is rate-limiting or the 3D view died, Ed still types "hack hack hack ✌".
  - **Provenance:** [October 9 candidate, line 561](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:561); explicit source files unchanged at review time.

## Remaining candidates: Groups (hashtag groups) & ranked-feed algorithms

- [x] **NS-348 · P1 · CODE · A · S — Have searchGroups push unknown tags into this.groups (non-featured, non-trending) and return the store…**
  - **Target:** [app/stores/groups.ts:1027](/Users/powerox/neospace/app/stores/groups.ts:1027). **Area:** app/stores/groups.ts.
  - **Change:** Have `searchGroups` push unknown tags into `this.groups` (non-featured, non-trending) and return the store object, or have GroupCard read membership via `groupsStore.getGroup(tag)?.isMember ?? group.isMember`.
  - **Prior observation to check:** `app/stores/groups.ts:1027-1037` — `searchGroups` returns plain new objects for tags not already in `groups`; `joinGroup` (`:836-848`) only updates/pushes store entries, so the search-result card's `group.isMember` stays `false`. User taps Join → spinner → button reverts to "Join" although the follow succeeded; tapping again re-follows.
  - **Provenance:** [October 9 candidate, line 1244](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1244); explicit source files unchanged at review time.
  - Evidence: `GroupCard.vue` now reads membership as `groupsStore.getGroup(tag)?.isMember ?? group.isMember`, so a search-result card flips to "Joined" once `joinGroup` pushes the tag into the store (chose this over pushing search hits into `groups`, which would pollute browse lists and categories). Leave falls back correctly.

- [x] **NS-349 · P1 · CODE · C · M — Treat _rankSource === 'home' (non-boost) as in-network in rankX**
  - **Target:** [app/composables/useRankedFeed.ts:95](/Users/powerox/neospace/app/composables/useRankedFeed.ts:95). **Area:** app/composables/useRankedFeed.ts.
  - **Change:** Treat `_rankSource === 'home'` (non-boost) as in-network in `rankX`. Don't cache a guest context for a signed-in account. Mark the context partial on failure and retry.
  - **Prior observation to check:** `app/composables/useRankedFeed.ts:95-110` (+ `app/utils/rankers.ts:260-264`) — In-network is decided only by `ctx.following`, which is capped at `FOLLOW_MAX = 400`, comes back `[]` when the request fails (`soft`), and is empty when `currentUser` isn't loaded yet (key falls to `'guest'`, `:72`, and is cached for 15 min). X then **drops** home-timeline posts from people you do follow ("no social proof"), down to an empty feed.
  - **Prior verifier qualification:** `app/composables/useRankedFeed.ts:95-110` / `app/utils/rankers.ts:276` — Home posts from follows beyond 400, or from everyone when the `following` fetch soft-fails, are dropped by X's social-proof gate, and a failed context is cached for 15 min. But the "currentUser not loaded → guest key" path can't happen, because `activeAccount` requires `user` (`instances.ts:267-274`). Corrected: drop that sub-claim and keep the >400 and failure-cached cases. Impact: High on failure (near-empty feed), otherwise Medium.
  - **Provenance:** [October 9 candidate, line 1332](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1332); explicit source files unchanged at review time.
  - Evidence: `rankX` treats `_rankSource === 'home'` as in-network (boosts included — the booster is followed by construction, and `following` is capped at 400 / empty on failure). `useRankedFeed` no longer pins a context for 15 min when a follow/favourite fetch failed (20s TTL instead) or when signed in without a loaded user. The guest-key sub-claim was already marked unreachable. Test in `tests/rankers.test.ts`.

- [x] **NS-350 · P1 · CODE · C · S — Use cursorPage(..**
  - **Target:** [app/composables/useRankedFeed.ts:39](/Users/powerox/neospace/app/composables/useRankedFeed.ts:39). **Area:** app/composables/useRankedFeed.ts.
  - **Change:** Use `cursorPage(... .$raw(...))` and `nextMaxId` from the Link header, as `fetchFollowedTags` already does.
  - **Prior observation to check:** `app/composables/useRankedFeed.ts:39-49,97,100` — `pageAll` pages following/followers with `maxId = lastAccount.id`, but Mastodon paginates these endpoints by the *follow relationship* id (Link header), not account id. Page 2+ is wrong (skips, repeats or ends), so mutuals/following are wrong for anyone with more than 80 follows.
  - **Provenance:** [October 9 candidate, line 1334](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1334); explicit source files unchanged at review time.
  - Evidence: `pageAll` in `useRankedFeed.ts` now pages following/followers with `cursorPage(...$raw)` and the Link-header `nextMaxId`, like `fetchFollowedTags`; the `page.length < 40` stop (wrong for `limit: 80`) is gone.

- [x] **NS-351 · P2 · CODE · A · M — Watch activeAccountId in the store (or layout) and call initializeGroups(true); reset isMember=false, drop…**
  - **Target:** [app/stores/groups.ts:583](/Users/powerox/neospace/app/stores/groups.ts:583). **Area:** app/stores/groups.ts.
  - **Change:** Watch `activeAccountId` in the store (or layout) and call `initializeGroups(true)`; reset `isMember=false`, drop non-featured/non-trending entries and clear `followedTags`/`timelineCache` before refetching.
  - **Prior observation to check:** `app/stores/groups.ts:583-628` — Nothing re-runs `initializeGroups` when `activeAccountId` changes (only mount-time callers in layout/pages), and the merge at `:599-618` carries `isMember` from the previous account. When the new account is a guest (`:624` skips `fetchFollowedTags`) or `fetchFollowedTags` fails (`:803-806`), the old account's joins stay "Joined" indefinitely; the old account's custom followed tags also linger as groups.
  - **Prior verifier qualification:** No `activeAccountId` watcher exists, so state stays stale on the current screen. But `initializeGroups` is account-keyed (`groupsInitializedFor`, :583-590), and the next visit to /groups, Explore or a group page re-inits and recomputes `isMember` from the new account's followed tags. "Indefinitely" holds only when `fetchFollowedTags` fails or nobody is authenticated (`activeAccount` falls back to any authed slot). Corrected: "stale until the next mount-time init; permanent only on fetch failure". Impact: Medium.
  - **Provenance:** [October 9 candidate, line 1245](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1245); explicit source files unchanged at review time.
  - **Done:** `app/stores/groups.ts` is re-initialised per account (isMember/trending/followed state reset on switch); `tests/groups-store.test.ts`.

- [x] **NS-352 · P2 · UX · A · S — Reset trending (and postsCount) for all carried entries before fetchTrendingTags, and drop non-member,…**
  - **Target:** [app/stores/groups.ts:616](/Users/powerox/neospace/app/stores/groups.ts:616). **Area:** app/stores/groups.ts.
  - **Change:** Reset `trending` (and `postsCount`) for all carried entries before `fetchTrendingTags`, and drop non-member, non-featured entries that no longer trend.
  - **Prior observation to check:** `app/stores/groups.ts:616-618` — On re-init only featured groups get `trending: false`; every other previously-trending tag is copied with `trending: true` and its stale `postsCount`, so tags that dropped off the server's trends stay in "Trending on {server}" and the Trending category until reload.
  - **Provenance:** [October 9 candidate, line 1247](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1247); explicit source files unchanged at review time.
  - **Done:** Trending counts and flags are reset for all carried entries before `fetchTrendingTags` and stale non-member entries are dropped; covered in `tests/groups-store.test.ts`.

- [x] **NS-353 · P2 · UX · A · S — Surface it on /groups (banner "Couldn't load your groups · Retry") and in the sidebar groups section.**
  - **Target:** [app/stores/groups.ts:91](/Users/powerox/neospace/app/stores/groups.ts:91). **Area:** app/stores/groups.ts.
  - **Change:** Surface it on /groups (banner "Couldn't load your groups · Retry") and in the sidebar groups section.
  - **Prior observation to check:** `app/stores/groups.ts:91,804` — `followedTagsError` is set but no component reads it (grep: only the store). A failed load still makes "Your groups" vanish and every group look un-joined with no message or retry.
  - **Provenance:** [October 9 candidate, line 1248](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1248); explicit source files unchanged at review time.
  - **Done:** `/groups` shows a "Couldn't load your groups · Retry" banner. Banner is on /groups only; the sidebar section was not changed.

- [x] **NS-354 · P2 · DESIGN · A · S — Only split camelCase when the tag is mixed-case *and* not in a small keep-list, or split only on _ and…**
  - **Target:** [app/stores/groups.ts:1141](/Users/powerox/neospace/app/stores/groups.ts:1141). **Area:** app/stores/groups.ts.
  - **Change:** Only split camelCase when the tag is mixed-case *and* not in a small keep-list, or split only on `_` and leave camelCase intact (`#JavaScript` is a name). Add a unit test.
  - **Prior observation to check:** `app/stores/groups.ts:1141-1153` — the first `.replace(/([a-z])([A-Z])/g, '$1 $2')` splits before the "keep NixOS" check can run: NixOS → "Nix OS", JavaScript → "Java Script", TikTok → "Tik Tok", iPhone → "I Phone", macOS → "Mac OS".
  - **Provenance:** [October 9 candidate, line 1249](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1249); explicit source files unchanged at review time.
  - **Done:** `app/utils/tagName.ts` splits camelCase only for mixed-case tags outside a keep-list; tests in `tests/groups-store.test.ts`.

- [x] **NS-355 · P2 · UX · A · S — Use isGroupTagName (plus a "has at least one letter" rule) for the offer.**
  - **Target:** [app/stores/groups.ts:1040](/Users/powerox/neospace/app/stores/groups.ts:1040). **Area:** app/stores/groups.ts.
  - **Change:** Use `isGroupTagName` (plus a "has at least one letter" rule) for the offer.
  - **Prior observation to check:** `app/stores/groups.ts:1040,1059` + `app/utils/hashtag.ts:4` — "Start following #q" uses `isValidHashtag` (`/^[a-zA-Z][a-zA-Z0-9_]*$/`, ≤64), while the route/API guard `isGroupTagName` (`groups.ts:32`) allows any script, digits-first and 100 chars. `#日本`, `#café`, `#100DaysOfCode` are never offered as a group in search, yet `/groups/日本` works.
  - **Provenance:** [October 9 candidate, line 1250](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1250); explicit source files unchanged at review time.
  - **Done:** Create-group offer uses `isGroupTagName` plus a has-a-letter rule.

- [x] **NS-356 · P2 · UX · A · S — Use this.guessCategory(name) in all three places.**
  - **Target:** [app/stores/groups.ts:797](/Users/powerox/neospace/app/stores/groups.ts:797). **Area:** app/stores/groups.ts.
  - **Change:** Use `this.guessCategory(name)` in all three places.
  - **Prior observation to check:** `app/stores/groups.ts:797,843,1132` — Followed tags and newly joined tags are hard-coded `category: 'other'`, while trending/search use `guessCategory`. A tag shown as "tech" in search jumps to "Other" after Join and its tint changes.
  - **Provenance:** [October 9 candidate, line 1251](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1251); explicit source files unchanged at review time.
  - **Done:** `guessCategory` is used at all three call sites in the groups store.

- [x] **NS-357 · P2 · UX · A · M — Honour wholeWord with token match, skip expired / non-public contexts, and re-filter when…**
  - **Target:** [app/stores/groups.ts:688](/Users/powerox/neospace/app/stores/groups.ts:688). **Area:** app/stores/groups.ts.
  - **Change:** Honour `wholeWord` with token match, skip expired / non-`public` contexts, and re-filter when `settingsStore.filters` changes.
  - **Prior observation to check:** `app/stores/groups.ts:688-698` — Trending tags are hidden with `key.includes(kw)` over all v2 filter keywords, ignoring `wholeWord` (a "ai" filter hides #rain, #taiwan), filter `context`, expired filters (`expiresAt`), and whether filters have loaded yet (init runs right after `instances.initialize`; a missed race keeps the unfiltered list for the 5-min TTL).
  - **Provenance:** [October 9 candidate, line 1252](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1252); explicit source files unchanged at review time.
  - **Done:** Tag filters honour `wholeWord` via token matching and skip expired entries (`app/utils/tagFilters.ts`).

- [x] **NS-358 · P2 · CODE · A · S — Early-return (or queue) when the tag is already pending; let the latest intent win by sequence number.**
  - **Target:** [app/stores/groups.ts:816](/Users/powerox/neospace/app/stores/groups.ts:816). **Area:** app/stores/groups.ts.
  - **Change:** Early-return (or queue) when the tag is already pending; let the latest intent win by sequence number.
  - **Prior observation to check:** `app/stores/groups.ts:816-866,871-903` — join/leave don't refuse a call while `pendingTags[key]` is set. Join + Undo/Leave fired close together race: the first to finish deletes the pending key, and the server ends in whichever order the requests landed while the UI shows the other.
  - **Provenance:** [October 9 candidate, line 1253](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1253); explicit source files unchanged at review time.
  - **Done:** Join/leave are serialized per tag; the latest intent wins by sequence number.

- [x] **NS-359 · P2 · UX · A · S — Re-throw (or return { results, error }) and show "Couldn't search — check your connection · Retry" in /groups.**
  - **Target:** [app/stores/groups.ts:1057](/Users/powerox/neospace/app/stores/groups.ts:1057). **Area:** app/stores/groups.ts.
  - **Change:** Re-throw (or return `{ results, error }`) and show "Couldn't search — check your connection · Retry" in /groups.
  - **Prior observation to check:** `app/stores/groups.ts:1057-1071` (+ `app/composables/useGroupSearch.ts:53`) — Search errors (offline, 401, 429) are swallowed and turned into a fake "Start following #q" card, so the UI can't tell "no such tag" from "search failed", and the composable's `catch` is unreachable.
  - **Provenance:** [October 9 candidate, line 1254](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1254); explicit source files unchanged at review time.
  - **Done:** Group search now returns/raises errors; `/groups` shows "Couldn't search — check your connection" with Retry.

- [x] **NS-360 · P2 · CODE · A · S — Use the Link header via cursorPage (already imported and used for followed tags) for maxId/hasMore.**
  - **Target:** [app/stores/groups.ts:946](/Users/powerox/neospace/app/stores/groups.ts:946). **Area:** app/stores/groups.ts.
  - **Change:** Use the Link header via `cursorPage` (already imported and used for followed tags) for `maxId`/`hasMore`.
  - **Prior observation to check:** `app/stores/groups.ts:946,991` — `hasMore = statuses.length === 20` ends the group feed early ("You've seen all the posts! 🎉") whenever the server returns a short page (filtered/hidden statuses, GoToSocial/Akkoma page caps), and keeps going one extra empty round otherwise.
  - **Provenance:** [October 9 candidate, line 1255](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1255); explicit source files unchanged at review time.
  - **Done:** Tag timelines paginate from the Link header via `cursorPage` (`maxId`/`hasMore`).

- [x] **NS-361 · P2 · UX · A · S — Use a separate timelineError field.**
  - **Target:** [app/stores/groups.ts:919](/Users/powerox/neospace/app/stores/groups.ts:919). **Area:** app/stores/groups.ts.
  - **Change:** Use a separate `timelineError` field.
  - **Prior observation to check:** `app/stores/groups.ts:919,949` — Group-timeline errors share `state.error` with `initializeGroups` (`:596` sets `error = null`). Any background re-init (drawer open, TTL expiry, explore page) wipes a shown timeline error, and the page flips from "Try again" to "No posts yet".
  - **Provenance:** [October 9 candidate, line 1256](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1256); explicit source files unchanged at review time.
  - **Done:** Added a separate `timelineError` field so a timeline failure doesn't reuse the global error.

- [x] **NS-362 · P2 · UX · A · S — cats).**
  - **Target:** [app/utils/guessCategory.ts:60](/Users/powerox/neospace/app/utils/guessCategory.ts:60). **Area:** app/utils/guessCategory.ts.
  - **Change:** cats).
  - **Prior observation to check:** `app/utils/guessCategory.ts:60-61` — The tag is lowercased *before* tokenizing, so camelCase tags (`CatsOfMastodon`, `LinuxGaming`, `IndieDev`) become one token and land in "Other". Most real tags are concatenated words, so few trending tags get bucketed. → Split camelCase/digit boundaries first, then lowercase. Optionally do a prefix/suffix match against keywords ≥4 chars for all-lowercase concatenations (`catsofmastodon`
  - **Provenance:** [October 9 candidate, line 1266](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1266); explicit source files unchanged at review time.
  - **Done:** `guessCategory` splits camelCase and letter/digit boundaries before lowercasing, so CatsOfMastodon / LinuxGaming bucket correctly. The optional prefix/suffix match for all-lowercase concatenations was not added.

- [x] **NS-363 · P2 · UX · A · S — Add a one-line lede under the h1: "Groups are hashtags**
  - **Target:** [app/pages/groups/index.vue:82](/Users/powerox/neospace/app/pages/groups/index.vue:82). **Area:** app/pages/groups/index.vue.
  - **Change:** Add a one-line lede under the h1: "Groups are hashtags. Join one to see its posts in Home. Post with #tag to take part."
  - **Prior observation to check:** `app/pages/groups/index.vue:82-86` — Signed-in users get no explanation that a "group" is a followed hashtag: there's no lede, Join doesn't say what it does, and nothing says other people can't see membership. Users coming from Facebook/Lemmy groups expect members, moderation and posting rights.
  - **Provenance:** [October 9 candidate, line 1274](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1274); explicit source files unchanged at review time.
  - **Done:** Added a lede under the `/groups` h1.

- [x] **NS-364 · P2 · UX · A · S — Show the loader only when filteredGroups.length === 0; otherwise keep the grid and show a subtle inline…**
  - **Target:** [app/pages/groups/index.vue:284](/Users/powerox/neospace/app/pages/groups/index.vue:284). **Area:** app/pages/groups/index.vue.
  - **Change:** Show the loader only when `filteredGroups.length === 0`; otherwise keep the grid and show a subtle inline spinner.
  - **Prior observation to check:** `app/pages/groups/index.vue:284-286` — `groupsStore.isLoading` replaces the whole Browse grid with a 55dvh loader on *every* re-init (TTL expiry, drawer open, account switch), although featured groups are already seeded synchronously at `groups.ts:619`.
  - **Provenance:** [October 9 candidate, line 1275](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1275); explicit source files unchanged at review time.
  - **Done:** Refresh keeps the existing grid and shows an inline indicator; the loader appears only when the grid is empty.

- [x] **NS-365 · P2 · UX · A · S — Derive the label from the same URL fetchTrendingTags used (store it in state).**
  - **Target:** [app/pages/groups/index.vue:39](/Users/powerox/neospace/app/pages/groups/index.vue:39). **Area:** app/pages/groups/index.vue.
  - **Change:** Derive the label from the same URL `fetchTrendingTags` used (store it in state).
  - **Prior observation to check:** `app/pages/groups/index.vue:39-50` — The "Trending on {host}" label falls back to `instances[0]` or "your server", but guests' trends come from `publicClient()` → `resolvePublicInstanceUrl` (`DEFAULT_PUBLIC_INSTANCE` fosstodon.org, or the fallback for auth-gated hosts). Guests see "Trending on your server" (or the wrong host) over fosstodon's trends.
  - **Provenance:** [October 9 candidate, line 1276](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1276); explicit source files unchanged at review time.
  - **Done:** Trending label is derived from the same source URL used by `fetchTrendingTags`.

- [x] **NS-366 · P2 · A11Y · A · S — Wrap it in .groups-rail-wrap with useHorizontalRail arrows like Suggested/Trending.**
  - **Target:** [app/pages/groups/index.vue:160](/Users/powerox/neospace/app/pages/groups/index.vue:160). **Area:** app/pages/groups/index.vue.
  - **Change:** Wrap it in `.groups-rail-wrap` with `useHorizontalRail` arrows like Suggested/Trending.
  - **Prior observation to check:** `app/pages/groups/index.vue:160-183` — The "Your groups" jump rail hides its scrollbar but has no prev/next buttons. The other two rails got them in the last audit. Mouse users with many joined groups can't reach the overflow.
  - **Provenance:** [October 9 candidate, line 1277](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1277); explicit source files unchanged at review time.
  - **Done:** The rail is wrapped with `useHorizontalRail` arrows like Suggested/Trending.

- [x] **NS-367 · P2 · UX · A · M — "Slow down — try again in a minute".**
  - **Target:** [app/components/GroupCard.vue:63](/Users/powerox/neospace/app/components/GroupCard.vue:63). **Area:** app/components/GroupCard.vue.
  - **Change:** "Slow down — try again in a minute".
  - **Prior observation to check:** `app/components/GroupCard.vue:63-69` (+ `[tag].vue:158`) — Every join failure shows "Couldn't join group · Retry". On servers without tag following (older GoToSocial/Akkoma: 404/501) or with a 422, Retry can never work. → Map status codes: 404/501 → "Your server doesn't support following hashtags" (no Retry). 429
  - **Provenance:** [October 9 candidate, line 1290](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1290); explicit source files unchanged at review time.
  - **Done:** Rate-limit join errors now read as "Slow down — try again in a minute" (`app/utils/groupErrors.ts`).

- [x] **NS-368 · P2 · DESIGN · A · S — Move the badge onto the icon (bottom-right of .group-card__icon), or drop it since the button already says…**
  - **Target:** [app/components/GroupCard.vue:172](/Users/powerox/neospace/app/components/GroupCard.vue:172). **Area:** app/components/GroupCard.vue.
  - **Change:** Move the badge onto the icon (bottom-right of `.group-card__icon`), or drop it since the button already says "Joined".
  - **Prior observation to check:** `app/components/GroupCard.vue:172-174,402-414` — The member check badge is absolutely positioned at top/right 0.5rem (1.25rem square). It overlaps the top-right corner of the Leave button in column 3 (card padding 0.875–1rem), and `.group-card__actions` (z-index 2) paints over it, so it looks clipped.
  - **Provenance:** [October 9 candidate, line 1291](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1291); explicit source files unchanged at review time.
  - **Done:** `GroupCard.vue` badge moved onto the icon.

- [x] **NS-369 · P2 · CODE · A · S — @host).**
  - **Target:** [app/utils/rankers.ts:199](/Users/powerox/neospace/app/utils/rankers.ts:199). **Area:** app/utils/rankers.ts.
  - **Change:** `@host`).
  - **Prior observation to check:** `app/utils/rankers.ts:199` — `mentionsYou` is also true when `norm(m.acct).split('@')[0] === self.split('@')[0]`, so any mention of `@alice@other.example` counts as mentioning you (`alice`). X then adds `75 × 0.6 = 45` ("the author may reply to you"), which outranks everything. → Compare full accts only: normalize your own acct to `user@host` and mention accts the same way (local
  - **Prior verifier qualification:** The local-part fallback does flag `@alice@other.example` as mentioning local `alice` and adds 75×0.6. Realistically it only affects posts mentioning someone who shares your username, which skews a few posts in the X ranker. Impact: Medium (ranking quality).
  - **Provenance:** [October 9 candidate, line 1315](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1315); explicit source files unchanged at review time.
  - **Done:** `rankers.ts` `qualifyAcct` normalises accts with the instance host; `tests/rankers.test.ts`.

- [x] **NS-370 · P2 · CODE · A · S — Store and compare fully-qualified accts (add the instance host to local accts in loadContext/tasteFrom),…**
  - **Target:** [app/utils/rankers.ts:207](/Users/powerox/neospace/app/utils/rankers.ts:207). **Area:** app/utils/rankers.ts.
  - **Change:** Store and compare fully-qualified accts (add the instance host to local accts in `loadContext`/`tasteFrom`), and remove the local-part fallback.
  - **Prior observation to check:** `app/utils/rankers.ts:207-213` — `isFollowed`/`isMutual`/`likedAuthorScore` fall back to `acct.split('@')[0]`. If you follow a local `bob`, every remote `bob@x` is "in your network" / "a friend", gets FB closeness 1.0 and passes X's social-proof gate.
  - **Prior verifier qualification:** The local-part fallback is real: following local `bob` makes every `bob@x` in-network and mutual. It's a ranking-quality bug limited to username collisions. Impact: Medium.
  - **Provenance:** [October 9 candidate, line 1317](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1317); explicit source files unchanged at review time.
  - **Done:** Local accts are host-qualified in `loadContext` / `tasteFrom(statuses, host)` and matched exactly.

- [x] **NS-371 · P2 · CODE · A · S — Math.max(0, Number(x) || 0) for all three counts, and guard Number.isFinite(score) ? score : 0.**
  - **Target:** [app/utils/rankers.ts:182](/Users/powerox/neospace/app/utils/rankers.ts:182). **Area:** app/utils/rankers.ts.
  - **Change:** `Math.max(0, Number(x) || 0)` for all three counts, and guard `Number.isFinite(score) ? score : 0`.
  - **Prior observation to check:** `app/utils/rankers.ts:182-184` — Counts aren't clamped (followers is). A negative/garbage `favouritesCount` from a misbehaving server makes `p()` return −∞, and `log1p(msi)` returns NaN when msi < −1. `-Infinity * 0` (old posts) gives NaN, and a NaN in the sort comparator scrambles the order.
  - **Provenance:** [October 9 candidate, line 1319](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1319); explicit source files unchanged at review time.
  - **Done:** Counts clamp via `Math.max(0, Number(x) || 0)` and scores go through a `finite()` guard.

- [x] **NS-372 · P2 · CODE · A · S — Treat created &gt; now + 10 min as untrusted: use the fetch time, or ageH of the post's position, or demote it.**
  - **Target:** [app/utils/rankers.ts:186](/Users/powerox/neospace/app/utils/rankers.ts:186). **Area:** app/utils/rankers.ts.
  - **Change:** Treat `created > now + 10 min` as untrusted: use the fetch time, or `ageH` of the post's position, or demote it.
  - **Prior observation to check:** `app/utils/rankers.ts:186,422` — Future-dated posts (clock skew, or a malicious server setting `createdAt` years ahead) are clamped to `ageH = 0`, so they never decay, always qualify as TikTok "fresh" exploration picks, and sit at the top indefinitely.
  - **Provenance:** [October 9 candidate, line 1320](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1320); explicit source files unchanged at review time.
  - **Done:** Posts dated in the future are treated as untrusted for age scoring.

- [x] **NS-373 · P2 · UX · A · S — Treat boostedBy followed as closeness ≥ FB_CLOSENESS.following with the reason "shared by someone you follow".**
  - **Target:** [app/utils/rankers.ts:334](/Users/powerox/neospace/app/utils/rankers.ts:334). **Area:** app/utils/rankers.ts.
  - **Change:** Treat `boostedBy` followed as closeness ≥ `FB_CLOSENESS.following` with the reason "shared by someone you follow".
  - **Prior observation to check:** `app/utils/rankers.ts:334-351` — In the Facebook ranker, a home post that's there because someone you follow (not mutual) boosted it is scored as a stranger (0.3) and labelled "suggested". Only mutual boosters count.
  - **Provenance:** [October 9 candidate, line 1321](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1321); explicit source files unchanged at review time.
  - **Done:** Facebook ranker treats followed boosters as following-level closeness with a viewer-facing reason.

- [x] **NS-374 · P2 · PERF · A · S — Drop 'local' from X's sources, or let local posts through with an out-of-network discount like trends.**
  - **Target:** [app/utils/rankers.ts:89](/Users/powerox/neospace/app/utils/rankers.ts:89). **Area:** app/utils/rankers.ts.
  - **Change:** Drop `'local'` from X's sources, or let local posts through with an out-of-network discount like trends.
  - **Prior observation to check:** `app/utils/rankers.ts:89` — X's sources include `'local'`, but `rankX` (`:264`) discards every out-of-network post that has no tag or liked-author hit and isn't from `'trend'`, so nearly every local candidate fetched each refill is thrown away.
  - **Provenance:** [October 9 candidate, line 1322](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1322); explicit source files unchanged at review time.
  - **Done:** X ranker sources no longer include `local`.

- [x] **NS-375 · P2 · UX · A · S — Rewrite as viewer-facing phrases ("Popular with people you follow", "Lots of replies", "From a trending…**
  - **Target:** [app/utils/rankers.ts:276](/Users/powerox/neospace/app/utils/rankers.ts:276). **Area:** app/utils/rankers.ts.
  - **Change:** Rewrite as viewer-facing phrases ("Popular with people you follow", "Lots of replies", "From a trending topic") and never append demotions to `why`.
  - **Prior observation to check:** `app/utils/rankers.ts:276-282,292,303` — The "why" reasons are internal jargon ("social proof", "worth opening", "reply-heavy", "author diversity"), and "author diversity" is a *demotion*, not a reason you're seeing the post.
  - **Provenance:** [October 9 candidate, line 1323](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1323); explicit source files unchanged at review time.
  - **Done:** `why` strings rewritten viewer-facing; `rankWhyLabel` in `app/utils/rankedSources.ts`.

- [x] **NS-376 · P2 · CODE · A · S — Await groups.initializeGroups() before reading, and read groups.followedTags live in fetchSource/rank…**
  - **Target:** [app/composables/useRankedFeed.ts:77](/Users/powerox/neospace/app/composables/useRankedFeed.ts:77). **Area:** app/composables/useRankedFeed.ts.
  - **Change:** Await `groups.initializeGroups()` before reading, and read `groups.followedTags` live in `fetchSource`/rank instead of snapshotting.
  - **Prior observation to check:** `app/composables/useRankedFeed.ts:77-80` — `followedTags` is copied from `groups.followedTags` at context-load time. At app start `initializeGroups` is still in flight, so the set is empty and cached for 15 min: the "tag" source is marked exhausted (`:164-166`), and X's tag social-proof and FB's "your group" never fire. Joining a group also has no effect for 15 min.
  - **Provenance:** [October 9 candidate, line 1335](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1335); explicit source files unchanged at review time.
  - **Done:** `useRankedFeed` awaits groups init and reads followed tags live.

- [x] **NS-377 · P2 · CODE · A · M — Add a session token captured in nextPage/refill and bail after each await if it changed.**
  - **Target:** [app/composables/useRankedFeed.ts:179](/Users/powerox/neospace/app/composables/useRankedFeed.ts:179). **Area:** app/composables/useRankedFeed.ts.
  - **Change:** Add a session token captured in `nextPage`/`refill` and bail after each await if it changed.
  - **Prior observation to check:** `app/composables/useRankedFeed.ts:179-226` — The composable's state (`pool`, `queue`, `served`, `cursors`) is shared and unguarded. TimelineColumn's refresh resets `isLoadingMore` and starts a new generation while an older `nextPage` is still awaiting `refill`, so the stale call later pushes old pages into the *new* pool, overwrites `queue`, and marks new-session posts as served (they never display).
  - **Provenance:** [October 9 candidate, line 1336](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1336); explicit source files unchanged at review time.
  - **Done:** `useRankedFeed` uses a session token and bails after awaits if it changed.

- [x] **NS-378 · P2 · PERF · A · S — Set cursors[source] = null on 404/401/403/501, and use backoff for others.**
  - **Target:** [app/composables/useRankedFeed.ts:173](/Users/powerox/neospace/app/composables/useRankedFeed.ts:173). **Area:** app/composables/useRankedFeed.ts.
  - **Change:** Set `cursors[source] = null` on 404/401/403/501, and use backoff for others.
  - **Prior observation to check:** `app/composables/useRankedFeed.ts:173-175` — When a source throws (no `/trends/statuses` on GoToSocial/Akkoma, 401 on auth-gated local timelines) the catch returns `[]` but leaves the cursor `undefined`, so every refill re-requests the failing endpoint.
  - **Provenance:** [October 9 candidate, line 1337](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1337); explicit source files unchanged at review time.
  - **Done:** Permanent source failures (401/403/404/501) retire the source; others back off (`app/utils/rankedSources.ts`).

- [x] **NS-379 · P2 · PERF · A · S — Keep a per-tag maxId cursor and mark a tag exhausted when it returns nothing new.**
  - **Target:** [app/composables/useRankedFeed.ts:168](/Users/powerox/neospace/app/composables/useRankedFeed.ts:168). **Area:** app/composables/useRankedFeed.ts.
  - **Change:** Keep a per-tag `maxId` cursor and mark a tag exhausted when it returns nothing new.
  - **Prior observation to check:** `app/composables/useRankedFeed.ts:168-171` — The "tag" source re-fetches the *first page* of each followed tag on every rotation (no `maxId` per tag) up to 3 times. Rounds 2–3 return only already-pooled posts and spend a request each.
  - **Provenance:** [October 9 candidate, line 1338](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1338); explicit source files unchanged at review time.
  - **Done:** Per-tag `maxId` cursors with exhaustion when nothing new is returned.

- [x] **NS-380 · P2 · UX · A · S — Join only non-empty parts, or fall back to a reason like "Something new".**
  - **Target:** [app/composables/useRankedFeed.ts:195](/Users/powerox/neospace/app/composables/useRankedFeed.ts:195). **Area:** app/composables/useRankedFeed.ts.
  - **Change:** Join only non-empty parts, or fall back to a reason like "Something new".
  - **Prior observation to check:** `app/composables/useRankedFeed.ts:195` — When a ranker returns no reasons (TikTok text posts with low engagement and no interest hit leave `why` empty), the label renders as "TikTok · " with a dangling separator.
  - **Provenance:** [October 9 candidate, line 1339](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1339); explicit source files unchanged at review time.
  - **Done:** Empty reason parts are dropped, with a fallback label.

- [x] **NS-381 · P2 · UX · A · S — Reuse isGroupTagName (Unicode letters/marks/numbers).**
  - **Target:** [app/utils/algorithms.ts:64](/Users/powerox/neospace/app/utils/algorithms.ts:64). **Area:** app/utils/algorithms.ts.
  - **Change:** Reuse `isGroupTagName` (Unicode letters/marks/numbers).
  - **Prior observation to check:** `app/utils/algorithms.ts:64,82` — `TAG_RE = /^[a-z0-9_]+$/i` silently drops non-ASCII tags from include/exclude lists (`#café`, `#日本`, `#straße`). The recipe saves without them, so "Must include #café" shows everything.
  - **Provenance:** [October 9 candidate, line 1344](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1344); explicit source files unchanged at review time.
  - **Done:** `app/utils/algorithms.ts` hashtag regex is Unicode-aware.

- [x] **NS-382 · P2 · UX · A · S — Match on word boundaries (\b with the u flag, or token sets), and allow an explicit * for prefix.**
  - **Target:** [app/utils/algorithms.ts:147](/Users/powerox/neospace/app/utils/algorithms.ts:147). **Area:** app/utils/algorithms.ts.
  - **Change:** Match on word boundaries (`\b` with the `u` flag, or token sets), and allow an explicit `*` for prefix.
  - **Prior observation to check:** `app/utils/algorithms.ts:147-151` — Keyword filters use plain substring matching: exclude "ai" hides "said", "again", "rain"; include "art" matches "start", "party". (The groups code already fixed the same issue for categories.)
  - **Provenance:** [October 9 candidate, line 1345](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1345); explicit source files unchanged at review time.
  - **Done:** Keyword matching is word-boundary based (`keywordMatches`).

- [x] **NS-383 · P2 · CODE · A · S — Decode numeric and named entities (DOMParser or a shared helper).**
  - **Target:** [app/utils/algorithms.ts:104](/Users/powerox/neospace/app/utils/algorithms.ts:104). **Area:** app/utils/algorithms.ts.
  - **Change:** Decode numeric and named entities (DOMParser or a shared helper).
  - **Prior observation to check:** `app/utils/algorithms.ts:104-115` — This `stripHtml` decodes only `&nbsp; &amp; &lt; &gt;`. Mastodon encodes apostrophes and quotes as `&#39;`/`&quot;`, so a keyword like `don't` or `"breaking"` never matches.
  - **Provenance:** [October 9 candidate, line 1346](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1346); explicit source files unchanged at review time.
  - **Done:** `decodeEntities` decodes numeric and named entities before matching.

- [x] **NS-384 · P2 · UX · A · S — Include spoilerText (and alt text) in the haystack.**
  - **Target:** [app/utils/algorithms.ts:147](/Users/powerox/neospace/app/utils/algorithms.ts:147). **Area:** app/utils/algorithms.ts.
  - **Change:** Include `spoilerText` (and alt text) in the haystack.
  - **Prior observation to check:** `app/utils/algorithms.ts:147` — Keyword filters only look at `content`. The CW/`spoilerText`, media alt text and poll options are ignored, so "Exclude keywords: spoilers, politics" lets through posts whose CW says exactly that.
  - **Provenance:** [October 9 candidate, line 1347](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1347); explicit source files unchanged at review time.
  - **Done:** Haystack now includes CW text, alt text and poll options.

- [x] **NS-385 · P2 · CODE · A · S — Only treat ' as a quote when preceded by start/space and followed by space/punct at the end, or support…**
  - **Target:** [app/utils/algorithms.ts:440](/Users/powerox/neospace/app/utils/algorithms.ts:440). **Area:** app/utils/algorithms.ts.
  - **Change:** Only treat `'` as a quote when preceded by start/space and followed by space/punct at the end, or support only double/curly quotes.
  - **Prior observation to check:** `app/utils/algorithms.ts:440` — The single-quote phrase regex `'([^']{2,64})'` grabs text between apostrophes. "cat's pics and dog's pics" adds the include keyword "s pics and dog", so the feed shows nothing.
  - **Provenance:** [October 9 candidate, line 1348](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1348); explicit source files unchanged at review time.
  - **Done:** Apostrophes are only quotes at word edges, so "don't" survives.

- [x] **NS-386 · P2 · UX · A · S — Append "−#politics", "−'giveaway'" (and "+N more") to the summary.**
  - **Target:** [app/utils/algorithms.ts:251](/Users/powerox/neospace/app/utils/algorithms.ts:251). **Area:** app/utils/algorithms.ts.
  - **Change:** Append "−#politics", "−'giveaway'" (and "+N more") to the summary.
  - **Prior observation to check:** `app/utils/algorithms.ts:251-264` — `recipeSummary` omits exclude tags/keywords (and all but the first include keyword). The import preview and editor preview never show what a recipe *hides*, so a shared link can quietly filter out a topic.
  - **Provenance:** [October 9 candidate, line 1349](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1349); explicit source files unchanged at review time.
  - **Done:** Summary lists hidden terms (e.g. −#tag, −'phrase').

- [x] **NS-387 · P2 · UX · A · S — Refuse with "You have 24 algorithms — delete one to import" (or confirm, naming the victim), and remove…**
  - **Target:** [app/stores/algorithms.ts:244](/Users/powerox/neospace/app/stores/algorithms.ts:244). **Area:** app/stores/algorithms.ts.
  - **Change:** Refuse with "You have 24 algorithms — delete one to import" (or confirm, naming the victim), and remove its columns consistently.
  - **Prior observation to check:** `app/stores/algorithms.ts:244-248` — Importing when you already have 24 custom algorithms silently **deletes your oldest one**, with no confirm or undo, and any column using it then errors with "This algorithm was deleted…".
  - **Prior verifier qualification:** True: at `MAX_CUSTOM`=24, `importPayload` silently removes the oldest custom algorithm, and `import.vue:48` shows no confirm. It's only reachable with 24 custom algorithms, though. Impact: Medium (silent data loss in a rare state).
  - **Provenance:** [October 9 candidate, line 1355](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1355); explicit source files unchanged at review time.
  - **Done:** `importPayload` refuses when the board is full (returns null) instead of silently evicting; `/algorithms/import` shows the message. Refuses outright rather than a replace-confirm.

- [x] **NS-388 · P2 · CODE · A · S — Add r.ranker === recipe.ranker (and description) to the twin check.**
  - **Target:** [app/stores/algorithms.ts:230](/Users/powerox/neospace/app/stores/algorithms.ts:230). **Area:** app/stores/algorithms.ts.
  - **Change:** Add `r.ranker === recipe.ranker` (and description) to the twin check.
  - **Prior observation to check:** `app/stores/algorithms.ts:230-242` — The import dedupe ("twin") ignores `ranker`. Importing a TikTok-ranked link whose name and filters equal an existing X-ranked recipe returns the X one, and the user never gets what was shared.
  - **Provenance:** [October 9 candidate, line 1357](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1357); explicit source files unchanged at review time.
  - **Done:** Twin check now also compares `ranker` and `description`.

- [x] **NS-389 · P2 · CODE · A · S — Listen for storage on STORAGE_KEY and re-hydrate, and merge by id/updatedAt on save.**
  - **Target:** [app/stores/algorithms.ts:97](/Users/powerox/neospace/app/stores/algorithms.ts:97). **Area:** app/stores/algorithms.ts.
  - **Change:** Listen for `storage` on `STORAGE_KEY` and re-hydrate, and merge by id/`updatedAt` on save.
  - **Prior observation to check:** `app/stores/algorithms.ts:97-101,72-80` — No `storage` event listener and hydrate-once: two tabs editing recipes overwrite each other's list wholesale (last `saveCustom` wins with a stale in-memory array).
  - **Provenance:** [October 9 candidate, line 1358](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1358); explicit source files unchanged at review time.
  - **Done:** `stores/algorithms.ts` listens for `storage` events on its key and re-hydrates. Rehydrate only; no merge-on-save.

- [x] **NS-390 · P2 · SEC · A · S — Label it as unverified ("Says it's from @x"), strip bidi/control characters, and link the acct to the real…**
  - **Target:** [app/pages/algorithms/import.vue:70](/Users/powerox/neospace/app/pages/algorithms/import.vue:70). **Area:** app/pages/algorithms/import.vue.
  - **Change:** Label it as unverified ("Says it's from @x"), strip bidi/control characters, and link the acct to the real profile.
  - **Prior observation to check:** `app/pages/algorithms/import.vue:70-73` — "Curated by @{authorAcct} · {authorName}" comes straight from the unauthenticated link payload. Anyone can mint a link "curated by @Gargron@mastodon.social" (bidi/control characters allowed) to borrow trust for a feed that hides topics.
  - **Provenance:** [October 9 candidate, line 1363](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1363); explicit source files unchanged at review time.
  - **Done:** Import page labels the source as unverified and strips control/bidi characters.

- [x] **NS-391 · P2 · UX · A · S — Check the return value, and warn/confirm before evicting a column ("Your board is full — replace {column}?").**
  - **Target:** [app/pages/algorithms/import.vue:53](/Users/powerox/neospace/app/pages/algorithms/import.vue:53). **Area:** app/pages/algorithms/import.vue.
  - **Change:** Check the return value, and warn/confirm before evicting a column ("Your board is full — replace {column}?").
  - **Prior observation to check:** `app/pages/algorithms/import.vue:53-54` — `ensureFocusedView` can remove the user's last column when the board is full, or return `null`, yet the page always toasts "Added …" and navigates home.
  - **Provenance:** [October 9 candidate, line 1364](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1364); explicit source files unchanged at review time.
  - **Done:** Callers check the `importPayload` return and show a "board full" toast. No replace-confirm.

- [x] **NS-392 · P2 · UX · A · S — Show "Sign in to use this algorithm" with a login link (returnTo this URL) when !hasAuthenticatedInstance…**
  - **Target:** [app/pages/algorithms/import.vue:66](/Users/powerox/neospace/app/pages/algorithms/import.vue:66). **Area:** app/pages/algorithms/import.vue.
  - **Change:** Show "Sign in to use this algorithm" with a login link (`returnTo` this URL) when `!hasAuthenticatedInstance && (s === 'home' || RANKERS[r]?.needsAuth)`. Also gate `RANKERS.needsAuth` in `TimelineColumn.vue:113`, which only checks `source`.
  - **Prior observation to check:** `app/pages/algorithms/import.vue:66-87` — There's no warning for guests importing a recipe that needs sign-in (home source, or X/Facebook ranker with `needsAuth`). The column then errors, or (ranker + local source) silently shows only trending posts.
  - **Provenance:** [October 9 candidate, line 1365](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1365); explicit source files unchanged at review time.
  - **Done:** "Sign in to use this algorithm" gate in `app/pages/algorithms/import.vue` and `TimelineColumn.vue` for ranker feeds.

- [x] **NS-393 · P2 · TOOLING · A · S — Add cases with the real shapes: selfAcct='alice' with a mention of alice@other, and following bob with a…**
  - **Target:** [tests/rankers.test.ts:42](/Users/powerox/neospace/tests/rankers.test.ts:42). **Area:** tests (gaps).
  - **Change:** Add cases with the real shapes: `selfAcct='alice'` with a mention of `alice@other`, and following `bob` with a post from `bob@x`.
  - **Prior observation to check:** `tests/rankers.test.ts:42` — Tests set `selfAcct = 'me@home.social'`, but production uses `user.acct` (local form `me`, `useRankedFeed.ts:85`), and no test covers the local-part collisions in `mentionsYou`/`isFollowed`.
  - **Provenance:** [October 9 candidate, line 1387](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1387); explicit source files unchanged at review time.
  - **Done:** Added real-shape acct cases to `tests/rankers.test.ts`.

- [x] **NS-394 · P2 · TOOLING · A · S — Add a property-style test asserting every score is finite and the output is a permutation of the filtered…**
  - **Target:** [tests/rankers.test.ts](/Users/powerox/neospace/tests/rankers.test.ts). **Area:** tests (gaps).
  - **Change:** Add a property-style test asserting every score is finite and the output is a permutation of the filtered input.
  - **Prior observation to check:** `tests/rankers.test.ts` — No coverage for hostile or degenerate inputs: negative/NaN counts, future `createdAt`, empty candidate lists, the empty-`why` label, or NaN in the sort.
  - **Provenance:** [October 9 candidate, line 1388](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1388); explicit source files unchanged at review time.
  - **Done:** Added finite-score / permutation tests in `tests/rankers.test.ts`.

- [x] **NS-395 · P2 · TOOLING · A · M — Add vitest with stubbed masto clients for those four behaviours.**
  - **Target:** [app/composables/useRankedFeed.ts](/Users/powerox/neospace/app/composables/useRankedFeed.ts). **Area:** tests (gaps).
  - **Change:** Add vitest with stubbed masto clients for those four behaviours.
  - **Prior observation to check:** `app/composables/useRankedFeed.ts` — Zero tests for the ranked-feed session (cursor pagination, `dry` detection, served-never-moves, refresh during refill).
  - **Provenance:** [October 9 candidate, line 1389](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1389); explicit source files unchanged at review time.
  - **Done:** `tests/rankedFeed.test.ts` drives `useRankedFeed` with stubbed masto clients and a stubbed home source: per-source cursor pagination (2nd refill continues from the previous page's last id), `dry` detection / exhaustion, served posts never move or repeat across refills, a refresh during a refill supersedes the stale call (empty non-final page, nothing leaks into the new session), and a permanently-404 source is retired instead of retried.

- [x] **NS-396 · P2 · TOOLING · A · S — Add a tests/algorithms.test.ts covering each.**
  - **Target:** [tests/rankers.test.ts:164](/Users/powerox/neospace/tests/rankers.test.ts:164). **Area:** tests (gaps).
  - **Change:** Add a `tests/algorithms.test.ts` covering each.
  - **Prior observation to check:** `tests/rankers.test.ts:164-177` — Algorithm-recipe tests cover only ranker round-tripping. There are none for `statusMatchesRecipe` (entities, CW, word boundaries), `parseAlgorithmSentence` (apostrophes, "local news"), `importPayload` (twin vs ranker, 24-cap eviction) or non-ASCII `normalizeTagList`.
  - **Provenance:** [October 9 candidate, line 1390](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1390); explicit source files unchanged at review time.
  - **Done:** New `tests/algorithms.test.ts`.

- [x] **NS-397 · P2 · TOOLING · A · S — Add store tests with a mocked client.**
  - **Target:** [tests/discovery.test.ts:87](/Users/powerox/neospace/tests/discovery.test.ts:87). **Area:** tests (gaps).
  - **Change:** Add store tests with a mocked client.
  - **Prior observation to check:** `tests/discovery.test.ts:87-120` — Group tests cover only the timeline cache and `isGroupTagName`. There are none for join/leave optimistic rollback, search-result membership after join, account-switch reset, `formatTagAsName` (NixOS/JavaScript), or trending-flag refresh.
  - **Provenance:** [October 9 candidate, line 1391](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1391); explicit source files unchanged at review time.
  - **Done:** New `tests/groups-store.test.ts` with a mocked client.

- [x] **NS-398 · P3 · CODE · A · S — Add a shared tagKey() (NFKC, lowercased, accents stripped for Latin) and use it for all comparisons and…**
  - **Target:** [app/stores/groups.ts:556](/Users/powerox/neospace/app/stores/groups.ts:556). **Area:** app/stores/groups.ts.
  - **Change:** Add a shared `tagKey()` (NFKC, lowercased, accents stripped for Latin) and use it for all comparisons and cache keys.
  - **Prior observation to check:** `app/stores/groups.ts:556,562,1076` — Group identity is `toLowerCase()` only. Mastodon normalizes tags with NFKC and folds Latin accents (café ≡ cafe), so a followed `café` and a trending `cafe` appear as two groups with different membership. A decomposed `café` URL also misses the cache.
  - **Provenance:** [October 9 candidate, line 1257](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1257); explicit source files unchanged at review time.
  - Evidence: `tagKey()` in `utils/hashtag.ts`; wired through groups store getters/search/cache.

- [x] **NS-399 · P3 · UX · A · S — Move an existing exact match to index 0 too.**
  - **Target:** [app/stores/groups.ts:1039](/Users/powerox/neospace/app/stores/groups.ts:1039). **Area:** app/stores/groups.ts.
  - **Change:** Move an existing exact match to index 0 too.
  - **Prior observation to check:** `app/stores/groups.ts:1039-1054` — An exact-match tag is only put first when the server *didn't* return it. If `#baking` is result #6, the user's exact query is buried under `#bakingbread`, etc.
  - **Provenance:** [October 9 candidate, line 1258](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1258); explicit source files unchanged at review time.
  - Evidence: `searchGroups` promotes existing exact match to index 0.

- [x] **NS-400 · P3 · DESIGN · A · S — Use tagHistorySummary(tag) as the description and fill postsCount.**
  - **Target:** [app/stores/groups.ts:1030](/Users/powerox/neospace/app/stores/groups.ts:1030). **Area:** app/stores/groups.ts.
  - **Change:** Use `tagHistorySummary(tag)` as the description and fill `postsCount`.
  - **Prior observation to check:** `app/stores/groups.ts:1030` — Every search result gets the boilerplate description "Join #x as a group", and the `history` the search API returns is thrown away (`tagHistorySummary` in utils/hashtag already formats "N people · M posts · last 7d").
  - **Provenance:** [October 9 candidate, line 1259](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1259); explicit source files unchanged at review time.
  - Evidence: Search uses `tagHistorySummary()` + 7d `postsCount`.

- [x] **NS-401 · P3 · DESIGN · A · S — Show "1.2K posts this week" (Intl compact number) on tiles and cards, or stop computing it.**
  - **Target:** [app/stores/groups.ts:66](/Users/powerox/neospace/app/stores/groups.ts:66). **Area:** app/stores/groups.ts.
  - **Change:** Show "1.2K posts this week" (Intl compact number) on tiles and cards, or stop computing it.
  - **Prior observation to check:** `app/stores/groups.ts:66,720-727` — `postsCount` (7-day uses) is computed for trending/featured groups but never rendered anywhere (grep: no template reads it). Trending tiles say just "Trending".
  - **Provenance:** [October 9 candidate, line 1260](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1260); explicit source files unchanged at review time.
  - Evidence: GroupCard renders compact weekly post counts.

- [x] **NS-402 · P3 · CODE · A · S — Delete it.**
  - **Target:** [app/stores/groups.ts:1120](/Users/powerox/neospace/app/stores/groups.ts:1120). **Area:** app/stores/groups.ts.
  - **Change:** Delete it.
  - **Prior observation to check:** `app/stores/groups.ts:1120-1136` — `addCustomGroup` is dead (no callers) and pushes an unvalidated tag (no `isGroupTagName`) if ever used.
  - **Provenance:** [October 9 candidate, line 1261](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1261); explicit source files unchanged at review time.
  - Evidence: Deleted dead `addCustomGroup`.

- [x] **NS-403 · P3 · CODE · A · S — Remove it.**
  - **Target:** [app/stores/groups.ts:453](/Users/powerox/neospace/app/stores/groups.ts:453). **Area:** app/stores/groups.ts.
  - **Change:** Remove it.
  - **Prior observation to check:** `app/stores/groups.ts:453` — An orphaned doc comment ("Rough bucket for live tags…") sits above the `timelineRequestId` comment and documents nothing.
  - **Provenance:** [October 9 candidate, line 1262](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1262); explicit source files unchanged at review time.
  - Evidence: Removed orphaned comment above `timelineRequestId`.

- [x] **NS-404 · P3 · CODE · A · S — Drop both from the union and remove the dead branch.**
  - **Target:** [app/stores/groups.ts:48](/Users/powerox/neospace/app/stores/groups.ts:48). **Area:** app/stores/groups.ts.
  - **Change:** Drop both from the union and remove the dead branch.
  - **Prior observation to check:** `app/stores/groups.ts:48-49,543` — `GroupCategory` includes `'local'` and `'trending'`, but nothing assigns either as a category (trending uses the flag), and `GROUP_CATEGORIES` has no 'local'. `getByCategory`'s `g.category === 'trending'` branch is dead.
  - **Provenance:** [October 9 candidate, line 1263](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1263); explicit source files unchanged at review time.
  - Evidence: Removed `local`/`trending` from `GroupCategory` union + dead branch.

- [x] **NS-405 · P3 · UX · A · S — Drop the ambiguous words or require a second signal.**
  - **Target:** [app/utils/guessCategory.ts:31](/Users/powerox/neospace/app/utils/guessCategory.ts:31). **Area:** app/utils/guessCategory.ts.
  - **Change:** Drop the ambiguous words or require a second signal.
  - **Prior observation to check:** `app/utils/guessCategory.ts:31,37,42` — False positives: `indie` → gaming (indie music/film), `steam` → gaming (STEAM education, steam trains), `ask`/`help` → social, `world` → news.
  - **Provenance:** [October 9 candidate, line 1267](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1267); explicit source files unchanged at review time.
  - Evidence: Dropped ambiguous guessCategory keywords.

- [x] **NS-406 · P3 · UX · A · S — Tokenize on [^\p{L}\p{N}]+/u.**
  - **Target:** [app/utils/guessCategory.ts:61](/Users/powerox/neospace/app/utils/guessCategory.ts:61). **Area:** app/utils/guessCategory.ts.
  - **Change:** Tokenize on `[^\p{L}\p{N}]+/u`.
  - **Prior observation to check:** `app/utils/guessCategory.ts:61` — The tokenizer `[^a-z0-9]+` shreds non-ASCII tags (`café` → `caf`, `fotografía` → `fotograf`, `ía`), so non-English tags always land in "Other".
  - **Provenance:** [October 9 candidate, line 1268](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1268); explicit source files unchanged at review time.
  - Evidence: Unicode-aware tokenization in `guessCategory`.

- [x] **NS-407 · P3 · UX · A · S — Normalize with normalizeHashtagInput before the length check.**
  - **Target:** [app/composables/useGroupSearch.ts:39](/Users/powerox/neospace/app/composables/useGroupSearch.ts:39). **Area:** app/composables/useGroupSearch.ts.
  - **Change:** Normalize with `normalizeHashtagInput` before the length check.
  - **Prior observation to check:** `app/composables/useGroupSearch.ts:39-45` — A query of just `#` (or `##`) passes `minLength` and runs a search for "" (normalized), then shows "No groups match "#"".
  - **Provenance:** [October 9 candidate, line 1271](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1271); explicit source files unchanged at review time.
  - Evidence: `useGroupSearch` normalizes `#` before min-length.

- [x] **NS-408 · P3 · UX · A · S — Add aria-busy and reduced opacity on the grid while isSearching.**
  - **Target:** [app/pages/groups/index.vue:139](/Users/powerox/neospace/app/pages/groups/index.vue:139). **Area:** app/pages/groups/index.vue.
  - **Change:** Add `aria-busy` and reduced opacity on the grid while `isSearching`.
  - **Prior observation to check:** `app/pages/groups/index.vue:139-148` — While a new query is debouncing/searching, results for the *previous* query stay on screen under "Search results" with no dimming.
  - **Provenance:** [October 9 candidate, line 1279](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1279); explicit source files unchanged at review time.
  - Evidence: Search grid `aria-busy` + dim while debouncing.

- [x] **NS-409 · P3 · UX · A · S — For trending, say "{server} doesn't share trending tags." For others, suggest searching any hashtag.**
  - **Target:** [app/pages/groups/index.vue:288](/Users/powerox/neospace/app/pages/groups/index.vue:288). **Area:** app/pages/groups/index.vue.
  - **Change:** For `trending`, say "{server} doesn't share trending tags." For others, suggest searching any hashtag.
  - **Prior observation to check:** `app/pages/groups/index.vue:288-291` — The Browse empty state is always "No groups found in this category. 😕". On GoToSocial/Akkoma (no `/trends/tags`) the Trending category is simply empty with no hint why.
  - **Provenance:** [October 9 candidate, line 1280](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1280); explicit source files unchanged at review time.
  - Evidence: Copy when server shares no trending tags.

- [x] **NS-410 · P3 · UX · A · S — Filter !isMember inside the getter (or pass a limit) before slicing.**
  - **Target:** [app/pages/groups/index.vue:35](/Users/powerox/neospace/app/pages/groups/index.vue:35). **Area:** app/pages/groups/index.vue.
  - **Change:** Filter `!isMember` inside the getter (or pass a limit) before slicing.
  - **Prior observation to check:** `app/pages/groups/index.vue:35-37` — The store's `trendingGroups` caps at 12 *before* this page filters out joined tags, so with several trending tags joined the rail shows far fewer than 10.
  - **Provenance:** [October 9 candidate, line 1281](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1281); explicit source files unchanged at review time.
  - Evidence: Trending getter excludes joined tags before cap.

- [x] **NS-411 · P3 · A11Y · A · S — Use &lt;div role="group" aria-label="Filter by category"&gt;.**
  - **Target:** [app/pages/groups/index.vue:270](/Users/powerox/neospace/app/pages/groups/index.vue:270). **Area:** app/pages/groups/index.vue.
  - **Change:** Use `<div role="group" aria-label="Filter by category">`.
  - **Prior observation to check:** `app/pages/groups/index.vue:270` — Category filter toggles are wrapped in `<nav aria-label="Group categories">`. They're `aria-pressed` filter buttons, not navigation links, so a landmark is wrong.
  - **Provenance:** [October 9 candidate, line 1282](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1282); explicit source files unchanged at review time.
  - Evidence: Category filters use `role="group"`.

- [x] **NS-412 · P3 · UX · A · S — Sync selectedCategory with ?cat= via router.replace.**
  - **Target:** [app/pages/groups/index.vue:17](/Users/powerox/neospace/app/pages/groups/index.vue:17). **Area:** app/pages/groups/index.vue.
  - **Change:** Sync `selectedCategory` with `?cat=` via `router.replace`.
  - **Prior observation to check:** `app/pages/groups/index.vue:17,277` — The selected category lives in a local ref, so returning from a group page always resets to "All Groups" and scroll-restores into a different list.
  - **Provenance:** [October 9 candidate, line 1283](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1283); explicit source files unchanged at review time.
  - Evidence: `?cat=` sync via `router.replace`.

- [x] **NS-413 · P3 · UX · A · S — Use NuxtLink with the same styling.**
  - **Target:** [app/pages/groups/index.vue:167](/Users/powerox/neospace/app/pages/groups/index.vue:167). **Area:** app/pages/groups/index.vue.
  - **Change:** Use `NuxtLink` with the same styling.
  - **Prior observation to check:** `app/pages/groups/index.vue:167-181` — The jump chips are `<button @click=router.push>`, so you can't middle-click, cmd-click or long-press them to open in a new tab, and they lack link semantics.
  - **Provenance:** [October 9 candidate, line 1284](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1284); explicit source files unchanged at review time.
  - Evidence: Jump chips are `NuxtLink`s.

- [x] **NS-414 · P3 · CODE · A · S — Delete it, or use it for the lede proposed above.**
  - **Target:** [app/pages/groups/index.vue:433](/Users/powerox/neospace/app/pages/groups/index.vue:433). **Area:** app/pages/groups/index.vue.
  - **Change:** Delete it, or use it for the lede proposed above.
  - **Prior observation to check:** `app/pages/groups/index.vue:433-437` — `.section-lede` CSS is unused (no element has the class).
  - **Provenance:** [October 9 candidate, line 1285](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1285); explicit source files unchanged at review time.
  - Evidence: Removed unused `.section-lede` CSS.

- [x] **NS-415 · P3 · DESIGN · A · S — Drop the Trending chip from GROUP_CATEGORIES, or make the rail link to it.**
  - **Target:** [app/pages/groups/index.vue:442](/Users/powerox/neospace/app/pages/groups/index.vue:442). **Area:** app/pages/groups/index.vue.
  - **Change:** Drop the Trending chip from `GROUP_CATEGORIES`, or make the rail link to it.
  - **Prior observation to check:** `app/pages/groups/index.vue:442-444` (store) / `:271-281` — A "Trending" category chip repeats the "Trending on {server}" rail directly above it, and its card list is the same ≤20 tags.
  - **Provenance:** [October 9 candidate, line 1286](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1286); explicit source files unchanged at review time.
  - Evidence: Removed Trending browse chip (rail only).

- [x] **NS-416 · P3 · DESIGN · A · S — Add &--member:hover { background: color-mix(in srgb, var(--neo-accent) 14%, var(--neo-bg-card)); }.**
  - **Target:** [app/components/GroupCard.vue:206](/Users/powerox/neospace/app/components/GroupCard.vue:206). **Area:** app/components/GroupCard.vue.
  - **Change:** Add `&--member:hover { background: color-mix(in srgb, var(--neo-accent) 14%, var(--neo-bg-card)); }`.
  - **Prior observation to check:** `app/components/GroupCard.vue:206-214` — `&:hover` comes after `&--member` and overrides its background, so a joined card loses its accent tint on hover and looks un-joined.
  - **Provenance:** [October 9 candidate, line 1292](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1292); explicit source files unchanged at review time.
  - Evidence: Member card hover keeps accent tint.

- [x] **NS-417 · P3 · DESIGN · A · S — Show the #tag and a stats line on tiles, and keep the category with a 🔥 marker.**
  - **Target:** [app/components/GroupCard.vue:127](/Users/powerox/neospace/app/components/GroupCard.vue:127). **Area:** app/components/GroupCard.vue.
  - **Change:** Show the `#tag` and a stats line on tiles, and keep the category with a 🔥 marker.
  - **Prior observation to check:** `app/components/GroupCard.vue:127-135` — Trending cards replace the category label with the word "trending" (and tiles' tagline is just "Trending" inside the "Trending on…" rail), so the category and the tag name are both lost.
  - **Provenance:** [October 9 candidate, line 1293](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1293); explicit source files unchanged at review time.
  - Evidence: Tiles show `#tag`, stats, 🔥 category.

- [x] **NS-418 · P3 · CODE · A · S — Remove both.**
  - **Target:** [app/components/GroupCard.vue:16](/Users/powerox/neospace/app/components/GroupCard.vue:16). **Area:** app/components/GroupCard.vue.
  - **Change:** Remove both.
  - **Prior observation to check:** `app/components/GroupCard.vue:16,22,109,124,216-229,139` — The `compact` prop and its CSS are dead (no caller passes it). `@click.stop` on actions is a leftover from the old clickable article.
  - **Provenance:** [October 9 candidate, line 1294](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1294); explicit source files unchanged at review time.
  - Evidence: Removed dead GroupCard `compact` / `@click.stop`.

- [x] **NS-419 · P3 · DESIGN · A · S — Use one fallback.**
  - **Target:** [app/components/GroupCard.vue:188](/Users/powerox/neospace/app/components/GroupCard.vue:188). **Area:** app/components/GroupCard.vue.
  - **Change:** Use one fallback.
  - **Prior observation to check:** `app/components/GroupCard.vue:188,255` — `--neo-radius-md` falls back to `4px` on the card but `8px` on the icon, so the corners don't match when the token is missing.
  - **Provenance:** [October 9 candidate, line 1295](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1295); explicit source files unchanged at review time.
  - Evidence: Unified `--neo-radius-md` fallback on icon.

- [x] **NS-420 · P3 · PERF · A · S — Keep a running inCount.**
  - **Target:** [app/utils/rankers.ts:313](/Users/powerox/neospace/app/utils/rankers.ts:313). **Area:** app/utils/rankers.ts.
  - **Change:** Keep a running `inCount`.
  - **Prior observation to check:** `app/utils/rankers.ts:313-316` — The in/out-of-network interleave recounts `mixed.filter(x => x.inNetwork)` on every push (O(n²)). With pools of several hundred unserved posts re-ranked on each refill, that's wasted work.
  - **Provenance:** [October 9 candidate, line 1324](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1324); explicit source files unchanged at review time.
  - Evidence: Running `inCount` in X interleave (no O(n²) filter).

- [ ] **NS-421 · P3 · CODE · A · S — Decode entities (a shared helper, also used by utils/algorithms.ts) before tokenizing.**
  - **Target:** [app/utils/rankers.ts:118](/Users/powerox/neospace/app/utils/rankers.ts:118). **Area:** app/utils/rankers.ts.
  - **Change:** Decode entities (a shared helper, also used by `utils/algorithms.ts`) before tokenizing.
  - **Prior observation to check:** `app/utils/rankers.ts:118-124` — `stripHtml` turns every entity into a space, so Mastodon's `don&#39;t` becomes "don t" and `&amp;` becomes a gap. That pollutes `likedWords`/interest matching and the engagement-bait regex ("like if you&#39;re…").
  - **Provenance:** [October 9 candidate, line 1325](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1325); explicit source files unchanged at review time.

- [ ] **NS-422 · P3 · UX · A · S — Use Intl.Segmenter(undefined, { granularity: 'word' }) when available.**
  - **Target:** [app/utils/rankers.ts:128](/Users/powerox/neospace/app/utils/rankers.ts:128). **Area:** app/utils/rankers.ts.
  - **Change:** Use `Intl.Segmenter(undefined, { granularity: 'word' })` when available.
  - **Prior observation to check:** `app/utils/rankers.ts:128` — `contentWords` assumes space-separated words: CJK/Thai posts become one giant "word" (or a few), so TikTok-style interest matching never fires for those languages.
  - **Provenance:** [October 9 candidate, line 1326](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1326); explicit source files unchanged at review time.

- [ ] **NS-423 · P3 · UX · A · S — Seed it from settingsStore preferences (posting:default:language) and accept a set of languages.**
  - **Target:** [app/utils/rankers.ts:484](/Users/powerox/neospace/app/utils/rankers.ts:484). **Area:** app/utils/rankers.ts.
  - **Change:** Seed it from `settingsStore` preferences (`posting:default:language`) and accept a set of languages.
  - **Prior observation to check:** `app/utils/rankers.ts:484-487` — `viewerLang` comes from `navigator.language` only, ignoring the account's posting language and chosen UI language, so a bilingual user is penalised (×0.8) for their own language.
  - **Provenance:** [October 9 candidate, line 1327](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1327); explicit source files unchanged at review time.

- [x] **NS-424 · P3 · UX · A · S — Document the limitation in the Facebook description, or add the top few languages.**
  - **Target:** [app/utils/rankers.ts:223](/Users/powerox/neospace/app/utils/rankers.ts:223). **Area:** app/utils/rankers.ts.
  - **Change:** Document the limitation in the Facebook description, or add the top few languages.
  - **Prior observation to check:** `app/utils/rankers.ts:223-224` — The engagement-bait regex is English-only. Non-English bait ("teilen wenn", "comparte si", "いいねしたら") is never demoted.
  - **Provenance:** [October 9 candidate, line 1328](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1328); explicit source files unchanged at review time.
  - Evidence: Facebook description notes English-only bait regex.

- [ ] **NS-425 · P3 · PERF · A · S — Cache features per identity, and evict served entries older than a few pages.**
  - **Target:** [app/composables/useRankedFeed.ts:59](/Users/powerox/neospace/app/composables/useRankedFeed.ts:59). **Area:** app/composables/useRankedFeed.ts.
  - **Change:** Cache features per identity, and evict served entries older than a few pages.
  - **Prior observation to check:** `app/composables/useRankedFeed.ts:59,186-196` — `pool` grows without bound for the session, and every refill re-runs `features()` (HTML strip, regex, tokenizing) on every unserved post.
  - **Provenance:** [October 9 candidate, line 1340](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1340); explicit source files unchanged at review time.

- [ ] **NS-426 · P3 · PERF · A · S — Rank and serve after the first refill, and run the second in the background.**
  - **Target:** [app/composables/useRankedFeed.ts:221](/Users/powerox/neospace/app/composables/useRankedFeed.ts:221). **Area:** app/composables/useRankedFeed.ts.
  - **Change:** Rank and serve after the first refill, and run the second in the background.
  - **Prior observation to check:** `app/composables/useRankedFeed.ts:221` — A fresh load runs two full refills (up to 5 sources × 2), plus up to 12 context requests (5+5 follow pages, favourites, bookmarks): ~22 requests before the first post. On slow networks the column spins for seconds.
  - **Provenance:** [October 9 candidate, line 1341](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1341); explicit source files unchanged at review time.

- [ ] **NS-427 · P3 · UX · A · S — Expose the limits as constants and show "12 max" helper text and a warning in AlgorithmSheet.**
  - **Target:** [app/utils/algorithms.ts:85](/Users/powerox/neospace/app/utils/algorithms.ts:85). **Area:** app/utils/algorithms.ts.
  - **Change:** Expose the limits as constants and show "12 max" helper text and a warning in AlgorithmSheet.
  - **Prior observation to check:** `app/utils/algorithms.ts:85,96,99` — Tag and keyword lists are silently truncated to 12 entries and keywords over 64 chars are silently dropped. Nothing in the editor says so.
  - **Provenance:** [October 9 candidate, line 1350](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1350); explicit source files unchanged at review time.

- [ ] **NS-428 · P3 · UX · A · S — Return a typed error ('version') and show "This link was made with a newer NeoSpace — refresh to update".**
  - **Target:** [app/utils/algorithms.ts:210](/Users/powerox/neospace/app/utils/algorithms.ts:210). **Area:** app/utils/algorithms.ts.
  - **Change:** Return a typed error (`'version'`) and show "This link was made with a newer NeoSpace — refresh to update".
  - **Prior observation to check:** `app/utils/algorithms.ts:210` — A payload with `v !== 1` (e.g., a link from a newer NeoSpace) gets the same generic "invalid or corrupted" error, and there's no migration hook.
  - **Provenance:** [October 9 candidate, line 1351](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1351); explicit source files unchanged at review time.

- [ ] **NS-429 · P3 · UX · A · S — Require phrasing like "on local", "local timeline" or "this server".**
  - **Target:** [app/utils/algorithms.ts:411](/Users/powerox/neospace/app/utils/algorithms.ts:411). **Area:** app/utils/algorithms.ts.
  - **Change:** Require phrasing like "on local", "local timeline" or "this server".
  - **Prior observation to check:** `app/utils/algorithms.ts:411` — Source detection treats any "local" as the Local timeline, so "local news without replies" becomes a Local-timeline recipe with keyword "news".
  - **Provenance:** [October 9 candidate, line 1352](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1352); explicit source files unchanged at review time.

- [ ] **NS-430 · P3 · UX · A · S — Return a boolean from saveCustom and toast "Saved for this session only — storage is full".**
  - **Target:** [app/stores/algorithms.ts:75](/Users/powerox/neospace/app/stores/algorithms.ts:75). **Area:** app/stores/algorithms.ts.
  - **Change:** Return a boolean from `saveCustom` and toast "Saved for this session only — storage is full".
  - **Prior observation to check:** `app/stores/algorithms.ts:75-79` — Quota/private-mode save failures are swallowed, so the toast says "Saved", the recipe works until reload, then vanishes.
  - **Provenance:** [October 9 candidate, line 1359](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1359); explicit source files unchanged at review time.

- [ ] **NS-431 · P3 · CODE · A · S — Coerce booleans with === true, and skip custom ids starting with builtin-.**
  - **Target:** [app/stores/algorithms.ts:51](/Users/powerox/neospace/app/stores/algorithms.ts:51). **Area:** app/stores/algorithms.ts.
  - **Change:** Coerce booleans with `=== true`, and skip custom ids starting with `builtin-`.
  - **Prior observation to check:** `app/stores/algorithms.ts:51-64` — Untrusted localStorage `mediaOnly`/`noReblogs`/`noReplies` are spread as-is (`"false"` is truthy), and a custom entry whose id equals a builtin id (`builtin-x`) replaces the builtin and can then be deleted.
  - **Provenance:** [October 9 candidate, line 1360](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1360); explicit source files unchanged at review time.

- [ ] **NS-432 · P3 · UX · A · S — Branch the note on preview.ranker.**
  - **Target:** [app/pages/algorithms/import.vue:74](/Users/powerox/neospace/app/pages/algorithms/import.vue:74). **Area:** app/pages/algorithms/import.vue.
  - **Change:** Branch the note on `preview.ranker`.
  - **Prior observation to check:** `app/pages/algorithms/import.vue:74-76` — "This adds a filtered view on *your* timelines" is wrong for ranked recipes, which pull trending, federated and followed-tag posts from beyond your timelines.
  - **Provenance:** [October 9 candidate, line 1366](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1366); explicit source files unchanged at review time.

- [ ] **NS-433 · P3 · UX · A · S — Toast "Already in your feeds — opened it" when the twin path was taken (return a flag from importPayload).**
  - **Target:** [app/pages/algorithms/import.vue:48](/Users/powerox/neospace/app/pages/algorithms/import.vue:48). **Area:** app/pages/algorithms/import.vue.
  - **Change:** Toast "Already in your feeds — opened it" when the twin path was taken (return a flag from `importPayload`).
  - **Prior observation to check:** `app/pages/algorithms/import.vue:48-54` — Re-importing a link you already have (`twin`) still toasts "Added …", as if it were a new feed.
  - **Provenance:** [October 9 candidate, line 1367](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1367); explicit source files unchanged at review time.

## Remaining candidates: Platform, security, handoffs, build/deploy, tests & docs

- [x] **NS-434 · P1 · SEC · A · M — Verify the production key pair and enforceable edge rate limiting on /api/feedback; document whether…**
  - **Done:** Documented in `docs/STATUS.md` — Turnstile optional by design; isolate Map still caps 5/hour/IP; recommend CF WAF edge rule for global enforcement. Production key presence not inspected from this environment.
  - **Target:** [functions/api/feedback.ts:221](/Users/powerox/neospace/functions/api/feedback.ts:221). **Area:** Feedback API: functions/api/feedback.ts, functions/utils/rateLimit.ts, shared/feedbackConstants.ts.
  - **Change:** Verify the production key pair and enforceable edge rate limiting on /api/feedback; document whether production deliberately refuses requests when verification configuration is missing.
  - **Prior observation to check:** Feedback verification is conditional on TURNSTILE_SECRET_KEY, and its rate limiter is an in-isolate Map. Production keys and edge rules were not inspected during this review; do not infer they are absent from an older status document.
  - **Prior verifier qualification:** The Origin check is spoofable and Turnstile is off: `docs/STATUS.md:93` says "keys not set", and the built `index.html` has `turnstileSiteKey:""`. But "unlimited" overstates it. `allowRequest` still caps at 5 per hour per IP per isolate, so spam scales with IPs and isolates rather than being unlimited from one client. Impact still High-ish (public issue spam via the PAT).
  - **Provenance:** [October 9 candidate, line 1398](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1398); explicit source files unchanged at review time.

- [x] **NS-435 · P1 · UX · A · M — Upload to R2 (or the GitHub contents API) and link the URL, or remove the feature and its copy.**
  - **Done:** Removed screenshot attach UI + stopped inlining `data:` images (GitHub strips them). Issue notes hosting is not configured; STATUS documents R2 as the path to restore.
  - **Target:** [functions/api/feedback.ts:335](/Users/powerox/neospace/functions/api/feedback.ts:335). **Area:** Feedback API: functions/api/feedback.ts, functions/utils/rateLimit.ts, shared/feedbackConstants.ts.
  - **Change:** Upload to R2 (or the GitHub contents API) and link the URL, or remove the feature and its copy.
  - **Prior observation to check:** `functions/api/feedback.ts:335-348` — . The screenshot is still inlined as `![screenshot](data:image/…;base64,…)`. GitHub's sanitizer drops `data:` image sources, so the issue shows no image, only up to 45 KB of base64 bloat. The UI tells users "any screenshot is included".
  - **Provenance:** [October 9 candidate, line 1400](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1400); explicit source files unchanged at review time.

- [x] **NS-436 · P2 · UX · A · S — Don't run escapeMd on the fenced body (keep it only for text outside a fence).**
  - **Done:** Fenced body keeps raw `@user@host` / `#N`; fence alone blocks mentions.
  - **Target:** [functions/api/feedback.ts:305](/Users/powerox/neospace/functions/api/feedback.ts:305). **Area:** Feedback API: functions/api/feedback.ts, functions/utils/rateLimit.ts, shared/feedbackConstants.ts.
  - **Change:** Don't run `escapeMd` on the fenced body (keep it only for text outside a fence).
  - **Prior observation to check:** `functions/api/feedback.ts:305-313` — `escapeMd` rewrites `@` to `&#64;` and `#N` to `&#35;N`. The body then goes inside a ```` ```text ```` fence, where GitHub does not decode entities. Every Fediverse handle in a note shows as `&#64;alice&#64;server`. The fence alone already stops mentions and cross-refs.
  - **Provenance:** [October 9 candidate, line 1401](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1401); explicit source files unchanged at review time.

- [x] **NS-437 · P2 · SEC · A · S — Increment the bucket only after Turnstile passes, or keep a separate failure bucket.**
  - **Done:** Rate limit charged after JSON parse + Turnstile; failed verifies no longer burn the success bucket (test updated).
  - **Target:** [functions/api/feedback.ts:225](/Users/powerox/neospace/functions/api/feedback.ts:225). **Area:** Feedback API: functions/api/feedback.ts, functions/utils/rateLimit.ts, shared/feedbackConstants.ts.
  - **Change:** Increment the bucket only after Turnstile passes, or keep a separate failure bucket.
  - **Prior observation to check:** `functions/api/feedback.ts:225-237` — The rate limit is charged before validation and before Turnstile. Junk JSON or failed verifications use up the shared 5/hour bucket, so one abuser behind the same NAT or IPv6 /64 can lock out real users for an hour.
  - **Provenance:** [October 9 candidate, line 1402](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1402); explicit source files unchanged at review time.

- [x] **NS-438 · P2 · TOOLING · A · S — Use a same-origin check (Origin === new URL(request.url).origin) plus the prod host.**
  - **Target:** [functions/api/feedback.ts:35](/Users/powerox/neospace/functions/api/feedback.ts:35). **Area:** Feedback API: functions/api/feedback.ts, functions/utils/rateLimit.ts, shared/feedbackConstants.ts.
  - **Change:** Use a same-origin check (`Origin === new URL(request.url).origin`) plus the prod host.
  - **Prior observation to check:** `functions/api/feedback.ts:35-62` — Two overlapping hand-kept allowlists, with `pages.dev` special-cased in both. `localhost:3000` is allowed, but `npm run cf:preview` (wrangler on :8788), `.claude/launch.json`'s pages dev on :3013 and nuxt dev on :3011 are not, so feedback returns 403 `FORBIDDEN_ORIGIN` in the documented preview flow.
  - **Provenance:** [October 9 candidate, line 1403](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1403); explicit source files unchanged at review time.
  - **Done:** `functions/api/feedback.ts` uses a same-origin check; `tests/platform-security.test.ts`.

- [x] **NS-439 · P2 · CODE · A · M — Merge history.state into the pushed state ({ ...history.state, neoFeedback: true }), or use a router…**
  - **Target:** [app/composables/useFeedbackNotes.ts:50](/Users/powerox/neospace/app/composables/useFeedbackNotes.ts:50). **Area:** Feedback client: FeedbackNotes.vue, useFeedbackNotes.ts, app/utils/feedback.ts, app/utils/log.ts.
  - **Change:** Merge `history.state` into the pushed state (`{ ...history.state, neoFeedback: true }`), or use a router hash/query.
  - **Prior observation to check:** `app/composables/useFeedbackNotes.ts:50-55` — A raw `history.pushState({ neoFeedback: true }, '')` skips vue-router's state (`back`, `current`, `position`), and it's the only raw pushState in the app. After closing, browser Forward lands on an entry the router doesn't know (warning, broken scroll restoration), and back from it does nothing visible.
  - **Provenance:** [October 9 candidate, line 1425](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1425); explicit source files unchanged at review time.
  - **Done:** `useFeedbackNotes.ts` merges `history.state` when pushing.

- [x] **NS-440 · P2 · CODE · A · M — Send them through logWarn/logError.**
  - **Target:** [app/utils/log.ts:50](/Users/powerox/neospace/app/utils/log.ts:50). **Area:** Feedback client: FeedbackNotes.vue, useFeedbackNotes.ts, app/utils/feedback.ts, app/utils/log.ts.
  - **Change:** Send them through `logWarn`/`logError`.
  - **Prior observation to check:** `app/utils/log.ts:50-70` — 35 raw `console.*` calls skip the ring buffer (e.g. `notifications.ts:363,446,540`, `status.ts:281`, `useAccountSearch.ts:54`), so feedback logs miss most real failures. Those `console.warn` calls also print in prod, unlike `logWarn`.
  - **Provenance:** [October 9 candidate, line 1428](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1428); explicit source files unchanged at review time.
  - **Done:** Cited console calls and the remaining `console.warn/error` in `app/` now go through `logWarn`/`logError`.

- [x] **NS-441 · P2 · CODE · C · S — Dispatch on e.data.type first, then check that source's origin rule.**
  - **Target:** [app/composables/useLoomHandoff.ts:190](/Users/powerox/neospace/app/composables/useLoomHandoff.ts:190). **Area:** Suite handoffs: useLoomHandoff.ts, composeHandoff.ts, loom/bruh/notebookHandoff.ts.
  - **Change:** Dispatch on `e.data.type` first, then check that source's origin rule.
  - **Prior observation to check:** `app/composables/useLoomHandoff.ts:190-199` — The dispatcher checks origins in a fixed order. `isBruhOrigin` accepts any localhost (`bruhHandoff.ts:36`) and `isNotebookOrigin` accepts every `*.ibm.io` (`notebookHandoff.ts:37`). A `loom-neospace-share` from `https://loom.ibm.io` goes to `onNotebookMessage`, which rejects the type and returns, so it never reaches the Loom branch. Local Loom and Throughline messages hit the bruh branch the same way.
  - **Prior verifier qualification:** Mis-dispatch is real: `https://loom.ibm.io` passes `isNotebookOrigin` (`.ibm.io`), `onNotebookMessage` rejects the type, and the message never reaches the Loom branch; localhost is caught by `isBruhOrigin` first. In prod, though, this path is currently unreachable because COOP same-origin (#24) already severs the opener channel. It bites in dev, and in prod once #24 is fixed. Impact: Medium now, High once #24 is fixed.
  - **Provenance:** [October 9 candidate, line 1433](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1433); explicit source files unchanged at review time.
  - **Done:** `useLoomHandoff.ts` dispatches on `e.data.type` first.

- [x] **NS-442 · P2 · SEC · C · S — Use an exact allowlist (ibm.io, www.ibm.io, notebook.ibm.io).**
  - **Target:** [app/utils/notebookHandoff.ts:36](/Users/powerox/neospace/app/utils/notebookHandoff.ts:36). **Area:** Suite handoffs: useLoomHandoff.ts, composeHandoff.ts, loom/bruh/notebookHandoff.ts.
  - **Change:** Use an exact allowlist (`ibm.io`, `www.ibm.io`, `notebook.ibm.io`).
  - **Prior observation to check:** `app/utils/notebookHandoff.ts:36-37` — It trusts every `*.ibm.io` subdomain (loom, bruh, neospace itself, anything hosted later) to push compose text, which makes `NOTEBOOK_ORIGINS` (`:8-11`) pointless.
  - **Provenance:** [October 9 candidate, line 1436](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1436); explicit source files unchanged at review time.
  - **Done:** `app/utils/notebookHandoff.ts` uses an exact host allowlist; `tests/notebookHandoff.test.ts`.

- [x] **NS-443 · P2 · CODE · A · S — One ack(e, type) that calls (e.source as Window)?.postMessage(..., e.origin).**
  - **Target:** [app/composables/useLoomHandoff.ts:78](/Users/powerox/neospace/app/composables/useLoomHandoff.ts:78). **Area:** Suite handoffs: useLoomHandoff.ts, composeHandoff.ts, loom/bruh/notebookHandoff.ts.
  - **Change:** One `ack(e, type)` that calls `(e.source as Window)?.postMessage(..., e.origin)`.
  - **Prior observation to check:** `app/composables/useLoomHandoff.ts:78-106` — ACKs go to `window.opener`, not `e.source`. If the share came from another window or frame, or the opener navigated away, the sender never gets an ACK and keeps retrying. The three ack functions are also copy-pasted.
  - **Provenance:** [October 9 candidate, line 1437](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1437); explicit source files unchanged at review time.
  - **Done:** `useLoomHandoff.ts` has a single `ack(e, type)` helper.

- [x] **NS-444 · P2 · UX · A · M — Keep large buffers in IndexedDB or the Cache API, keyed by share.**
  - **Target:** [app/stores/composeHandoff.ts:341](/Users/powerox/neospace/app/stores/composeHandoff.ts:341). **Area:** Suite handoffs: useLoomHandoff.ts, composeHandoff.ts, loom/bruh/notebookHandoff.ts.
  - **Change:** Keep large buffers in IndexedDB or the Cache API, keyed by share.
  - **Prior observation to check:** `app/stores/composeHandoff.ts:341-347,130` — postMessage images of 400 KB or more are never turned into a data URL. A signed-out user is sent to `/login` (`useLoomHandoff.ts:224-226`), the saved share has no image, and the chart is gone after OAuth.
  - **Provenance:** [October 9 candidate, line 1438](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1438); explicit source files unchanged at review time.
  - **Done:** Large postMessage chart images (≥ 400 KB) are now stashed in IndexedDB keyed by the share (`utils/handoffBuffers.ts`, 30 min TTL, memory fallback) and the persisted share carries `imageBufferKey`; `ingestStored` rebuilds the `File` from it after the login / OAuth round trip, and `clearPersistedLoomShare` drops it. Also fixed `useLoomHandoff.onLoomShare`, which cleared the persisted share even when signed out (that is what actually lost the chart). Tests: `tests/handoff-buffers.test.ts` (memory backend); the real IndexedDB path was not exercised in a browser here.

- [x] **NS-445 · P2 · UX · A · M — registerType: 'prompt' with an "Update ready" toast, or keep autoUpdate but delay the reload until the…**
  - **Target:** [nuxt.config.ts:43](/Users/powerox/neospace/nuxt.config.ts:43). **Area:** PWA, service worker & boot: nuxt.config.ts, public/boot/rescue.js, plugins.
  - **Change:** `registerType: 'prompt'` with an "Update ready" toast, or keep autoUpdate but delay the reload until the page is hidden or the next navigation.
  - **Prior observation to check:** `nuxt.config.ts:43,97-98` — REGRESSED (audit #913 says "already registerType:'prompt', skipWaiting:false"). It's back to `autoUpdate` with `skipWaiting` and `clientsClaim`. With no `onNeedReload`, vite-plugin-pwa's `register.js:39-46` calls `window.location.reload()` when the new SW activates. Updates are checked every 30 min plus on focus/visibility (`pwa-rescue.client.ts:23-38`), so tabs reload mid-use: attachments, open threads, column scroll, Edward state and the feedback draft are lost.
  - **Prior verifier qualification:** The mechanics are right: autoUpdate plus skipWaiting/clientsClaim, no `onNeedReload` in `@vite-pwa/nuxt` (`pwa.client.js`), and `register.js:39-46` calls `window.location.reload()`, with update checks every 1800s plus on focus. But it isn't a regression: it's a deliberate change, commented at :41-42 as fixing stale home-screen shells. Corrected: "autoUpdate (chosen to fix stale PWA shells) reloads open tabs mid-use after each deploy; defer the reload until hidden or next navigation." Impact: Medium/High depending on deploy frequency.
  - **Provenance:** [October 9 candidate, line 1449](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1449); explicit source files unchanged at review time.
  - **Done:** Same change as NS-181: `registerType: 'prompt'`, `skipWaiting: false`, `pwa-update.client.ts` applies the update only when hidden with nothing open, otherwise an "Update ready" toast with Reload.

- [x] **NS-446 · P2 · CODE · A · S — Signal from nuxtApp.hook('app:mounted') (or page:finish).**
  - **Target:** [app/plugins/mount-signal.client.ts:2](/Users/powerox/neospace/app/plugins/mount-signal.client.ts:2). **Area:** PWA, service worker & boot: nuxt.config.ts, public/boot/rescue.js, plugins.
  - **Change:** Signal from `nuxtApp.hook('app:mounted')` (or `page:finish`).
  - **Prior observation to check:** `app/plugins/mount-signal.client.ts:2-10` — It signals "mounted" while plugins initialize, before `app.mount` and layout setup. A crash in layout or page setup leaves a blank screen with the `rescue.js:60-69` watchdog already turned off.
  - **Provenance:** [October 9 candidate, line 1453](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1453); explicit source files unchanged at review time.
  - **Done:** `mount-signal.client.ts` signals on `page:finish`.

- [x] **NS-447 · P2 · UX · A · S — Add OG tags and a 1200×630 image under public/.**
  - **Target:** [nuxt.config.ts:116](/Users/powerox/neospace/nuxt.config.ts:116). **Area:** PWA, service worker & boot: nuxt.config.ts, public/boot/rescue.js, plugins.
  - **Change:** Add OG tags and a 1200×630 image under `public/`.
  - **Prior observation to check:** `nuxt.config.ts:116-139` — There are no Open Graph or Twitter meta tags (`og:title`, `og:description`, `og:image`). Links to neospace.ibm.io shared on Mastodon, the app's own audience, unfurl as bare URLs.
  - **Provenance:** [October 9 candidate, line 1457](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1457); explicit source files unchanged at review time.
  - **Done:** `nuxt.config.ts` adds Open Graph/Twitter meta; new 1200×630 `public/og-image.png`.
- [x] **NS-448 · P2 · UX · A · S — Delete 404.html (and Nuxt's 200.html) in the post-step so Pages answers 200, then verify with curl -I.**
  - **Target:** [scripts/spa-fallback.mjs:23](/Users/powerox/neospace/scripts/spa-fallback.mjs:23). **Area:** Hosting, headers & Docker: _headers, _redirects, spa-fallback.mjs, nginx, Dockerfile.
  - **Change:** Delete `404.html` (and Nuxt's `200.html`) in the post-step so Pages answers 200, then verify with `curl -I`.
  - **Prior observation to check:** `scripts/spa-fallback.mjs:23-24` — . Copying `index.html` to `404.html` turns off Cloudflare Pages' SPA routing, so deep links (`/status/123`, `/groups/cats`) come back as HTTP 404 with the app shell. Link unfurlers, uptime checks and crawlers treat them as dead.
  - **Provenance:** [October 9 candidate, line 1465](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1465); explicit source files unchanged at review time.
  - **Done:** `scripts/spa-fallback.mjs`, `public/_redirects`, README and ARCHITECTURE updated to remove 404.html/200.html. Not verified with `curl -I` against production (no network here).

- [x] **NS-449 · P2 · SEC · A · S — 1.28-alpine@sha256:… and node:22-alpine@sha256:….**
  - **Target:** [Dockerfile:3](/Users/powerox/neospace/Dockerfile:3). **Area:** Hosting, headers & Docker: _headers, _redirects, spa-fallback.mjs, nginx, Dockerfile.
  - **Change:** `1.28-alpine@sha256:…` and `node:22-alpine@sha256:…`.
  - **Prior observation to check:** `Dockerfile:3,13` — . Neither stage is pinned by digest, and `nginx-unprivileged:1.27-alpine` is an ended mainline branch (current: 1.28 stable, 1.29 mainline).
  - **Provenance:** [October 9 candidate, line 1467](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1467); explicit source files unchanged at review time.
  - **Done:** `Dockerfile`: both base images pinned by digest (`node:22-alpine@sha256:0a7108bf…`, `nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a…` — digests read from the Docker Hub registry), nginx moved off the ended 1.27 branch to 1.28 stable, Dependabot's `docker` ecosystem added so bumps are reviewable PRs. `tests/dockerfile-pins.test.ts` fails on an unpinned `FROM`. The image was not built here (no Docker daemon).

- [x] **NS-450 · P2 · TOOLING · A · S — Test createGitHubIssue with stubbed fetch and location (sends the path only; a non-JSON reply throws…**
  - **Target:** [tests/smoke.test.ts:329](/Users/powerox/neospace/tests/smoke.test.ts:329). **Area:** Tests: tests/*.test.ts.
  - **Change:** Test `createGitHubIssue` with stubbed `fetch` and `location` (sends the path only; a non-JSON reply throws `FeedbackError` `BAD_RESPONSE`).
  - **Prior observation to check:** `tests/smoke.test.ts:329-338` — "feedback area path" only checks `typeof createGitHubIssue === 'function'` and splits a string literal; no app code is exercised.
  - **Provenance:** [October 9 candidate, line 1494](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1494); explicit source files unchanged at review time.
  - **Done:** `createGitHubIssue` tests added with stubbed fetch/location.

- [ ] **NS-451 · P3 · CODE · A · S — Build it from new URL(request.url).host.**
  - **Target:** [functions/api/feedback.ts:327](/Users/powerox/neospace/functions/api/feedback.ts:327). **Area:** Feedback API: functions/api/feedback.ts, functions/utils/rateLimit.ts, shared/feedbackConstants.ts.
  - **Change:** Build it from `new URL(request.url).host`.
  - **Prior observation to check:** `functions/api/feedback.ts:327` — The meta block hardcodes `source: neospace.ibm.io leave-a-note`, even for pages.dev previews and localhost, so triage can't tell preview reports from prod ones.
  - **Provenance:** [October 9 candidate, line 1404](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1404); explicit source files unchanged at review time.

- [x] **NS-452 · P3 · SEC · A · S — Add X-Content-Type-Options: nosniff (and friends) in json().**
  - **Target:** [functions/api/feedback.ts:64](/Users/powerox/neospace/functions/api/feedback.ts:64). **Area:** Feedback API: functions/api/feedback.ts, functions/utils/rateLimit.ts, shared/feedbackConstants.ts.
  - **Change:** Add `X-Content-Type-Options: nosniff` (and friends) in `json()`.
  - **Prior observation to check:** `functions/api/feedback.ts:64-77` — Cloudflare Pages does not apply `_headers` to Function responses, so `/api/feedback` replies have no nosniff, HSTS or frame headers.
  - **Provenance:** [October 9 candidate, line 1405](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1405); explicit source files unchanged at review time.
  - Evidence: N/A: already in `feedback.ts` `json()`; test accepts charset.

- [ ] **NS-453 · P3 · CODE · A · S — Use @cloudflare/workers-types and remove the override.**
  - **Target:** [functions/api/feedback.ts:24](/Users/powerox/neospace/functions/api/feedback.ts:24). **Area:** Feedback API: functions/api/feedback.ts, functions/utils/rateLimit.ts, shared/feedbackConstants.ts.
  - **Change:** Use `@cloudflare/workers-types` and remove the override.
  - **Prior observation to check:** `functions/api/feedback.ts:24-27` + `functions/tsconfig.json:10` — Hand-rolled `PagesFunction` type (no `waitUntil` or `params`), and `noImplicitAny: false` weakens `strict`.
  - **Provenance:** [October 9 candidate, line 1407](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1407); explicit source files unchanged at review time.

## Remaining candidates: Posts & compose

- [x] **NS-454 · P2 · SEC · A · S — Accept the fallback only when fetched.uri === status.uri.**
  - **Done:** `usePostActions` and `status.resolveReplyId` accept the last-resort `fetchStatus` match only when `fetched.uri === status.uri`.
  - **Target:** [app/composables/usePostActions.ts:157](/Users/powerox/neospace/app/composables/usePostActions.ts:157). **Area:** RealPostCard — identity & cross-server correctness.
  - **Change:** Accept the fallback only when `fetched.uri === status.uri`.
  - **Prior observation to check:** `app/composables/usePostActions.ts:157` — The last-resort `fetchStatus(status.id)` treats any local status with that id as the same post. A foreign snowflake/ULID that happens to exist locally gets liked, boosted or bookmarked on the wrong post. The same pattern is in `status.ts:323` (`resolveReplyId`), so a reply can attach to an unrelated post.
  - **Provenance:** [October 9 candidate, line 306](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:306); explicit source files unchanged at review time.

- [x] **NS-455 · P2 · UX · A · S — Guard private/direct (see RealPostCard:399), and optionally offer "Repost to followers only".**
  - **Done:** `toggleBoost` toasts and returns for private/direct posts instead of boosting.
  - **Target:** [app/composables/usePostActions.ts:238](/Users/powerox/neospace/app/composables/usePostActions.ts:238). **Area:** usePostActions & stores/status.ts.
  - **Change:** Guard private/direct (see RealPostCard:399), and optionally offer "Repost to followers only".
  - **Prior observation to check:** `app/composables/usePostActions.ts:238` — `toggleBoost` doesn't check `visibility` and always reposts publicly. It also can't do Mastodon's boost visibility (`reblog({ visibility })`).
  - **Provenance:** [October 9 candidate, line 351](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:351); explicit source files unchanged at review time.

- [x] **NS-456 · P2 · UX · A · S — Add image/heic|heif|avif and audio/* types to both the regex and the accept list (16), passing HEIC…**
  - **Done:** `COMPOSE_IMAGE_ACCEPT`/`COMPOSE_MEDIA_ACCEPT` and the mime regex now include avif/heic/heif and audio; previews use `composeAttachmentIcon` for non-previewable types.
  - **Target:** [app/utils/composeConstants.ts:12](/Users/powerox/neospace/app/utils/composeConstants.ts:12). **Area:** useComposeMedia, prepareComposeImage, composeConstants.
  - **Change:** Add `image/heic|heif|avif` and `audio/*` types to both the regex and the `accept` list (16), passing HEIC through unconverted where `createImageBitmap` can't decode it.
  - **Prior observation to check:** `app/utils/composeConstants.ts:12` — (old item 474): HEIC/HEIF and AVIF are still rejected, which is common for drag-drop from macOS Photos/Finder and Android. Audio (mp3/ogg/m4a/wav/flac, all supported by Mastodon) can't be attached at all.
  - **Provenance:** [October 9 candidate, line 394](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:394); explicit source files unchanged at review time.

- [x] **NS-457 · P2 · UX · A · S — Remove the hard cap while bytes are flowing (XHR progress), or scale to a ~0.1MB/s floor.**
  - **Done:** Upload timeout now scales at 10s/MB (capped at 20 min) instead of a flat cap (`composeConstants`).
  - **Target:** [app/utils/composeConstants.ts:9](/Users/powerox/neospace/app/utils/composeConstants.ts:9). **Area:** useComposeMedia, prepareComposeImage, composeConstants.
  - **Change:** Remove the hard cap while bytes are flowing (XHR progress), or scale to a ~0.1MB/s floor.
  - **Prior observation to check:** `app/utils/composeConstants.ts:9` — The upload timeout is capped at 120s (`uploadTimeoutForBytes`, 34). A 99MB video needs about 0.8MB/s sustained, so typical mobile uploads abort near the end with "timed out".
  - **Provenance:** [October 9 candidate, line 399](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:399); explicit source files unchanged at review time.

- [x] **NS-458 · P2 · UX · A · S — Detect animation (ANIM/acTL chunk sniff, or ImageDecoder frameCount &gt; 1) and pass those files through.**
  - **Done:** `isAnimatedImageBytes` sniffs WebP VP8X animation flag and APNG `acTL`; animated files pass through unconverted (`prepareComposeImage`). Test in `tests/p2-small-fixes.test.ts`.
  - **Target:** [app/utils/prepareComposeImage.ts:96](/Users/powerox/neospace/app/utils/prepareComposeImage.ts:96). **Area:** useComposeMedia, prepareComposeImage, composeConstants.
  - **Change:** Detect animation (`ANIM`/`acTL` chunk sniff, or `ImageDecoder` `frameCount > 1`) and pass those files through.
  - **Prior observation to check:** `app/utils/prepareComposeImage.ts:96` — Only `image/gif` is passed through. Animated WebP and APNG above the recompress threshold go through `createImageBitmap`, which keeps only the first frame, so the animation is silently lost.
  - **Provenance:** [October 9 candidate, line 400](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:400); explicit source files unchanged at review time.

- [x] **NS-459 · P2 · SEC · A · S — Add sandbox="allow-scripts allow-same-origin allow-presentation allow-popups", and accept only URLs…**
  - **Done:** `PreviewCard` iframe has `sandbox`; `resolvePeerTubeEmbed` returns only normalized embed URLs.
  - **Target:** [app/components/PreviewCard.vue:74](/Users/powerox/neospace/app/components/PreviewCard.vue:74). **Area:** PreviewCard & peertube.ts.
  - **Change:** Add `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"`, and accept only URLs normalized by `peerTubeEmbedUrl`.
  - **Prior observation to check:** `app/components/PreviewCard.vue:74` — The PeerTube `<iframe>` has no `sandbox`. Its src can come from remote-controlled `card.html` whenever `providerName` contains "peertube" (`peertube.ts:79`), and CSP `frame-src https:` allows any origin. A hostile page gets full script plus popups and top navigation on user activation.
  - **Provenance:** [October 9 candidate, line 406](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:406); explicit source files unchanged at review time.

- [x] **NS-460 · P2 · UX · A · S — Require card.type === 'video' *and* (providerName ~ peertube or html iframe on the same origin) before…**
  - **Done:** `resolvePeerTubeEmbed` requires `card.type==='video'` plus a PeerTube provider or same-origin iframe; tests updated in `tests/peertube.test.ts`.
  - **Target:** [app/utils/peertube.ts:24](/Users/powerox/neospace/app/utils/peertube.ts:24). **Area:** PreviewCard & peertube.ts.
  - **Change:** Require `card.type === 'video'` *and* (`providerName` ~ peertube or `html` iframe on the same origin) before treating a URL as PeerTube.
  - **Prior observation to check:** `app/utils/peertube.ts:24` — Detection is path-only. Any site with `/w/<x>` (e.g. `wikipedia.org/w/index.php`) or `/videos/watch/<id>` (20) becomes a "video" card that iframes `/videos/embed/…`, a 404 page.
  - **Provenance:** [October 9 candidate, line 407](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:407); explicit source files unchanged at review time.

- [x] **NS-461 · P2 · UX · A · S — Set touch-action: pan-y on .neo-lightbox__alt, and ignore drags that start inside it.**
  - **Done:** `.neo-lightbox__alt` has `touch-action: pan-y` and drags starting inside it are ignored.
  - **Target:** [app/components/NeoLightbox.vue:174](/Users/powerox/neospace/app/components/NeoLightbox.vue:174). **Area:** NeoLightbox.
  - **Change:** Set `touch-action: pan-y` on `.neo-lightbox__alt`, and ignore drags that start inside it.
  - **Prior observation to check:** `app/components/NeoLightbox.vue:174` — `touch-action: pinch-zoom` on the root blocks one-finger panning for descendants, so long alt text in the caption (max 12dvh, `overflow-y: auto`, 239) can't be scrolled on phones.
  - **Provenance:** [October 9 candidate, line 411](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:411); explicit source files unchanged at review time.

- [x] **NS-462 · P2 · UX · A · S — Show the already-cached previewUrl (or blurhash) underneath with a spinner, plus an error state with "Open…**
  - **Done:** `NeoLightbox` shows the cached preview with a spinner while loading, and an error panel with "Open original".
  - **Target:** [app/components/NeoLightbox.vue:138](/Users/powerox/neospace/app/components/NeoLightbox.vue:138). **Area:** NeoLightbox.
  - **Change:** Show the already-cached `previewUrl` (or blurhash) underneath with a spinner, plus an error state with "Open original".
  - **Prior observation to check:** `app/components/NeoLightbox.vue:138` — The full-size `url` loads with no placeholder or spinner. On slow networks you get a black screen until it arrives, and a failed load shows nothing.
  - **Provenance:** [October 9 candidate, line 412](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:412); explicit source files unchanged at review time.

- [x] **NS-463 · P2 · UX · A · S — Use /^[\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*$/u.**
  - **Done:** `HASHTAG_RE` is now Unicode-aware; `ComposeGroupPicker` uses `isValidHashtag`. Tested.
  - **Target:** [app/components/ComposeGroupPicker.vue:76](/Users/powerox/neospace/app/components/ComposeGroupPicker.vue:76). **Area:** ComposeGroupPicker.
  - **Change:** Use `/^[\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*$/u`.
  - **Prior observation to check:** `app/components/ComposeGroupPicker.vue:76` — `queryTag` allows only `[a-z0-9_]`, so "Use #…" never appears for #café, #日本語, #Ελλάδα, though Mastodon supports Unicode hashtags. The same ASCII-only rule is in `hashtag.ts:4`, which also rejects leading digits (#2024election).
  - **Provenance:** [October 9 candidate, line 421](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:421); explicit source files unchanged at review time.

- [x] **NS-464 · P2 · UX · A · S — font-size: max(16px, 1rem), like the composer textarea.**
  - **Done:** `ComposeGroupPicker` input uses `font-size: max(16px, 1rem)`.
  - **Target:** [app/components/ComposeGroupPicker.vue:587](/Users/powerox/neospace/app/components/ComposeGroupPicker.vue:587). **Area:** ComposeGroupPicker.
  - **Change:** `font-size: max(16px, 1rem)`, like the composer textarea.
  - **Prior observation to check:** `app/components/ComposeGroupPicker.vue:587` — The search input is 0.9375rem (~14px at a 15px root), so iOS zooms the page when the sheet opens and focuses it.
  - **Provenance:** [October 9 candidate, line 422](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:422); explicit source files unchanged at review time.

- [x] **NS-465 · P2 · UX · A · S — Before reading textContent, replace &lt;br&gt; with "\n" and append "\n" after block elements (or walk nodes).**
  - **Done:** `stripHtml` inserts a space for `<br>` and block elements before reading `textContent`.
  - **Target:** [app/utils/stripHtml.ts:13](/Users/powerox/neospace/app/utils/stripHtml.ts:13). **Area:** Text utils (stripHtml, sanitizeHtml, emojify, mastodonLength, hashtag, useComposedStatus).
  - **Change:** Before reading `textContent`, replace `<br>` with "\n" and append "\n" after block elements (or walk nodes).
  - **Prior observation to check:** `app/utils/stripHtml.ts:13` — `doc.body.textContent` joins `<br>` and `<p>` boundaries with no whitespace: "line one<br>line two" becomes "line oneline two". This garbles reply context, quote previews, share text and conversation previews.
  - **Provenance:** [October 9 candidate, line 434](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:434); explicit source files unchanged at review time.

- [x] **NS-466 · P2 · UX · A · S — Take the per-URL weight from instance config (and treat "absent" as full length on non-Mastodon servers).**
  - **Done:** `mastodonLength` takes `urlWeight`; `urlWeightFor` reads instance config (null = full length on GoToSocial/Akkoma/Pleroma). Wired into `RealComposeBox` and `ChatComposer`. Tested.
  - **Target:** [app/utils/mastodonLength.ts:6](/Users/powerox/neospace/app/utils/mastodonLength.ts:6). **Area:** Text utils (stripHtml, sanitizeHtml, emojify, mastodonLength, hashtag, useComposedStatus).
  - **Change:** Take the per-URL weight from instance config (and treat "absent" as full length on non-Mastodon servers).
  - **Prior observation to check:** `app/utils/mastodonLength.ts:6` — URL weight is hard-coded to 23. Servers that report a different `configuration.statuses.charactersReservedPerUrl`, or count URLs in full (Pleroma/Akkoma/GoToSocial), get a counter that under-counts, so posts shown as valid are rejected.
  - **Provenance:** [October 9 candidate, line 435](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:435); explicit source files unchanged at review time.

- [x] **NS-467 · P2 · A11Y · A · S — Use staticUrl when reduced motion is on (or by user setting) and animate on hover.**
  - **Done:** Partial: `emojify` picks `staticUrl` when reduced motion is on (html `.reduce-motion` or OS). No hover-to-animate.
  - **Target:** [app/utils/emojify.ts:57](/Users/powerox/neospace/app/utils/emojify.ts:57). **Area:** Text utils (stripHtml, sanitizeHtml, emojify, mastodonLength, hashtag, useComposedStatus).
  - **Change:** Use `staticUrl` when reduced motion is on (or by user setting) and animate on hover.
  - **Prior observation to check:** `app/utils/emojify.ts:57` — It always uses the animated `url` and ignores `staticUrl`, so animated custom emoji loop in names and content even under `prefers-reduced-motion`.
  - **Provenance:** [October 9 candidate, line 437](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:437); explicit source files unchanged at review time.

- [x] **NS-468 · P3 · DESIGN · A · S — Set ctx.imageSmoothingQuality = 'high' (or step down by halves).**
  - **Done:** `prepareComposeImage` uses `ctx.imageSmoothingQuality = 'high'`.
  - **Target:** [app/utils/prepareComposeImage.ts:133](/Users/powerox/neospace/app/utils/prepareComposeImage.ts:133). **Area:** useComposeMedia, prepareComposeImage, composeConstants.
  - **Change:** Set `ctx.imageSmoothingQuality = 'high'` (or step down by halves).
  - **Prior observation to check:** `app/utils/prepareComposeImage.ts:133` — A single-step `drawImage` with the default `imageSmoothingQuality` ('low') moiré-aliases 4032→1600 downsizes (text and fabric shimmer).
  - **Provenance:** [October 9 candidate, line 401](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:401); explicit source files unchanged at review time.

- [x] **NS-469 · P3 · PERF · A · S — Move the alpha probe after the passthrough checks.**
  - **Done:** `pngHasAlpha` runs only after passthrough / no-work early returns.
  - **Target:** [app/utils/prepareComposeImage.ts:106](/Users/powerox/neospace/app/utils/prepareComposeImage.ts:106). **Area:** useComposeMedia, prepareComposeImage, composeConstants.
  - **Change:** Move the alpha probe after the passthrough checks.
  - **Prior observation to check:** `app/utils/prepareComposeImage.ts:106` — `pngHasAlpha` (canvas plus `getImageData`) runs before the "no work needed" early return at 109, wasting a readback on every small PNG.
  - **Provenance:** [October 9 candidate, line 402](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:402); explicit source files unchanged at review time.

- [x] **NS-470 · P3 · CODE · A · S — Import the constants in composeMediaLimits and delete the dead export.**
  - **Done:** `instances.composeMediaLimits` imports `DEFAULT_MAX_*` and `MEDIA_ALT_MAX`; removed unused `COMPOSE_MAX_IMAGE_DIMENSION` export.
  - **Target:** [app/utils/composeConstants.ts:6](/Users/powerox/neospace/app/utils/composeConstants.ts:6). **Area:** useComposeMedia, prepareComposeImage, composeConstants.
  - **Change:** Import the constants in `composeMediaLimits` and delete the dead export.
  - **Prior observation to check:** `app/utils/composeConstants.ts:6` — `DEFAULT_MAX_ATTACHMENTS`, `DEFAULT_MAX_FILE_BYTES` (7) and `COMPOSE_MAX_IMAGE_DIMENSION` (19) are unused, while `instances.ts:330-334` hard-codes the same 4 / 40MB.
  - **Provenance:** [October 9 candidate, line 403](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:403); explicit source files unchanged at review time.

- [x] **NS-471 · P3 · A11Y · A · S — Use imageDescription when present, and hide the media box on error.**
  - **Done:** `PreviewCard` uses `imageDescription` for alt and hides the image tile on `@error`.
  - **Target:** [app/components/PreviewCard.vue:104](/Users/powerox/neospace/app/components/PreviewCard.vue:104). **Area:** PreviewCard & peertube.ts.
  - **Change:** Use `imageDescription` when present, and hide the media box on error.
  - **Prior observation to check:** `app/components/PreviewCard.vue:104` — Card images always have `alt=""` and ignore Mastodon 4.3's `card.imageDescription`. There's no blurhash or `@error` fallback, so a failed OG image leaves a gray box.
  - **Provenance:** [October 9 candidate, line 408](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:408); explicit source files unchanged at review time.

- [x] **NS-472 · P3 · A11Y · A · S — Include the alt in the live region ("2 of 4: &lt;alt&gt;"), or move focus to the figure.**
  - **Done:** `NeoLightbox` announces gallery position plus alt in an `aria-live` region.
  - **Target:** [app/components/NeoLightbox.vue:158](/Users/powerox/neospace/app/components/NeoLightbox.vue:158). **Area:** NeoLightbox.
  - **Change:** Include the alt in the live region ("2 of 4: <alt>"), or move focus to the figure.
  - **Prior observation to check:** `app/components/NeoLightbox.vue:158` — Arrow and swipe navigation only announces "2 of 4", not the new image's description.
  - **Provenance:** [October 9 candidate, line 413](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:413); explicit source files unchanged at review time.

- [x] **NS-473 · P3 · UX · A · S — Add "No groups match "{q}"" with the Use-#tag row when valid.**
  - **Done:** `ComposeGroupPicker` shows “No groups match …” when a search has zero hits.
  - **Target:** [app/components/ComposeGroupPicker.vue:258](/Users/powerox/neospace/app/components/ComposeGroupPicker.vue:258). **Area:** ComposeGroupPicker.
  - **Change:** Add "No groups match "{q}"" with the Use-#tag row when valid.
  - **Prior observation to check:** `app/components/ComposeGroupPicker.vue:258` — There's no "No matches" state. A query with zero results (or a non-ASCII query) leaves only the hint text, which reads as broken.
  - **Provenance:** [October 9 candidate, line 423](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:423); explicit source files unchanged at review time.

- [x] **NS-474 · P3 · UX · A · S — On Enter, pick the "Use #query" row or the first result.**
  - **Done:** Enter in group search picks “Use #…” or the first result.
  - **Target:** [app/components/ComposeGroupPicker.vue:227](/Users/powerox/neospace/app/components/ComposeGroupPicker.vue:227). **Area:** ComposeGroupPicker.
  - **Change:** On Enter, pick the "Use #query" row or the first result.
  - **Prior observation to check:** `app/components/ComposeGroupPicker.vue:227` — Enter in the search field (`enterkeyhint="search"`) does nothing.
  - **Provenance:** [October 9 candidate, line 424](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:424); explicit source files unchanged at review time.

- [x] **NS-475 · P3 · UX · A · S — Pick queryTag.value, or display the raw form.**
  - **Done:** `useQueryAsTag` posts `queryTag` (matches the “Use #…” label).
  - **Target:** [app/components/ComposeGroupPicker.vue:104](/Users/powerox/neospace/app/components/ComposeGroupPicker.vue:104). **Area:** ComposeGroupPicker.
  - **Change:** Pick `queryTag.value`, or display the raw form.
  - **Prior observation to check:** `app/components/ComposeGroupPicker.vue:104` — The button says "Use #{{ queryTag }}" (lower-cased at 74), but `useQueryAsTag` picks the raw query, so "Rust" posts `#Rust` while the UI promised `#rust`.
  - **Provenance:** [October 9 candidate, line 425](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:425); explicit source files unchanged at review time.

- [x] **NS-476 · P3 · A11Y · A · S — Remove it; the label "currently X" already conveys state.**
  - **Done:** Removed meaningless `aria-current` from group picker triggers.
  - **Target:** [app/components/ComposeGroupPicker.vue:137](/Users/powerox/neospace/app/components/ComposeGroupPicker.vue:137). **Area:** ComposeGroupPicker.
  - **Change:** Remove it; the label "currently X" already conveys state.
  - **Prior observation to check:** `app/components/ComposeGroupPicker.vue:137` — `aria-current="true"` is set on the trigger buttons (also 171), where it means nothing. Screen readers say "current" on a button that opens a picker.
  - **Provenance:** [October 9 candidate, line 426](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:426); explicit source files unchanged at review time.

- [x] **NS-477 · P3 · CODE · A · S — Delete them.**
  - **Done:** Deleted dead pre-NeoSheet overlay CSS from `ComposeGroupPicker`.
  - **Target:** [app/components/ComposeGroupPicker.vue:477](/Users/powerox/neospace/app/components/ComposeGroupPicker.vue:477). **Area:** ComposeGroupPicker.
  - **Change:** Delete them.
  - **Prior observation to check:** `app/components/ComposeGroupPicker.vue:477` — About 60 lines of dead CSS (`.group-pick-sheet`, `__backdrop`, `__panel`, enter/leave transitions at 684-704) are left from before the NeoSheet migration.
  - **Provenance:** [October 9 candidate, line 427](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:427); explicit source files unchanged at review time.

- [x] **NS-478 · P3 · DESIGN · A · S — Mount unconditionally with appear, or add appear and let the sheet drive the leave before the parent drops it.**
  - **Done:** `PostActionSheet` uses `appear`; share sheet mounts before opening (`RealPostCard`).
  - **Target:** [app/components/PostActionSheet.vue:33](/Users/powerox/neospace/app/components/PostActionSheet.vue:33). **Area:** PostActionSheet.
  - **Change:** Mount unconditionally with `appear`, or add `appear` and let the sheet drive the leave before the parent drops it.
  - **Prior observation to check:** `app/components/PostActionSheet.vue:33` — The `<Transition>` never runs. RealPostCard mounts the sheet with `v-if="shareOpen"` (`RealPostCard.vue:1146`) while `open` is already true (no `appear`), then unmounts it on close, so there's no slide-in or fade-out. The card's own `<Teleport>` (1144) is also redundant.
  - **Provenance:** [October 9 candidate, line 430](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:430); explicit source files unchanged at review time.

- [x] **NS-479 · P3 · A11Y · A · S — Use useId().**
  - **Done:** `PostActionSheet` title id uses `useId()`.
  - **Target:** [app/components/PostActionSheet.vue:22](/Users/powerox/neospace/app/components/PostActionSheet.vue:22). **Area:** PostActionSheet.
  - **Change:** Use `useId()`.
  - **Prior observation to check:** `app/components/PostActionSheet.vue:22` — `titleId` is the constant `'action-sheet-title'`, so any second instance (Share plus a nested sheet, or other callers) duplicates the id and `aria-labelledby` points at the wrong title.
  - **Provenance:** [October 9 candidate, line 431](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:431); explicit source files unchanged at review time.

- [x] **NS-480 · P3 · UX · A · S — Allow balanced parentheses in the URL pattern (as twitter-text does).**
  - **Done:** `mastodonLength` URL scanner allows balanced parentheses.
  - **Target:** [app/utils/mastodonLength.ts:10](/Users/powerox/neospace/app/utils/mastodonLength.ts:10). **Area:** Text utils (stripHtml, sanitizeHtml, emojify, mastodonLength, hashtag, useComposedStatus).
  - **Change:** Allow balanced parentheses in the URL pattern (as twitter-text does).
  - **Prior observation to check:** `app/utils/mastodonLength.ts:10` — The URL token stops at `(`, so `https://en.wikipedia.org/wiki/Foo_(bar)` counts 23 + 5 instead of 23 and the counter overstates.
  - **Provenance:** [October 9 candidate, line 436](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:436); explicit source files unchanged at review time.

- [x] **NS-481 · P3 · UX · A · S — Key the map case-sensitively.**
  - **Done:** `emojify` maps shortcodes case-sensitively.
  - **Target:** [app/utils/emojify.ts:45](/Users/powerox/neospace/app/utils/emojify.ts:45). **Area:** Text utils (stripHtml, sanitizeHtml, emojify, mastodonLength, hashtag, useComposedStatus).
  - **Change:** Key the map case-sensitively.
  - **Prior observation to check:** `app/utils/emojify.ts:45` — Shortcodes are folded to lower case, so `:Blobcat:` and `:blobcat:` (distinct emoji on many servers) render the same image.
  - **Provenance:** [October 9 candidate, line 438](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:438); explicit source files unchanged at review time.

- [x] **NS-482 · P3 · UX · A · S — Add those tags and attributes.**
  - **Done:** `sanitizeHtml` allowlist adds sub/sup/ruby and list start/value attrs.
  - **Target:** [app/utils/sanitizeHtml.ts:8](/Users/powerox/neospace/app/utils/sanitizeHtml.ts:8). **Area:** Text utils (stripHtml, sanitizeHtml, emojify, mastodonLength, hashtag, useComposedStatus).
  - **Change:** Add those tags and attributes.
  - **Prior observation to check:** `app/utils/sanitizeHtml.ts:8` — The allowlist drops `sub`, `sup`, `ruby`, `rt` and `rp`, which Mastodon allows. Japanese furigana collapse into run-on text ("漢字かんじ") and x² becomes "x2". `ol[start|reversed]` and `li[value]` (15) are also stripped, so lists renumber from 1.
  - **Provenance:** [October 9 candidate, line 439](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:439); explicit source files unchanged at review time.

- [x] **NS-483 · P3 · CODE · A · S — Drop the filter (or class from NAME_ATTR).**
  - **Done:** Removed dead `class` filter in `sanitizeDisplayName`.
  - **Target:** [app/utils/sanitizeHtml.ts:116](/Users/powerox/neospace/app/utils/sanitizeHtml.ts:116). **Area:** Text utils (stripHtml, sanitizeHtml, emojify, mastodonLength, hashtag, useComposedStatus).
  - **Change:** Drop the filter (or `class` from `NAME_ATTR`).
  - **Prior observation to check:** `app/utils/sanitizeHtml.ts:116` — `NAME_ATTR.filter((a) => a !== 'class')` is dead, because `purifyWithSafeClasses` re-adds `'class'` (63).
  - **Provenance:** [October 9 candidate, line 440](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:440); explicit source files unchanged at review time.

- [x] **NS-484 · P3 · UX · A · S — Pluralize, use Intl.NumberFormat, and label it "accounts (daily sum)" or use the last 2 days like Mastodon.**
  - **Done:** `tagHistorySummary` pluralizes and uses `Intl.NumberFormat` + “accounts (daily sum)”.
  - **Target:** [app/utils/hashtag.ts:25](/Users/powerox/neospace/app/utils/hashtag.ts:25). **Area:** Text utils (stripHtml, sanitizeHtml, emojify, mastodonLength, hashtag, useComposedStatus).
  - **Change:** Pluralize, use `Intl.NumberFormat`, and label it "accounts (daily sum)" or use the last 2 days like Mastodon.
  - **Prior observation to check:** `app/utils/hashtag.ts:25` — `tagHistorySummary` prints "1 posts · last 7d" and non-localized counts. "people" is a sum of daily unique accounts over 7 days, so it counts the same person repeatedly.
  - **Provenance:** [October 9 candidate, line 441](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:441); explicit source files unchanged at review time.

- [x] **NS-485 · P3 · CODE · A · S — Wrap each handler call in try/catch.**
  - **Done:** `emitComposedStatus` wraps handlers in try/catch.
  - **Target:** [app/composables/useComposedStatus.ts:13](/Users/powerox/neospace/app/composables/useComposedStatus.ts:13). **Area:** Text utils (stripHtml, sanitizeHtml, emojify, mastodonLength, hashtag, useComposedStatus).
  - **Change:** Wrap each handler call in try/catch.
  - **Prior observation to check:** `app/composables/useComposedStatus.ts:13` — One throwing handler aborts the loop, so later columns never receive the freshly posted status.
  - **Provenance:** [October 9 candidate, line 442](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:442); explicit source files unchanged at review time.

## Remaining candidates: Profile, Explore & Search

- [x] **NS-486 · P1 · UX · A · M — Add relationship actions to the NeoMenu, using the Relationship the server returns to update the state and…**
  - **Target:** [app/pages/profile.vue:620](/Users/powerox/neospace/app/pages/profile.vue:620). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Add relationship actions to the `NeoMenu`, using the Relationship the server returns to update the state and `openConfirm` for Block and Report.
  - **Prior observation to check:** `app/pages/profile.vue:620` — The profile ⋯ menu only has Share, Copy handle, Open on instance and the presence links. There's no Mute, Block, Report, domain block, Unmute or Unblock. The chips at `:242-244` say "Muted" or "Blocked", but the page gives no way to undo either.
  - **Prior verifier qualification:** Confirmed: the profile menu has only Share, Copy handle, Open on instance and links, with no Mute, Block or Report. But "no way to undo" is overstated: Settings moderation has unmute and unblock (`settings.ts:1026,1044`). [Corrected: "The profile page can show Muted/Blocked chips but offers no mute, block, report, unmute or unblock. Undo is only available in Settings." Impact Medium-High.]
  - **Provenance:** [October 9 candidate, line 833](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:833); explicit source files unchanged at review time.
  - Evidence: Profile ⋯ menu gains Mute/Unmute, Block/Unblock and Report for other accounts once the relationship has loaded (`profile.vue`). Mute and Block use `openConfirm`; the Relationship the server returns replaces local state and is ignored if the viewed profile changed meanwhile. New `setRelationship` / `reportViewedAccount` in `stores/profile.ts`. Domain block/unblock is not added to the menu.

- [x] **NS-487 · P1 · UX · A · S — Add a banner with a link to moved.acct, and demote the Follow button to secondary.**
  - **Target:** [app/pages/profile.vue:691](/Users/powerox/neospace/app/pages/profile.vue:691). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Add a banner with a link to `moved.acct`, and demote the Follow button to secondary.
  - **Prior observation to check:** `app/pages/profile.vue:691` — `viewedProfile.moved` is never read. A migrated account shows as a normal profile with an active Follow button, and nothing says "This account has moved to @new".
  - **Provenance:** [October 9 candidate, line 835](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:835); explicit source files unchanged at review time.
  - Evidence: `profile.vue` shows a "has moved to @new" banner linking to the new profile (handle qualified with the moved account's host) and demotes Follow to the secondary style when `viewedProfile.moved` is set.

- [x] **NS-488 · P1 · UX · A · M — Auto-page until N matches or the end is reached, or request exclude_reblogs:true for Posts.**
  - **Target:** [app/pages/profile.vue:323](/Users/powerox/neospace/app/pages/profile.vue:323). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Auto-page until N matches or the end is reached, or request `exclude_reblogs:true` for Posts.
  - **Prior observation to check:** `app/pages/profile.vue:323` — Posts and Reposts still filter one 20-item page on the client (`stores/profile.ts:246`) and don't auto-page. A heavy booster's Posts tab says "No posts yet." with a Load more button underneath.
  - **Provenance:** [October 9 candidate, line 863](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:863); explicit source files unchanged at review time.
  - Evidence: Posts, Media and Replies now request `exclude_reblogs: true` (store + page), and every tab auto-pages (up to 5 extra pages, until 8 matches) so Reposts/Replies on a heavy booster no longer show "No posts yet." over a Load more button; an `isFillingTab` flag stops the empty state flashing between pages.

- [x] **NS-489 · P1 · SEC · R · S — Run the position rewrite before inserting markers, and also match after */ ((^|[;{\s]|\*\/))**
  - **Target:** [app/utils/sanitizeCss.ts:78](/Users/powerox/neospace/app/utils/sanitizeCss.ts:78). **Area:** app/utils/sanitizeCss.ts — profile skin sanitizer.
  - **Change:** Run the position rewrite before inserting markers, and also match after `*/` (`(^|[;{\s]|\*\/)`). Better: rewrite each declaration in `scopeCss` with a declaration-level parser. Add a regression test.
  - **Prior observation to check:** `app/utils/sanitizeCss.ts:78` — The position rewrite only fires when `position` follows `^`, `;`, `{` or whitespace. The blocklist replacements on `:49-55` insert `/* blocked … */` markers that end in `/`, so `a{javascript:position:fixed;inset:0;z-index:2147483647}` becomes `/* blocked javascript: */position:fixed`, which isn't rewritten. The browser drops the comment and applies `position:fixed`, and a full-screen spoof overlay escapes the scope.
  - **Provenance:** [October 9 candidate, line 884](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:884); explicit source files unchanged at review time.
  - Evidence: Reproduced: `a{javascript:position:fixed;inset:0;z-index:2147483647}` came out as `/* blocked javascript: */position:fixed`. The position rewrite now matches after any non-identifier character (so after `*/` markers), leaving `background-position` / `--position` alone. Regression tests in `tests/platform-security.test.ts`.

- [x] **NS-490 · P1 · SEC · R · M — Inject .chaos-active #main-content{position:relative;contain:paint;isolation:isolate;z-index:0} with the…**
  - **Target:** [app/utils/sanitizeCss.ts:30](/Users/powerox/neospace/app/utils/sanitizeCss.ts:30). **Area:** app/utils/sanitizeCss.ts — profile skin sanitizer.
  - **Change:** Inject `.chaos-active #main-content{position:relative;contain:paint;isolation:isolate;z-index:0}` with the skin, drop empty parts, and clamp `z-index`.
  - **Prior observation to check:** `app/utils/sanitizeCss.ts:30` — `position:absolute` is allowed, and `#main-content` is `position:static` with no `contain` (`layouts/default.vue:424`). An absolutely positioned descendant with `top:0;left:0;width:100vw;height:100vh;z-index:99999` therefore covers the sidebar, tab bar and dialogs. `scopeSelectors` (`:148`) also turns an empty selector part (`, x{}`) into a rule on `#main-content` itself.
  - **Provenance:** [October 9 candidate, line 885](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:885); explicit source files unchanged at review time.
  - Evidence: Reproduced: an empty selector part and the bare scope styled `#main-content`, and `position:absolute` + `z-index:99999` could cover the shell. `sanitizeCss.ts` now drops empty/bare-scope selectors, clamps integer `z-index` to ±100 (non-integer → `auto`), and appends `SKIN_CONTAINMENT` (`position:relative; contain:paint; isolation:isolate; z-index:0` on `.chaos-active #main-content`) to every non-empty skin. Existing exact-output tests updated; new tests cover each case and idempotence still holds.

- [x] **NS-491 · P2 · UX · A · S — Show a "Suspended" or "Hidden by your server's moderators" state with a click-through.**
  - **Done:** Profile shows a moderation notice (suspended / hidden by moderators) and an explanatory empty-posts state.
  - **Target:** [app/pages/profile.vue:691](/Users/powerox/neospace/app/pages/profile.vue:691). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Show a "Suspended" or "Hidden by your server's moderators" state with a click-through.
  - **Prior observation to check:** `app/pages/profile.vue:691` — `limited` (hidden by moderators) and `suspended` accounts aren't handled. A suspended remote account shows "No posts yet." and a working Follow button.
  - **Provenance:** [October 9 candidate, line 836](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:836); explicit source files unchanged at review time.

- [x] **NS-492 · P2 · UX · A · S — Add a "Blocked you" chip, and swap Follow for Unblock (or disable it) when blocking or blockedBy is set.**
  - **Done:** "Blocked you" chip added; Follow is disabled when `blocking`/`blockedBy` (Unblock kept for `blocking`).
  - **Target:** [app/pages/profile.vue:237](/Users/powerox/neospace/app/pages/profile.vue:237). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Add a "Blocked you" chip, and swap Follow for Unblock (or disable it) when `blocking` or `blockedBy` is set.
  - **Prior observation to check:** `app/pages/profile.vue:237` — The relationship chips ignore `blockedBy`, and the Follow button (`:933`) still says "Follow" while you're blocking or blocked. Clicking it fails with a generic toast.
  - **Provenance:** [October 9 candidate, line 837](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:837); explicit source files unchanged at review time.

- [x] **NS-493 · P2 · CODE · A · S — Store the normalized keys (customcss, chaoscss, neospacecolumns) or normalize the set.**
  - **Done:** New `utils/profileCss.ts` normalizes keys (`cssFieldKey`, `isColumnsField`); `INTERNAL_FIELD_NAMES` mismatch removed. Tested.
  - **Target:** [app/pages/profile.vue:38](/Users/powerox/neospace/app/pages/profile.vue:38). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Store the normalized keys (`customcss`, `chaoscss`, `neospacecolumns`) or normalize the set.
  - **Prior observation to check:** `app/pages/profile.vue:38` — `INTERNAL_FIELD_NAMES` keeps underscores (`custom_css`, `chaos_css`, `neospace_columns`), but `:96` compares them against `normalizeFieldKey()`, which strips every non-alphanumeric character. Those fields are never filtered out, so raw CSS or column JSON shows up as a profile chip.
  - **Provenance:** [October 9 candidate, line 838](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:838); explicit source files unchanged at review time.

- [x] **NS-494 · P2 · UX · A · S — Only treat a field as CSS when its value looks like CSS (contains {), or reserve the namespaced…**
  - **Done:** `theme`/`style` fields count as CSS only when the value contains `{` (`isProfileCssField`). Tested.
  - **Target:** [app/pages/profile.vue:38](/Users/powerox/neospace/app/pages/profile.vue:38). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Only treat a field as CSS when its value looks like CSS (contains `{`), or reserve the namespaced `neospace_css` key.
  - **Prior observation to check:** `app/pages/profile.vue:38` — Any field labelled "Theme" or "Style" (for example "Style: Jazz") is hidden from viewers and handed to the CSS sanitizer (`stores/profile.ts:120`).
  - **Provenance:** [October 9 candidate, line 839](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:839); explicit source files unchanged at review time.

- [x] **NS-495 · P2 · UX · A · S — Show any presence field that didn't become a chip as a normal token.**
  - **Done:** `resolvePresence` returns consumed indexes; unconsumed fields stay ordinary tokens. Tested.
  - **Target:** [app/pages/profile.vue:97](/Users/powerox/neospace/app/pages/profile.vue:97). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Show any presence field that didn't become a chip as a normal token.
  - **Prior observation to check:** `app/pages/profile.vue:97` — Every presence-like field is hidden from the field tokens, but `buildPresenceLinks` (`utils/profileSources.ts:248`) keeps only one link per kind. A second "Homepage" or "Bluesky" field disappears for viewers, and so does a "Website"/"URL"/"Site" field whose value isn't a link (for example "coming soon").
  - **Provenance:** [October 9 candidate, line 840](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:840); explicit source files unchanged at review time.

- [x] **NS-496 · P2 · UX · A · S — Carry verifiedAt into PresenceLink and render the ✓ on the chip.**
  - **Done:** `PresenceLink.verifiedAt` carried through; ✓ rendered on presence chips.
  - **Target:** [app/pages/profile.vue:813](/Users/powerox/neospace/app/pages/profile.vue:813). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Carry `verifiedAt` into `PresenceLink` and render the ✓ on the chip.
  - **Prior observation to check:** `app/pages/profile.vue:813` — The verified ✓ only renders on non-presence tokens. A Website field that Mastodon verified via `rel=me` (the most common verified field) loses its checkmark when it moves to the presence chips (`:853`).
  - **Provenance:** [October 9 candidate, line 841](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:841); explicit source files unchanged at review time.

- [x] **NS-497 · P2 · UX · A · S — Read nodeinfo or instanceInfo, or drop the badge.**
  - **Done:** Partial: the software badge is hidden for remote profiles (it showed the viewer's server software).
  - **Target:** [app/pages/profile.vue:210](/Users/powerox/neospace/app/pages/profile.vue:210). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Read nodeinfo or `instanceInfo`, or drop the badge.
  - **Prior observation to check:** `app/pages/profile.vue:210` — `softwareLabel` guesses the software from the profile URL's hostname (`/gotosocial|gts\./`). Almost every profile is labelled "MASTODON", including Akkoma, Misskey and Pixelfed hosts.
  - **Provenance:** [October 9 candidate, line 842](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:842); explicit source files unchanged at review time.

- [x] **NS-498 · P2 · UX · A · S — Set requested: viewedProfile.locked, following: !locked optimistically.**
  - **Done:** Optimistic follow sets `requested` for locked accounts, `following` otherwise.
  - **Target:** [app/pages/profile.vue:495](/Users/powerox/neospace/app/pages/profile.vue:495). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Set `requested: viewedProfile.locked, following: !locked` optimistically.
  - **Prior observation to check:** `app/pages/profile.vue:495` — When following a locked account, the optimistic update sets `following: true`. The button flashes "Following" and then flips to "Requested".
  - **Provenance:** [October 9 candidate, line 845](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:845); explicit source files unchanged at review time.

- [x] **NS-499 · P2 · CODE · A · S — Watch [user, account] and always go through loadProfileFromRoute.**
  - **Done:** Route watch is now on `[user, account]` and goes through `loadProfileFromRoute`.
  - **Target:** [app/pages/profile.vue:64](/Users/powerox/neospace/app/pages/profile.vue:64). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Watch `[user, account]` and always go through `loadProfileFromRoute`.
  - **Prior observation to check:** `app/pages/profile.vue:64` — When `route.query.account` changes, the read override updates but the profile isn't reloaded. The relationship and statuses stay from the previous account. (`AccountSwitcherSheet.vue:59` also calls `fetchProfile()` directly, skipping relationship, tab and CSS sync.)
  - **Provenance:** [October 9 candidate, line 848](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:848); explicit source files unchanged at review time.

- [x] **NS-500 · P2 · UX · A · S — Store the original error (or its status) and map 404 to "Account not found" with no Retry.**
  - **Done:** Profile store keeps `errorStatus` (404 → "Account not found", no Retry).
  - **Target:** [app/pages/profile.vue:588](/Users/powerox/neospace/app/pages/profile.vue:588). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Store the original error (or its status) and map 404 to "Account not found" with no Retry.
  - **Prior observation to check:** `app/pages/profile.vue:588` — The store keeps only `e.message`, and the page wraps it in `new Error(...)`, so the HTTP status is lost. A 404 ("User not found" or "Record not found") shows "Something went wrong" with a Retry button.
  - **Provenance:** [October 9 candidate, line 850](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:850); explicit source files unchanged at review time.

- [x] **NS-501 · P2 · A11Y · A · S — Use headerStatic and avatarStatic when reduced motion is on.**
  - **Done:** Header and avatar use static URLs when reduced motion is on (`usePrefersReducedMotion`).
  - **Target:** [app/pages/profile.vue:196](/Users/powerox/neospace/app/pages/profile.vue:196). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Use `headerStatic` and `avatarStatic` when reduced motion is on.
  - **Prior observation to check:** `app/pages/profile.vue:196` — The header and avatar (`:207`) always use the animated `header` and `avatar`, ignoring both the app's `reduceMotion` setting and `prefers-reduced-motion`.
  - **Provenance:** [October 9 candidate, line 854](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:854); explicit source files unchanged at review time.

- [x] **NS-502 · P2 · UX · A · S — Intercept .mention and .hashtag clicks the way RealPostCard.vue:708 does.**
  - **Done:** Bio clicks route `.mention`/`.hashtag` in-app via `inAppLinkFor`. Tested.
  - **Target:** [app/pages/profile.vue:794](/Users/powerox/neospace/app/pages/profile.vue:794). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Intercept `.mention` and `.hashtag` clicks the way `RealPostCard.vue:708` does.
  - **Prior observation to check:** `app/pages/profile.vue:794` — Bio links go through `sanitizeStatusHtml` with `target=_blank`, so @mentions and #hashtags in a bio open the remote instance in a new tab instead of `/profile` or `/groups`. The same happens for mention links in fields (`:104`).
  - **Provenance:** [October 9 candidate, line 855](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:855); explicit source files unchanged at review time.

- [x] **NS-503 · P2 · UX · A · S — Use "Only approved followers can see posts" when locked && !following, and add an "Older posts may be on…**
  - **Done:** Locked-and-not-following gets "Only approved followers can see posts"; remote accounts get an "Older posts may be on {host}" note.
  - **Target:** [app/pages/profile.vue:1142](/Users/powerox/neospace/app/pages/profile.vue:1142). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Use "Only approved followers can see posts" when `locked && !following`, and add an "Older posts may be on {host}" link for remote accounts.
  - **Prior observation to check:** `app/pages/profile.vue:1142` — The empty state can't tell why there are no posts. A locked account you don't follow, or a remote account whose older posts never federated, shows "No posts yet."
  - **Provenance:** [October 9 candidate, line 865](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:865); explicit source files unchanged at review time.

- [x] **NS-504 · P2 · UX · A · S — Add a "Pinned" section label or a per-card pin badge.**
  - **Done:** Added a "Pinned" section label.
  - **Target:** [app/pages/profile.vue:1121](/Users/powerox/neospace/app/pages/profile.vue:1121). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Add a "Pinned" section label or a per-card pin badge.
  - **Prior observation to check:** `app/pages/profile.vue:1121` — Pinned posts render at the top with no "Pinned" heading or badge (`RealPostCard` has no pinned indicator), so an old pin looks like the newest post.
  - **Provenance:** [October 9 candidate, line 866](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:866); explicit source files unchanged at review time.

- [x] **NS-505 · P2 · UX · A · S — Hide the &lt;h1&gt; while isEditing, or bind it to the draft.**
  - **Done:** The profile `<h1>` is hidden while editing.
  - **Target:** [app/pages/profile.vue:713](/Users/powerox/neospace/app/pages/profile.vue:713). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Hide the `<h1>` while `isEditing`, or bind it to the draft.
  - **Prior observation to check:** `app/pages/profile.vue:713` — While editing, the display-name input and the old `<h1>` name both render, so the name appears twice and the heading doesn't update as you type.
  - **Provenance:** [October 9 candidate, line 869](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:869); explicit source files unchanged at review time.

- [x] **NS-506 · P2 · UX · A · S — Rename it "Save", disable Cancel while isUpdating, toast "Profile saved", and add an onBeforeRouteLeave…**
  - **Done:** Button renamed "Save"; Cancel disabled while updating; `onBeforeRouteLeave` guard on dirty edits.
  - **Target:** [app/pages/profile.vue:905](/Users/powerox/neospace/app/pages/profile.vue:905). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Rename it "Save", disable Cancel while `isUpdating`, toast "Profile saved", and add an `onBeforeRouteLeave` guard when the form is dirty.
  - **Prior observation to check:** `app/pages/profile.vue:905` — The save button says "Done", Cancel (`:907`) stays enabled while saving, there's no success toast, and navigating away silently discards unsaved edits.
  - **Provenance:** [October 9 candidate, line 870](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:870); explicit source files unchanged at review time.

- [x] **NS-507 · P2 · UX · A · M — Include private in the on-screen report and filter only the CSV/Loom payload, or add a toggle.**
  - **Target:** [app/stores/insights.ts:201](/Users/powerox/neospace/app/stores/insights.ts:201). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Include `private` in the on-screen report and filter only the CSV/Loom payload, or add a toggle.
  - **Prior observation to check:** `app/stores/insights.ts:201` — Followers-only posts are excluded from your own charts as well as from export (also `utils/insights.ts:191`). For people who mostly post followers-only, every KPI reads near zero.
  - **Provenance:** [October 9 candidate, line 891](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:891); explicit source files unchanged at review time.
  - **Done:** Decision: the **on-screen report includes followers-only posts** (it is the owner's own view) while **exports (CSV/zip/Loom) exclude them** and direct messages are never counted. `buildInsightsReport({ includePrivate })`; `ProfileInsights` copy says so. Tests: `tests/p2-final-batch.test.ts`.

- [x] **NS-508 · P2 · UX · A · S — Either exclude boosts from the waffle or label the KPI "Posts (excl**
  - **Done:** KPI relabelled "Posts (excl. boosts)" with a separate "Boosts shared" count.
  - **Target:** [app/utils/insights.ts:198](/Users/powerox/neospace/app/utils/insights.ts:198). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Either exclude boosts from the waffle or label the KPI "Posts (excl. boosts)" and show a boosts count.
  - **Prior observation to check:** `app/utils/insights.ts:198` — The "Post types" waffle counts boosts (`:303`), but the "Posts" KPI, the heatmap, the daily posts and the attribute percentages use `countable` (no boosts). The numbers on one screen disagree, for example 10 posts in the KPI against a waffle of 12.
  - **Provenance:** [October 9 candidate, line 892](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:892); explicit source files unchanged at review time.

- [x] **NS-509 · P2 · UX · A · S — Use stripHtml (DOMParser) or decode numeric entities.**
  - **Done:** `stripTags` in `insights.ts` decodes named and numeric entities.
  - **Target:** [app/utils/insights.ts:118](/Users/powerox/neospace/app/utils/insights.ts:118). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Use `stripHtml` (DOMParser) or decode numeric entities.
  - **Prior observation to check:** `app/utils/insights.ts:118` — `stripTags` decodes only five named entities. Mastodon encodes apostrophes as `&#39;`, so Top-post previews and the CSV `preview` column show "it&#39;s".
  - **Provenance:** [October 9 candidate, line 893](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:893); explicit source files unchanged at review time.

- [x] **NS-510 · P2 · PERF · A · S — Fetch the requested window first, render, then backfill to 90d in the background for the cache.**
  - **Target:** [app/stores/insights.ts:168](/Users/powerox/neospace/app/stores/insights.ts:168). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Fetch the requested window first, render, then backfill to 90d in the background for the cache.
  - **Prior observation to check:** `app/stores/insights.ts:168` — Every load fetches 90 days (up to 12 × 40 statuses) even for the default 30d or 7d view, so the first paint waits on the largest window.
  - **Provenance:** [October 9 candidate, line 895](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:895); explicit source files unchanged at review time.
  - **Done:** The insights store fetches the requested window first and renders, then backfills to 90 days in the background for the cache (`stores/insights.ts`); `windowTruncated` reports truncation per requested window (a capped 90d backfill that still reaches back past 7d isn't "truncated" for 7d). Tests: `tests/p2-final-batch.test.ts`.

- [x] **NS-511 · P2 · UX · A · S — Zip the three files, or offer three separate downloads.**
  - **Target:** [app/utils/loomExport.ts:88](/Users/powerox/neospace/app/utils/loomExport.ts:88). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Zip the three files, or offer three separate downloads.
  - **Prior observation to check:** `app/utils/loomExport.ts:88` — "Download CSV" builds one file that stacks three tables with different headers and `# name` comment lines. It isn't valid CSV, so Excel and Sheets show mixed columns.
  - **Provenance:** [October 9 candidate, line 901](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:901); explicit source files unchanged at review time.
  - **Done:** The "CSV" export is now a real zip of three valid CSV files (`utils/zip.ts` store-method writer, `loomExport.ts`) instead of three tables stacked in one file. Tests: CRC-32 vector + archive structure in `tests/p2-final-batch.test.ts`.

- [x] **NS-512 · P2 · UX · A · S — Hide the actions when account.id === currentUser.id.**
  - **Done:** Follow/Message actions hidden for the viewer's own row (`SearchPersonRow`, `FollowersModal`).
  - **Target:** [app/components/FollowersModal.vue:313](/Users/powerox/neospace/app/components/FollowersModal.vue:313). **Area:** app/components/FollowersModal.vue.
  - **Change:** Hide the actions when `account.id === currentUser.id`.
  - **Prior observation to check:** `app/components/FollowersModal.vue:313` — There's no self check. When your own account appears in someone's Followers or Following list, it gets a "Follow"/"Follow back" button and a Mute/Block menu for yourself. The same applies to `SearchPersonRow.vue:66`.
  - **Provenance:** [October 9 candidate, line 905](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:905); explicit source files unchanged at review time.

- [x] **NS-513 · P2 · UX · A · S — Render a neutral, disabled button until relationships[id] arrives.**
  - **Done:** `FollowersModal` shows a neutral disabled button until relationships settle.
  - **Target:** [app/components/FollowersModal.vue:80](/Users/powerox/neospace/app/components/FollowersModal.vue:80). **Area:** app/components/FollowersModal.vue.
  - **Change:** Render a neutral, disabled button until `relationships[id]` arrives.
  - **Prior observation to check:** `app/components/FollowersModal.vue:80` — Relationships are fetched fire-and-forget after the rows render. Every row first shows "Follow back"/"Follow" and then flips to "Following", and a quick tap re-follows.
  - **Provenance:** [October 9 candidate, line 906](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:906); explicit source files unchanged at review time.

- [x] **NS-514 · P2 · UX · A · S — Reuse openConfirm for unfollow.**
  - **Done:** Unfollow from `FollowersModal` goes through `openConfirm`.
  - **Target:** [app/components/FollowersModal.vue:136](/Users/powerox/neospace/app/components/FollowersModal.vue:136). **Area:** app/components/FollowersModal.vue.
  - **Change:** Reuse `openConfirm` for unfollow.
  - **Prior observation to check:** `app/components/FollowersModal.vue:136` — Unfollowing from the list happens on one tap with no confirmation, while the profile page confirms (`profile.vue:498`).
  - **Provenance:** [October 9 candidate, line 907](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:907); explicit source files unchanged at review time.

- [x] **NS-515 · P2 · UX · A · S — Map the error to friendly copy.**
  - **Done:** `FollowersModal` maps load errors to friendly copy.
  - **Target:** [app/components/FollowersModal.vue:88](/Users/powerox/neospace/app/components/FollowersModal.vue:88). **Area:** app/components/FollowersModal.vue.
  - **Change:** Map the error to friendly copy.
  - **Prior observation to check:** `app/components/FollowersModal.vue:88` — `loadError` shows the raw `err.message` (for example "Record not found" or a fetch TypeError), even though `mapErrorToMessage` is already imported in this file.
  - **Provenance:** [October 9 candidate, line 908](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:908); explicit source files unchanged at review time.

- [x] **NS-516 · P2 · UX · A · S — When the account is remote, add "Only followers known to {your server} are shown" and an "Open on {host}"…**
  - **Done:** `FollowersModal` shows "Only followers known to {your server} are shown" for remote accounts.
  - **Target:** [app/components/FollowersModal.vue:270](/Users/powerox/neospace/app/components/FollowersModal.vue:270). **Area:** app/components/FollowersModal.vue.
  - **Change:** When the account is remote, add "Only followers known to {your server} are shown" and an "Open on {host}" link.
  - **Prior observation to check:** `app/components/FollowersModal.vue:270` — For remote accounts the server only knows local followers, so "12.4K followers" opens a list of three with no explanation.
  - **Provenance:** [October 9 candidate, line 909](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:909); explicit source files unchanged at review time.

- [x] **NS-517 · P2 · UX · A · S — Only show this when account.bot is true.**
  - **Done:** `ProfileHumanBadges` shows the bot badge only when `account.bot === true`.
  - **Target:** [app/components/ProfileHumanBadges.vue:39](/Users/powerox/neospace/app/components/ProfileHumanBadges.vue:39). **Area:** app/components/ProfilePeekCard.vue & ProfileHumanBadges.vue.
  - **Change:** Only show this when `account.bot` is true.
  - **Prior observation to check:** `app/components/ProfileHumanBadges.vue:39` — On someone else's profile the tab publicly says "This account is marked as a bot (or looks like one)" based on a name heuristic (`edwardSemantics.ts:194` matches surnames like "Mia Bot").
  - **Provenance:** [October 9 candidate, line 920](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:920); explicit source files unchanged at review time.

- [x] **NS-518 · P2 · UX · A · S — Call ensureRelationships(discovery.suggestedPeople) when the query clears, or don't wipe relationships for…**
  - **Done:** `useFediverseSearch` no longer wipes relationships per search (cleared on account switch).
  - **Target:** [app/composables/useFediverseSearch.ts:407](/Users/powerox/neospace/app/composables/useFediverseSearch.ts:407). **Area:** app/pages/explore.vue.
  - **Change:** Call `ensureRelationships(discovery.suggestedPeople)` when the query clears, or don't wipe relationships for ids that are still shown.
  - **Prior observation to check:** `app/composables/useFediverseSearch.ts:407` — Every new search sets `relationships = {}`, but suggestions only get relationships when `discovery.suggestedPeople` changes (`explore.vue:193`). After a search and Clear, the People empty state shows "Follow" on people you already follow.
  - **Provenance:** [October 9 candidate, line 926](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:926); explicit source files unchanged at review time.

- [x] **NS-519 · P2 · UX · A · S — Page resultsFor.value, and skip while the debounce timer is pending.**
  - **Done:** `loadMore` pages `resultsFor` and skips when the box text differs from the sent query.
  - **Target:** [app/composables/useFediverseSearch.ts:485](/Users/powerox/neospace/app/composables/useFediverseSearch.ts:485). **Area:** app/pages/explore.vue.
  - **Change:** Page `resultsFor.value`, and skip while the debounce timer is pending.
  - **Prior observation to check:** `app/composables/useFediverseSearch.ts:485` — `loadMore` pages `opts.query.value` (the text in the box) rather than `resultsFor`. Typing while scrolled to the sentinel appends page 2 of the new query, at the old offset, onto the old results.
  - **Provenance:** [October 9 candidate, line 927](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:927); explicit source files unchanged at review time.

- [x] **NS-520 · P2 · UX · A · S — Add a loadMoreError with an inline "Couldn't load more · Retry" in place of the sentinel at explore.vue:1072.**
  - **Done:** `loadMoreError` + `retryLoadMore`; `explore.vue` shows "Couldn’t load more · Retry".
  - **Target:** [app/composables/useFediverseSearch.ts:473](/Users/powerox/neospace/app/composables/useFediverseSearch.ts:473). **Area:** app/pages/explore.vue.
  - **Change:** Add a `loadMoreError` with an inline "Couldn't load more · Retry" in place of the sentinel at `explore.vue:1072`.
  - **Prior observation to check:** `app/composables/useFediverseSearch.ts:473` — A failed load-more just sets `searchHasMore=false`, so results end silently with no error or Retry.
  - **Provenance:** [October 9 candidate, line 928](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:928); explicit source files unchanged at review time.

- [x] **NS-521 · P2 · UX · A · S — Only claim host intent on Enter when the TLD is in a known list or the instance probe succeeds; otherwise…**
  - **Done:** Partial: host intent now excludes common file extensions (`NOT_A_TLD`) so `notes.txt` searches as text. Tested.
  - **Target:** [app/utils/searchQuery.ts:19](/Users/powerox/neospace/app/utils/searchQuery.ts:19). **Area:** app/pages/explore.vue.
  - **Change:** Only claim host intent on Enter when the TLD is in a known list or the instance probe succeeds; otherwise search.
  - **Prior observation to check:** `app/utils/searchQuery.ts:19` — `HOST_RE` treats "node.js", "vue.js" or "asp.net" as a hostname. On All this shows a "Couldn't reach node.js" server card (`explore.vue:961`), and Enter (`explore.vue:398`) runs a server lookup instead of a search.
  - **Provenance:** [October 9 candidate, line 930](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:930); explicit source files unchanged at review time.

- [x] **NS-522 · P2 · UX · A · S — Accept a host/path shape, prefix https:// and resolve.**
  - **Done:** Scheme-less `host/path` is a url intent and `resolvableQuery` prefixes `https://`. Tested.
  - **Target:** [app/utils/searchQuery.ts:15](/Users/powerox/neospace/app/utils/searchQuery.ts:15). **Area:** app/pages/explore.vue.
  - **Change:** Accept a `host/path` shape, prefix `https://` and resolve.
  - **Prior observation to check:** `app/utils/searchQuery.ts:15` — `URL_RE` requires a scheme, so pasting "mastodon.social/@user/1234" (common from mobile share sheets) is treated as text and never resolved.
  - **Provenance:** [October 9 candidate, line 931](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:931); explicit source files unchanged at review time.

- [x] **NS-523 · P2 · CODE · A · S — Include activeAccountId in cacheKey.**
  - **Done:** `cacheKey` includes `activeAccountId`.
  - **Target:** [app/composables/useFediverseSearch.ts:187](/Users/powerox/neospace/app/composables/useFediverseSearch.ts:187). **Area:** app/pages/explore.vue.
  - **Change:** Include `activeAccountId` in `cacheKey`.
  - **Prior observation to check:** `app/composables/useFediverseSearch.ts:187` — The module-level cache key uses the server URL, not the account. Two linked accounts on the same server share cached results for `from:me` or "People I follow", so account B sees A's posts and followings.
  - **Provenance:** [October 9 candidate, line 935](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:935); explicit source files unchanged at review time.

- [x] **NS-524 · P2 · CODE · A · S — Key the cache by activeAccountId and reload on change.**
  - **Done:** `useAccountSearch` tracks the owning account and resets on account change.
  - **Target:** [app/composables/useAccountSearch.ts:30](/Users/powerox/neospace/app/composables/useAccountSearch.ts:30). **Area:** Composables: discovery, recents, account search, pagers.
  - **Change:** Key the cache by `activeAccountId` and reload on change.
  - **Prior observation to check:** `app/composables/useAccountSearch.ts:30` — `loadFollowing` returns early once anything is cached, without checking which account it belongs to, so after an account switch the picker suggests A's followings while composing as B.
  - **Provenance:** [October 9 candidate, line 958](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:958); explicit source files unchanged at review time.

- [x] **NS-525 · P3 · UX · A · S — Use the active account's handle domain or the instance uri.**
  - **Done:** Local `fullHandle` uses the active account’s `@domain` when `acct` is bare.
  - **Target:** [app/pages/profile.vue:217](/Users/powerox/neospace/app/pages/profile.vue:217). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Use the active account's handle domain or the instance `uri`.
  - **Prior observation to check:** `app/pages/profile.vue:217` — For local accounts, `fullHandle` uses the hostname of `p.url`, which is the web domain. On servers with `WEB_DOMAIN` ≠ `LOCAL_DOMAIN` it copies a handle that doesn't resolve.
  - **Provenance:** [October 9 candidate, line 843](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:843); explicit source files unchanged at review time.

- [x] **NS-526 · P3 · UX · A · S — Return on AbortError, and use toastStore directly.**
  - **Done:** Share sheet returns on `AbortError`; clipboard fallback uses existing `toastStore`.
  - **Target:** [app/pages/profile.vue:373](/Users/powerox/neospace/app/pages/profile.vue:373). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Return on `AbortError`, and use `toastStore` directly.
  - **Prior observation to check:** `app/pages/profile.vue:373` — If the user cancels the native share sheet (AbortError), the code falls through to the clipboard and shows "Profile link copied". It also re-imports a toast store that's already imported at `:35`.
  - **Provenance:** [October 9 candidate, line 851](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:851); explicit source files unchanged at review time.

- [x] **NS-527 · P3 · UX · A · S — Use fullHandle.value.**
  - **Done:** Native share text uses `fullHandle.value`.
  - **Target:** [app/pages/profile.vue:380](/Users/powerox/neospace/app/pages/profile.vue:380). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Use `fullHandle.value`.
  - **Prior observation to check:** `app/pages/profile.vue:380` — The share text is `@${p.acct}`, which for local accounts has no domain.
  - **Provenance:** [October 9 candidate, line 852](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:852); explicit source files unchanged at review time.

- [x] **NS-528 · P3 · UX · A · S — Catch the error and toast mapErrorToMessage.**
  - **Done:** `messageUser` catches errors and toasts `mapErrorToMessage`.
  - **Target:** [app/pages/profile.vue:396](/Users/powerox/neospace/app/pages/profile.vue:396). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Catch the error and toast `mapErrorToMessage`.
  - **Prior observation to check:** `app/pages/profile.vue:396` — `messageUser` has no try/catch, so a failed direct-conversation lookup or compose open is an unhandled rejection with no feedback.
  - **Provenance:** [October 9 candidate, line 853](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:853); explicit source files unchanged at review time.

- [x] **NS-529 · P3 · DESIGN · A · S — Strip shortcodes for plain-text uses and emojify where HTML is allowed.**
  - **Done:** Plain-text profile surfaces use `plainDisplayName` (title, head, share).
  - **Target:** [app/pages/profile.vue:257](/Users/powerox/neospace/app/pages/profile.vue:257). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Strip shortcodes for plain-text uses and emojify where HTML is allowed.
  - **Prior observation to check:** `app/pages/profile.vue:257` — `chromeTitle`, the `useHead` title (`:604`) and the unfollow confirm (`:497`) use the raw `displayName`, so custom emoji appear as `:blobcat:` shortcodes.
  - **Provenance:** [October 9 candidate, line 856](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:856); explicit source files unchanged at review time.

- [ ] **NS-530 · P3 · DESIGN · A · S — Use one sentence-case style everywhere.**
  - **Target:** [app/pages/profile.vue:1499](/Users/powerox/neospace/app/pages/profile.vue:1499). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Use one sentence-case style everywhere.
  - **Prior observation to check:** `app/pages/profile.vue:1499` — `.profile-chip` sets `text-transform: lowercase`, which also applies to the relationship chips, so they render "follows you" and "domain blocked" while the same chips elsewhere are Title Case. The bot chip is lowercase "bot" (`:744`), "BOT" in `FollowersModal.vue:304` and "Bot" in `SearchPersonRow.vue:59`.
  - **Provenance:** [October 9 candidate, line 857](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:857); explicit source files unchanged at review time.

- [x] **NS-531 · P3 · UX · A · S — Use one phrase ("Approves followers") everywhere.**
  - **Done:** Locked accounts labeled “Approves followers” on profile chips.
  - **Target:** [app/pages/profile.vue:748](/Users/powerox/neospace/app/pages/profile.vue:748). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Use one phrase ("Approves followers") everywhere.
  - **Prior observation to check:** `app/pages/profile.vue:748` — Locked accounts are labelled `title="Private"` / "Private account". `SearchPersonRow.vue:53` calls the same state "Approves followers", and the edit toggle says "Require follow approval".
  - **Provenance:** [October 9 candidate, line 858](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:858); explicit source files unchanged at review time.

- [x] **NS-532 · P3 · UX · A · S — Strip the query after showing it once, or add a close button.**
  - **Done:** Linked banner shows once, then `?linked=` is stripped from the URL.
  - **Target:** [app/pages/profile.vue:664](/Users/powerox/neospace/app/pages/profile.vue:664). **Area:** app/pages/profile.vue — identity, header & relationship.
  - **Change:** Strip the query after showing it once, or add a close button.
  - **Prior observation to check:** `app/pages/profile.vue:664` — The "Linked. Tap your name to switch." banner has no dismiss and stays as long as `?linked=1` is in the URL.
  - **Provenance:** [October 9 candidate, line 859](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:859); explicit source files unchanged at review time.

- [x] **NS-533 · P3 · CODE · A · S — Delete tabFetchOpts and use optsForTab(profileTab.value).**
  - **Done:** Removed duplicate `tabFetchOpts`; callers use `optsForTab`.
  - **Target:** [app/pages/profile.vue:312](/Users/powerox/neospace/app/pages/profile.vue:312). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Delete `tabFetchOpts` and use `optsForTab(profileTab.value)`.
  - **Prior observation to check:** `app/pages/profile.vue:312` — `tabFetchOpts` and `optsForTab` (`:351`) duplicate the tab→options mapping, and Load more (`:1162`) and compose `onPosted` (`:307`) use the other copy.
  - **Provenance:** [October 9 candidate, line 867](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:867); explicit source files unchanged at review time.

- [x] **NS-534 · P3 · UX · A · S — Clear postsQuery in loadProfileFromRoute.**
  - **Done:** `loadProfileFromRoute` clears `postsQuery`.
  - **Target:** [app/pages/profile.vue:413](/Users/powerox/neospace/app/pages/profile.vue:413). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Clear `postsQuery` in `loadProfileFromRoute`.
  - **Prior observation to check:** `app/pages/profile.vue:413` — Navigating A→B resets the tab to Posts but keeps the "Search posts…" text, so B's posts are filtered by A's query.
  - **Provenance:** [October 9 candidate, line 868](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:868); explicit source files unchanged at review time.

- [x] **NS-535 · P3 · DESIGN · A · S — Swap in NeoIcon.**
  - **Done:** Profile field remove uses `NeoIcon name="x"`.
  - **Target:** [app/pages/profile.vue:1032](/Users/powerox/neospace/app/pages/profile.vue:1032). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Swap in `NeoIcon`.
  - **Prior observation to check:** `app/pages/profile.vue:1032` — The remove-field button is a bare "✕" text glyph, while every other close button uses `NeoIcon name="x"`.
  - **Provenance:** [October 9 candidate, line 871](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:871); explicit source files unchanged at review time.

- [x] **NS-536 · P3 · UX · A · S — Scroll #profile-tab-panel into view after the switch.**
  - **Done:** Insights/Human tab switch scrolls `#profile-tab-panel` into view.
  - **Target:** [app/pages/profile.vue:926](/Users/powerox/neospace/app/pages/profile.vue:926). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Scroll `#profile-tab-panel` into view after the switch.
  - **Prior observation to check:** `app/pages/profile.vue:926` — "View insights" switches the tab but doesn't scroll, so on phones nothing visible changes above the fold.
  - **Provenance:** [October 9 candidate, line 872](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:872); explicit source files unchanged at review time.

- [x] **NS-537 · P3 · UX · A · S — Change the placeholder to "Find in loaded posts…".**
  - **Done:** Placeholder is “Find in loaded posts…”.
  - **Target:** [app/pages/profile.vue:1080](/Users/powerox/neospace/app/pages/profile.vue:1080). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Change the placeholder to "Find in loaded posts…".
  - **Prior observation to check:** `app/pages/profile.vue:1080` — The "Search posts…" placeholder implies a server search, but it only filters loaded posts. The empty message (`:1146`) admits this only after a miss.
  - **Provenance:** [October 9 candidate, line 873](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:873); explicit source files unchanged at review time.

- [ ] **NS-538 · P3 · CODE · A · S — Delete them.**
  - **Target:** [app/pages/profile.vue:1199](/Users/powerox/neospace/app/pages/profile.vue:1199). **Area:** app/pages/profile.vue — tabs, posts & editing.
  - **Change:** Delete them.
  - **Prior observation to check:** `app/pages/profile.vue:1199` — `.profile-handle__acct` is defined twice (also `:1488`) with conflicting colors. `.profile-loading__spinner` and `@keyframes spin` (`:1345-1352`), `.profile-chrome-more` (`:1671`) and `.profile-error span { font-size: 3rem }` (`:1312`) are dead.
  - **Provenance:** [October 9 candidate, line 874](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:874); explicit source files unchanged at review time.

- [x] **NS-539 · P3 · SEC · A · S — Check the host for the bluesky and seenu kinds before the generic URL branch, and fall back to website…**
  - **Done:** Bluesky/SeenU URLs validated by host before branded chips.
  - **Target:** [app/utils/profileSources.ts:86](/Users/powerox/neospace/app/utils/profileSources.ts:86). **Area:** app/stores/profile.ts & app/utils/profileSources.ts.
  - **Change:** Check the host for the bluesky and seenu kinds before the generic URL branch, and fall back to `website` otherwise.
  - **Prior observation to check:** `app/utils/profileSources.ts:86` — any `http(s)` value returns early, so the seenu.io host check at `:103-110` can never run. A field named "SeenU" (or "Bluesky") pointing at `https://phish.example` renders a "SeenU"/"Bluesky" chip with that network's icon (`profile.vue:887`).
  - **Provenance:** [October 9 candidate, line 879](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:879); explicit source files unchanged at review time.

- [x] **NS-540 · P3 · UX · A · S — Validate against a domain-handle pattern and encodeURIComponent.**
  - **Done:** Bluesky handles validated and passed through `encodeURIComponent`.
  - **Target:** [app/utils/profileSources.ts:97](/Users/powerox/neospace/app/utils/profileSources.ts:97). **Area:** app/stores/profile.ts & app/utils/profileSources.ts.
  - **Change:** Validate against a domain-handle pattern and `encodeURIComponent`.
  - **Prior observation to check:** `app/utils/profileSources.ts:97` — Bluesky handles aren't validated or encoded, so "my bsky is cool" becomes `https://bsky.app/profile/my bsky is cool`.
  - **Provenance:** [October 9 candidate, line 880](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:880); explicit source files unchanged at review time.

- [x] **NS-541 · P3 · CODE · A · S — Remove it.**
  - **Done:** Removed duplicate javascript/data guard in website branch.
  - **Target:** [app/utils/profileSources.ts:120](/Users/powerox/neospace/app/utils/profileSources.ts:120). **Area:** app/stores/profile.ts & app/utils/profileSources.ts.
  - **Change:** Remove it.
  - **Prior observation to check:** `app/utils/profileSources.ts:120` — The javascript/data/vbscript check is a dead duplicate of `:85`.
  - **Provenance:** [October 9 candidate, line 881](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:881); explicit source files unchanged at review time.

- [ ] **NS-542 · P3 · CODE · A · S — Split only at top-level commas (track paren depth).**
  - **Target:** [app/utils/sanitizeCss.ts:143](/Users/powerox/neospace/app/utils/sanitizeCss.ts:143). **Area:** app/utils/sanitizeCss.ts — profile skin sanitizer.
  - **Change:** Split only at top-level commas (track paren depth).
  - **Prior observation to check:** `app/utils/sanitizeCss.ts:143` — Splitting selectors on raw commas breaks `:is(a, b)` and `:where(…)` into `.scope :is(a, .scope b)`, silently changing what legitimate skins match.
  - **Provenance:** [October 9 candidate, line 886](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:886); explicit source files unchanged at review time.

- [ ] **NS-543 · P3 · UX · A · M — Keep @keyframes with a per-profile name prefix (and rewrite matching animation-name values).**
  - **Target:** [app/utils/sanitizeCss.ts:186](/Users/powerox/neospace/app/utils/sanitizeCss.ts:186). **Area:** app/utils/sanitizeCss.ts — profile skin sanitizer.
  - **Change:** Keep `@keyframes` with a per-profile name prefix (and rewrite matching `animation-name` values).
  - **Prior observation to check:** `app/utils/sanitizeCss.ts:186` — `@keyframes`, `@container` and `@font-face` are dropped, so any animated chaos skin silently stops animating.
  - **Provenance:** [October 9 candidate, line 887](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:887); explicit source files unchanged at review time.

- [x] **NS-544 · P3 · SEC · A · S — Strip -?moz-element( and element(.**
  - **Done:** Profile CSS sanitizer blocks `element()` / `-moz-element()`.
  - **Target:** [app/utils/sanitizeCss.ts:61](/Users/powerox/neospace/app/utils/sanitizeCss.ts:61). **Area:** app/utils/sanitizeCss.ts — profile skin sanitizer.
  - **Change:** Strip `-?moz-element(` and `element(`.
  - **Prior observation to check:** `app/utils/sanitizeCss.ts:61` — `element()` / `-moz-element(#id)` aren't blocked. In Firefox a skin can paint live app elements (another column, the compose box) as a background to fake UI.
  - **Provenance:** [October 9 candidate, line 888](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:888); explicit source files unchanged at review time.

- [ ] **NS-545 · P3 · UX · A · S — Prefer spoilerText when set, and fall back to "Photo / video post" or "Poll".**
  - **Target:** [app/utils/insights.ts:152](/Users/powerox/neospace/app/utils/insights.ts:152). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Prefer `spoilerText` when set, and fall back to "Photo / video post" or "Poll".
  - **Prior observation to check:** `app/utils/insights.ts:152` — The preview is the post body even when it's behind a content warning, so Top posts reveal CW'd text and media-only posts read "(no text)" (`ProfileInsights.vue:451`).
  - **Provenance:** [October 9 candidate, line 894](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:894); explicit source files unchanged at review time.

- [ ] **NS-546 · P3 · CODE · A · S — Pass { requestInit: { signal } } as useFediverseSearch.ts:375 does, and drop the cast.**
  - **Target:** [app/stores/insights.ts:173](/Users/powerox/neospace/app/stores/insights.ts:173). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Pass `{ requestInit: { signal } }` as `useFediverseSearch.ts:375` does, and drop the cast.
  - **Prior observation to check:** `app/stores/insights.ts:173` — The `AbortController` signal is never passed to `statuses.list(...)` (and the params are cast `as any`), so `abortInFlight()` doesn't cancel the network requests.
  - **Provenance:** [October 9 candidate, line 896](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:896); explicit source files unchanged at review time.

- [ ] **NS-547 · P3 · UX · A · S — Add a Refresh button that clears statusCache, or invalidate the cache from compose onPosted.**
  - **Target:** [app/stores/insights.ts:192](/Users/powerox/neospace/app/stores/insights.ts:192). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Add a Refresh button that clears `statusCache`, or invalidate the cache from compose `onPosted`.
  - **Prior observation to check:** `app/stores/insights.ts:192` — The 5-minute cache isn't invalidated when you post or delete, and there's no refresh control, so a just-published post is missing from Insights.
  - **Provenance:** [October 9 candidate, line 897](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:897); explicit source files unchanged at review time.

- [ ] **NS-548 · P3 · UX · A · S — Pluralize, say "posts", and use one hour format.**
  - **Target:** [app/components/ProfileInsights.vue:163](/Users/powerox/neospace/app/components/ProfileInsights.vue:163). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Pluralize, say "posts", and use one hour format.
  - **Prior observation to check:** `app/components/ProfileInsights.vue:163` — Plurals are wrong: "· 1 posts" in the heat summary, `title="… — 1 posts"` (`:366`), "N statuses" (`:494`, which also says "statuses" where the rest of the app says "posts") and "followers" for 1. The hour also shows as "9:00" in titles but "09:00" in the summary.
  - **Provenance:** [October 9 candidate, line 898](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:898); explicit source files unchanged at review time.

- [ ] **NS-549 · P3 · UX · A · S — Use "3 posts · 1.2K engagement".**
  - **Target:** [app/components/ProfileInsights.vue:465](/Users/powerox/neospace/app/components/ProfileInsights.vue:465). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Use "3 posts · 1.2K engagement".
  - **Prior observation to check:** `app/components/ProfileInsights.vue:465` — The tag meta reads "3 · 1.2K eng", where "eng" is unexplained jargon and the bare "3" has no unit.
  - **Provenance:** [October 9 candidate, line 899](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:899); explicit source files unchanged at review time.

- [ ] **NS-550 · P3 · DESIGN · A · S — Use largest-remainder rounding.**
  - **Target:** [app/components/ProfileInsights.vue:189](/Users/powerox/neospace/app/components/ProfileInsights.vue:189). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Use largest-remainder rounding.
  - **Prior observation to check:** `app/components/ProfileInsights.vue:189` — Each kind's waffle cells are rounded separately, so the cells can total 99 (one grey "empty" cell at 100% coverage), and the legend percentages (`:416`) can sum to 99 or 101.
  - **Provenance:** [October 9 candidate, line 900](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:900); explicit source files unchanged at review time.

- [ ] **NS-551 · P3 · UX · A · S — Keep the listener (and the payload) alive for the tab's lifetime, and show "Loom is slow — download…**
  - **Target:** [app/utils/loomExport.ts:165](/Users/powerox/neospace/app/utils/loomExport.ts:165). **Area:** app/components/ProfileInsights.vue, app/stores/insights.ts, app/utils/insights.ts, app/utils/loomExport.ts.
  - **Change:** Keep the listener (and the payload) alive for the tab's lifetime, and show "Loom is slow — download instead?" rather than auto-downloading.
  - **Prior observation to check:** `app/utils/loomExport.ts:165` — After 8 seconds the message listener is removed and the CSVs auto-download. If Loom loads slowly, the user ends up with an empty Loom tab plus an unexpected download, and a late "ready" is ignored.
  - **Provenance:** [October 9 candidate, line 902](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:902); explicit source files unchanged at review time.

- [x] **NS-552 · P3 · UX · A · S — Show nothing when the field is absent.**
  - **Done:** Followers modal omits “No recent posts” when `lastStatusAt` is absent.
  - **Target:** [app/components/FollowersModal.vue:367](/Users/powerox/neospace/app/components/FollowersModal.vue:367). **Area:** app/components/FollowersModal.vue.
  - **Change:** Show nothing when the field is absent.
  - **Prior observation to check:** `app/components/FollowersModal.vue:367` — When `lastStatusAt` is missing (GoToSocial and Akkoma often omit it), rows say "No recent posts", which is a claim the app can't support.
  - **Provenance:** [October 9 candidate, line 910](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:910); explicit source files unchanged at review time.

- [x] **NS-553 · P3 · DESIGN · A · S — Emojify via sanitizeDisplayName(emojify(...)) as profile.vue:79 does.**
  - **Done:** Followers modal names use `plainDisplayName`.
  - **Target:** [app/components/FollowersModal.vue:303](/Users/powerox/neospace/app/components/FollowersModal.vue:303). **Area:** app/components/FollowersModal.vue.
  - **Change:** Emojify via `sanitizeDisplayName(emojify(...))` as `profile.vue:79` does.
  - **Prior observation to check:** `app/components/FollowersModal.vue:303` — Display names render raw, so custom emoji show as `:shortcode:`. The same happens in `ProfilePeekCard.vue:61` and `SearchPersonRow.vue:25`.
  - **Provenance:** [October 9 candidate, line 911](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:911); explicit source files unchanged at review time.

- [ ] **NS-554 · P3 · UX · A · S — Decrement profileStore.viewedProfile counts when it's your own list, and toast "Blocked @x".**
  - **Target:** [app/components/FollowersModal.vue:183](/Users/powerox/neospace/app/components/FollowersModal.vue:183). **Area:** app/components/FollowersModal.vue.
  - **Change:** Decrement `profileStore.viewedProfile` counts when it's your own list, and toast "Blocked @x".
  - **Prior observation to check:** `app/components/FollowersModal.vue:183` — Block and Remove follower (`:204`) drop the row but don't update the profile's follower/following counts, and there's no success toast.
  - **Provenance:** [October 9 candidate, line 912](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:912); explicit source files unchanged at review time.

- [x] **NS-555 · P3 · DESIGN · A · S — Use the ellipsis and the scrim token.**
  - **Done:** Modal overlay uses `var(--neo-bg-overlay)`; load-more shows “Loading…”.
  - **Target:** [app/components/FollowersModal.vue:380](/Users/powerox/neospace/app/components/FollowersModal.vue:380). **Area:** app/components/FollowersModal.vue.
  - **Change:** Use the ellipsis and the scrim token.
  - **Prior observation to check:** `app/components/FollowersModal.vue:380` — "Loading..." uses three dots while the rest of the app uses "Loading…", and the overlay color is hard-coded `rgba(0,0,0,0.75)` (`:394`).
  - **Provenance:** [October 9 candidate, line 913](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:913); explicit source files unchanged at review time.

- [ ] **NS-556 · P3 · CODE · A · S — Pass { requestInit: { signal } } through $raw/list.**
  - **Target:** [app/components/FollowersModal.vue:66](/Users/powerox/neospace/app/components/FollowersModal.vue:66). **Area:** app/components/FollowersModal.vue.
  - **Change:** Pass `{ requestInit: { signal } }` through `$raw`/`list`.
  - **Prior observation to check:** `app/components/FollowersModal.vue:66` — `void signal` drops the pager's AbortSignal, so closing or switching tabs never cancels the request. `useLinkedProfileFeed.ts:78` does the same.
  - **Provenance:** [October 9 candidate, line 914](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:914); explicit source files unchanged at review time.

- [x] **NS-557 · P3 · UX · A · S — Pluralize.**
  - **Target:** [app/components/ProfilePeekCard.vue:71](/Users/powerox/neospace/app/components/ProfilePeekCard.vue:71). **Area:** app/components/ProfilePeekCard.vue & ProfileHumanBadges.vue.
  - **Change:** Pluralize.
  - **Prior observation to check:** `app/components/ProfilePeekCard.vue:71` — Stats always use plurals ("1 followers", "1 posts").
  - **Provenance:** [October 9 candidate, line 917](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:917); explicit source files unchanged at review time.
  - **Done:** `ProfilePeekCard.vue` pluralizes follower(s) / post(s).

- [x] **NS-558 · P3 · A11Y · A · S — Use alt="".**
  - **Target:** [app/components/ProfilePeekCard.vue:49](/Users/powerox/neospace/app/components/ProfilePeekCard.vue:49). **Area:** app/components/ProfilePeekCard.vue & ProfileHumanBadges.vue.
  - **Change:** Use `alt=""`.
  - **Prior observation to check:** `app/components/ProfilePeekCard.vue:49` — The avatar's `alt` repeats the `<h3>` name right next to it, so screen readers announce the name twice.
  - **Provenance:** [October 9 candidate, line 918](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:918); explicit source files unchanged at review time.
  - **Done:** `ProfilePeekCard.vue` avatar uses `alt=""` (name is in the adjacent heading).

- [ ] **NS-559 · P3 · CODE · A · S — Use Array.from(name)[0] or clipGraphemes.**
  - **Target:** [app/components/ProfilePeekCard.vue:57](/Users/powerox/neospace/app/components/ProfilePeekCard.vue:57). **Area:** app/components/ProfilePeekCard.vue & ProfileHumanBadges.vue.
  - **Change:** Use `Array.from(name)[0]` or `clipGraphemes`.
  - **Prior observation to check:** `app/components/ProfilePeekCard.vue:57` — `.slice(0, 1)` splits surrogate pairs, so a name starting with an emoji renders a broken glyph in the placeholder.
  - **Provenance:** [October 9 candidate, line 919](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:919); explicit source files unchanged at review time.

- [x] **NS-560 · P3 · UX · A · S — Hide it on other people's profiles until badges exist, or move it to Settings.**
  - **Done:** Human tab hidden on other people’s profiles.
  - **Target:** [app/pages/profile.vue:277](/Users/powerox/neospace/app/pages/profile.vue:277). **Area:** app/components/ProfilePeekCard.vue & ProfileHumanBadges.vue.
  - **Change:** Hide it on other people's profiles until badges exist, or move it to Settings.
  - **Prior observation to check:** `app/pages/profile.vue:277` — The "Human" tab appears on every profile with the same eight "soon" placeholder cards and nothing specific to the person.
  - **Provenance:** [October 9 candidate, line 921](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:921); explicit source files unchanged at review time.

- [x] **NS-561 · P3 · UX · A · S — Use "Why this exists" as the link text and drop the opacity.**
  - **Done:** Human badges link text “Why this exists”; card opacity removed.
  - **Target:** [app/components/ProfileHumanBadges.vue:71](/Users/powerox/neospace/app/components/ProfileHumanBadges.vue:71). **Area:** app/components/ProfilePeekCard.vue & ProfileHumanBadges.vue.
  - **Change:** Use "Why this exists" as the link text and drop the opacity.
  - **Prior observation to check:** `app/components/ProfileHumanBadges.vue:71` — The microcopy "Settings → Humans first — why this exists." is awkward, and screen readers read the arrow as "right arrow". The `opacity:0.92` on the cards (`:135`) also lowers the contrast of the already-muted 11px text.
  - **Provenance:** [October 9 candidate, line 922](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:922); explicit source files unchanged at review time.

- [ ] **NS-562 · P3 · UX · A · S — Use after: with the local date minus N+1 days.**
  - **Target:** [app/utils/searchQuery.ts:79](/Users/powerox/neospace/app/utils/searchQuery.ts:79). **Area:** app/pages/explore.vue.
  - **Change:** Use `after:` with the local date minus N+1 days.
  - **Prior observation to check:** `app/utils/searchQuery.ts:79` — `isoDay` uses UTC, and Mastodon's `after:` is exclusive by date, so "Past day" returns only posts from today (UTC), not the last 24 hours. Late in the evening west of UTC it can return nothing.
  - **Provenance:** [October 9 candidate, line 933](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:933); explicit source files unchanged at review time.

- [ ] **NS-563 · P3 · UX · A · S — Compute tips in a computed/getter, and use the user's UI language.**
  - **Target:** [app/utils/searchQuery.ts:106](/Users/powerox/neospace/app/utils/searchQuery.ts:106). **Area:** app/pages/explore.vue.
  - **Change:** Compute tips in a computed/getter, and use the user's UI language.
  - **Prior observation to check:** `app/utils/searchQuery.ts:106` — The "Past week" tip's `after:` date is computed once at module load, so a long-lived SPA tab inserts a stale date. "In English" is hard-coded to `language:en` (`:105`).
  - **Provenance:** [October 9 candidate, line 934](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:934); explicit source files unchanged at review time.

- [x] **NS-564 · P3 · UX · A · S — Use "Mutual".**
  - **Done:** Explore mutual chip reads “Mutual”.
  - **Target:** [app/components/search/SearchPersonRow.vue:57](/Users/powerox/neospace/app/components/search/SearchPersonRow.vue:57). **Area:** app/components/search/*.vue.
  - **Change:** Use "Mutual".
  - **Prior observation to check:** `app/components/search/SearchPersonRow.vue:57` — The chip says "Mutuals" (plural) for a single person.
  - **Provenance:** [October 9 candidate, line 949](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:949); explicit source files unchanged at review time.

- [x] **NS-565 · P3 · UX · A · S — Pick one label for locked accounts across all three.**
  - **Done:** Locked accounts use “Follow” in search (consistent with profile).
  - **Target:** [app/components/search/SearchPersonRow.vue:38](/Users/powerox/neospace/app/components/search/SearchPersonRow.vue:38). **Area:** app/components/search/*.vue.
  - **Change:** Pick one label for locked accounts across all three.
  - **Prior observation to check:** `app/components/search/SearchPersonRow.vue:38` — Locked accounts show "Request" here but "Follow" on the profile page (`profile.vue:492`) and in FollowersModal (`:332`).
  - **Provenance:** [October 9 candidate, line 950](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:950); explicit source files unchanged at review time.

- [x] **NS-566 · P3 · UX · A · S — Show "active today", "yesterday" or "N days ago" from a formatDateOnly-style date.**
  - **Done:** `accountActiveLabel` for calendar `lastStatusAt` dates.
  - **Target:** [app/components/search/SearchPersonRow.vue:33](/Users/powerox/neospace/app/components/search/SearchPersonRow.vue:33). **Area:** app/components/search/*.vue.
  - **Change:** Show "active today", "yesterday" or "N days ago" from a `formatDateOnly`-style date.
  - **Prior observation to check:** `app/components/search/SearchPersonRow.vue:33` — `lastStatusAt` is a calendar date, but `formatCompactRelativeTime` parses it as UTC midnight, so someone active today shows "active 14h".
  - **Provenance:** [October 9 candidate, line 951](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:951); explicit source files unchanged at review time.

- [x] **NS-567 · P3 · UX · A · S — Show nothing when history is absent.**
  - **Done:** Tag rows omit summary when `history` is absent.
  - **Target:** [app/components/search/SearchTagRow.vue:24](/Users/powerox/neospace/app/components/search/SearchTagRow.vue:24). **Area:** app/components/search/*.vue.
  - **Change:** Show nothing when `history` is absent.
  - **Prior observation to check:** `app/components/search/SearchTagRow.vue:24` — Tags with no `history` (GoToSocial, Akkoma, freshly resolved tags) say "No posts this week", which is a false claim.
  - **Provenance:** [October 9 candidate, line 952](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:952); explicit source files unchanged at review time.

- [x] **NS-568 · P3 · A11Y · A · S — Keep a static label ("Follow #x") with aria-pressed, or drop aria-pressed.**
  - **Done:** Tag follow button keeps static “Follow #x” `aria-label` with `aria-pressed`.
  - **Target:** [app/components/search/SearchTagRow.vue:42](/Users/powerox/neospace/app/components/search/SearchTagRow.vue:42). **Area:** app/components/search/*.vue.
  - **Change:** Keep a static label ("Follow #x") with `aria-pressed`, or drop `aria-pressed`.
  - **Prior observation to check:** `app/components/search/SearchTagRow.vue:42` — The button combines `aria-pressed="true"` with `aria-label="Unfollow #x"`, so screen readers hear "Unfollow #x, pressed".
  - **Provenance:** [October 9 candidate, line 953](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:953); explicit source files unchanged at review time.

- [ ] **NS-569 · P3 · DESIGN · A · S — Use one formatter app-wide.**
  - **Target:** [app/utils/searchQuery.ts:180](/Users/powerox/neospace/app/utils/searchQuery.ts:180). **Area:** app/components/search/*.vue.
  - **Change:** Use one formatter app-wide.
  - **Prior observation to check:** `app/utils/searchQuery.ts:180` — Explore's `formatCount` always uses compact notation in the user's locale, while the profile and insights `formatCompact` (`utils/insights.ts:401`) uses `'en'` and compacts only at 10,000 and above. The same account shows "1.2K followers" in search and "1,234 followers" on its profile.
  - **Provenance:** [October 9 candidate, line 954](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:954); explicit source files unchanged at review time.

- [ ] **NS-570 · P3 · PERF · A · S — Resolve only when the host part matches a complete-domain pattern.**
  - **Target:** [app/composables/useAccountSearch.ts:85](/Users/powerox/neospace/app/composables/useAccountSearch.ts:85). **Area:** Composables: discovery, recents, account search, pagers.
  - **Change:** Resolve only when the host part matches a complete-domain pattern.
  - **Prior observation to check:** `app/composables/useAccountSearch.ts:85` — `resolve` is set whenever the query contains "@", so typing "alice@mast" fires a remote WebFinger lookup for each partial domain.
  - **Provenance:** [October 9 candidate, line 959](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:959); explicit source files unchanged at review time.

- [ ] **NS-571 · P3 · UX · A · S — Pass the page size and set hasMore = items.length &gt;= limit, as useAccountPager.ts:49 does.**
  - **Target:** [app/composables/usePager.ts:92](/Users/powerox/neospace/app/composables/usePager.ts:92). **Area:** Composables: discovery, recents, account search, pagers.
  - **Change:** Pass the page size and set `hasMore = items.length >= limit`, as `useAccountPager.ts:49` does.
  - **Prior observation to check:** `app/composables/usePager.ts:92` — For plain-array pages, `hasMore` stays true after a short final page, so `useLinkedProfileFeed` shows "Load more" past the end and an extra empty request runs.
  - **Provenance:** [October 9 candidate, line 960](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:960); explicit source files unchanged at review time.

- [ ] **NS-572 · P3 · CODE · A · S — Add a generation token, and memoize failures briefly.**
  - **Target:** [app/composables/useSearchDiscovery.ts:69](/Users/powerox/neospace/app/composables/useSearchDiscovery.ts:69). **Area:** Composables: discovery, recents, account search, pagers.
  - **Change:** Add a generation token, and memoize failures briefly.
  - **Prior observation to check:** `app/composables/useSearchDiscovery.ts:69` — `fetchSlice` has no generation guard. After `reset()` on a sign-in change, an in-flight request from the previous source still writes its suggestions and trends. Failed slices aren't memoized either (`:72`), so a server with trends disabled is re-hit on every tab flip.
  - **Provenance:** [October 9 candidate, line 961](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:961); explicit source files unchanged at review time.

- [ ] **NS-573 · P3 · SEC · A · S — Delete the bucket in logoutInstance, and add a "Remember searches" toggle.**
  - **Target:** [app/composables/useRecentSearches.ts:36](/Users/powerox/neospace/app/composables/useRecentSearches.ts:36). **Area:** Composables: discovery, recents, account search, pagers.
  - **Change:** Delete the bucket in `logoutInstance`, and add a "Remember searches" toggle.
  - **Prior observation to check:** `app/composables/useRecentSearches.ts:36` — Recent searches are kept per account in localStorage but aren't pruned when that account is logged out (only `clearLocalDeviceData` wipes them), and there's no setting to turn history off. Every tapped topic is also recorded (`explore.vue:426`).
  - **Provenance:** [October 9 candidate, line 962](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:962); explicit source files unchanged at review time.

- [ ] **NS-574 · P3 · CODE · A · S — Re-read before writing (or listen for storage events), and compare case-insensitively.**
  - **Target:** [app/composables/useRecentSearches.ts:37](/Users/powerox/neospace/app/composables/useRecentSearches.ts:37). **Area:** Composables: discovery, recents, account search, pagers.
  - **Change:** Re-read before writing (or listen for `storage` events), and compare case-insensitively.
  - **Prior observation to check:** `app/composables/useRecentSearches.ts:37` — The store is read once per mount and written whole, so two open tabs overwrite each other's history. `remove` (`:53`) is case-sensitive while `record` dedupes case-insensitively.
  - **Provenance:** [October 9 candidate, line 963](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:963); explicit source files unchanged at review time.

- [ ] **NS-575 · P3 · CODE · A · S — Type the params, and map errors with mapErrorToMessage.**
  - **Target:** [app/composables/useLinkedProfileFeed.ts:84](/Users/powerox/neospace/app/composables/useLinkedProfileFeed.ts:84). **Area:** Composables: discovery, recents, account search, pagers.
  - **Change:** Type the params, and map errors with `mapErrorToMessage`.
  - **Prior observation to check:** `app/composables/useLinkedProfileFeed.ts:84` — The params are cast `as any`, and the errors at `:119` and `:132` surface the raw `e.message`.
  - **Provenance:** [October 9 candidate, line 964](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:964); explicit source files unchanged at review time.

## Remaining candidates: Settings, theming & design system

- [x] **NS-576 · P1 · A11Y · C · S — Keep button refs and call refs[next].focus() after select() (or in nextTick).**
  - **Target:** [app/components/NeoRadioGroup.vue:30](/Users/powerox/neospace/app/components/NeoRadioGroup.vue:30). **Area:** Segmented control (`NeoRadioGroup.vue`).
  - **Change:** Keep button refs and call `refs[next].focus()` after `select()` (or in `nextTick`).
  - **Prior observation to check:** `app/components/NeoRadioGroup.vue:30-49` — `onKeydown` works out `next` and emits the new value, but never focuses the next button. Focus stays on the old button, which now has `tabindex=-1`, so the next ArrowRight works out the same `next` again and `select()` returns early. Arrow keys move exactly one step, then stop.
  - **Provenance:** [October 9 candidate, line 573](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:573); explicit source files unchanged at review time.
  - Evidence: `NeoRadioGroup.vue` keeps button refs and focuses the newly selected button after arrow keys, so repeated ArrowRight/Left keeps moving.

- [x] **NS-577 · P1 · UX · C · M — Key the posting overrides by activeAccountId (or drop the local override and trust the server…**
  - **Target:** [app/stores/settings.ts:166](/Users/powerox/neospace/app/stores/settings.ts:166). **Area:** Settings modal: behaviour & sync (`SettingsModal.vue`, `stores/settings.ts`).
  - **Change:** Key the posting overrides by `activeAccountId` (or drop the local override and trust the server `source.privacy` once the PATCH succeeds).
  - **Prior observation to check:** `app/stores/settings.ts:166,361-367,845-862` — `localPreferences.defaultVisibility` / `defaultSensitive` / `postingDefaultsTouched` are stored once in `neospace_local_prefs` and the getter prefers them over `preferences['posting:default:visibility']` for every account. After one save, every other linked account's server default is ignored, both in Settings and in the composer.
  - **Provenance:** [October 9 candidate, line 579](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:579); explicit source files unchanged at review time.
  - Evidence: Posting overrides are stored per account id (`localPreferences.postingOverrides`), with getters resolving the active account's override before its server pref; legacy global `defaultVisibility`/`defaultSensitive` are dropped on load (they can't be attributed to an account, and the server value from the same save applies). `SettingsModal` re-syncs on account switch. Tests in `tests/settings-posting.test.ts`.

- [x] **NS-578 · P1 · UX · C · S — On failure, set this.error ("Saved on this device only — couldn't update your server") and skip saveSuccess.**
  - **Target:** [app/stores/settings.ts:870](/Users/powerox/neospace/app/stores/settings.ts:870). **Area:** Settings modal: behaviour & sync (`SettingsModal.vue`, `stores/settings.ts`).
  - **Change:** On failure, set `this.error` ("Saved on this device only — couldn't update your server") and skip `saveSuccess`.
  - **Prior observation to check:** `app/stores/settings.ts:870-879` — If `updateCredentials({source})` fails (offline, 422, GoToSocial/Akkoma variant), the failure only goes to `console.warn`, and then `saveSuccess = true` shows "Settings saved successfully". The user thinks the server has the new default, but the web UI and other clients disagree.
  - **Provenance:** [October 9 candidate, line 580](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:580); explicit source files unchanged at review time.
  - Evidence: A failed `updateCredentials` now sets `error` = "Saved on this device only — couldn’t update your server" (only if the same account is still active) and skips `saveSuccess`; `savePostingDefaults` awaits the store call. Covered in `tests/settings-posting.test.ts`.

- [x] **NS-579 · P2 · A11Y · A · S — Give the checked state a ≥3:1 indicator: an accent border/underline or --neo-border-color-dark ring, plus…**
  - **Target:** [app/components/NeoRadioGroup.vue:99](/Users/powerox/neospace/app/components/NeoRadioGroup.vue:99). **Area:** Segmented control (`NeoRadioGroup.vue`).
  - **Change:** Give the checked state a ≥3:1 indicator: an accent border/underline or `--neo-border-color-dark` ring, plus a weight change.
  - **Prior observation to check:** `app/components/NeoRadioGroup.vue:99-103` — The selected segment differs from the others only by fill (`--neo-bg-card` against `--neo-bg-tertiary` = 1.08–1.39:1 in all 12 themes, e.g. light 1.22, dark 1.19, contrast 1.39) plus a 1px hairline ring that is itself ~1.2:1. The selected state is barely visible (WCAG 1.4.11 needs 3:1).
  - **Provenance:** [October 9 candidate, line 574](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:574); explicit source files unchanged at review time.
  - **Done:** `NeoRadioGroup` checked state has an accent ring/border plus a weight change (≥3:1 against the unchecked state).
- [x] **NS-580 · P2 · UX · A · S — Reset saveSuccess in open(), and only set it from explicit Settings saves (or always pair it with…**
  - **Done:** `open()` resets `saveSuccess`; `updateAppearance` sets it only while Settings is open.
  - **Target:** [app/stores/settings.ts:903](/Users/powerox/neospace/app/stores/settings.ts:903). **Area:** Settings modal: behaviour & sync (`SettingsModal.vue`, `stores/settings.ts`).
  - **Change:** Reset `saveSuccess` in `open()`, and only set it from explicit Settings saves (or always pair it with `clearSuccess()`).
  - **Prior observation to check:** `app/stores/settings.ts:903` + `app/composables/useShellAppearance.ts:94-117` + `app/stores/settings.ts:408-415` — `updateAppearance` sets `saveSuccess = true` without `clearSuccess()`. Sidebar cycles (theme/chrome/corners/density/lines) run it while Settings is closed, and `open()` never resets `saveSuccess`, so the next time Settings opens it shows a stale "Settings saved successfully" banner.
  - **Provenance:** [October 9 candidate, line 582](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:582); explicit source files unchanged at review time.

- [x] **NS-581 · P2 · UX · A · S — Match whole words / prefixes only (k.startsWith(query) or tokenise the query); drop the reverse check.**
  - **Done:** New `settingsKeywordMatches` — prefix match on the keyword or any of its words. Tested.
  - **Target:** [app/stores/settings.ts:347](/Users/powerox/neospace/app/stores/settings.ts:347). **Area:** Settings modal: behaviour & sync (`SettingsModal.vue`, `stores/settings.ts`).
  - **Change:** Match whole words / prefixes only (`k.startsWith(query)` or tokenise the query); drop the reverse check.
  - **Prior observation to check:** `app/stores/settings.ts:347` — Keyword matching also checks `query.includes(k)`, so short keywords match inside longer words: "email", "detail" and "maintain" all show *Humans first* (keyword `ai`), and anything containing "ui" (e.g. "build", "guide") shows Appearance.
  - **Provenance:** [October 9 candidate, line 587](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:587); explicit source files unchanged at review time.

- [x] **NS-582 · P2 · UX · A · S — Rebuild the keyword lists from what each panel actually renders.**
  - **Done:** Keyword lists rebuilt for profile/privacy/notifications/appearance/posting.
  - **Target:** [app/stores/settings.ts:56](/Users/powerox/neospace/app/stores/settings.ts:56). **Area:** Settings modal: behaviour & sync (`SettingsModal.vue`, `stores/settings.ts`).
  - **Change:** Rebuild the keyword lists from what each panel actually renders.
  - **Prior observation to check:** `app/stores/settings.ts:56,63,70,84` — Search keywords point to settings that don't exist (`avatar`, `header`, `fields`, `website`, `language`, `cw`, `push`), and `discoverable` sends users to Privacy although the toggle is in Profile. Real settings have no keywords: `photo`/`upload`/`quality` (Posting), `reposts`/`boost`/`collapse`, `import`/`export`/`reset`/`backup`, `size`/`corners`/`chrome`/`flip`, `password`/`2fa`/`email` (Account). "photo" currently finds only *Humans first*.
  - **Provenance:** [October 9 candidate, line 588](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:588); explicit source files unchanged at review time.

- [x] **NS-583 · P2 · UX · A · S — Parse with new URL() when the input contains ://, take the part after the last @, strip paths, and…**
  - **Done:** `blockDomain` uses `normalizeDomainInput` (URL/handle/port/IDN aware). Tested.
  - **Target:** [app/stores/settings.ts:764](/Users/powerox/neospace/app/stores/settings.ts:764). **Area:** Settings modal: behaviour & sync (`SettingsModal.vue`, `stores/settings.ts`).
  - **Change:** Parse with `new URL()` when the input contains `://`, take the part after the last `@`, strip paths, and validate the hostname before sending.
  - **Prior observation to check:** `app/stores/settings.ts:764` — `blockDomain` only trims and strips a leading `@`. Pasting `https://mastodon.social/`, `mastodon.social/@bob` or `@bob@host` sends that string to the server and gets a raw 422 message back.
  - **Provenance:** [October 9 candidate, line 593](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:593); explicit source files unchanged at review time.

- [x] **NS-584 · P2 · UX · A · M — Honour the server reading prefs in the post card (or add local overrides under Appearance).**
  - **Target:** [app/stores/settings.ts:128](/Users/powerox/neospace/app/stores/settings.ts:128). **Area:** Settings modal: behaviour & sync (`SettingsModal.vue`, `stores/settings.ts`).
  - **Change:** Honour the server reading prefs in the post card (or add local overrides under Appearance).
  - **Prior observation to check:** `app/stores/settings.ts:128-130` — `reading:expand:media`, `reading:expand:spoilers` and `reading:autoplay:gifs` are fetched and typed but nothing in `app/` reads them, and there's no in-app equivalent. Users who set "always show sensitive media", "always expand CWs" or "don't autoplay GIFs" on their server get the opposite here.
  - **Provenance:** [October 9 candidate, line 603](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:603); explicit source files unchanged at review time.
  - **Done:** Server reading prefs are honoured in post cards: `settingsStore.readingPrefs` (`utils/readingPrefs.ts`) drives `reading:expand:spoilers` (CWs open), `reading:expand:media` (`show_all` reveals sensitive media, `hide_all` hides all until revealed; a collapsed CW still hides its media) and `reading:autoplay:gifs` (gifv autoplay in cards and DM bubbles; controls stay available). The prefs are fetched once per active account at boot (`loadReadingPrefs`, cleared on account switch), so they apply without opening Settings; `e2e/helpers/mockApi.ts` gained the `/preferences` fixture. Tests: `tests/reading-prefs.test.ts`.

- [x] **NS-585 · P2 · CODE · A · S — Rename the selector to .settings-nav-item and drop the dead one.**
  - **Done:** Selector renamed to `.settings-nav-item`; dead `.settings-segmented__btn` dropped.
  - **Target:** [app/assets/css/_themes.scss:623](/Users/powerox/neospace/app/assets/css/_themes.scss:623). **Area:** Settings modal: visual polish & copy.
  - **Change:** Rename the selector to `.settings-nav-item` and drop the dead one.
  - **Prior observation to check:** `app/assets/css/_themes.scss:623,778,780` — The Military uppercase rule and the chrome UI-font rule target `.settings-nav__item`, but the real class is `.settings-nav-item` (`SettingsModal.vue:683`). `.settings-segmented__btn` no longer exists. In Military chrome the Settings nav is the only nav that isn't uppercase and tracked.
  - **Provenance:** [October 9 candidate, line 624](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:624); explicit source files unchanged at review time.

- [x] **NS-586 · P2 · A11Y · A · S — Give each theme its own success colour in the mixin (e.g**
  - **Target:** [app/assets/css/_structural.scss:9](/Users/powerox/neospace/app/assets/css/_structural.scss:9). **Area:** Theme tokens & computed contrast (`_themes.scss`, `_structural.scss`).
  - **Change:** Give each theme its own success colour in the mixin (e.g. a lighter green for dark schemes).
  - **Prior observation to check:** `app/assets/css/_structural.scss:9-12` — `--neo-success: #2f7d4a` is shared across all themes. The "Settings saved successfully" banner (`SettingsModal.vue:2059-2062`, success text on `--neo-success-soft` over the face) is **4.15** light, **3.01** dark, **3.85** contrast, **3.79** paper, **4.19** glass, **3.22** frost, **4.31** brutal, **3.33** loom, **2.44** tank, **4.08** nes; it fails AA in 10 of 12 themes (only beta/y override it).
  - **Provenance:** [October 9 candidate, line 638](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:638); explicit source files unchanged at review time.
  - **Done:** Resolved at the consumer rather than the token: the “saved” banner (the cited failure) now uses full ink text with the success colour only on the border and glyph, so it passes AA in every theme. The shared `--neo-success` token is unchanged.
- [x] **NS-587 · P2 · A11Y · A · S — Use the full --neo-text-primary for banner text with a danger icon and border, or darken/lighten the…**
  - **Target:** [app/assets/css/_themes.scss:76](/Users/powerox/neospace/app/assets/css/_themes.scss:76). **Area:** Theme tokens & computed contrast (`_themes.scss`, `_structural.scss`).
  - **Change:** Use the full `--neo-text-primary` for banner text with a danger icon and border, or darken/lighten the danger colour per theme.
  - **Prior observation to check:** `app/assets/css/_themes.scss:76-77` — Danger text on `--neo-danger-soft` over the face (Settings error banner, `SettingsModal.vue:2074-2077`, 15px) is **4.47** light, **4.42** loom, **4.28** tank, **4.31** nes, **4.28** beta, **3.90** y.
  - **Provenance:** [October 9 candidate, line 639](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:639); explicit source files unchanged at review time.
  - **Done:** `SettingsModal` banners use `var(--neo-text-primary)` text with a coloured border and a coloured `aria-hidden` glyph, for both success and danger.
- [x] **NS-588 · P2 · DESIGN · A · S — Give Brutal a red danger (#d00000 is already its accent; pick e.g**
  - **Done:** Brutal danger is `#b00020`, NES `#8a0020`.
  - **Target:** [app/assets/css/_themes.scss:280](/Users/powerox/neospace/app/assets/css/_themes.scss:280). **Area:** Theme tokens & computed contrast (`_themes.scss`, `_structural.scss`).
  - **Change:** Give Brutal a red danger (`#d00000` is already its accent; pick e.g. `#b00020` and differentiate by shape/icon) and NES a distinct danger.
  - **Prior observation to check:** `app/assets/css/_themes.scss:280,346` — Brutal's `$mark` (danger) is `#000000`, the same as ink (1.00:1). Errors, "Delete" and "Clear data" buttons look like ordinary text or black buttons. NES danger equals its accent `#d00000`, so destructive actions look primary (the bug old #135 fixed for Contrast).
  - **Provenance:** [October 9 candidate, line 641](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:641); explicit source files unchanged at review time.

- [x] **NS-589 · P2 · DESIGN · A · S — Base the overlay on black (e.g**
  - **Done:** `--neo-bg-overlay` is a black scrim (`.55` dark / `.4` light) and `--neo-scrim` aliases it.
  - **Target:** [app/assets/css/_themes.scss:40](/Users/powerox/neospace/app/assets/css/_themes.scss:40). **Area:** Theme tokens & computed contrast (`_themes.scss`, `_structural.scss`).
  - **Change:** Base the overlay on black (e.g. `rgb(0 0 0 / .5)` dark, `/.4` light) and use the token in SettingsModal too.
  - **Prior observation to check:** `app/assets/css/_themes.scss:40` — `--neo-bg-overlay: color-mix(ink 45%, transparent)`. In the 7 dark themes ink is near-white, so the scrims behind `NeoSheet.vue:95`, `MobileDrawer.vue:382`, `PostActionSheet.vue:85` and `ComposeGroupPicker.vue:496` are a 45% *white* veil that washes the page out to grey, while SettingsModal uses a black 48% scrim (`SettingsModal.vue:1821`).
  - **Provenance:** [October 9 candidate, line 642](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:642); explicit source files unchanged at review time.

- [x] **NS-590 · P2 · CODE · A · S — Have line styles scale a multiplier (--neo-line-scale) or apply max() against the theme width.**
  - **Target:** [app/assets/css/_themes.scss:1025](/Users/powerox/neospace/app/assets/css/_themes.scss:1025). **Area:** Theme tokens & computed contrast (`_themes.scss`, `_structural.scss`).
  - **Change:** Have line styles scale a multiplier (`--neo-line-scale`) or apply `max()` against the theme width.
  - **Prior observation to check:** `app/assets/css/_themes.scss:1025-1035` vs `:143,283,330,349` — `html[data-line=dashed|crayon|ink]` (specificity 0,1,1) overrides the theme's `--neo-border-width` (0,1,0). Contrast's 2px and Brutal/NES's 3px borders drop to 1.5px with Dashed, and Tank's 2px becomes 2.5px with Crayon. The "hard edge" themes lose their defining border.
  - **Provenance:** [October 9 candidate, line 643](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:643); explicit source files unchanged at review time.
  - **Done:** `_themes.scss` adds `--neo-theme-border-width` per theme; the `data-line` overrides use `max(…, var(--neo-theme-border-width))` so a thick theme isn't thinned by a thin line setting.
- [x] **NS-591 · P2 · CODE · A · S — Raise the font and size selectors to html[data-font=…] and put them after the chrome blocks, or let…**
  - **Target:** [app/assets/css/_themes.scss:430](/Users/powerox/neospace/app/assets/css/_themes.scss:430). **Area:** Cascade & token hygiene.
  - **Change:** Raise the font and size selectors to `html[data-font=…]` and put them after the chrome blocks, or let chromes set `--neo-chrome-leading` and resolve with `max()`.
  - **Prior observation to check:** `app/assets/css/_themes.scss:430-441,443-571` vs `:839-875,926-953` — Every `html[data-ui=…]` block (specificity 0,1,1) includes `neo-chrome-base`, which sets `--neo-leading-body: 1.5` and `--neo-measure: 62ch` (some chromes set their own). This always beats `[data-font=…]` and `[data-font-size=…]` (0,1,0), and `data-ui` is always set by prepaint. Book's 52ch/1.65 and Dyslexic's 48ch/1.7 measure and leading tokens, and the per-size leading, never take effect. Dyslexic readers get 62ch lines on bios, compose and post text (only `.status-content` gets the explicit overrides at `:877-888`).
  - **Prior verifier qualification:** `app/assets/css/_themes.scss:430-441` vs `:839-875,926-953` — The specificity analysis is correct: every UI id has an `html[data-ui]` block including the base mixin, `normalizeUi` defaults to braun, and the JS only inlines font-family. So Book and Dyslexic `--neo-measure` and all per-size leading never apply. But Dyslexic and Book leading are re-applied explicitly on `body` and `.status-content` (877-888), so the loss is mostly measure (48ch → 62ch) plus leading on compose, bio and the other reading surfaces. [Impact Medium.]
  - **Provenance:** [October 9 candidate, line 648](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:648); explicit source files unchanged at review time.
  - **Done:** `html[data-font=…]` / `html[data-font-size=…]` selectors (specificity 0,1,1) placed after the chrome blocks, so Book / Dyslexic measure and per-size leading apply.
- [x] **NS-592 · P2 · CODE · A · S — Have [data-font-size] set only --neo-font-size-base in px/% and give html font-size:…**
  - **Target:** [app/assets/css/main.scss:40](/Users/powerox/neospace/app/assets/css/main.scss:40). **Area:** Cascade & token hygiene.
  - **Change:** Have `[data-font-size]` set only `--neo-font-size-base` in px/% and give `html` `font-size: var(--neo-font-size-base)` with a higher specificity; make `.neo-input` use `1rem`.
  - **Prior observation to check:** `app/assets/css/main.scss:40,423,893-896` + `app/assets/css/_themes.scss:926-953` — (old #112): there are two font-size mechanisms again. `html{font-size:var(--neo-font-size-base)}` (0,0,1) loses to `[data-font-size]{font-size:…}` (0,1,0), so the "Dense trims type" rule at `main.scss:893-896` does nothing to the root. `.neo-input{font-size:var(--neo-font-size-base)}` applies a rem value on top of an already-scaled root: XXL inputs render at 1.3125rem × 21px ≈ 27.6px instead of 21px, and Medium inputs at 14.06px.
  - **Provenance:** [October 9 candidate, line 650](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:650); explicit source files unchanged at review time.
  - **Done:** The `[data-font-size]` blocks no longer set `font-size` directly; they only set the size variables and `html` resolves its size from them.
- [x] **NS-593 · P2 · CODE · A · S — Remove both lines here (the combined rule already lives in _themes.scss), or write the combined value once.**
  - **Done:** `.neo-card` has a single combined `box-shadow` line; chrome shadow tokens use `0 0 0 0 transparent` (`none` is invalid in a list).
  - **Target:** [app/assets/css/main.scss:155](/Users/powerox/neospace/app/assets/css/main.scss:155). **Area:** Cascade & token hygiene.
  - **Change:** Remove both lines here (the combined rule already lives in `_themes.scss`), or write the combined value once.
  - **Prior observation to check:** `app/assets/css/main.scss:155-156` — `.neo-card` declares `box-shadow` twice; the second (`--neo-chrome-card-shadow`) discards `--neo-card-extra-shadow`. This rule comes after `_themes.scss:796-803` (which combines both), so Jagged corners never get their stamp-cut edge shadow on `.neo-card`.
  - **Provenance:** [October 9 candidate, line 651](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:651); explicit source files unchanged at review time.

- [x] **NS-594 · P2 · UX · A · M — Add change listeners for both queries that re-run applyLocalAppearance() when theme==='auto', and expose…**
  - **Target:** [app/utils/appearance.ts:273](/Users/powerox/neospace/app/utils/appearance.ts:273). **Area:** Runtime appearance (`appearance.ts`, `loadFonts.ts`, `suiteLook.ts`, `useShellAppearance.ts`, `stores/theme.ts`).
  - **Change:** Add `change` listeners for both queries that re-run `applyLocalAppearance()` when `theme==='auto'`, and expose the resolved scheme as a ref.
  - **Prior observation to check:** `app/utils/appearance.ts:273-280` — `resolveTheme('auto')` reads `matchMedia` once per `applyAppearance` call, and nothing in `app/` listens for `prefers-color-scheme` or `prefers-contrast` changes. When macOS/iOS switch to dark at sunset, or the user turns on Increase Contrast, an "Auto" NeoSpace tab stays on the old theme until reload. The sidebar label "Auto · Light" (`useShellAppearance.ts:64-72`) isn't reactive either.
  - **Prior verifier qualification:** Wrong that nothing listens: `app/layouts/default.vue:128-133` re-runs `applyTheme()` on `prefers-color-scheme` change when the theme is auto. What's actually missing: no `prefers-contrast` listener, no listener on `layout:false` pages (login), and `currentThemeLabel` (`useShellAppearance.ts:64-72`) isn't reactive to the media query. [Corrected claim as above. Impact Low-Medium.]
  - **Provenance:** [October 9 candidate, line 664](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:664); explicit source files unchanged at review time.
  - **Done:** `useShellAppearance`/`default.vue`: both colour-scheme and contrast media queries have change listeners that call `bumpOsScheme()` (new `utils/osScheme.ts` ref) and re-apply the theme when it is `auto`.
- [x] **NS-595 · P2 · CODE · A · S — Check THEME_IDS.includes(LEGACY[blob.theme] ?? blob.theme) || blob.theme === 'auto' *before* normalising,…**
  - **Done:** `readSuiteLook` validates the theme before normalizing.
  - **Target:** [app/utils/suiteLook.ts:58](/Users/powerox/neospace/app/utils/suiteLook.ts:58). **Area:** Runtime appearance (`appearance.ts`, `loadFonts.ts`, `suiteLook.ts`, `useShellAppearance.ts`, `stores/theme.ts`).
  - **Change:** Check `THEME_IDS.includes(LEGACY[blob.theme] ?? blob.theme) || blob.theme === 'auto'` *before* normalising, and ignore anything else.
  - **Prior observation to check:** `app/utils/suiteLook.ts:58-62` — `normalizeTheme()` maps any id it doesn't know to `'auto'`, so the `theme === 'auto' || THEME_IDS.includes` guard always passes. If a sibling tool (bruh/wordcount) stores a theme NeoSpace lacks, every load (`settings.ts:472-473`) and every storage event overwrites the user's chosen NeoSpace theme with Auto.
  - **Provenance:** [October 9 candidate, line 669](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:669); explicit source files unchanged at review time.

- [x] **NS-596 · P2 · CODE · A · M — Also listen for LOCAL_PREFS_KEY (re-parse and apply), and in the suite handler merge into the stored blob…**
  - **Target:** [app/stores/settings.ts:508](/Users/powerox/neospace/app/stores/settings.ts:508). **Area:** Runtime appearance (`appearance.ts`, `loadFonts.ts`, `suiteLook.ts`, `useShellAppearance.ts`, `stores/theme.ts`).
  - **Change:** Also listen for `LOCAL_PREFS_KEY` (re-parse and apply), and in the suite handler merge into the stored blob instead of rewriting the whole object.
  - **Prior observation to check:** `app/stores/settings.ts:508-536` + `app/utils/suiteLook.ts:94-101` — There is no `storage` listener for `neospace_local_prefs`, only for the suite blob. When tab A changes the theme, tab B's handler calls `saveLocalPreferences()` and writes its *stale* fontSize/density/radius/line/flip values over tab A's. Tab A's other changes are lost on the next reload.
  - **Provenance:** [October 9 candidate, line 670](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:670); explicit source files unchanged at review time.
  - **Done:** `settings.ts` listens for `LOCAL_PREFS_KEY` storage events (`mergeStoredLocalPrefs`) and the suite handler merges into the stored blob instead of overwriting it.
- [x] **NS-597 · P2 · UX · A · S — Have the generated script read the suite blob after local prefs, with the same validation as readSuiteLook.**
  - **Target:** [public/boot/prepaint.js:4](/Users/powerox/neospace/public/boot/prepaint.js:4). **Area:** Pre-paint (`public/boot/prepaint.js`, `scripts/build-prepaint.mjs`).
  - **Change:** Have the generated script read the suite blob after local prefs, with the same validation as `readSuiteLook`.
  - **Prior observation to check:** `public/boot/prepaint.js:4-37` vs `app/stores/settings.ts:472-475` — Prepaint reads only `neospace_local_prefs`, while runtime then applies the `ibm.tools.shared` suite look on top. Users who changed their theme or chrome in bruh/loom/wordcount get one frame of the old NeoSpace theme, then a switch, on every visit: exactly the flash prepaint exists to prevent.
  - **Provenance:** [October 9 candidate, line 679](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:679); explicit source files unchanged at review time.
  - **Done:** `build-prepaint.mjs` emits a script that reads the suite blob after local prefs with the same validation as `readSuiteLook`.
- [x] **NS-598 · P2 · A11Y · A · S — Move the matchMedia resolution out of the try, so the fallback still honours OS scheme and contrast, and…**
  - **Target:** [public/boot/prepaint.js:43](/Users/powerox/neospace/public/boot/prepaint.js:43). **Area:** Pre-paint (`public/boot/prepaint.js`, `scripts/build-prepaint.mjs`).
  - **Change:** Move the `matchMedia` resolution out of the `try`, so the fallback still honours OS scheme and contrast, and set `data-font-size="medium"`.
  - **Prior observation to check:** `public/boot/prepaint.js:43-49` — If `localStorage` throws (Safari with storage blocked, some private modes), the catch forces `data-theme="light"` without checking `prefers-color-scheme`/`prefers-contrast`, and never sets `data-font-size`. Runtime (`readStoredLocalPrefs` → `auto`) then switches to dark, so dark-mode and high-contrast users get a full white flash.
  - **Provenance:** [October 9 candidate, line 680](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:680); explicit source files unchanged at review time.
  - **Done:** The prepaint fallback resolves `matchMedia` outside the `try` so it still honours OS scheme/contrast and sets `data-font-size="medium"`.
- [x] **NS-599 · P2 · CODE · A · S — Have prepaint set meta[name=theme-color] from the same generated swatch map, and make the static values…**
  - **Target:** [nuxt.config.ts:125](/Users/powerox/neospace/nuxt.config.ts:125). **Area:** Pre-paint (`public/boot/prepaint.js`, `scripts/build-prepaint.mjs`).
  - **Change:** Have prepaint set `meta[name=theme-color]` from the same generated swatch map, and make the static values match light/dark `--neo-bg-primary`.
  - **Prior observation to check:** `nuxt.config.ts:125-126` + `public/boot/prepaint.js` — The static `theme-color` metas are `#faf9f7` / `#1a1a18`, which match no theme (light bg `#f2f2f0`, dark `#161616`). Prepaint never updates them, so the mobile status bar shows a third colour until JS runs, and users on Loom/Tank/Y with a light OS get a light bar over a black page at boot.
  - **Provenance:** [October 9 candidate, line 681](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:681); explicit source files unchanged at review time.
  - **Done:** Prepaint sets `meta[name=theme-color]` from the generated swatch map; static `nuxt.config.ts` values match light/dark `--neo-bg-primary`.
- [x] **NS-600 · P3 · A11Y · A · S — Return early when e.altKey||e.ctrlKey||e.metaKey, and add Home/End.**
  - **Done:** `NeoRadioGroup` ignores modified arrow keys; Home/End jump.
  - **Target:** [app/components/NeoRadioGroup.vue:30](/Users/powerox/neospace/app/components/NeoRadioGroup.vue:30). **Area:** Segmented control (`NeoRadioGroup.vue`).
  - **Change:** Return early when `e.altKey||e.ctrlKey||e.metaKey`, and add Home/End.
  - **Prior observation to check:** `app/components/NeoRadioGroup.vue:30-46` — The keydown handler hijacks Arrow keys even with Alt/Ctrl/Meta held, which breaks browser back/forward shortcuts, and it doesn't support Home/End.
  - **Provenance:** [October 9 candidate, line 575](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:575); explicit source files unchanged at review time.

- [x] **NS-601 · P3 · DESIGN · A · S — Use grid-template-columns: repeat(auto-fit, minmax(4.5rem,1fr)) or size from options.length.**
  - **Done:** Mobile segmented control uses `auto-fit` grid columns.
  - **Target:** [app/components/NeoRadioGroup.vue:115](/Users/powerox/neospace/app/components/NeoRadioGroup.vue:115). **Area:** Segmented control (`NeoRadioGroup.vue`).
  - **Change:** Use `grid-template-columns: repeat(auto-fit, minmax(4.5rem,1fr))` or size from `options.length`.
  - **Prior observation to check:** `app/components/NeoRadioGroup.vue:115-118` — At ≤480px every button gets `flex: 1 1 calc(33.333% - 2px)`, so the 5 font-size options wrap 3 + 2 and the last two stretch wider than the first three.
  - **Provenance:** [October 9 candidate, line 576](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:576); explicit source files unchanged at review time.

- [ ] **NS-602 · P3 · CODE · A · S — Emit $sidebar-width-expanded/-rail as the tokens, set --neo-sidebar-width on :root instead of .neo-layout,…**
  - **Target:** [app/assets/css/_structural.scss:173](/Users/powerox/neospace/app/assets/css/_structural.scss:173). **Area:** Cascade & token hygiene.
  - **Change:** Emit `$sidebar-width-expanded`/`-rail` as the tokens, set `--neo-sidebar-width` on `:root` instead of `.neo-layout`, and delete the `-sm/-md/-lg` set.
  - **Prior observation to check:** `app/assets/css/_structural.scss:173-176` — (old #119): `:root` sets `--neo-sidebar-width: 64px` from the stale 56/64/72 tokens, while the real widths are 248/200/68 (`default.vue:316,352,357`). Every `var(--neo-sidebar-width, 248px)` fallback is dead, and anything teleported outside `.neo-layout` gets 64px.
  - **Provenance:** [October 9 candidate, line 653](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:653); explicit source files unchanged at review time.

- [ ] **NS-603 · P3 · CODE · A · S — Delete the palette, point $chaos-stop-1 at a theme token, and either adopt @include vars.desk or remove it.**
  - **Target:** [app/assets/css/_variables.scss:8](/Users/powerox/neospace/app/assets/css/_variables.scss:8). **Area:** Cascade & token hygiene.
  - **Change:** Delete the palette, point `$chaos-stop-1` at a theme token, and either adopt `@include vars.desk` or remove it.
  - **Prior observation to check:** `app/assets/css/_variables.scss:8-28,175-201` — (old #116/#119): the light/dark palette (`$bg`…`$dark-mark`, with `$mute: #757575` and `$accent: #c45c26` disagreeing with the live `#666666`/`#a84c1e`), `$sidebar-width-rail/expanded`, `$bp-*`, `@mixin desk` and `@mixin mobile` aren't used anywhere. The comment "used by pre-paint + layout" (`:175`) is false. Only `$accent` leaks out, via `$chaos-stop-1`.
  - **Provenance:** [October 9 candidate, line 654](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:654); explicit source files unchanged at review time.

- [ ] **NS-604 · P3 · CODE · A · M — Prune them (or document them as public API for profile CSS).**
  - **Target:** [app/assets/css/_structural.scss:14](/Users/powerox/neospace/app/assets/css/_structural.scss:14). **Area:** Cascade & token hygiene.
  - **Change:** Prune them (or document them as public API for profile CSS).
  - **Prior observation to check:** `app/assets/css/_structural.scss:14-25,91-129,185-206` (+ `_themes.scss:66,69,357`) — About 80 custom properties are defined and never read: the whole `--neo-opacity-*` scale except 50, `--neo-letter-spacing-*`, `--neo-transition-timing-*`, `--neo-transition-slow(er)`, `--neo-container-*` except xl, `--neo-content-width*`, `--neo-z-base/-fixed/-sticky/-sheet`, `--neo-warning-*`, `--neo-success-light`, `--neo-danger-light/-dark`, `--neo-info-light/-dark`, `--neo-accent-light`, `--neo-accent-soft-hover`, `--neo-bg-active`, `--neo-border-color-light`, `--neo-body-tracking`, `--neo-chrome-outline-style`, `--neo-nes-sky`, `--neo-mobile-chrome-top`.
  - **Provenance:** [October 9 candidate, line 655](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:655); explicit source files unchanged at review time.

- [ ] **NS-605 · P3 · CODE · A · S — Delete them, along with the --neo-chaos-* tokens (_structural.scss:214-217).**
  - **Target:** [app/assets/css/main.scss:265](/Users/powerox/neospace/app/assets/css/main.scss:265). **Area:** Cascade & token hygiene.
  - **Change:** Delete them, along with the `--neo-chaos-*` tokens (`_structural.scss:214-217`).
  - **Prior observation to check:** `app/assets/css/main.scss:265-281,399-403` — `.neo-btn--chaos` and `@keyframes gradient-shift` aren't used anywhere in `app/`.
  - **Provenance:** [October 9 candidate, line 656](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:656); explicit source files unchanged at review time.

- [ ] **NS-606 · P3 · DESIGN · A · S — Move them to utils/groupCategory.ts, and define the cat tokens per scheme (or derive them from --neo-accent).**
  - **Target:** [app/assets/css/_structural.scss:158](/Users/powerox/neospace/app/assets/css/_structural.scss:158). **Area:** Cascade & token hygiene.
  - **Change:** Move them to `utils/groupCategory.ts`, and define the cat tokens per scheme (or derive them from `--neo-accent`).
  - **Prior observation to check:** `app/assets/css/_structural.scss:158-165` + `app/composables/useShellAppearance.ts:165-174` — The `--neo-cat-*` group colours are fixed light-theme hexes (two are the old `#c45c26` accent) and aren't themed. The sidebar/GroupCard tints are therefore the same in Contrast, Beta and Brutal. The helpers also sit in a "shell appearance" composable they have nothing to do with.
  - **Provenance:** [October 9 candidate, line 657](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:657); explicit source files unchanged at review time.

- [ ] **NS-607 · P3 · DESIGN · A · S — Add a single --neo-disabled-opacity token.**
  - **Target:** [app/assets/css/main.scss:194](/Users/powerox/neospace/app/assets/css/main.scss:194). **Area:** Cascade & token hygiene.
  - **Change:** Add a single `--neo-disabled-opacity` token.
  - **Prior observation to check:** `app/assets/css/main.scss:194,341,447` + `SettingsModal.vue:3193` + `main.scss:224` — Disabled opacity is .45, .5, .6 or .7 depending on the component, so disabled controls look different across adjacent surfaces.
  - **Provenance:** [October 9 candidate, line 658](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:658); explicit source files unchanged at review time.

- [ ] **NS-608 · P3 · DESIGN · A · S — Implement the halo with outline + outline-offset only (or a CSS layer the components can opt out of).**
  - **Target:** [app/assets/css/main.scss:739](/Users/powerox/neospace/app/assets/css/main.scss:739). **Area:** Cascade & token hygiene.
  - **Change:** Implement the halo with `outline` + `outline-offset` only (or a CSS layer the components can opt out of).
  - **Prior observation to check:** `app/assets/css/main.scss:739-743` — The global `:focus-visible` sets `box-shadow: 0 0 0 4px var(--neo-bg-primary)`, which replaces any component shadow while focused. Brutal/NES 4px offset card shadows and Ink-line press shadows vanish on focus, and cards jump.
  - **Provenance:** [October 9 candidate, line 659](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:659); explicit source files unchanged at review time.

- [ ] **NS-609 · P3 · DESIGN · A · S — Add ::selection { background: var(--neo-accent-soft-hover); color: var(--neo-text-primary) } and a minimal…**
  - **Target:** [app/assets/css/main.scss](/Users/powerox/neospace/app/assets/css/main.scss). **Area:** Cascade & token hygiene.
  - **Change:** Add `::selection { background: var(--neo-accent-soft-hover); color: var(--neo-text-primary) }` and a minimal print sheet that hides the shell and forces light colours.
  - **Prior observation to check:** `app/assets/css/main.scss` (whole file) — There is no `::selection` style, so selection uses the OS highlight, which ignores the theme (blue on Loom gold or Tank green). There are no `@media print` rules, so printing a thread prints the sidebar, mobile tab bar and dark page background.
  - **Provenance:** [October 9 candidate, line 660](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:660); explicit source files unchanged at review time.

- [ ] **NS-610 · P3 · DESIGN · A · S — Drop the body transition, or apply a short view-transition for theme changes only.**
  - **Target:** [app/assets/css/main.scss:65](/Users/powerox/neospace/app/assets/css/main.scss:65). **Area:** Cascade & token hygiene.
  - **Change:** Drop the body transition, or apply a short view-transition for theme changes only.
  - **Prior observation to check:** `app/assets/css/main.scss:65` — Only `body` cross-fades `background-color`/`color` (220ms) on theme change; cards, sidebar and modal snap immediately, so a switch shows a half-second two-tone flash.
  - **Provenance:** [October 9 candidate, line 661](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:661); explicit source files unchanged at review time.

- [ ] **NS-611 · P3 · UX · A · S — Rename one ("Columns: Focused/Wide/Packed" vs "Spacing: Roomy/Cozy/Dense").**
  - **Target:** [app/composables/useShellAppearance.ts:119](/Users/powerox/neospace/app/composables/useShellAppearance.ts:119). **Area:** Runtime appearance (`appearance.ts`, `loadFonts.ts`, `suiteLook.ts`, `useShellAppearance.ts`, `stores/theme.ts`).
  - **Change:** Rename one ("Columns: Focused/Wide/Packed" vs "Spacing: Roomy/Cozy/Dense").
  - **Prior observation to check:** `app/composables/useShellAppearance.ts:119-139` vs `app/utils/appearance.ts:110-114` — There are two unrelated "density" settings: desk column density (Focused / Roomy / Packed) and Appearance density (Roomy / Cozy / Dense). Both have a "Roomy" option that means different things.
  - **Provenance:** [October 9 candidate, line 673](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:673); explicit source files unchanged at review time.

- [x] **NS-612 · P3 · A11Y · A · S — Render the shared lookAnnounce region once in the layout instead of per sidebar.**
  - **Target:** [app/composables/useShellAppearance.ts:60](/Users/powerox/neospace/app/composables/useShellAppearance.ts:60). **Area:** Runtime appearance (`appearance.ts`, `loadFonts.ts`, `suiteLook.ts`, `useShellAppearance.ts`, `stores/theme.ts`).
  - **Change:** Render the shared `lookAnnounce` region once in the layout instead of per sidebar.
  - **Prior observation to check:** `app/composables/useShellAppearance.ts:60-62` — `lookAnnounce` is only rendered by `DesktopSidebar.vue:516`. The mobile drawer's theme button (`MobileDrawer.vue:326-334`) cycles with no live announcement, and focus stays on a button whose label changed silently.
  - **Provenance:** [October 9 candidate, line 674](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:674); explicit source files unchanged at review time.
  - Evidence: Done in the P3 UX/A11Y/polish pass; see `tests/p3-batch.test.ts` for the util-level cases (UI changes verified by typecheck + unit tests, not in a live browser).

- [x] **NS-613 · P3 · A11Y · A · S — Default to aria-hidden="true" and only expose role=img when a label is passed for standalone use.**
  - **Target:** [app/components/ThemeSwatch.vue:8](/Users/powerox/neospace/app/components/ThemeSwatch.vue:8). **Area:** Runtime appearance (`appearance.ts`, `loadFonts.ts`, `suiteLook.ts`, `useShellAppearance.ts`, `stores/theme.ts`).
  - **Change:** Default to `aria-hidden="true"` and only expose `role=img` when a `label` is passed for standalone use.
  - **Prior observation to check:** `app/components/ThemeSwatch.vue:8-12` — The swatch is `role="img"` with `aria-label="Theme: …"`, but both callers (`DesktopSidebar.vue:525`, `MobileDrawer.vue:333`) put it inside a button that already has the same `aria-label`. Some screen readers read it twice, and the default "Theme" label is meaningless anywhere else.
  - **Provenance:** [October 9 candidate, line 675](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:675); explicit source files unchanged at review time.
  - Evidence: N/A — `NeoIcon` already sets `aria-hidden="true"` unless a label is passed — no change needed.

- [ ] **NS-614 · P3 · CODE · A · S — Delete the dead actions, or wire setProfileCssDisabled to a "Disable profile CSS on this device" toggle in…**
  - **Target:** [app/stores/theme.ts:30](/Users/powerox/neospace/app/stores/theme.ts:30). **Area:** Runtime appearance (`appearance.ts`, `loadFonts.ts`, `suiteLook.ts`, `useShellAppearance.ts`, `stores/theme.ts`).
  - **Change:** Delete the dead actions, or wire `setProfileCssDisabled` to a "Disable profile CSS on this device" toggle in Appearance.
  - **Prior observation to check:** `app/stores/theme.ts:30,39-43,97-107,120-123` — `safeCustomCSS` (identity getter), `toggleMode`, `setProfileCssDisabled` and `loadUserTheme` have no callers. `setProfileCssDisabled` claims to be the "escape hatch from Settings" but no Settings UI exists, so `?safe=1` is the only way out of a broken skin.
  - **Provenance:** [October 9 candidate, line 676](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:676); explicit source files unchanged at review time.

- [ ] **NS-615 · P3 · CODE · A · S — Drop the inline property from the generator (the html[data-rail] selector already covers it).**
  - **Target:** [public/boot/prepaint.js:39](/Users/powerox/neospace/public/boot/prepaint.js:39). **Area:** Pre-paint (`public/boot/prepaint.js`, `scripts/build-prepaint.mjs`).
  - **Change:** Drop the inline property from the generator (the `html[data-rail]` selector already covers it).
  - **Prior observation to check:** `public/boot/prepaint.js:39-42` + `app/composables/useShellAppearance.ts:28-31` — Prepaint writes an inline `--neo-sidebar-width: 68px` on `<html>`. `syncRailAttr` only toggles the `data-rail` attribute and never removes that inline property, and `.neo-layout` redefines the variable anyway (`default.vue:316,357`). The property does nothing inside the layout and stays stale on `<html>` after the rail is turned off.
  - **Provenance:** [October 9 candidate, line 682](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:682); explicit source files unchanged at review time.

## Remaining candidates: Threads, notifications & direct messages

- [x] **NS-616 · P1 · UX · A · S — Only hide the bar when the focused element is inside a [data-keyboard-fixed] dock (e.g**
  - **Target:** [app/pages/status/[id].vue:930](/Users/powerox/neospace/app/pages/status/[id].vue:930). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Only hide the bar when the focused element is inside a `[data-keyboard-fixed]` dock (e.g. `!document.activeElement?.closest('.thread-search')`), or switch to `v-show` and keep it while it has focus.
  - **Prior observation to check:** `app/pages/status/[id].vue:930` — The find bar is rendered with `v-if="… && !keyboardOpen"`, and `keyboardOpen` is the shared flag that flips for *any* focused text field. On a phone, tapping "Search conversation…" opens the keyboard, which unmounts the input mid-focus. The keyboard then closes and the bar comes back, so search can't be used on touch.
  - **Provenance:** [October 9 candidate, line 971](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:971); explicit source files unchanged at review time.
  - Evidence: The find bar stays mounted while it holds focus (`threadSearchFocused` via focusin/focusout) instead of unmounting when the shared `keyboardOpen` flag flips (`status/[id].vue`).

- [x] **NS-617 · P1 · UX · A · M — After the first fetch, if ancestors[0] exists, fetch the root's context, then de-duplicate and show the…**
  - **Target:** [app/pages/status/[id].vue:78](/Users/powerox/neospace/app/pages/status/[id].vue:78). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** After the first fetch, if `ancestors[0]` exists, fetch the root's context, then de-duplicate and show the whole tree.
  - **Prior observation to check:** `app/pages/status/[id].vue:78-81` — The chat is `ancestors + focus + descendants` of the post that was opened. The inbox opens `lastStatus` (`messages.vue:93`, `dmHelpers.ts:39`), and Mastodon's context only returns that post's parent chain. In a group DM where two people answered the same message, the other branch is never shown.
  - **Provenance:** [October 9 candidate, line 972](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:972); explicit source files unchanged at review time.
  - Evidence: For direct threads, `statusStore.fetchThread` re-reads the root's context and merges branches chronologically around the focus (`app/utils/threadMerge.ts`, tests in `tests/threadMerge.test.ts`); public threads are unchanged, and a failed root fetch falls back to the focus context.

- [x] **NS-618 · P1 · UX · A · M — Keep a single instance alive (v-show for the pane), or persist the draft (see ChatComposer).**
  - **Target:** [app/pages/status/[id].vue:1145](/Users/powerox/neospace/app/pages/status/[id].vue:1145). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Keep a single instance alive (`v-show` for the pane), or persist the draft (see ChatComposer).
  - **Prior observation to check:** `app/pages/status/[id].vue:1145-1146` — The mobile composer is `v-if="dmPane === 'chat'"`. Flipping to Profile unmounts `ChatComposer`, which throws away the typed text, attachments, alt text and any pending or failed bubble. Desktop (1121) and mobile (1145) are also separate instances, so rotating an iPad across 1024px wipes the draft too.
  - **Provenance:** [October 9 candidate, line 974](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:974); explicit source files unchanged at review time.
  - Evidence: `ChatComposer` takes a `draftSlot` (`chat:<thread root id>`, shared by the desktop and mobile instances) and persists typed text through `useDraft`; failed sends restore their text into the draft. Chat slots are hidden from Settings → Saved drafts. Attachments and the pending bubble still don't survive an unmount (media ids are server-bound).

- [x] **NS-619 · P1 · A11Y · A · S — Use a 44px hit area (padding or ::before), full opacity, and a 2px focus outline.**
  - **Target:** [app/components/DmContextFooter.vue:93](/Users/powerox/neospace/app/components/DmContextFooter.vue:93). **Area:** app/components/DmContextFooter.vue.
  - **Change:** Use a 44px hit area (padding or `::before`), full opacity, and a 2px focus outline.
  - **Prior observation to check:** `app/components/DmContextFooter.vue:93-104,117-120` — The Chat/Profile tabs are 22×22px with 12px icons at 0.55 opacity, and this UI is mobile-only. That is below the 24px minimum target (44px recommended on touch) and roughly 3:1 non-text contrast; the focus ring is 1px.
  - **Provenance:** [October 9 candidate, line 1035](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1035); explicit source files unchanged at review time.
  - Evidence: `DmContextFooter.vue` tabs keep the 22px chip but get a 44px-tall hit area (`::before`), full-opacity secondary/primary colours, and a 2px focus outline.

- [x] **NS-620 · P1 · CODE · A · S — Use masto's paginator, or parse Link: rel=next.**
  - **Target:** [app/composables/useAccountSearch.ts:48](/Users/powerox/neospace/app/composables/useAccountSearch.ts:48). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Use masto's paginator, or parse `Link: rel=next`.
  - **Prior observation to check:** `app/composables/useAccountSearch.ts:48` (feeds `RecipientPicker.vue:109` and `messages.vue:24,71`) — The following list is paginated with `maxId = last account id`. Mastodon paginates `/following` by follow-record id from the Link header, so page 2 onward returns the wrong, duplicate or missing people. That causes duplicate `:key` rows in `RecipientPicker.vue:221` and people missing from the picker.
  - **Provenance:** [October 9 candidate, line 1039](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1039); explicit source files unchanged at review time.
  - Evidence: `useAccountSearch.loadFollowing` pages with `cursorPage(...$raw)` / Link `nextMaxId` and de-dupes by account id, so the picker no longer repeats or drops people.

- [x] **NS-621 · P1 · UX · A · M — Send types[] to the API for the active filter and refetch when the filter changes.**
  - **Target:** [app/stores/notifications.ts:122](/Users/powerox/neospace/app/stores/notifications.ts:122). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Send `types[]` to the API for the active filter and refetch when the filter changes.
  - **Prior observation to check:** `app/stores/notifications.ts:122-130` — Filters run client-side over the 30 rows loaded per account, so "Mentions", "Polls" and "Edits" often show "Nothing here" even though older matches exist. The empty state (`notifications.vue:507-520`) also unmounts `loadTrigger` (651), so no further pages are ever fetched.
  - **Provenance:** [October 9 candidate, line 1053](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1053); explicit source files unchanged at review time.
  - Evidence: Filters now go to the server as `types[]` (`typesForFilter`) for both the first page and load-more, and `notifications.vue` refetches on filter change (tab click and back/forward). While filtered, the badge comes from the server's unread_count (not a recount of one type) and Mark all read looks up the account's real newest id. Tests in `tests/notifications-filter.test.ts`.

- [x] **NS-622 · P1 · PERF · C · S — Poll with backoff while visible, as conversations.ts:252-288 does, or use the notification stream.**
  - **Target:** [app/layouts/default.vue:135](/Users/powerox/neospace/app/layouts/default.vue:135). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Poll with backoff while visible, as `conversations.ts:252-288` does, or use the notification stream.
  - **Prior observation to check:** `app/layouts/default.vue:135-139,161-162` — `refreshUnreadBadge` runs on mount and on `visibilitychange` only. It never polls while the tab is visible, and it isn't refreshed when an account is added (the watcher at 178-189 only refreshes DMs). A tab left open shows a stale Activity badge indefinitely.
  - **Provenance:** [October 9 candidate, line 1054](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1054); explicit source files unchanged at review time.
  - Evidence: `notificationsStore.startBadgePolling()` polls `refreshUnreadBadge` every 60s while visible, doubling to 5 min after failures (`badgePollDelay`); the shell starts/stops it with live refresh, and adding an account now refreshes the badge. `refreshUnreadBadge` returns whether every account answered usably.

- [x] **NS-623 · P2 · UX · A · S — Sort chatMessages with compareId (or createdAt) before rendering and picking the reply target.**
  - **Done:** `chatMessages` sorted by `compareId`, so the reply target is the newest message.
  - **Target:** [app/pages/status/[id].vue:78](/Users/powerox/neospace/app/pages/status/[id].vue:78). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Sort `chatMessages` with `compareId` (or `createdAt`) before rendering and picking the reply target.
  - **Prior observation to check:** `app/pages/status/[id].vue:78-81,416` — `chatMessages` uses the server's depth-first descendant order, not chronological order. Branched DMs therefore show messages out of time order, and `replyTarget = chatMessages.at(-1)` may not be the newest message.
  - **Provenance:** [October 9 candidate, line 973](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:973); explicit source files unchanged at review time.

- [x] **NS-624 · P2 · UX · A · S — Drop backAction and let SubviewChrome use history, falling back to the current target.**
  - **Target:** [app/pages/status/[id].vue:864](/Users/powerox/neospace/app/pages/status/[id].vue:864). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Drop `backAction` and let SubviewChrome use history, falling back to the current target.
  - **Prior observation to check:** `app/pages/status/[id].vue:864` — The DM back button always calls `router.push('/messages')`, which overrides SubviewChrome's history-back. If you came from Activity or a profile, Back goes to the inbox, and browser Back then returns to the DM (a loop). The same hard-coded push is in `notifications.vue:363` and `messages.vue:240`.
  - **Provenance:** [October 9 candidate, line 975](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:975); explicit source files unchanged at review time.
  - **Done:** `SubviewChrome` gained a `backFallback` prop (default `/`) used when there is no in-app history; the status page passes its own fallback instead of overriding Back.
- [x] **NS-625 · P2 · UX · A · S — Leave out the viewer's acct, and add focusStatus.mentions except yourself.**
  - **Done:** Public reply mentions the author unless it's you, plus the post's other mentions (deduped).
  - **Target:** [app/pages/status/[id].vue:422](/Users/powerox/neospace/app/pages/status/[id].vue:422). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Leave out the viewer's acct, and add `focusStatus.mentions` except yourself.
  - **Prior observation to check:** `app/pages/status/[id].vue:422-426` — The public reply dock always prepends the focus author, including when that author is you, so replying to your own post sends "@you …". It also drops the other people mentioned in the post (Mastodon keeps them).
  - **Provenance:** [October 9 candidate, line 976](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:976); explicit source files unchanged at review time.

- [x] **NS-626 · P2 · UX · A · M — Add the same refresh action to the public header, and optionally a quiet poll with a "N new replies" pill.**
  - **Target:** [app/pages/status/[id].vue:913](/Users/powerox/neospace/app/pages/status/[id].vue:913). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Add the same refresh action to the public header, and optionally a quiet poll with a "N new replies" pill.
  - **Prior observation to check:** `app/pages/status/[id].vue:913-927,785` — Public threads have no refresh button (only the DM header has one, at 895) and no polling (`startThreadPoll` returns early when the thread isn't a DM). New replies only show after a full page reload.
  - **Provenance:** [October 9 candidate, line 978](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:978); explicit source files unchanged at review time.
  - **Done:** The public thread header has a Refresh button and a quiet poll that shows a "N new replies" pill instead of reflowing the page under the reader (`status/[id].vue`).

- [x] **NS-627 · P2 · UX · A · M — Render an "Earlier post unavailable · Open original" stub above the first ancestor.**
  - **Target:** [app/pages/status/[id].vue:1174](/Users/powerox/neospace/app/pages/status/[id].vue:1174). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Render an "Earlier post unavailable · Open original" stub above the first ancestor.
  - **Prior observation to check:** `app/pages/status/[id].vue:1174-1182` — Nothing marks a missing or deleted parent. If `focusStatus.inReplyToId` is set but `ancestors` is empty, or `ancestors[0].inReplyToId` points at a post that wasn't returned, the thread starts as if it were the root.
  - **Provenance:** [October 9 candidate, line 979](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:979); explicit source files unchanged at review time.
  - **Done:** When the topmost shown post still replies to something that isn't available, an "Earlier post unavailable · Open original" stub renders above it (`earlierPostMissing` in `utils/threadMerge.ts`). Tests: `tests/p2-final-batch.test.ts`.

- [x] **NS-628 · P2 · UX · A · M — Decide whether to merge the origin server's public /api/v1/statuses/:id/context (matched by uri) for…**
  - **Target:** [app/pages/status/[id].vue:662](/Users/powerox/neospace/app/pages/status/[id].vue:662). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Decide whether to merge the origin server's public `/api/v1/statuses/:id/context` (matched by `uri`) for public posts.
  - **Prior observation to check:** `app/pages/status/[id].vue:662` — `fetchThread` only asks the viewer's server. Replies your server never received are missing, and the only way to see the full remote thread is the globe link out of the app.
  - **Provenance:** [October 9 candidate, line 980](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:980); explicit source files unchanged at review time.
  - **Done:** Decision: **no merge** with the origin server's context (a second source would reorder and duplicate posts the reader already has); instead the gap is surfaced — the stub from NS-627 links to the original thread, so the reader can open the full conversation there.

- [x] **NS-629 · P2 · PERF · A · M — Drive it from the conversations store: only refetch context when this conversation's lastStatus.id changes.**
  - **Target:** [app/pages/status/[id].vue:786](/Users/powerox/neospace/app/pages/status/[id].vue:786). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Drive it from the conversations store: only refetch context when this conversation's `lastStatus.id` changes.
  - **Prior observation to check:** `app/pages/status/[id].vue:786-789` — The DM poll re-downloads the focus status and the whole context every 40s (`stores/status.ts:369-372`), on top of the conversations poll every 45s. Long DMs refetch and re-render hundreds of statuses per tick.
  - **Provenance:** [October 9 candidate, line 981](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:981); explicit source files unchanged at review time.
  - **Done:** The DM thread follows the conversations store: it refetches context only when the matching conversation's `lastStatus.id` is a message not already loaded (`findThreadConversation` / `threadNeedsRefetch`, `utils/dmThread.ts`), so an unchanged inbox row costs nothing. Tests: `tests/p2-final-batch.test.ts`, `tests/conversations-store.test.ts`.

- [x] **NS-630 · P2 · UX · A · S — visible, throttled.**
  - **Done:** `visibilitychange` triggers a quiet reload for DMs, throttled to 5s.
  - **Target:** [app/pages/status/[id].vue:787](/Users/powerox/neospace/app/pages/status/[id].vue:787). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** visible, throttled.
  - **Prior observation to check:** `app/pages/status/[id].vue:787` — The poll skips hidden tabs but nothing catches up on `visibilitychange`. Returning to a DM shows stale messages for up to 40s. → Run `loadThread({ quiet: true })` on visibility
  - **Provenance:** [October 9 candidate, line 982](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:982); explicit source files unchanged at review time.

- [x] **NS-631 · P2 · UX · A · S — Give images intrinsic size from meta.small, or re-scroll on image load while the reader is still at the…**
  - **Target:** [app/pages/status/[id].vue:570](/Users/powerox/neospace/app/pages/status/[id].vue:570). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Give images intrinsic size from `meta.small`, or re-scroll on image `load` while the reader is still at the bottom.
  - **Prior observation to check:** `app/pages/status/[id].vue:570-576` — `scrollChatToEnd` runs on `nextTick`, but bubble images are `loading="lazy"` with no width/height (`MessageBubble.vue:274-279`). As they load they push the newest message under the composer.
  - **Provenance:** [October 9 candidate, line 983](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:983); explicit source files unchanged at review time.
  - **Done:** `pages/status/[id].vue` re-scrolls on image `load` while the reader is still pinned to the bottom of the chat.
- [x] **NS-632 · P2 · UX · A · S — When paramId isn't the last message, scroll to that bubble and briefly highlight it.**
  - **Target:** [app/pages/status/[id].vue:697](/Users/powerox/neospace/app/pages/status/[id].vue:697). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** When `paramId` isn't the last message, scroll to that bubble and briefly highlight it.
  - **Prior observation to check:** `app/pages/status/[id].vue:697-699` — A DM opened from a notification about an older message always scrolls to the bottom. The referenced message isn't scrolled into view or highlighted.
  - **Provenance:** [October 9 candidate, line 984](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:984); explicit source files unchanged at review time.
  - **Done:** `scrollToChatMessage` scrolls to and briefly highlights the bubble when `paramId` isn't the last message.
- [x] **NS-633 · P2 · A11Y · A · S — Bind role/aria-labelledby only when showDmContextChrome.**
  - **Target:** [app/pages/status/[id].vue:969](/Users/powerox/neospace/app/pages/status/[id].vue:969). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Bind `role`/`aria-labelledby` only when `showDmContextChrome`.
  - **Prior observation to check:** `app/pages/status/[id].vue:969-979` — `role="tabpanel"` is set even when the tablist isn't rendered (desktop, or no participants). The result is an unnamed tabpanel with no tabs.
  - **Provenance:** [October 9 candidate, line 988](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:988); explicit source files unchanged at review time.
  - **Done:** `role`/`aria-labelledby` on the chat region are bound only when `showDmContextChrome`.
- [x] **NS-634 · P2 · A11Y · A · S — Add roving tabindex plus arrows, or use plain buttons with aria-pressed, and disable chips that have no id.**
  - **Target:** [app/pages/status/[id].vue:1036](/Users/powerox/neospace/app/pages/status/[id].vue:1036). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Add roving tabindex plus arrows, or use plain buttons with `aria-pressed`, and disable chips that have no id.
  - **Prior observation to check:** `app/pages/status/[id].vue:1036-1050` — `role="radiogroup"`/`role="radio"` chips have no arrow-key roving and every chip is a tab stop. Chips without `p.id` do nothing when clicked.
  - **Provenance:** [October 9 candidate, line 989](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:989); explicit source files unchanged at review time.
  - **Done:** Peek chips are now `aria-pressed` buttons inside a `role="group"` (not a half-implemented radiogroup) and are disabled when the person has no id.
- [x] **NS-635 · P2 · UX · A · S — Run emojify(html, status.emojis) and account.emojis for names.**
  - **Done:** Bubble body and sender name use `emojify` (sanitised).
  - **Target:** [app/components/MessageBubble.vue:259](/Users/powerox/neospace/app/components/MessageBubble.vue:259). **Area:** app/components/MessageBubble.vue.
  - **Change:** Run `emojify(html, status.emojis)` and `account.emojis` for names.
  - **Prior observation to check:** `app/components/MessageBubble.vue:259-263,235` — Custom emoji are never rendered. The bubble HTML and sender name skip `emojify` (RealPostCard uses it), so DMs show raw `:blobcat:`. The same applies to names in the chat header, inbox rows (`messages.vue:420`), the recipient picker (`RecipientPicker.vue:233`) and notification actors (`notifications.vue:569`).
  - **Provenance:** [October 9 candidate, line 1004](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1004); explicit source files unchanged at review time.

- [x] **NS-636 · P2 · UX · A · S — Hide the menu (or limit it to Copy) when delivery is set.**
  - **Done:** Delete / Open as post hidden while a bubble is pending or failed; Copy stays.
  - **Target:** [app/components/MessageBubble.vue:329](/Users/powerox/neospace/app/components/MessageBubble.vue:329). **Area:** app/components/MessageBubble.vue.
  - **Change:** Hide the menu (or limit it to Copy) when `delivery` is set.
  - **Prior observation to check:** `app/components/MessageBubble.vue:329-341` — The ⋯ menu also renders on optimistic and failed bubbles (`ChatComposer.vue:321`). "Delete" calls `deleteStatus('pending-…')` and shows an error toast; "Open as post" goes to `/status/pending-…`, which errors.
  - **Provenance:** [October 9 candidate, line 1005](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1005); explicit source files unchanged at review time.

- [x] **NS-637 · P2 · UX · A · S — Open status.url on the origin server, or remove the item.**
  - **Done:** "Open as post" is offered only for non-direct statuses (for a DM it was the same chat).
  - **Target:** [app/components/MessageBubble.vue:183](/Users/powerox/neospace/app/components/MessageBubble.vue:183). **Area:** app/components/MessageBubble.vue.
  - **Change:** Open `status.url` on the origin server, or remove the item.
  - **Prior observation to check:** `app/components/MessageBubble.vue:183-186` — "Open as post" goes to `/status/{id}`. For a direct status that page renders the same chat view, so the action appears to do nothing.
  - **Provenance:** [October 9 candidate, line 1006](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1006); explicit source files unchanged at review time.

- [x] **NS-638 · P2 · UX · A · S — Render gifv as &lt;video autoplay loop muted playsinline&gt; and skip the image lightbox for it.**
  - **Done:** gifv renders as muted looping `<video>` (controls under reduced motion) and skips the lightbox.
  - **Target:** [app/components/MessageBubble.vue:268](/Users/powerox/neospace/app/components/MessageBubble.vue:268). **Area:** app/components/MessageBubble.vue.
  - **Change:** Render gifv as `<video autoplay loop muted playsinline>` and skip the image lightbox for it.
  - **Prior observation to check:** `app/components/MessageBubble.vue:268-279,120-128` — GIFV is shown as a static `previewUrl` that never animates. Tapping it hands the lightbox `item.url`, an `.mp4`, as an image source, so the lightbox is broken.
  - **Provenance:** [October 9 candidate, line 1007](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1007); explicit source files unchanged at review time.

- [x] **NS-639 · P2 · SEC · A · S — Show a "Public"/"Unlisted" chip when status.visibility !== 'direct'.**
  - **Done:** Public / Unlisted / Followers-only chip shown when a non-direct status is in the thread.
  - **Target:** [app/components/MessageBubble.vue:210](/Users/powerox/neospace/app/components/MessageBubble.vue:210). **Area:** app/components/MessageBubble.vue.
  - **Change:** Show a "Public"/"Unlisted" chip when `status.visibility !== 'direct'`.
  - **Prior observation to check:** `app/components/MessageBubble.vue:210-226` — A public or unlisted post in a DM thread (an ancestor the DM replied to, or someone's non-direct reply) looks exactly like a private bubble. Users can't tell which messages are actually public.
  - **Provenance:** [October 9 candidate, line 1008](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1008); explicit source files unchanged at review time.

- [x] **NS-640 · P2 · UX · A · M — Reuse the poll and link-card components from RealPostCard inside the bubble.**
  - **Target:** [app/components/MessageBubble.vue:259](/Users/powerox/neospace/app/components/MessageBubble.vue:259). **Area:** app/components/MessageBubble.vue.
  - **Change:** Reuse the poll and link-card components from RealPostCard inside the bubble.
  - **Prior observation to check:** `app/components/MessageBubble.vue:259-310` — `status.poll`, `status.card` and quotes are ignored, so a DM containing a poll shows only its text and there's no way to vote.
  - **Provenance:** [October 9 candidate, line 1009](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1009); explicit source files unchanged at review time.
  - **Done:** `MessageBubble` renders the shared `PostPoll` (votable, using the active client) and `PreviewCard` for the first link inside a DM bubble.

- [x] **NS-641 · P2 · DESIGN · A · S — Show the time only on the last bubble of a run, or after a gap of more than 5 minutes; tighten corners…**
  - **Target:** [app/components/MessageBubble.vue:313](/Users/powerox/neospace/app/components/MessageBubble.vue:313). **Area:** app/components/MessageBubble.vue.
  - **Change:** Show the time only on the last bubble of a run, or after a gap of more than 5 minutes; tighten corners inside a run.
  - **Prior observation to check:** `app/components/MessageBubble.vue:313-318` — Every bubble has its own timestamp, so consecutive messages repeat "3:41 PM" under each line, and bubble corners aren't grouped. The chat feels noisy compared with Threads/IG.
  - **Provenance:** [October 9 candidate, line 1010](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1010); explicit source files unchanged at review time.
  - **Done:** Consecutive messages from one sender join into a run: corners tighten (`joinPrev` / `joinNext`) and the time shows only on the last bubble of a run or after a gap.
- [x] **NS-642 · P2 · PERF · A · S — Call loadFollowing() lazily, only when !conversations.length || isSparseInbox, and don't force it on refresh.**
  - **Done:** Pull-to-refresh loads following only for an empty/sparse inbox and no longer forces it.
  - **Target:** [app/pages/messages.vue:129](/Users/powerox/neospace/app/pages/messages.vue:129). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Call `loadFollowing()` lazily, only when `!conversations.length || isSparseInbox`, and don't force it on refresh.
  - **Prior observation to check:** `app/pages/messages.vue:129-132` — Every inbox open and pull-to-refresh pages through up to 400 followed accounts (5 sequential requests) just to fill ≤8 suggestion chips. Those chips only render when the inbox is empty or has fewer than 5 chats.
  - **Provenance:** [October 9 candidate, line 1040](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1040); explicit source files unchanged at review time.

- [x] **NS-643 · P2 · UX · A · S — Remove the row optimistically, restore it and toast on failure.**
  - **Done:** `conversations.remove` is optimistic and restores the row in place on failure; the page toasts.
  - **Target:** [app/pages/messages.vue:106](/Users/powerox/neospace/app/pages/messages.vue:106). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Remove the row optimistically, restore it and toast on failure.
  - **Prior observation to check:** `app/pages/messages.vue:106-110` — A failed "Remove chat" is silent. `conversations.ts:224` sets `store.error`, which only renders when the list is empty (326-327).
  - **Provenance:** [October 9 candidate, line 1041](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1041); explicit source files unchanged at review time.

- [x] **NS-644 · P2 · UX · A · S — Fall back to "Photo" / "Video" / "Attachment" from lastStatus.mediaAttachments.**
  - **Done:** `dmPreviewText` falls back to Photo/Video/Audio/Attachment for media-only messages. Tested.
  - **Target:** [app/stores/conversations.ts:235](/Users/powerox/neospace/app/stores/conversations.ts:235). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Fall back to "Photo" / "Video" / "Attachment" from `lastStatus.mediaAttachments`.
  - **Prior observation to check:** `app/stores/conversations.ts:235,240-243` — Media-only DMs have content like `<p>@alice</p>`, which strips to "". The row shows a blank preview or a dangling "You: ".
  - **Provenance:** [October 9 candidate, line 1042](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1042); explicit source files unchanged at review time.

- [x] **NS-645 · P2 · UX · A · S — Use "CW: {spoilerText}" when it is set.**
  - **Done:** `dmPreviewText` shows `CW: {spoilerText}` when set. Tested.
  - **Target:** [app/stores/conversations.ts:240](/Users/powerox/neospace/app/stores/conversations.ts:240). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Use "CW: {spoilerText}" when it is set.
  - **Prior observation to check:** `app/stores/conversations.ts:240-243` — The inbox preview shows the text of content-warned DMs because `spoilerText` is ignored.
  - **Provenance:** [October 9 candidate, line 1043](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1043); explicit source files unchanged at review time.

- [x] **NS-646 · P2 · UX · A · S — Use void conversations.markRead(...) after markReadLocal.**
  - **Done:** `openOrComposeDirect` and `ComposeSheet` use `void conversations.markRead`.
  - **Target:** [app/utils/dmHelpers.ts:38](/Users/powerox/neospace/app/utils/dmHelpers.ts:38). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Use `void conversations.markRead(...)` after `markReadLocal`.
  - **Prior observation to check:** `app/utils/dmHelpers.ts:38` — `await conversations.markRead(existing.id)` runs before `router.push`, so "Message Alice" waits on a network round-trip. The same happens in `ComposeSheet.vue:103`.
  - **Provenance:** [October 9 candidate, line 1044](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1044); explicit source files unchanged at review time.

- [x] **NS-647 · P2 · UX · A · S — Treat these as having no actor**
  - **Done:** `notifHasActor` + actorless labels; notifications page and `PanelColumn` hide avatar/name and guard profile open for severed/moderation/annual-report.
  - **Target:** [app/utils/notifHelpers.ts:39](/Users/powerox/neospace/app/utils/notifHelpers.ts:39). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Treat these as having no actor. Use copy like "You lost connections with {domain}", "Your account received a moderation warning", and link to `{instanceUrl}/severed_relationships`, `/disputes/strikes/{id}`, and the annual report.
  - **Prior observation to check:** `app/utils/notifHelpers.ts:39-41` — `severed_relationships`, `moderation_warning` and `annual_report` notifications carry the recipient's *own* account. Rows read "YourName severed a relationship", "YourName received a moderation warning" and "YourName shared an annual report", with your own avatar, and clicking opens your own profile (`notifications.vue:290-293`).
  - **Prior verifier qualification:** Real: Mastodon sets `from_account` to the recipient for these types, so rows show "You severed a relationship" with your own avatar and link to your own profile (`notifications.vue:292-293`). But these types are rare. [Impact Medium. Fix unchanged.]
  - **Provenance:** [October 9 candidate, line 1055](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1055); explicit source files unchanged at review time.

- [x] **NS-648 · P2 · UX · A · S — Build the whole sentence: "{name}'s poll has ended" / "Your poll has ended" when account.id is yours.**
  - **Done:** N/A — already fixed: label is "ended a poll" (no "'s poll has ended" spacing glitch in `notifLabel`). Own-poll wording not changed.
  - **Target:** [app/utils/notifHelpers.ts:31](/Users/powerox/neospace/app/utils/notifHelpers.ts:31). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Build the whole sentence: "{name}'s poll has ended" / "Your poll has ended" when `account.id` is yours.
  - **Prior observation to check:** `app/utils/notifHelpers.ts:31` — The poll label is "'s poll has ended". With the name span's `margin-right: .35rem` (`notifications.vue:1197`) plus the template whitespace, it renders "Alice ’s poll has ended". For your own poll it reads "YourName's poll has ended".
  - **Provenance:** [October 9 candidate, line 1058](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1058); explicit source files unchanged at review time.

- [x] **NS-649 · P2 · UX · A · S — Reverse groupOrder when sortOrder === 'oldest'.**
  - **Done:** `groupOrder` is a computed reversed when `sortOrder === 'oldest'`.
  - **Target:** [app/stores/notifications.ts:145](/Users/powerox/neospace/app/stores/notifications.ts:145). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Reverse `groupOrder` when `sortOrder === 'oldest'`.
  - **Prior observation to check:** `app/stores/notifications.ts:145-170` — "Oldest first" sorts rows within each bucket, but `groupOrder` (`notifications.vue:85,113`) stays Today → Older. Oldest-first still puts today's activity at the top.
  - **Provenance:** [October 9 candidate, line 1059](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1059); explicit source files unchanged at review time.

- [x] **NS-650 · P2 · UX · A · S — Keep the server count for the badge, and use the local unread state only for row styling.**
  - **Target:** [app/stores/notifications.ts:356](/Users/powerox/neospace/app/stores/notifications.ts:356). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Keep the server count for the badge, and use the local unread state only for row styling.
  - **Prior observation to check:** `app/stores/notifications.ts:356` — `fetchNotifications` replaces the server `unread_count` (up to 1000, lines 253-262) with a count over the ≤30 rows loaded per account. The title and heading drop from "(150)" to "(30)" when the page opens.
  - **Provenance:** [October 9 candidate, line 1065](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1065); explicit source files unchanged at review time.
  - **Done:** `notifications.ts` `reconcileUnreadWithList` keeps the server count (`max(server, local)`) and `adjustUnread` shifts it on dismiss/undo. Tests: `tests/notifications-reconcile.test.ts`.
- [x] **NS-651 · P2 · UX · A · S — Keep the previous value on total failure, and fall back to marker plus list count when the endpoint is…**
  - **Target:** [app/stores/notifications.ts:249](/Users/powerox/neospace/app/stores/notifications.ts:249). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Keep the previous value on total failure, and fall back to marker plus list count when the endpoint is missing.
  - **Prior observation to check:** `app/stores/notifications.ts:249-262` — If every `unread_count` call fails, the badge is set to 0. That covers offline, and GoToSocial/Akkoma, which lack `/api/v1/notifications/unread_count`, so those accounts never get a badge.
  - **Provenance:** [October 9 candidate, line 1066](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1066); explicit source files unchanged at review time.
  - **Done:** `refreshUnreadBadge` keeps the last good value on total failure and falls back to `localUnreadFor`; see `tests/notifications-reconcile.test.ts`.
- [x] **NS-652 · P2 · UX · A · S — Only drop rows for accounts that succeeded, and report a partial result.**
  - **Target:** [app/stores/notifications.ts:562](/Users/powerox/neospace/app/stores/notifications.ts:562). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Only drop rows for accounts that succeeded, and report a partial result.
  - **Prior observation to check:** `app/stores/notifications.ts:562-569` — `clearAll` counts any single account's success as success. It wipes every account's rows locally and shows "Notifications cleared" even though failed accounts still have theirs.
  - **Provenance:** [October 9 candidate, line 1067](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1067); explicit source files unchanged at review time.
  - **Done:** `clearAll` drops rows only for accounts that succeeded, returns `{ failedHosts }`, and `notifications.vue` toasts the partial result. Tests: `tests/notifications-reconcile.test.ts`.
- [x] **NS-653 · P2 · UX · A · M — Show only rows newer than the highest per-account oldest timestamp; hold the rest until the next page.**
  - **Target:** [app/stores/notifications.ts:330](/Users/powerox/neospace/app/stores/notifications.ts:330). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Show only rows newer than the highest per-account oldest timestamp; hold the rest until the next page.
  - **Prior observation to check:** `app/stores/notifications.ts:330-355,440` — Accounts are merged by time but each fetches only its newest 30. A quiet account's month-old rows sit between a busy account's last hour, then load-more inserts the busy account's older rows *above* them, so rows jump under the reader.
  - **Provenance:** [October 9 candidate, line 1068](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1068); explicit source files unchanged at review time.
  - **Done:** Notifications merge by time but accounts page independently, so rows older than the newest "oldest loaded row" among accounts that still have pages are held back (`notificationFrontier` / `withinFrontier` in `utils/notifHelpers.ts`, `moreByInstance` in the store, applied in `filteredNotifications`); `loadMore` keeps paging (up to 3 extra rounds) if a page lands entirely below the frontier. Tests: `tests/notifications-frontier.test.ts`.

- [x] **NS-654 · P2 · UX · A · M — Add an optional "Add more posts" step listing the account's recent posts, and a legal category.**
  - **Target:** [app/components/NeoReport.vue:51](/Users/powerox/neospace/app/components/NeoReport.vue:51). **Area:** app/components/NeoReport.vue.
  - **Change:** Add an optional "Add more posts" step listing the account's recent posts, and a `legal` category.
  - **Prior observation to check:** `app/components/NeoReport.vue:51-69` — Only the one post can be attached (`status.ts:444` sends `statusIds: [id]`). There's no way to add other posts from the account and no "Legal" category (Mastodon 4.2+).
  - **Provenance:** [October 9 candidate, line 1087](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1087); explicit source files unchanged at review time.
  - **Done:** `NeoReport` gained a "Legal issue" category (offered only when the server proves Mastodon 4.2+, `supportsLegalReports`) and an optional "Add more posts" step listing the account's recent posts (`statusStore.listReportablePosts`, extra `statusIds` sent with the report). Tests: `tests/p2-final-batch.test.ts` (`supportsLegalReports`).

- [x] **NS-655 · P2 · TOOLING · A · S — Add unit tests with a mocked clientFor.**
  - **Target:** [tests/inbox.test.ts:1](/Users/powerox/neospace/tests/inbox.test.ts:1). **Area:** tests/inbox.test.ts (gaps).
  - **Change:** Add unit tests with a mocked `clientFor`.
  - **Prior observation to check:** `tests/inbox.test.ts:1-176` — Nothing covers the conversations store: page-1 merge keeping the tail, an account switch clearing the list, `markReadForThread`'s exact participant set, `findExactOneToOne`, `stripParticipantMentions` (`app/utils/dmMentions.ts`), or `daySeparatorLabel(now)`.
  - **Provenance:** [October 9 candidate, line 1101](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1101); explicit source files unchanged at review time.
  - **Done:** `tests/conversations-store.test.ts` covers the conversations store with a mocked `clientFor`: page-1 refresh keeps the loaded tail, account switch clears the inbox, `markReadForThread` marks only the exact participant set / prefers the thread's last message, `findDirectWith` never returns a group thread, optimistic `remove`. `stripParticipantMentions` and `daySeparatorLabel` were already covered in `tests/smoke.test.ts`.

- [ ] **NS-656 · P3 · UX · A · S — Hydrate them via accounts.$select(id).fetch(), as the peek pane already does.**
  - **Target:** [app/pages/status/[id].vue:169](/Users/powerox/neospace/app/pages/status/[id].vue:169). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Hydrate them via `accounts.$select(id).fetch()`, as the peek pane already does.
  - **Prior observation to check:** `app/pages/status/[id].vue:169-181` — Participants who have only been mentioned (for example, you sent the first DM and they haven't replied yet) get `displayName = username` and `avatar: null`. A new 1:1 header shows a lowercase handle and a letter placeholder.
  - **Provenance:** [October 9 candidate, line 985](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:985); explicit source files unchanged at review time.

- [ ] **NS-657 · P3 · UX · A · S — Show it only when ancestors.length === 40 and ancestors[0].inReplyToId is set.**
  - **Target:** [app/pages/status/[id].vue:997](/Users/powerox/neospace/app/pages/status/[id].vue:997). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Show it only when `ancestors.length === 40` and `ancestors[0].inReplyToId` is set.
  - **Prior observation to check:** `app/pages/status/[id].vue:997-1001` — "Older messages may be truncated by your server's context limit" appears on any DM with 40 or more messages. Mastodon's context isn't capped at 40 for signed-in users, so the warning is usually false.
  - **Provenance:** [October 9 candidate, line 986](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:986); explicit source files unchanged at review time.

- [ ] **NS-658 · P3 · PERF · A · S — Have resolveThreadId return the status and reuse it.**
  - **Target:** [app/pages/status/[id].vue:636](/Users/powerox/neospace/app/pages/status/[id].vue:636). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Have `resolveThreadId` return the status and reuse it.
  - **Prior observation to check:** `app/pages/status/[id].vue:636,662` — Each fresh open fetches the focus status twice: `resolveThreadId` → `fetchStatus` (`status.ts:394`), then `fetchThread` → `fetch` (`status.ts:370`).
  - **Provenance:** [October 9 candidate, line 987](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:987); explicit source files unchanged at review time.

- [ ] **NS-659 · P3 · A11Y · A · S — Add role="region".**
  - **Target:** [app/pages/status/[id].vue:1026](/Users/powerox/neospace/app/pages/status/[id].vue:1026). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Add `role="region"`.
  - **Prior observation to check:** `app/pages/status/[id].vue:1026-1034` — The profile pane's `aria-label` sits on a role-less `div`, so it is ignored.
  - **Provenance:** [October 9 candidate, line 990](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:990); explicit source files unchanged at review time.

- [ ] **NS-660 · P3 · A11Y · A · M — Turn aria-live back on one tick after the list has settled.**
  - **Target:** [app/pages/status/[id].vue:985](/Users/powerox/neospace/app/pages/status/[id].vue:985). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Turn `aria-live` back on one tick after the list has settled.
  - **Prior observation to check:** `app/pages/status/[id].vue:985-989` — Clearing the find query switches `aria-live` back to `polite` in the same render that re-inserts every filtered-out bubble. Screen readers can then read out the whole conversation.
  - **Provenance:** [October 9 candidate, line 991](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:991); explicit source files unchanged at review time.

- [ ] **NS-661 · P3 · UX · A · S — Use one neutral label, or decide from the route.**
  - **Target:** [app/pages/status/[id].vue:952](/Users/powerox/neospace/app/pages/status/[id].vue:952). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Use one neutral label, or decide from the route.
  - **Prior observation to check:** `app/pages/status/[id].vue:952-953` — The loading label branches on `isDirectThread`, which is always false while loading because `focusStatus` is null. DMs show "Loading conversation", and the "Loading messages" branch never runs.
  - **Provenance:** [October 9 candidate, line 992](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:992); explicit source files unchanged at review time.

- [ ] **NS-662 · P3 · UX · A · S — Base it on descendants only, and use different copy when !canReply.**
  - **Target:** [app/pages/status/[id].vue:1219](/Users/powerox/neospace/app/pages/status/[id].vue:1219). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Base it on `descendants` only, and use different copy when `!canReply`.
  - **Prior observation to check:** `app/pages/status/[id].vue:1219-1221` — "No replies yet — be the first." only appears when there are no ancestors either, so a leaf reply shows nothing. It is also shown to signed-out viewers, who can't reply.
  - **Provenance:** [October 9 candidate, line 993](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:993); explicit source files unchanged at review time.

- [ ] **NS-663 · P3 · UX · A · S — Only increment when status.inReplyToId === focusStatus.id.**
  - **Target:** [app/pages/status/[id].vue:723](/Users/powerox/neospace/app/pages/status/[id].vue:723). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Only increment when `status.inReplyToId === focusStatus.id`.
  - **Prior observation to check:** `app/pages/status/[id].vue:723-728` — `onReplyPosted` adds 1 to the focus post's `repliesCount` for any `@replied` from an ancestor or nested card (1181, 1209), even when the reply went to a different post.
  - **Provenance:** [October 9 candidate, line 994](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:994); explicit source files unchanged at review time.

- [ ] **NS-664 · P3 · UX · A · S — " linking to /status/{id}.**
  - **Target:** [app/pages/status/[id].vue:499](/Users/powerox/neospace/app/pages/status/[id].vue:499). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** " linking to `/status/{id}`.
  - **Prior observation to check:** `app/pages/status/[id].vue:499` — Depth is capped at 6 with no "continue thread" affordance. Deeper replies all sit at the same indent, so you can't tell parent from child. → At the cap, render "Continue thread
  - **Provenance:** [October 9 candidate, line 995](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:995); explicit source files unchanged at review time.

- [ ] **NS-665 · P3 · DESIGN · A · S — Render a placeholder per slot instead of hiding the first.**
  - **Target:** [app/pages/status/[id].vue:872](/Users/powerox/neospace/app/pages/status/[id].vue:872). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Render a placeholder per slot instead of hiding the first.
  - **Prior observation to check:** `app/pages/status/[id].vue:872-886` — If the first participant has no avatar and the second does, the first `<img>` is hidden by `v-show`. The second renders as the small `--stack` badge next to an empty main circle.
  - **Provenance:** [October 9 candidate, line 996](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:996); explicit source files unchanged at review time.

- [ ] **NS-666 · P3 · CODE · A · S — Take the first grapheme (clipGraphemes/Intl.Segmenter).**
  - **Target:** [app/pages/status/[id].vue:885](/Users/powerox/neospace/app/pages/status/[id].vue:885). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Take the first grapheme (`clipGraphemes`/`Intl.Segmenter`).
  - **Prior observation to check:** `app/pages/status/[id].vue:885,1063` — `.slice(0, 1)` on a display name splits emoji surrogate pairs, so the initial shows as �.
  - **Provenance:** [October 9 candidate, line 997](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:997); explicit source files unchanged at review time.

- [ ] **NS-667 · P3 · UX · A · S — Use mapErrorToMessage.**
  - **Target:** [app/pages/status/[id].vue:264](/Users/powerox/neospace/app/pages/status/[id].vue:264). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Use `mapErrorToMessage`.
  - **Prior observation to check:** `app/pages/status/[id].vue:264,304,310` — The peek pane shows raw `e.message` (e.g. "Request failed with status code 404").
  - **Provenance:** [October 9 candidate, line 998](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:998); explicit source files unchanged at review time.

- [ ] **NS-668 · P3 · CODE · A · S — Pass focusStatus.visibility.**
  - **Target:** [app/pages/status/[id].vue:1247](/Users/powerox/neospace/app/pages/status/[id].vue:1247). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Pass `focusStatus.visibility`.
  - **Prior observation to check:** `app/pages/status/[id].vue:1247` — `focusStatus.visibility === 'direct' ? 'direct' : focusStatus.visibility` returns the same value either way, and this branch is never a DM.
  - **Provenance:** [October 9 candidate, line 999](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:999); explicit source files unchanged at review time.

- [ ] **NS-669 · P3 · UX · A · S — Share one helper built on Intl.ListFormat.**
  - **Target:** [app/pages/status/[id].vue:394](/Users/powerox/neospace/app/pages/status/[id].vue:394). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Share one helper built on `Intl.ListFormat`.
  - **Prior observation to check:** `app/pages/status/[id].vue:394-406` — The thread title joins names with "&" and "+N" in English and duplicates `participantLabel` (`dmHelpers.ts:54-62`).
  - **Provenance:** [October 9 candidate, line 1000](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1000); explicit source files unchanged at review time.

- [ ] **NS-670 · P3 · SEC · A · S — Decide whether DM titles should be a generic "Message | NeoSpace".**
  - **Target:** [app/pages/status/[id].vue:832](/Users/powerox/neospace/app/pages/status/[id].vue:832). **Area:** app/pages/status/[id].vue — thread & DM chat view.
  - **Change:** Decide whether DM titles should be a generic "Message | NeoSpace".
  - **Prior observation to check:** `app/pages/status/[id].vue:832-838` — DM participants' names go into `document.title`, so they show up in browser history, tab switchers and screen shares.
  - **Provenance:** [October 9 candidate, line 1001](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1001); explicit source files unchanged at review time.

- [ ] **NS-671 · P3 · UX · A · S — Also show meta when dayLabelFor(...) is set or the gap is over 1h.**
  - **Target:** [app/pages/status/[id].vue:437](/Users/powerox/neospace/app/pages/status/[id].vue:437). **Area:** app/components/MessageBubble.vue.
  - **Change:** Also show meta when `dayLabelFor(...)` is set or the gap is over 1h.
  - **Prior observation to check:** `app/pages/status/[id].vue:437-442` — The sender's name and avatar only reappear when the speaker changes. After a day separator or a gap of several hours, the same person's next message has no header.
  - **Provenance:** [October 9 candidate, line 1011](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1011); explicit source files unchanged at review time.

- [ ] **NS-672 · P3 · UX · A · S — Use the full gate only when spoilerText is set; otherwise blur just the media.**
  - **Target:** [app/components/MessageBubble.vue:60](/Users/powerox/neospace/app/components/MessageBubble.vue:60). **Area:** app/components/MessageBubble.vue.
  - **Change:** Use the full gate only when `spoilerText` is set; otherwise blur just the media.
  - **Prior observation to check:** `app/components/MessageBubble.vue:60-66,240-251` — `sensitive` with no spoiler text hides the message text as well. In Mastodon, `sensitive` only marks the media.
  - **Provenance:** [October 9 candidate, line 1012](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1012); explicit source files unchanged at review time.

- [ ] **NS-673 · P3 · UX · A · S — Keep a toggle above the content once revealed.**
  - **Target:** [app/components/MessageBubble.vue:241](/Users/powerox/neospace/app/components/MessageBubble.vue:241). **Area:** app/components/MessageBubble.vue.
  - **Change:** Keep a toggle above the content once revealed.
  - **Prior observation to check:** `app/components/MessageBubble.vue:241,250` — The CW button switches to "Hide" when revealed, but it is `v-if="showSpoilerGate"`, so it disappears and a revealed CW can't be hidden again.
  - **Provenance:** [October 9 candidate, line 1013](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1013); explicit source files unchanged at review time.

- [ ] **NS-674 · P3 · UX · A · S — Append "· Edited" with the edit time in the title.**
  - **Target:** [app/components/MessageBubble.vue:313](/Users/powerox/neospace/app/components/MessageBubble.vue:313). **Area:** app/components/MessageBubble.vue.
  - **Change:** Append "· Edited" with the edit time in the title.
  - **Prior observation to check:** `app/components/MessageBubble.vue:313-318` — Edited DMs aren't marked; `status.editedAt` is ignored.
  - **Provenance:** [October 9 candidate, line 1014](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1014); explicit source files unchanged at review time.

- [ ] **NS-675 · P3 · UX · A · S — Pass every image/gifv in knownMedia as items along with the start index.**
  - **Target:** [app/components/MessageBubble.vue:120](/Users/powerox/neospace/app/components/MessageBubble.vue:120). **Area:** app/components/MessageBubble.vue.
  - **Change:** Pass every image/gifv in `knownMedia` as `items` along with the start index.
  - **Prior observation to check:** `app/components/MessageBubble.vue:120-129` — The lightbox only gets the tapped image, so a DM with 4 photos can't be swiped through.
  - **Provenance:** [October 9 candidate, line 1015](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1015); explicit source files unchanged at review time.

- [ ] **NS-676 · P3 · A11Y · A · S — Keep one of them.**
  - **Target:** [app/components/MessageBubble.vue:220](/Users/powerox/neospace/app/components/MessageBubble.vue:220). **Area:** app/components/MessageBubble.vue.
  - **Change:** Keep one of them.
  - **Prior observation to check:** `app/components/MessageBubble.vue:220,227` — The speaker is announced twice: the article's `aria-label` starts with `speakerLabel`, and the sr-only span repeats it.
  - **Provenance:** [October 9 candidate, line 1016](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1016); explicit source files unchanged at review time.

- [ ] **NS-677 · P3 · UX · A · S — preventDefault the contextmenu that follows a long-press that opened the menu.**
  - **Target:** [app/components/MessageBubble.vue:188](/Users/powerox/neospace/app/components/MessageBubble.vue:188). **Area:** app/components/MessageBubble.vue.
  - **Change:** `preventDefault` the `contextmenu` that follows a long-press that opened the menu.
  - **Prior observation to check:** `app/components/MessageBubble.vue:188-195` — Long-press doesn't suppress the native `contextmenu`/selection on Android, so selection handles and our menu both appear.
  - **Provenance:** [October 9 candidate, line 1017](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1017); explicit source files unchanged at review time.

- [ ] **NS-678 · P3 · DESIGN · A · S — Decide whether to hide it on coarse pointers and show it only on focus.**
  - **Target:** [app/components/MessageBubble.vue:433](/Users/powerox/neospace/app/components/MessageBubble.vue:433). **Area:** app/components/MessageBubble.vue.
  - **Change:** Decide whether to hide it on coarse pointers and show it only on focus.
  - **Prior observation to check:** `app/components/MessageBubble.vue:433-440` — On touch, every bubble has a permanently visible 36px ⋯ button at 0.6 opacity even though long-press opens the same menu, which doubles the chat clutter.
  - **Provenance:** [October 9 candidate, line 1018](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1018); explicit source files unchanged at review time.

- [ ] **NS-679 · P3 · CODE · A · S — Delete it.**
  - **Target:** [app/components/MessageBubble.vue:348](/Users/powerox/neospace/app/components/MessageBubble.vue:348). **Area:** app/components/MessageBubble.vue.
  - **Change:** Delete it.
  - **Prior observation to check:** `app/components/MessageBubble.vue:348-358` — There is a scoped copy of `.sr-only` even though the global utility exists.
  - **Provenance:** [October 9 candidate, line 1019](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1019); explicit source files unchanged at review time.

- [ ] **NS-680 · P3 · UX · A · S — Fill both selected states, or add tiny text labels.**
  - **Target:** [app/components/DmContextFooter.vue:71](/Users/powerox/neospace/app/components/DmContextFooter.vue:71). **Area:** app/components/DmContextFooter.vue.
  - **Change:** Fill both selected states, or add tiny text labels.
  - **Prior observation to check:** `app/components/DmContextFooter.vue:71-81` — The tabs are icon-only and rely on `title` tooltips, which don't exist on touch. The selected Profile icon isn't filled (only Chat fills), so the current state is hard to read.
  - **Provenance:** [October 9 candidate, line 1036](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1036); explicit source files unchanged at review time.

- [ ] **NS-681 · P3 · UX · A · S — Open the indicator only for refreshes started by a pull.**
  - **Target:** [app/pages/messages.vue:383](/Users/powerox/neospace/app/pages/messages.vue:383). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Open the indicator only for refreshes started by a pull.
  - **Prior observation to check:** `app/pages/messages.vue:383-384` — The 64px pull indicator opens whenever `isRefreshing` is true. That also happens for the header Refresh button, account switches (236) and `afterMessagePosted` (82), so ordinary refreshes push the list down and show a second spinner.
  - **Provenance:** [October 9 candidate, line 1045](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1045); explicit source files unchanged at review time.

- [ ] **NS-682 · P3 · UX · A · S — Keep one control.**
  - **Target:** [app/pages/messages.vue:464](/Users/powerox/neospace/app/pages/messages.vue:464). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Keep one control.
  - **Prior observation to check:** `app/pages/messages.vue:464-484` — After a load-more failure, both the "Load more" button and an inline "Retry" link are shown, and they do the same thing.
  - **Provenance:** [October 9 candidate, line 1046](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1046); explicit source files unchanged at review time.

- [ ] **NS-683 · P3 · UX · A · S — Add one line of guidance and use "Find people to message".**
  - **Target:** [app/pages/messages.vue:338](/Users/powerox/neospace/app/pages/messages.vue:338). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Add one line of guidance and use "Find people to message".
  - **Prior observation to check:** `app/pages/messages.vue:338-347` — The empty inbox says only "No messages" with no explanation, and the secondary link is labelled just "People".
  - **Provenance:** [October 9 candidate, line 1047](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1047); explicit source files unchanged at review time.

- [ ] **NS-684 · P3 · UX · A · S — Show your own avatar and "Note to self".**
  - **Target:** [app/pages/messages.vue:406](/Users/powerox/neospace/app/pages/messages.vue:406). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Show your own avatar and "Note to self".
  - **Prior observation to check:** `app/pages/messages.vue:406-420` — A DM to yourself (`accounts: []`) shows no avatar (an empty 48px gap) and the label "Direct message".
  - **Provenance:** [October 9 candidate, line 1048](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1048); explicit source files unchanged at review time.

- [ ] **NS-685 · P3 · CODE · A · S — Use one helper with Intl.ListFormat.**
  - **Target:** [app/utils/dmHelpers.ts:54](/Users/powerox/neospace/app/utils/dmHelpers.ts:54). **Area:** app/pages/messages.vue, app/stores/conversations.ts, app/utils/dmHelpers.ts.
  - **Change:** Use one helper with `Intl.ListFormat`.
  - **Prior observation to check:** `app/utils/dmHelpers.ts:54-62` — `participantLabel` builds "A & B" and "A +2" with English concatenation; the same logic is duplicated in `status/[id].vue:394-406`.
  - **Provenance:** [October 9 candidate, line 1050](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1050); explicit source files unchanged at review time.

- [ ] **NS-686 · P3 · UX · A · S — Also collapse consecutive follow rows from the same instance.**
  - **Target:** [app/utils/notifGroup.ts:33](/Users/powerox/neospace/app/utils/notifGroup.ts:33). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Also collapse consecutive `follow` rows from the same instance.
  - **Prior observation to check:** `app/utils/notifGroup.ts:33-38` — Follows are never collapsed because they have no status, so 5 new followers make 5 rows. Mastodon groups them.
  - **Provenance:** [October 9 candidate, line 1073](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1073); explicit source files unchanged at review time.

- [ ] **NS-687 · P3 · UX · A · S — Leave it unset (treat as unread) and rely on the server marker.**
  - **Target:** [app/stores/notifications.ts:301](/Users/powerox/neospace/app/stores/notifications.ts:301). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Leave it unset (treat as unread) and rely on the server marker.
  - **Prior observation to check:** `app/stores/notifications.ts:301-302` — With no server marker and no local value, the first load saves `items[0]` as read. On a new device, or a server without markers, nothing ever shows as unread.
  - **Provenance:** [October 9 candidate, line 1077](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1077); explicit source files unchanged at review time.

- [ ] **NS-688 · P3 · UX · A · S — Depend on a shared minute or day tick.**
  - **Target:** [app/stores/notifications.ts:147](/Users/powerox/neospace/app/stores/notifications.ts:147). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Depend on a shared minute or day tick.
  - **Prior observation to check:** `app/stores/notifications.ts:147-150` — Today/Yesterday buckets use `new Date()` captured when the getter runs, so a page left open past midnight never re-buckets.
  - **Provenance:** [October 9 candidate, line 1078](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1078); explicit source files unchanged at review time.

- [ ] **NS-689 · P3 · UX · A · S — Add "edited a post you quoted".**
  - **Target:** [app/utils/notifHelpers.ts:5](/Users/powerox/neospace/app/utils/notifHelpers.ts:5). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Add "edited a post you quoted".
  - **Prior observation to check:** `app/utils/notifHelpers.ts:5-43` — Mastodon 4.5's `quoted_update` type isn't handled and falls back to "notification" with a bell icon.
  - **Provenance:** [October 9 candidate, line 1079](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1079); explicit source files unchanged at review time.

- [ ] **NS-690 · P3 · PERF · A · M — Decide whether to adopt v2 with a v1 fallback.**
  - **Target:** [app/stores/notifications.ts:289](/Users/powerox/neospace/app/stores/notifications.ts:289). **Area:** app/pages/notifications.vue, app/stores/notifications.ts, app/utils/notifHelpers.ts, app/utils/notifGroup.ts.
  - **Change:** Decide whether to adopt v2 with a v1 fallback.
  - **Prior observation to check:** `app/stores/notifications.ts:289,525-527` — This uses v1 notifications, so a viral post fills 30-row pages with likes, and dismissing a grouped row sends N requests. Mastodon 4.3+ offers `/api/v2/notifications` (grouped) and group dismiss.
  - **Provenance:** [October 9 candidate, line 1080](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1080); explicit source files unchanged at review time.

- [ ] **NS-691 · P3 · UX · A · S — Keep the dialog open with a busy state and show the error inline.**
  - **Target:** [app/components/NeoReport.vue:95](/Users/powerox/neospace/app/components/NeoReport.vue:95). **Area:** app/components/NeoReport.vue.
  - **Change:** Keep the dialog open with a busy state and show the error inline.
  - **Prior observation to check:** `app/components/NeoReport.vue:95-105` — Submit closes the dialog immediately. Resolving the remote status or account and the API call happen afterwards, so a failure is only a toast and the typed comment is lost.
  - **Provenance:** [October 9 candidate, line 1088](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1088); explicit source files unchanged at review time.

- [ ] **NS-692 · P3 · UX · A · S — Ignore backdrop clicks while the comment isn't empty.**
  - **Target:** [app/components/NeoReport.vue:34](/Users/powerox/neospace/app/components/NeoReport.vue:34). **Area:** app/components/NeoReport.vue.
  - **Change:** Ignore backdrop clicks while the comment isn't empty.
  - **Prior observation to check:** `app/components/NeoReport.vue:34` — Clicking the backdrop cancels and throws away the typed details without asking.
  - **Provenance:** [October 9 candidate, line 1089](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1089); explicit source files unchanged at review time.

- [x] **NS-693 · P3 · UX · A · S — Raise it to 1000.**
  - **Target:** [app/components/NeoReport.vue:77](/Users/powerox/neospace/app/components/NeoReport.vue:77). **Area:** app/components/NeoReport.vue.
  - **Change:** Raise it to 1000.
  - **Prior observation to check:** `app/components/NeoReport.vue:77` — The comment is capped at `maxlength="500"`; Mastodon accepts 1000 characters.
  - **Provenance:** [October 9 candidate, line 1090](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1090); explicit source files unchanged at review time.
  - **Done:** `NeoReport.vue` comment `maxlength` raised to 1000.

- [ ] **NS-694 · P3 · PERF · A · S — Add loading="lazy" decoding="async".**
  - **Target:** [app/components/RecipientPicker.vue:231](/Users/powerox/neospace/app/components/RecipientPicker.vue:231). **Area:** app/components/RecipientPicker.vue.
  - **Change:** Add `loading="lazy" decoding="async"`.
  - **Prior observation to check:** `app/components/RecipientPicker.vue:231` — Up to 400 rows render with eagerly loaded avatars.
  - **Provenance:** [October 9 candidate, line 1093](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1093); explicit source files unchanged at review time.

- [ ] **NS-695 · P3 · UX · A · S — Show a small inline "Searching the fediverse…" row under the local matches.**
  - **Target:** [app/components/RecipientPicker.vue:197](/Users/powerox/neospace/app/components/RecipientPicker.vue:197). **Area:** app/components/RecipientPicker.vue.
  - **Change:** Show a small inline "Searching the fediverse…" row under the local matches.
  - **Prior observation to check:** `app/components/RecipientPicker.vue:197-203` — While the remote search runs, the "Searching…" indicator only shows when there are no local matches, so remote results suddenly push into the list.
  - **Provenance:** [October 9 candidate, line 1094](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1094); explicit source files unchanged at review time.

- [x] **NS-696 · P3 · UX · A · S — Filter out instancesStore.currentUser.id.**
  - **Target:** [app/components/RecipientPicker.vue:61](/Users/powerox/neospace/app/components/RecipientPicker.vue:61). **Area:** app/components/RecipientPicker.vue.
  - **Change:** Filter out `instancesStore.currentUser.id`.
  - **Prior observation to check:** `app/components/RecipientPicker.vue:61-65` — Search results can include your own account, and picking it starts a DM to yourself.
  - **Provenance:** [October 9 candidate, line 1095](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1095); explicit source files unchanged at review time.
  - **Done:** `RecipientPicker.vue` excludes the active account from merged results.

- [x] **NS-697 · P3 · A11Y · A · S — Use tertiary.**
  - **Target:** [app/components/RecipientPicker.vue:287](/Users/powerox/neospace/app/components/RecipientPicker.vue:287). **Area:** app/components/RecipientPicker.vue.
  - **Change:** Use tertiary.
  - **Prior observation to check:** `app/components/RecipientPicker.vue:287-295` — The "People you follow" section label is 11px `--neo-text-quaternary`, below contrast.
  - **Provenance:** [October 9 candidate, line 1096](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1096); explicit source files unchanged at review time.
  - **Done:** `RecipientPicker.vue` section label uses `--neo-text-tertiary`.

- [ ] **NS-698 · P3 · UX · A · S — Add small badges and a "Chat open" marker using findDirectWith.**
  - **Target:** [app/components/RecipientPicker.vue:231](/Users/powerox/neospace/app/components/RecipientPicker.vue:231). **Area:** app/components/RecipientPicker.vue.
  - **Change:** Add small badges and a "Chat open" marker using `findDirectWith`.
  - **Prior observation to check:** `app/components/RecipientPicker.vue:231-235` — Rows give no hint for locked, bot or moved accounts, or for people you already have a chat with.
  - **Provenance:** [October 9 candidate, line 1097](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1097); explicit source files unchanged at review time.

- [ ] **NS-699 · P3 · UX · A · M — Decide whether to support multi-select chips.**
  - **Target:** [app/components/RecipientPicker.vue:112](/Users/powerox/neospace/app/components/RecipientPicker.vue:112). **Area:** app/components/RecipientPicker.vue.
  - **Change:** Decide whether to support multi-select chips.
  - **Prior observation to check:** `app/components/RecipientPicker.vue:112-117` — Only one recipient can be picked, so there's no way to start a group DM.
  - **Provenance:** [October 9 candidate, line 1098](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1098); explicit source files unchanged at review time.

- [ ] **NS-700 · P3 · TOOLING · A · S — Add cases next to the existing store tests.**
  - **Target:** [tests/inbox.test.ts:111](/Users/powerox/neospace/tests/inbox.test.ts:111). **Area:** tests/inbox.test.ts (gaps).
  - **Change:** Add cases next to the existing store tests.
  - **Prior observation to check:** `tests/inbox.test.ts:111-176` — Notification tests don't cover `groupedByTime` with `sortOrder: 'oldest'`, `clearAll` partial failure, `fetchNotifications` marker sync on first load, or `notifLabel` for the self-account types.
  - **Provenance:** [October 9 candidate, line 1102](/Users/powerox/neospace/docs/AUDIT-2026-10-09.md:1102); explicit source files unchanged at review time.

## Review boundaries

This queue spans feature completeness, federation correctness, board behavior, composing, messages/activity, accounts/authentication, discovery/ranking, Edward/GPU work, settings/appearance, accessibility, security, performance, testing, documentation, hosting, and operations. It is finite and prioritized so it can drive useful work; do not interpret small visual cleanups as equal in urgency to account safety or content-warning failures.

Production deployment state, Turnstile secrets, actual third-party server compatibility, real account workflows, Safari behavior, and physical-device keyboard/touch behavior were not validated. Operational and server-dependent candidates remain conditional until checked.
