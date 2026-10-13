# NeoSpace iOS (Capacitor)

Production path for TestFlight / App Store: **Capacitor** packing the Nuxt static export (same shape as Loom’s in-review build).

| Item | Value |
|------|--------|
| Bundle ID | `io.ibm.neospace` |
| Team | `WC44W2QVE4` |
| webDir | `.output/public` |
| OAuth redirect | `https://neospace.ibm.io/auth/callback` (Universal Links) |
| Scheme fallback | `neospace://auth/callback` |
| Privacy URL | https://neospace.ibm.io/privacy |

## Commands

```bash
npm run ios:sync    # generate + cap sync ios
npm run ios:open    # open Xcode (after sync once)
npm run ios:xcode   # sync then open
./scripts/ios-submit.sh open   # open Xcode for Archive
./scripts/ios-submit.sh build  # xcodebuild archive → IPA (needs signing)
```

## One-time Apple setup

1. developer.apple.com → Identifiers → App ID `io.ibm.neospace` with **Associated Domains**.
2. Enable Associated Domains on the Xcode target: `applinks:neospace.ibm.io`.
3. URL Types → URL Schemes: `neospace` (for scheme fallback).
4. App Store Connect → new app → bundle ID matches.
5. Deploy web so `/.well-known/apple-app-site-association` is live (see `public/.well-known/`).

## OAuth flow

1. App calls `startAuth` with redirect `https://neospace.ibm.io/auth/callback`.
2. `@capacitor/browser` opens the instance authorize page.
3. After approval, UL (or `neospace://`) opens the app; `native-oauth.client.ts` routes to `/auth/callback`.
4. Existing PKCE `completeAuth` finishes sign-in.

## Acceptance

See [MOBILE_ACCEPTANCE.md](./MOBILE_ACCEPTANCE.md). ASC copy: [ios/APP_STORE_CONNECT.md](../ios/APP_STORE_CONNECT.md) (created after first `cap add ios`).
