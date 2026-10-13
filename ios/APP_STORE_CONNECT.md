# App Store Connect — NeoSpace (iOS)

Bundle ID: `io.ibm.neospace`  
Team: `WC44W2QVE4` · Category: **Social Networking**  

Shell: Capacitor (`ios/`) packing the same static UI as [neospace.ibm.io](https://neospace.ibm.io)

## Name
NeoSpace

## Subtitle (≤30 chars)
Fediverse boards & feeds

## Promotional text (≤170)
Multi-column Mastodon client — home, local, groups, DMs, and Edward. Sign in with any Mastodon server.

## Description
NeoSpace is a Fediverse client for iPhone and iPad — the same experience as neospace.ibm.io, packaged for the App Store.

• Multi-column boards for home, local, federated, and hashtag groups  
• Multi-account sign-in via your Mastodon (or compatible) server  
• Compose with polls, media, drafts, and scheduling where your server allows  
• Direct messages, notifications, and profile tools  
• Edward — lean back and watch the fediverse float by  

No NeoSpace account. You approve access on your chosen server (OAuth). Tokens stay on device.

## Keywords
mastodon,fediverse,social,timeline,activitypub,boards,microblog

## Support URL
https://github.com/mhsenkow/neospace

## Marketing URL
https://neospace.ibm.io

## Privacy policy URL
https://neospace.ibm.io/privacy

## Age rating
12+ (user-generated content from the Fediverse; no NeoSpace-hosted UGC).

## App Privacy
Disclose network activity to third-party Mastodon servers the user chooses. No advertising SDK. Prefer accurate nutrition labels once the portal form is filled.

## Review notes
1. Launch → Sign in → enter a Mastodon host (e.g. fosstodon.org) → Approve NeoSpace.  
2. OAuth returns into the app → Home timeline.  
3. Compose a draft (do not require posting).  

Demo: any public Mastodon account the reviewer owns. No NeoSpace credentials.

Privacy: https://neospace.ibm.io/privacy

## Build / encryption
- Marketing version **1.0**, build **1** (bump `CURRENT_PROJECT_VERSION` in Xcode)  
- `ITSAppUsesNonExemptEncryption` = false (HTTPS only)

## One-time portal setup
1. Create App ID `io.ibm.neospace` with Associated Domains.  
2. New ASC app → bundle ID match.  
3. Confirm AASA live: `curl -sI https://neospace.ibm.io/.well-known/apple-app-site-association`  
4. Archive via `./scripts/ios-submit.sh open` or `build`, upload TestFlight.

## Screenshots
Capture on device after OAuth works: Home board, compose, notifications (iPhone 6.7" required).
