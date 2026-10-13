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

Next human steps: create App ID in developer.apple.com, run `npm run ios:xcode`, Archive → TestFlight, complete acceptance checklist on a phone.
