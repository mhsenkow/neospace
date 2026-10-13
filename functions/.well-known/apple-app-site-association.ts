/**
 * Serve AASA at /.well-known/… — Cloudflare Pages SPA mode was returning index.html
 * for the static file under .well-known/. Root /apple-app-site-association also works.
 */
const BODY = JSON.stringify({
  applinks: {
    apps: [],
    details: [
      {
        appID: 'WC44W2QVE4.io.ibm.neospace',
        paths: ['/auth/callback', '/auth/callback/*'],
      },
    ],
  },
})

export const onRequestGet: PagesFunction = async () =>
  new Response(BODY, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  })
