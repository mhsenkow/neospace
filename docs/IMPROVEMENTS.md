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
| 4 | **Web push for Activity** | ⬜ | VAPID + subscription + permission UX |
| 5 | **First-run that teaches the board** | ⬜ | Feed\|Flick, pills, algorithms, multi-server ~30s |

## Mobile chrome / nav

| # | Item | Status | Notes |
|---|------|--------|-------|
| 6 | **Don’t lose Messages** — Search↔Messages swap needs a discoverable toggle | ✅ | Long-press discover tab swaps Search ↔ Messages + toast |
| 7 | **Unify portrait vs landscape** chrome rules | ⬜ | Same Feed\|Flick / home rules |
| 8 | **Clearer back-to-feeds** when deep in portals | ✅ | `goHome` clears board portal |
| 9 | **Thread peek → full thread continuity** | ⬜ | Hammock deep-thread handoff |
| 10 | **Compose sheet squeeze** on small phones | ⬜ | Poll + media + keyboard height |

## Feed / reading

| # | Item | Status | Notes |
|---|------|--------|-------|
| 11 | **Smarter Federated catch-up** | ✅ | `AUTO_SPARSE_SKIPS` 4 → 8 |
| 12 | **New-posts pill reliability** | ⬜ | Instant jump, never steal scroll |
| 13 | **Lists** | ⬜ | Mastodon lists + board columns |
| 14 | **Mute/block/filter discoverability** on phone | ⬜ | Shorter path from card / profile |
| 15 | **Quotes as first-class** | ⬜ | Beyond URL append |

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

---

## Working agreement

1. Update this file when starting / finishing an item (`⬜` → `🔄` → `✅`).
2. Prefer small live deploys over one giant PR.
3. If an item is blocked (API, security, ops), mark `⛔` and note why under Notes.
4. After a batch, append a Progress log row and redeploy.
