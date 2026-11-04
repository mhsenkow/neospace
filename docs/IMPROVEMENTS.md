# NeoSpace improvements tracker

_Started: Nov 2026 · From the “top 20 still improve” pass after Threads chrome / poll / scroll polish._

Work through these in order when possible. Check boxes as they ship to live. Link PRs/commits under **Notes**.

See also: [STATUS.md](./STATUS.md) · [PLAN-DEFERRED-AUDIT.md](./PLAN-DEFERRED-AUDIT.md)

---

## Highest leverage

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | **Ship or hide voice notes** — FAB can prefer voice but compose only toasted “coming soon” | ✅ | MediaRecorder → audio File attach; mic tool + recording bar |
| 2 | **Persist polls in drafts** — restore lost poll UI | ✅ | Draft schema v2 + poll snapshot restore |
| 3 | **Real post edit** — beyond delete-and-redraft | ✅ | Edit menu → source fetch → in-place PUT; media/poll still via redraft |
| 4 | **Web push for Activity** | ✅ | SW push-handler + Settings toggle; VAPID from v2 instance |
| 5 | **First-run that teaches the board** | ⬜ | Feed\|Flick, pills, algorithms, multi-server ~30s |

## Mobile chrome / nav

| # | Item | Status | Notes |
|---|------|--------|-------|
| 6 | **Don’t lose Messages** — Search↔Messages swap needs a discoverable toggle | ✅ | Long-press discover tab swaps Search ↔ Messages + toast |
| 7 | **Unify portrait vs landscape** chrome rules | ✅ | Landscape Feed\|Flick matches portrait header |
| 8 | **Clearer back-to-feeds** when deep in portals | ✅ | `goHome` clears board portal |
| 9 | **Thread peek → full thread continuity** | ✅ | Resolved id + draft handoff via `compose`/`draft` query |
| 10 | **Compose sheet squeeze** on small phones | ✅ | Keyboard mode tightens poll + tools |

## Feed / reading

| # | Item | Status | Notes |
|---|------|--------|-------|
| 11 | **Smarter Federated catch-up** | ✅ | `AUTO_SPARSE_SKIPS` 4 → 8 |
| 12 | **New-posts pill reliability** | ✅ | Pill jump uses `behavior: 'auto'` + preventScroll focus |
| 13 | **Lists** | ✅ | Board columns + drawer/menu; `useMastodonLists`; timeline fetch |
| 14 | **Mute/block/filter discoverability** on phone | ✅ | Mute/Block/Report moved up in card more-menu |
| 15 | **Quotes as first-class** | ✅ | Prefer `quotedStatusId`; URL body only as fallback |

## Social surfaces

| # | Item | Status | Notes |
|---|------|--------|-------|
| 16 | **Server-side chat search** | ✅ | Honest “Filter loaded chats…” (local-only, labeled) |
| 17 | **Cross-account DMs / Activity clarity** | ⬜ | Which account on every action |
| 18 | **Explore → follow without thrash** | ⬜ | End-to-end multi-server follow |
| 19 | **Groups as a product loop** | ⬜ | Join → catch up → post-to-group |
| 20 | **Offline usefulness** | ⬜ | Queued likes/posts + readable last feed |

---

## Progress log

| Date | Shipped | Commit / notes |
|------|---------|----------------|
| 2026-11-04 | Tracker + batch 1 | Voice notes, poll drafts, Messages long-press, portal Home, sparse skips, chat filter label |
| 2026-11-04 | Batch 2 (edit) | Real post Edit in more-menu; compose sheet editStatusId; timeline patch on edit |
| 2026-11-04 | Batch 3 (lists) | `list` feed type, drawer + FeedMenu, openListColumn, timeline paging |
| 2026-11-04 | Batch 4 | Web push, landscape Feed\|Flick, pill jump, mute/block up, compose squeeze |

---

## Working agreement

1. Update this file when starting / finishing an item (`⬜` → `🔄` → `✅`).
2. Prefer small live deploys over one giant PR.
3. If an item is blocked (API, security, ops), mark `⛔` and note why under Notes.
4. After a batch, append a Progress log row and redeploy.
