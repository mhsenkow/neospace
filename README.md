# 🌌 NeoSpace

**Dual-Mode Social Media Frontend for the Fediverse**

A beautiful, customizable frontend for Mastodon, GoToSocial, and other ActivityPub-compatible servers. Features two visual modes:

- **👩 Mom Mode**: Clean, accessible, professional design
- **🌀 Chaos Mode**: Inject your own CSS and relive the Myspace glory days

![NeoSpace Screenshot](https://via.placeholder.com/800x400?text=NeoSpace+Screenshot)

## ✨ Features

- 🔐 OAuth authentication with any Mastodon-compatible instance
- 📱 Responsive 3-column layout
- 🎨 Full CSS variable theming system
- ✏️ Edit your profile directly from NeoSpace
- 📝 Post, boost, and favorite content
- 🌐 View local and federated timelines without login
- 💜 Custom CSS injection via profile metadata

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## 🌐 Deploy

### Vercel (Recommended)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/neospace)

1. Push to GitHub
2. Connect to Vercel
3. Deploy automatically

### Netlify
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start)

1. Push to GitHub
2. Connect to Netlify
3. Deploy automatically

### Cloudflare Pages
1. Push to GitHub
2. Connect repository in Cloudflare Dashboard
3. Set build command: `npm run build`
4. Set output directory: `.output/public`

### Docker
```bash
docker build -t neospace .
docker run -p 3000:3000 neospace
```

## 🎨 Custom CSS (Chaos Mode)

Add a profile field on your Mastodon instance:
- **Name**: `css` (or `custom_css`, `theme`, `style`)
- **Value**: Your custom CSS

Example:
```css
:root {
  --neo-bg-primary: #0a0a0a;
  --neo-text-primary: #00ff41;
  --neo-accent: #ff00ff;
  --neo-font-family: 'Courier New', monospace;
}
```

## 🛠️ Tech Stack

- **Framework**: Nuxt 3
- **Styling**: SCSS (no Tailwind - full CSS control)
- **State**: Pinia
- **API**: masto.js (Mastodon API client)
- **Auth**: OAuth 2.0

## 📁 Project Structure

```
app/
├── assets/css/       # Global styles & variables
├── components/       # Vue components
├── composables/      # Composables (useMasto, useMockData)
├── layouts/          # App layouts
├── pages/            # Route pages
└── stores/           # Pinia stores (auth, theme, timeline, profile)
```

## 🤝 Contributing

PRs welcome! Please follow the existing code style.

## 📄 License

MIT License - do whatever you want with it!

---

Built with 💜 and questionable CSS decisions
