# NeoSpace architecture

How NeoSpace is built — accurate to the codebase as of Oct 2026.

---

## Overview

NeoSpace is a **Nuxt 4 client-only SPA** (`ssr: false` in `nuxt.config.ts`). The browser holds OAuth tokens and talks directly to Fediverse instance REST APIs via **masto.js**. There is no NeoSpace backend for timelines, auth, or media — only a single **Cloudflare Pages Function** for leave-a-note feedback.

```
┌─────────────────────────────────────────────────────────┐
│  Browser (NeoSpace SPA)                                 │
│  ┌──────────┐  ┌────────────┐  ┌─────────────────────┐  │
│  │  Pages   │  │ Pinia      │  │ composables/        │  │
│  │  (routes)│◄─┤ stores     │◄─┤ useMasto, usePager  │  │
│  └──────────┘  └────────────┘  └─────────────────────┘  │
│         │              │                    │           │
│         └──────────────┴────────────────────┘           │
│                        │ masto.js REST                    │
└────────────────────────┼────────────────────────────────┘
                         ▼
              ┌──────────────────────┐
              │ Mastodon / GoToSocial│
              │ (user's instance)    │
              └──────────────────────┘

  Optional: POST /api/feedback ──► GitHub Issues (Pages Function)
```

**Deploy artifact:** `npm run generate` → `.output/public` (static HTML/JS/CSS + PWA service worker).

---

## Nuxt configuration

Key settings in `nuxt.config.ts`:

| Setting | Value | Notes |
|---------|-------|-------|
| `ssr` | `false` | Pure SPA — no server render |
| `srcDir` | `app/` | App lives under `app/`, not root |
| `modules` | `@pinia/nuxt`, `@vite-pwa/nuxt` | State + installable PWA |
| `runtimeConfig.public.turnstileSiteKey` | env | Optional Turnstile widget |
| PWA | `registerType: 'autoUpdate'` | Avoids stale SW on home-screen installs |
| Global CSS | `~/assets/css/main.scss` | SCSS with injected `_variables.scss` |
| Boot scripts | `/boot/rescue.js`, `/boot/prepaint.js` | External scripts in `<head>` (no inline) |

---

## Routing & pages

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/pages/index.vue` | Multi-column home board |
| `/explore` | `app/pages/explore.vue` | Search accounts, hashtags, posts |
| `/groups`, `/groups/[tag]` | `app/pages/groups/` | Group discovery and tag timeline |
| `/profile` | `app/pages/profile.vue` | Account profile (self or remote) |
| `/messages` | `app/pages/messages.vue` | DM inbox and threads |
| `/notifications` | `app/pages/notifications.vue` | Notification list |
| `/status/[id]` | `app/pages/status/[id].vue` | Thread view |
| `/login` | `app/pages/login.vue` | Server picker + OAuth start |
| `/auth/callback` | `app/pages/auth/callback.vue` | OAuth PKCE callback |

`app/app.vue` wraps everything with `<NuxtRouteAnnouncer />`, focuses `#main-content` on route change.

`app/layouts/default.vue` orchestrates shell chrome — sidebar, mobile header/tab bar/drawer, live refresh, theme boot.

---

## Pinia stores

### Core

| Store | File | Responsibility |
|-------|------|----------------|
| `instances` | `stores/instances.ts` | Connected servers, OAuth tokens, active account, public preview, timeline fetch helpers |
| `columns` | `stores/columns.ts` | TweetDeck column config (1–8), feed types, desk density, mobile view mode; persisted per-account in localStorage |
| `settings` | `stores/settings.ts` | Mastodon-synced preferences + local appearance prefs (theme, font, density, …) |
| `theme` | `stores/theme.ts` | Resolved theme state, applies CSS classes |

### Feeds & social

| Store | File | Responsibility |
|-------|------|----------------|
| `notifications` | `stores/notifications.ts` | Notification list, unread badge, polling |
| `conversations` | `stores/conversations.ts` | DM inbox, thread messages, live refresh |
| `groups` | `stores/groups.ts` | Hashtag groups — membership, trending, categories |
| `profile` | `stores/profile.ts` | Remote profile data, follower/following pagers |
| `status` | `stores/status.ts` | Post actions — create, mute, block, report, favourite, boost |
| `insights` | `stores/insights.ts` | Profile engagement analytics |

### UI & compose

| Store | File | Responsibility |
|-------|------|----------------|
| `overlay` | `stores/overlay.ts` | Global lightbox / sheet host state |
| `toast` | `stores/toast.ts` | Toast notifications |
| `composeSheet` | `stores/composeSheet.ts` | Mobile compose sheet open/close, remount guard for Loom handoff |
| `composeHandoff` | `stores/composeHandoff.ts` | Loom → NeoSpace chart image + caption pipeline |

**Note:** `instances.ts` is large (~870 lines) and mixes OAuth, persistence, and timeline logic — splitting it is a deferred epic ([PLAN-DEFERRED-AUDIT.md](./PLAN-DEFERRED-AUDIT.md) #6).

---

## Shell components

Under `app/components/shell/`:

| Component | Role |
|-----------|------|
| `DesktopSidebar.vue` | Left rail — account switcher, nav, inbox shortcut |
| `MobileHeader.vue` | Top bar on mobile subviews |
| `MobileTabBar.vue` | Bottom tabs — home, explore, compose, notifications, profile |
| `MobileDrawer.vue` | Slide-out menu |

Shared a11y primitives under `app/components/Neo*.vue`:

- `NeoTabs` — APG tabs pattern
- `NeoMenu` — menu button + popup
- `NeoRadioGroup` — segmented controls
- `NeoConfirm` — confirm sheet
- `NeoSheet` / `NeoSheetHeader` — bottom sheets
- `NeoOverlayHost` / `NeoLightbox` — global overlays
- `NeoToastHost` — toasts

---

## API client layer

**`app/composables/useMasto.ts`** — single factory for `createRestAPIClient`:

- `clientFor(instanceId)` — authenticated client for a connected instance
- `activeClient()` — client for the active account
- `publicClient(url?)` — unauthenticated client for previews
- Clients are **memoized** in a `Map` keyed by URL + token; `clearClientCache()` on logout/token change

All stores and composables import from here rather than constructing masto clients ad hoc.

---

## Key data flows

### OAuth login

```
login.vue → instancesStore.connect(url)
  → oauthPkce.ts: beginOAuthChallenge (PKCE verifier in sessionStorage)
  → redirect to instance /oauth/authorize
  → auth/callback.vue: consumeOAuthChallenge, exchange code
  → instancesStore: persist tokens + user in localStorage (STORAGE_KEY)
  → redirect to returnTo or /
```

Files: `app/utils/oauthPkce.ts`, `app/stores/instances.ts`, `app/pages/login.vue`, `app/pages/auth/callback.vue`.

Multi-account: each server slot gets a unique `id`. Adding a second account on the same host creates a new slot and revokes the previous token. Client secrets are cached per-host in `neospace_oauth_apps` for revoke-on-logout.

### Timeline columns

```
index.vue mounts → columnsStore.loadForAccount(activeAccountId)
  → TimelineColumn.vue per column
  → instancesStore.fetchTimeline(feedType) or groupsStore for group columns
  → polling interval (pauses when column recessed on mobile)
  → scroll position persisted in columns store
```

Files: `app/pages/index.vue`, `app/components/TimelineColumn.vue`, `app/stores/columns.ts`.

### Compose

```
User opens compose (inline column, ComposeSheet, or + FAB)
  → RealComposeBox.vue
  → @mention autocomplete via useAccountSearch
  → useComposeMedia.ts for attachments + alt text
  → statusStore.postStatus (Idempotency-Key header)
  → masto v1 statuses.create
```

Loom handoff path: `useLoomHandoff` / `composeHandoff` store receives postMessage or URL params → downloads chart image → opens compose with pre-filled caption.

Files: `app/components/RealComposeBox.vue`, `app/components/ComposeSheet.vue`, `app/stores/status.ts`, `app/composables/useComposeMedia.ts`, `app/stores/composeHandoff.ts`.

### Direct messages

```
/messages → conversationsStore.initialize()
  → fetch conversations list (paginated)
  → select thread → fetch messages
  → ChatComposer.vue for replies (direct visibility locked)
  → live refresh polling while app visible
```

Files: `app/stores/conversations.ts`, `app/pages/messages.vue`, `app/components/ChatComposer.vue`.

### Settings sync

```
SettingsModal.vue → settingsStore
  → local prefs: localStorage (appearance — theme, font, density, …)
  → server prefs: masto API (posting defaults, notification filters, profile fields)
  → applyAppearance() writes CSS variables to document
```

Files: `app/stores/settings.ts`, `app/utils/appearance.ts`, `app/components/SettingsModal.vue`.

---

## Boot scripts & prepaint

Theme flash prevention runs **before** Vue hydrates:

1. **`scripts/build-prepaint.mjs`** reads `app/utils/appearance.ts` option arrays and generates **`public/boot/prepaint.js`** with theme/UI/font cycles.
2. **`nuxt.config.ts`** loads `/boot/prepaint.js` and `/boot/rescue.js` as external `<script>` tags (CSP-friendly — no inline boot code).
3. **`prepaint.js`** reads `neospace_local_prefs` from localStorage and sets `data-neo-theme`, `data-neo-ui`, font classes on `<html>` immediately.

**`public/boot/rescue.js`** + **`app/plugins/pwa-rescue.client.ts`** — recover from stale PWA chunk loads after deploy (reload once on chunk error).

Run `npm run prepaint` manually after editing appearance catalogs; `npm run generate` runs it automatically.

---

## Security

### Content sanitization

| File | Role |
|------|------|
| `app/utils/sanitizeHtml.ts` | DOMPurify wrapper for post HTML; allowlisted classes |
| `app/utils/sanitizeCss.ts` | Profile custom CSS sanitizer |
| `app/utils/profileSources.ts` | Profile field parsing; blocks `javascript:` hrefs |

### CSP & headers

**`public/_headers`** (Cloudflare Pages):

- `Content-Security-Policy` — `default-src 'self'`; `connect-src 'self' https: wss:` for Fediverse APIs; Turnstile frames/scripts; Google Fonts (fonts deferred to self-host epic)
- `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`
- Cache rules: revalidate HTML/SW; immutable `/_nuxt/*`

### Feedback API

**`functions/api/feedback.ts`** — POST handler:

- Origin/host allowlist (neospace.ibm.io, pages.dev, localhost)
- Rate limit (5/hour/IP)
- Optional Turnstile verify via `TURNSTILE_SECRET_KEY`
- Creates GitHub issue via `GITHUB_TOKEN`

Shared limits in `shared/feedbackConstants.ts`.

---

## PWA

Configured in `nuxt.config.ts` via `@vite-pwa/nuxt`:

- Manifest: standalone display, theme/background `#1a1a18`
- Workbox: app-shell caching; `navigateFallback: '/'`; excludes `/auth` and `/api/`
- `registerType: 'autoUpdate'` — new SW activates without prompt
- Icons in `public/icons/`

---

## Multi-account model

```
localStorage:
  neospace_instances     → ConnectedInstance[] (tokens, user, instanceInfo)
  neospace_oauth_apps    → per-host OAuth client credentials (for revoke)
  neospace_columns_{id}  → column layout per account id
  neospace_local_prefs   → appearance preferences (device-local)
```

- **`primaryAccountId`** — first login in a session; others are secondary
- **`activeAccountId`** — who you're acting as now
- **`activeInstanceFilter`** — optional filter to one server across columns
- Column configs are **device-local** (not synced to Mastodon profile — audit fix disabled profile-field sync)

---

## SPA routing on Cloudflare Pages

Static export produces `index.html`. **`scripts/spa-fallback.mjs`** copies it to `404.html` so CF Pages serves the app shell for unknown paths. No Netlify-style `_redirects` rewrite — CF uses the 404 fallback pattern.

---

## Testing

**`tests/smoke.test.ts`** — Vitest unit tests for pure utilities:

- Loom handoff URL parsing
- Instance normalization
- Insights CSV/export
- `compareId` snowflake comparison
- CSS sanitizer
- Log ring for feedback

CI (`.github/workflows/ci.yml`): `npm run check` + `npm run generate`.

---

## Important file index

| Area | Files |
|------|-------|
| Config | `nuxt.config.ts`, `wrangler.toml`, `package.json` |
| Entry | `app/app.vue`, `app/layouts/default.vue` |
| Home board | `app/pages/index.vue`, `app/components/TimelineColumn.vue`, `app/stores/columns.ts` |
| Auth | `app/utils/oauthPkce.ts`, `app/stores/instances.ts` |
| API | `app/composables/useMasto.ts` |
| Compose | `app/components/RealComposeBox.vue`, `app/stores/status.ts`, `app/composables/useComposeMedia.ts` |
| Appearance | `app/utils/appearance.ts`, `app/assets/css/_themes.scss`, `app/assets/css/_variables.scss` |
| A11y | `app/composables/useFocusTrap.ts`, `app/components/Neo*.vue` |
| Feedback | `functions/api/feedback.ts`, `app/composables/useFeedbackNotes.ts` |
| Headers | `public/_headers` |
| Build | `scripts/build-prepaint.mjs`, `scripts/spa-fallback.mjs` |
