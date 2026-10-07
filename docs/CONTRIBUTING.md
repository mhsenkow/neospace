# Contributing to NeoSpace

How to develop, check, and land changes. For product context see [STATUS.md](./STATUS.md); for system design see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Setup

**Requirements:** Node.js 22+ (`.nvmrc`)

```bash
git clone https://github.com/mhsenkow/neospace.git
cd neospace
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in against any Mastodon-compatible instance (or use Explore → Watch for public timelines without auth).

---

## Scripts you will use

| Script | When |
|--------|------|
| `npm run dev` | Day-to-day development |
| `npm run check` | Before a PR — Functions typecheck + Vitest |
| `npm run generate` | Catch SPA build / import errors (CI gate) |
| `npm test` | Vitest only |
| `npm run prepaint` | After editing appearance option lists in `app/utils/appearance.ts` |
| `npm run cf:deploy` | Ship static build to Cloudflare Pages (maintainers) |
| `npm run analyze` | Investigate bundle size |

CI (`.github/workflows/ci.yml`) runs `npm ci` → `npm run check` → `npm run generate` on push/PR to `main`.

`npm run typecheck:app` (full Nuxt/vue-tsc) still has known masto typing gaps — do not treat it as a hard gate yet. Prefer `generate` for app compile health.

---

## Project conventions

### Vue / Nuxt

- App code lives under `app/` (`srcDir`).
- Prefer Vue 3 SFCs with `<script setup lang="ts">`.
- Routes are file-based under `app/pages/`.
- Shared UI chrome belongs in `app/components/shell/` or `Neo*.vue` primitives — avoid duplicating focus traps, menus, or sheets.

### State

- Pinia stores in `app/stores/`. Use `useMasto()` / `clientFor()` — never construct masto clients ad hoc.
- Persist account-scoped layout in the columns store pattern (per-account localStorage keys). Do not sync private column config into public profile fields.

### Styling

- SCSS + CSS custom properties (`--neo-*`). Tokens live in `app/assets/css/_variables.scss` and themes in `_themes.scss`.
- Prefer tokens over hard-coded hex/rgba. Touch themes carefully — contrast was an audit focus.
- Structural layout rules: `_structural.scss` before themes in the cascade.

### Accessibility

- Interactive overlays use `useFocusTrap`.
- Prefer `NeoTabs` / `NeoMenu` / `NeoRadioGroup` / `NeoConfirm` / `NeoSheet` over one-off ARIA.
- Icon-only controls need accessible names (`aria-label`). Decorative icons stay `aria-hidden`.
- Do not remove the route announcer / skip link / main landmark wiring in `app.vue` / `default.vue`.

### Security

- All remote HTML goes through `sanitizeHtml` / related helpers — never `v-html` raw API strings.
- Profile CSS goes through `sanitizeCss`.
- Feedback API changes must keep origin checks, rate limits, and optional Turnstile verify intact (`functions/api/feedback.ts`).

### Commits / PRs

- Prefer focused commits: one concern per PR when possible.
- Message style: short imperative summary of **why** (see recent `git log`).
- Call out UI risk (auth, compose, DMs, sanitizers) in the PR description.
- Screenshots help for shell / settings / compose changes.

---

## Using the audit as a work order

1. **[STATUS.md](./STATUS.md)** — where we are and suggested next slices.
2. **[PLAN-DEFERRED-AUDIT.md](./PLAN-DEFERRED-AUDIT.md)** — the 10 remaining large epics (+ Turnstile ops). Prefer those over random polish.
3. **[AUDIT-2026-10.md](./AUDIT-2026-10.md)** — historical checklist (~733 done). Line numbers drift; search by behavior/selector.

When you finish a deferred epic, tick it in `PLAN-DEFERRED-AUDIT.md` and the matching item in `AUDIT-2026-10.md`, and note it in `STATUS.md` if the live feature set changed.

---

## Deploy notes (maintainers)

```bash
npm run cf:deploy
```

Secrets on the Pages project:

| Secret / env | Purpose |
|--------------|---------|
| `GITHUB_TOKEN` | Leave-a-note → GitHub issues |
| `TURNSTILE_SECRET_KEY` | Enforce Turnstile on feedback (optional until set) |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` | Build-time site key for the widget |

Docker (`Dockerfile`) serves static assets only — no Functions. Production feedback requires Cloudflare Pages.

---

## Questions / feedback

Use the in-app **Leave a note** control on [neospace.ibm.io](https://neospace.ibm.io), or open a GitHub issue on this repo.
