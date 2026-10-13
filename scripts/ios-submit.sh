#!/usr/bin/env bash
# NeoSpace — iOS TestFlight / App Store helper (Capacitor)
#
# Prerequisites (one-time, in Xcode):
#   1. Accounts → Apple ID (team WC44W2QVE4)
#   2. App ID io.ibm.neospace + Associated Domains
#   3. Target Signing → Team + Automatically manage signing
#   4. Associated Domains: applinks:neospace.ibm.io
#   5. URL Types scheme: neospace
#
# Usage:
#   ./scripts/ios-submit.sh sync   # generate + cap sync
#   ./scripts/ios-submit.sh open   # open Xcode
#   ./scripts/ios-submit.sh build  # archive + export IPA
#   ./scripts/ios-submit.sh upload # altool upload (needs API key)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CMD="${1:-sync}"
WORKSPACE="ios/App/App.xcworkspace"
SCHEME="App"
ARCHIVE_PATH="ios/build/NeoSpace.xcarchive"
EXPORT_PATH="ios/build"
EXPORT_PLIST="ios/ExportOptions.plist"

case "$CMD" in
  sync)
    npm run ios:sync
    ;;
  open)
    npm run ios:xcode
    echo "In Xcode: Any iOS Device → Product → Archive → Distribute → App Store Connect / TestFlight"
    ;;
  build)
    npm run ios:sync
    test -d ios/App || { echo "Missing ios/ — run: npx cap add ios" >&2; exit 1; }
    if [[ ! -f "$EXPORT_PLIST" ]]; then
      mkdir -p ios
      cat > "$EXPORT_PLIST" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>WC44W2QVE4</string>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST
    fi
    mkdir -p ios/build
    xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" \
      -configuration Release -destination 'generic/platform=iOS' \
      -archivePath "$ARCHIVE_PATH" archive
    xcodebuild -exportArchive -archivePath "$ARCHIVE_PATH" \
      -exportPath "$EXPORT_PATH" -exportOptionsPlist "$EXPORT_PLIST"
    echo "IPA:"
    find ios/build -name '*.ipa' 2>/dev/null || true
    ;;
  upload)
    IPA="$(find ios/build -name '*.ipa' 2>/dev/null | head -1 || true)"
    if [[ -z "${IPA}" ]]; then
      echo "No IPA. Run: ./scripts/ios-submit.sh build" >&2
      exit 1
    fi
    if [[ -z "${APPLE_API_KEY_ID:-}" || -z "${APPLE_API_ISSUER:-}" ]]; then
      echo "Set APPLE_API_KEY_ID and APPLE_API_ISSUER, or drag ${IPA} into Transporter." >&2
      open -R "$IPA" 2>/dev/null || true
      exit 1
    fi
    xcrun altool --upload-app --type ios --file "$IPA" \
      --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
    ;;
  *)
    echo "Usage: $0 [sync|open|build|upload]" >&2
    exit 1
    ;;
esac
