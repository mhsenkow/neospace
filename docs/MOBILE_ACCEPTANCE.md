# NeoSpace mobile release acceptance

Complete on a **physical device** with a **Release / TestFlight** build (not `nuxt dev`).

**Build under test:** _______________  
**Device / iOS:** _______________  
**Tester / date:** _______________

## Journey

| Step | Pass | Notes |
|------|------|-------|
| Fresh install opens to login / guest home | ☐ | |
| Sign in with a Mastodon account (OAuth returns into app) | ☐ | |
| Home timeline loads | ☐ | |
| Compose opens; draft persists if closed | ☐ | |
| Background → resume (no white screen; still signed in) | ☐ | |
| Force-quit → reopen; session intact | ☐ | |
| Airplane mode: clear offline / error, no infinite spinner | ☐ | |
| Edward open/close (note WebGL jank; fail only on crash) | ☐ | note-only |

## Evidence

- Version + build from Xcode Organizer or Settings
- Screen recording of OAuth return + home timeline (for ASC if asked)

**Sign-off:** ☐ Ready for TestFlight upload
