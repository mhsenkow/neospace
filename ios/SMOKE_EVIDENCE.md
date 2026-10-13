# iOS smoke evidence (automated)

**Date:** 2026-10-13  
**Shell:** Capacitor · bundle `io.ibm.neospace`  
**Build:** Debug · iPhone 16 Simulator (iOS 18.6) · `xcodebuild` **BUILD SUCCEEDED**

| Step | Result |
|------|--------|
| `npm run ios:sync` | OK — Nuxt generate + `cap sync ios` |
| Simulator build | OK |
| `simctl install` + `launch` | OK — process started (`io.ibm.neospace`) |
| OAuth return on device | **Pending physical device** — needs Apple App ID + Associated Domains + TestFlight/dev device; use [MOBILE_ACCEPTANCE.md](../docs/MOBILE_ACCEPTANCE.md) |
| Edward | Note-only on first device pass |

### Archive attempt (2026-10-13)

`xcodebuild archive` **failed** until the App ID exists with **Associated Domains**:

> Provisioning profile "iOS Team Provisioning Profile: \*" doesn't include the Associated Domains capability.

### Next human steps (portal — ~15 min)

1. [developer.apple.com](https://developer.apple.com) → Identifiers → **+** → App IDs → `io.ibm.neospace`  
   Enable **Associated Domains** (and save).
2. Xcode → Signing: Team `WC44W2QVE4`, automatic signing (profile refreshes).
3. `npm run ios:xcode` → Archive → Distribute → **TestFlight**.
4. ASC: new app + metadata from [APP_STORE_CONNECT.md](./APP_STORE_CONNECT.md).
5. On a phone: complete [MOBILE_ACCEPTANCE.md](../docs/MOBILE_ACCEPTANCE.md) (OAuth return).

**Already live on web:** privacy + AASA  
- https://neospace.ibm.io/privacy  
- https://neospace.ibm.io/apple-app-site-association  
- https://neospace.ibm.io/.well-known/apple-app-site-association  

