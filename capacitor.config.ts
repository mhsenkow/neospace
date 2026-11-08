import type { CapacitorConfig } from '@capacitor/cli'

/**
 * iOS shell for TestFlight / App Store — packs the Nuxt static export.
 * Mirror of Loom’s Capacitor layout; do not point server.url at the live site
 * (that reads as a thin website wrapper in review).
 */
const config: CapacitorConfig = {
  appId: 'io.ibm.neospace',
  appName: 'LoomSpace',
  webDir: '.output/public',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: 'LoomSpace',
  },
}

export default config
