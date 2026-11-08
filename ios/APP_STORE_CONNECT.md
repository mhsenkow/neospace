# App Store Connect — LoomSpace (iOS)

Bundle ID: `io.ibm.neospace` (ASC display name: **loomspace**)  
Team: `WC44W2QVE4` · Category: **Social Networking**  

Shell: Capacitor (`ios/`) packing the same static UI as [neospace.ibm.io](https://neospace.ibm.io)

## Name
LoomSpace

## Subtitle (≤30 chars)
Fediverse boards & RSS packs

## Promotional text (≤170)
Multi-column Mastodon client with switchable Feed Packs, RSS columns, custom algorithms, groups, and DMs. Sign in with any Mastodon server.

## Description
LoomSpace is a Fediverse desk for iPhone and iPad — the same experience as neospace.ibm.io, packaged for the App Store.

• Multi-column boards for home, local, federated, lists, and hashtag groups  
• Feed Packs — up to eight named boards you can switch and share  
• Native RSS / Atom columns beside Mastodon timelines  
• Custom algorithms you can build and share  
• Multi-account sign-in via your Mastodon (or compatible) server  
• Compose with media, drafts, and scheduling where your server allows  
• Direct messages, notifications, and profile tools  

No LoomSpace account. You approve access on your chosen server (OAuth). Tokens stay on device.

## Keywords
mastodon,fediverse,rss,social,timeline,activitypub,boards,packs,microblog

## Support URL
https://github.com/mhsenkow/neospace

## Marketing URL
https://neospace.ibm.io

## Privacy policy URL
https://neospace.ibm.io/privacy

## Age rating
12+ (user-generated content from the Fediverse; no LoomSpace-hosted UGC).

## App Privacy
Disclose network activity to third-party Mastodon servers the user chooses. No advertising SDK.

## Review notes
1. Launch → Sign in → enter a Mastodon host (e.g. fosstodon.org) → Approve LoomSpace.  
2. OAuth returns into the app → Home board.  
3. Open Menu → Packs (or Add feed → RSS) without requiring a post.  

Demo: any public Mastodon account the reviewer owns. No LoomSpace credentials.

Privacy: https://neospace.ibm.io/privacy

## Build / encryption
- Marketing version **1.0**, build **2** (bump `CURRENT_PROJECT_VERSION` in Xcode)  
- `ITSAppUsesNonExemptEncryption` = false (HTTPS only)

## Store media
```bash
node scripts/capture-ios-store-screenshots.mjs
node scripts/build-app-previews.mjs
node scripts/upload-store-media.mjs --ios-only --replace-ios
```

## One-time portal setup
1. App ID `io.ibm.neospace` with Associated Domains (`applinks:neospace.ibm.io`).  
2. URL Types: `loomspace` (+ legacy `neospace`).  
3. Archive: `./scripts/ios-submit.sh build` then `./scripts/ios-submit.sh upload`.
