# 🌌 NeoSpace

**Fediverse frontend for Mastodon, GoToSocial, and ActivityPub-compatible servers**

Multi-column TweetDeck-style layout, multi-instance watching, OAuth login, and CSS theming (including Chaos Mode via profile metadata).

## Quick Start

```bash
# Node 22+
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

### Cloudflare Pages (primary)

Live: [https://neospace.ibm.io](https://neospace.ibm.io)  
Also: [https://neospace-dc4.pages.dev](https://neospace-dc4.pages.dev)

```bash
# One-time: npx wrangler login
npm run cf:deploy
```

**Dashboard / Git settings** (if connecting the repo for push-to-deploy):
- Build command: `npm run generate`
- Output directory: `.output/public`
- Node version: `22` (see `.nvmrc`)

This project is currently **direct-upload** via Wrangler. A Git-connected Pages project would need to be created fresh (direct-upload projects cannot be converted) if you want PR preview URLs.

SPA deep links use `public/_redirects`. Security/cache headers use `public/_headers`.

### Leave-a-note (GitHub issues)

The floating note button posts to `POST /api/feedback` (Pages Function), which opens an issue on [mhsenkow/neospace](https://github.com/mhsenkow/neospace).

One-time secret — prefer a **fine-grained PAT** (this repo only, Issues: Read and write). Avoid classic `repo`-scope PATs:

```bash
npx wrangler pages secret put GITHUB_TOKEN --project-name neospace
```

Optional label (created automatically on first note if missing is fine — the API retries without labels):

```bash
gh label create feedback --repo mhsenkow/neospace --color 0E8A16 --description "Leave-a-note from neospace.ibm.io" || true
```

Optional **Cloudflare Turnstile** (recommended in production — Origin checks alone are spoofable by non-browsers):

1. Create a Turnstile widget at [dash.cloudflare.com](https://dash.cloudflare.com/) → Turnstile.
2. Set the **site key** at build time: `NUXT_PUBLIC_TURNSTILE_SITE_KEY=…` (shows the widget in Leave-a-note).
3. Set the **secret key** on Pages: `npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name neospace`

When `TURNSTILE_SECRET_KEY` is set, the API rejects requests without a valid token. Both keys are required for bot protection to work end-to-end.

### Docker

Static Docker image (no `/api/feedback` — use Cloudflare Pages for the live API):

```bash
docker build -t neospace .
docker run -p 8080:8080 neospace
```

## Custom CSS (Chaos Mode)

Add a profile field on your instance:
- **Name**: `css` (or `custom_css`, `theme`, `style`)
- **Value**: Your custom CSS

```css
:root {
  --neo-bg-primary: #0a0a0a;
  --neo-text-primary: #00ff41;
  --neo-accent: #ff00ff;
  --neo-font-family: 'Courier New', monospace;
}
```

## Tech Stack

- **Framework**: Nuxt 4 (SPA, `ssr: false`)
- **Styling**: SCSS + CSS variables
- **State**: Pinia (single multi-account `instances` store)
- **API**: masto.js via `~/composables/useMasto`
- **Auth**: OAuth 2.0 (browser; tokens in localStorage)

## Project Structure

```
app/
├── assets/css/       # Global styles & variables
├── components/       # Vue components
├── composables/      # useMasto, curated instances, accounts manager
├── layouts/          # App layouts
├── pages/            # Routes
├── stores/           # Pinia stores
└── utils/            # Shared helpers (appearance, feedback, instances)
functions/
└── api/feedback.ts   # Pages Function → GitHub issues
```

## License

MIT
