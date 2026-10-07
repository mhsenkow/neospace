# NeoSpace status

_Last updated: Oct 2026_

Where the project stands, what's live, what's deferred, and how to pick up the next slice of work.

See also: [PLAN-DEFERRED-AUDIT.md](./PLAN-DEFERRED-AUDIT.md) · [AUDIT-2026-10.md](./AUDIT-2026-10.md) · [README](../README.md)

---

## Goals (unchanged)

NeoSpace aims to be a **production-quality, multi-column Fediverse client** in the ibm.io suite:

- TweetDeck-style boards with per-column feeds and persistent layouts
- Multi-account OAuth across Mastodon-compatible instances
- Deep theming and accessibility as first-class concerns
- Static SPA deploy on Cloudflare Pages (no timeline backend)
- Honest feature set — no UI for APIs the client doesn't call

---

## What's live

| URL | Role |
|-----|------|
| [neospace.ibm.io](https://neospace.ibm.io) | Primary production |
| [neospace-dc4.pages.dev](https://neospace-dc4.pages.dev) | Cloudflare Pages preview / alternate |

Deploy path: `npm run generate` → `.output/public` → Wrangler Pages upload (`npm run cf:deploy`).

**Working today:**
- Full multi-column board (home, local, federated, group, liked, saved, custom algorithms, profile, search, notifications, messages)
- Algorithms section: Local / Federated / Liked / Saved + named client-side recipes (filters) with shareable curator links (`/algorithms/import`)
- OAuth login, multi-account, public preview without auth
- Compose (mentions autocomplete, CW, visibility, media + alt text, drafts)
- DMs, notifications, explore/search, groups, profile + insights
- Settings synced with Mastodon API; appearance controls (themes, UI chrome, fonts)
- PWA install; Loom compose handoff; leave-a-note → GitHub issues
- CSP + security headers; Vitest + CI on push/PR

---

## Oct 2026 audit pass

[AUDIT-2026-10.md](./AUDIT-2026-10.md) catalogued **744 items** across UX, design, a11y, code, perf, security, and tooling — with live verification on neospace.ibm.io at desktop and 375px mobile.

### Outcomes

| Metric | Value |
|--------|-------|
| Total audit items | 744 |
| Addressed | ~733 |
| Remaining (large epics) | 11 (10 code epics + 1 ops) |
| "Do these 30 first" critical bugs | All 30 fixed |
| Systemic fixes (shared composables, focus traps, contrast, CI) | Done |

The audit pass closed trust/safety bugs (CW/sensitive media, sanitizer holes, DM safety, OAuth revoke, duplicate accounts), accessibility gaps (focus traps, contrast, route announcer, shared Neo* components), and tooling (CI, typecheck for Pages Functions, generate gate).

What **didn't** fit a sweep-sized fix is tracked as epics below.

---

## Deferred roadmap

From [PLAN-DEFERRED-AUDIT.md](./PLAN-DEFERRED-AUDIT.md), in **suggested priority order**:

| # | Epic | Size | Why it matters |
|---|------|------|----------------|
| 7 | Settings mobile drill-down nav | M | Phone settings is an unlabelled icon rail — needs list → panel + back chrome |
| 3 | Compose upload progress + cancel | M–L | Upload shows "Uploading…" with no progress or abort UI |
| 2 | Compose `#` / `:emoji:` autocomplete | L | Only `@` mentions autocomplete today |
| 4 | Compose polls + scheduling | L | Mastodon API supports these; UI doesn't |
| 9 | Split SettingsModal into panels | L | ~2.2k lines; do after mobile nav (#7) |
| 6 | Split `instances` store | L | ~870 lines mixing OAuth, persistence, timelines, preview |
| 1 | Self-host Google Fonts | L | FOUT + IP leak; fonts load after JS today |
| 5 | Trusted Types + token isolation + CSP | L | Highest risk — do last among product work |
| 8 | Settings fork-specific paths | M | Mastodon-only deep links break on GoToSocial/Akkoma |
| 10 | Playwright + axe CI | L | No e2e or automated a11y gate yet |
| — | **(Ops) Turnstile keys** | — | Widget + server verify plumbed; keys not set |

### Checklist (from deferred plan)

- [ ] Self-host Google Fonts
- [ ] Compose `#` / `:` autocomplete
- [ ] Compose upload progress + cancel UI
- [ ] Compose polls + scheduling
- [ ] Trusted Types + token isolation + CSP harden
- [ ] Split `instances` store
- [ ] Settings mobile drill-down
- [ ] Settings fork-specific paths
- [ ] Split SettingsModal into panels
- [ ] Playwright + axe CI
- [ ] (Ops) Turnstile keys on Pages / build

---

## Ops checklist

These are **not code** — enable when ready:

### Turnstile (bot protection for leave-a-note)

Code is ready in `functions/api/feedback.ts` and `app/composables/useFeedbackNotes.ts`.

1. Create a Turnstile widget in Cloudflare dashboard
2. Build with site key: `NUXT_PUBLIC_TURNSTILE_SITE_KEY=…`
3. Pages secret: `npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name neospace`

When `TURNSTILE_SECRET_KEY` is set, the API **requires** a valid token. Both keys must be set for end-to-end enforcement.

### GITHUB_TOKEN (leave-a-note → issues)

```bash
npx wrangler pages secret put GITHUB_TOKEN --project-name neospace
```

Use a fine-grained PAT scoped to this repo with **Issues: Read and write**. Classic `repo`-scope PATs work but are broader than needed.

### Docker vs Pages

Docker serves the static SPA only — **no `/api/feedback`**. Use Cloudflare Pages for production with Functions.

---

## How to think about next work

1. **User-visible wins first** — mobile settings nav (#7) and upload progress (#3) improve daily use without architectural risk.
2. **Compose features cluster** — autocomplete (#2) and polls/scheduling (#4) share `RealComposeBox.vue`; tackle together after #3.
3. **Refactors when touching the file anyway** — SettingsModal split (#9) after mobile nav; instances split (#6) when adding account features.
4. **Security hardening last** — Trusted Types (#5) touches CSP, sanitizers, and token storage; plan as one focused project.
5. **Use the audit as a work order** — [AUDIT-2026-10.md](./AUDIT-2026-10.md) items are checkbox-ready with `file:line` citations. Deferred epics link back to specific audit refs in [PLAN-DEFERRED-AUDIT.md](./PLAN-DEFERRED-AUDIT.md).
6. **CI gate today** — `npm run check` (typecheck + vitest) and `npm run generate` must pass. Playwright (#10) would extend this.

---

## Known limitations (honest)

- Fonts load from Google at runtime (deferred #1)
- Compose lacks hashtag/emoji autocomplete, upload progress, polls, scheduling
- Settings deep links assume Mastodon web UI paths
- `npm run typecheck:app` has pre-existing masto typing gaps — CI uses `generate` as the main app gate
- No automated axe/Playwright CI yet
- Turnstile enforcement requires manual key setup
