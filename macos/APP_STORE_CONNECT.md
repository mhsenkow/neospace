# App Store Connect — LoomSpace (Mac)

The Mac TestFlight build is the **iOS IPA** (`isIosBuildMacAppStoreCompatible`).  
ASC also has a separate `MAC_OS` 1.0 version shell for desktop screenshots / preview.

| Item | Value |
|------|--------|
| Bundle ID | `io.ibm.neospace` |
| iOS version (submittable) | `8ef48a06-ade5-43c1-a964-d1159f84338d` |
| Mac version (media only until native Mac binary) | `6a28f14f-1d4e-4aba-b951-c34590144f99` |
| Mac localization | `48c1df54-7b57-4264-9a47-7f38d946cab5` |

## Store media

```
macos/store/screenshots/mac16x10/   # 2560×1600 PNG screenshots
macos/store/preview-mac.mp4        # 1920×1080 App Preview (~15s)
```

Uploaded to the Mac localization as `APP_DESKTOP` + `DESKTOP` preview.

## Submit blocker (manual once)

App Privacy nutrition labels are **not** in the public ASC API. Publish them in the portal, then re-run submission:

1. Open https://appstoreconnect.apple.com/apps/6832129931/appPrivacy  
2. Get Started → declare collection (identifiers / user content / diagnostics as linked, not for tracking — OAuth tokens stay on device; timelines come from the user’s chosen Mastodon server).  
3. Publish.  
4. Then: attach iOS build (already attached) → Submit for Review.

## Already done via API

- LoomSpace listing name + subtitle  
- Age rating (12+ social / UGC)  
- Social Networking category  
- Free USA price schedule  
- Worldwide availability  
- Review contact + notes (iOS + Mac)  
- iOS screenshots + previews COMPLETE  
- Mac screenshots + preview uploaded  
- iOS build 2 attached to iOS 1.0  

## Note on Mac review

A dedicated `MAC_OS` version cannot take the iOS IPA (platform mismatch). Mac TestFlight is the iOS-on-Mac binary; submit the **iOS** version for App Review (that’s what powers Mac TestFlight).
