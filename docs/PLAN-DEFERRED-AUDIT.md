# Deferred audit work (large)

Carry-over from [AUDIT-2026-10.md](./AUDIT-2026-10.md). Everything else from that pass is done; these need their own slices.

**Context:** [STATUS.md](./STATUS.md) (where things are) · [README](../README.md) (product overview) · [docs index](./README.md)

**Enable anytime (not code):** Turnstile — set `NUXT_PUBLIC_TURNSTILE_SITE_KEY` at build time and `TURNSTILE_SECRET_KEY` as a Pages secret. Widget + server verify are already plumbed.

---

## Epics

### 1. Self-host Google Fonts
- **Why:** FOUT + IP leak to Google; fonts currently load after JS
- **Scope:** `@nuxt/fonts` or fontsource for the faces in `appearance.ts`; preload active face; drop Google from CSP when unused
- **Size:** L (~2MB+ for all 15 families — consider subsetting to shipped faces only)
- **Refs:** `loadFonts.ts`, audit PERF·M·M

### 2. Compose: rich autocomplete
- **Why:** Only `@` mentions autocomplete today
- **Scope:** Generalize `ComposeAutocomplete` for `#hashtag` and `:emoji:` (custom + unicode)
- **Size:** L
- **Refs:** `RealComposeBox.vue`, audit UX·M·L

### 3. Compose: upload progress + cancel
- **Why:** “Uploading…” with no progress or abort
- **Scope:** XHR (or fetch + ReadableStream) progress events; per-item abort UI wired to existing `AbortController`s
- **Size:** M–L (API client rewrite)
- **Refs:** `useComposeMedia.ts`, audit UX·M·M

### 4. Compose: polls + scheduling
- **Why:** Missing Mastodon posting features
- **Scope:** Poll editor (options, expires, multiple); schedule picker; API fields on create
- **Size:** L
- **Refs:** `RealComposeBox.vue`, audit UX·M·L

### 5. Trusted Types + token isolation
- **Why:** Tokens in one localStorage blob; CSP still needs `unsafe-inline` / broad `connect-src`
- **Scope:**
  1. Refactor `sanitizeHtml.ts` so post-sanitize string surgery isn’t required (or use TrustedHTML APIs)
  2. `require-trusted-types-for 'script'` + DOMPurify `RETURN_TRUSTED_TYPE`
  3. Move tokens to a dedicated storage key readable only by the masto client factory
  4. Tighten CSP hashes / drop `unsafe-inline` where possible
- **Size:** L (security-sensitive; do as one project)
- **Refs:** `instances.ts`, `sanitizeHtml.ts`, `public/_headers`, audit SEC·M·M ×2

### 6. Split `instances` store
- **Why:** ~871 lines mixing OAuth, persistence, timelines, preview UI
- **Scope:** `accounts` store + directory/peek store + thin timeline helpers; keep public API stable during migrate
- **Size:** L
- **Refs:** `stores/instances.ts`, audit CODE·M·L

### 7. Settings: mobile drill-down nav
- **Status:** Done (list → panel + back chrome at ≤768px)
- **Why:** Phone nav is an unlabelled 3rem icon rail
- **Scope:** List → panel drill-down with back chrome; labelled sections
- **Size:** M
- **Refs:** `SettingsModal.vue`, audit UX·M·M

### 8. Settings: fork-specific paths
- **Why:** Mastodon-only deep links break on GoToSocial / Akkoma
- **Scope:** Detect software from instance info; map preferences/filter URLs per fork
- **Size:** M
- **Refs:** `SettingsModal.vue`, audit UX·L·S

### 9. Split SettingsModal
- **Why:** ~2.2k lines; section headers copied 7×
- **Scope:** `SettingsSectionHeader` + one panel component per category; thin host modal
- **Size:** L (best after #7)
- **Refs:** `SettingsModal.vue`, audit CODE·M·L

### 10. Playwright + axe
- **Why:** No e2e / a11y CI gate
- **Scope:** Playwright with mocked Mastodon routes; fail on serious axe violations; wire into `npm run check` / CI
- **Size:** L
- **Refs:** `package.json`, `.github/workflows/ci.yml`, audit TOOLING·M·M

---

## Suggested order

1. **#7** mobile settings nav (user-visible, medium)
2. **#3** upload progress (builds on existing abort)
3. **#2** then **#4** compose features
4. **#9** SettingsModal split (after #7)
5. **#6** instances split
6. **#1** fonts (bundle / privacy)
7. **#5** Trusted Types (last among product work — highest risk)
8. **#8** fork paths (when you care about non-Mastodon)
9. **#10** Playwright (anytime once happy-path UI is stable)

---

## Checklist

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
