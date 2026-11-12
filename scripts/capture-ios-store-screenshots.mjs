#!/usr/bin/env node
/**
 * Capture App Store screenshots for LoomSpace at Apple device sizes
 * (iPhone 6.7", iPad 13", Mac 16:10).
 *
 * Usage:
 *   node scripts/capture-ios-store-screenshots.mjs
 *   LOOMSPACE_SHOT_BASE=http://127.0.0.1:3000 node scripts/capture-ios-store-screenshots.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.LOOMSPACE_SHOT_BASE || 'https://neospace.ibm.io').replace(/\/$/, '')

const DEVICES = {
  iphone67: {
    dir: path.join(ROOT, 'ios/store/screenshots/iphone67'),
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  ipad13: {
    dir: path.join(ROOT, 'ios/store/screenshots/ipad13'),
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  mac16x10: {
    dir: path.join(ROOT, 'macos/store/screenshots/mac16x10'),
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  },
}

/** Public routes that look good without a signed-in account. */
const SHOTS = [
  { file: '01-home.png', path: '/', waitMs: 2500 },
  { file: '02-explore.png', path: '/explore', waitMs: 2200 },
  { file: '03-groups.png', path: '/groups', waitMs: 2200 },
  { file: '04-login.png', path: '/login', waitMs: 1500 },
  { file: '05-privacy.png', path: '/privacy', waitMs: 1200 },
  { file: '06-algorithms.png', path: '/algorithms/import', waitMs: 1500 },
]

async function dismissChrome(page) {
  await page.keyboard.press('Escape').catch(() => {})
  for (const name of ['Close', 'Got it', 'Dismiss', 'Not now', 'Skip']) {
    const btn = page.getByRole('button', { name, exact: true })
    if (await btn.first().isVisible().catch(() => false)) {
      await btn.first().click({ timeout: 1500 }).catch(() => {})
    }
  }
}

async function captureOne(browser, cfg, shot) {
  const context = await browser.newContext({
    viewport: cfg.viewport,
    deviceScaleFactor: cfg.deviceScaleFactor,
    isMobile: cfg.isMobile,
    hasTouch: cfg.hasTouch,
    userAgent: cfg.userAgent,
    colorScheme: 'dark',
  })
  await context.addInitScript(() => {
    try {
      localStorage.setItem('neospace_whats_new_seen', '9999')
      localStorage.setItem('neospace_coach_seen', '1')
      sessionStorage.setItem('neospace_install_banner_dismissed', '1')
    } catch {
      /* ignore */
    }
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  try {
    const url = `${BASE}${shot.path}${shot.path.includes('?') ? '&' : '?'}shot=${Date.now()}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.waitForTimeout(700)
    await dismissChrome(page)
    await page.waitForTimeout(shot.waitMs)
    await dismissChrome(page)
    const out = path.join(cfg.dir, shot.file)
    await page.screenshot({ path: out, fullPage: false, type: 'png' })
    console.log(`  wrote ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`)
  } finally {
    await context.close()
  }
}

async function captureDevice(name, cfg) {
  console.log(`\n→ ${name} ${cfg.viewport.width}×${cfg.viewport.height}@${cfg.deviceScaleFactor} @ ${BASE}`)
  fs.mkdirSync(cfg.dir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const shot of SHOTS) {
      await captureOne(browser, cfg, shot)
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  for (const [name, cfg] of Object.entries(DEVICES)) {
    await captureDevice(name, cfg)
  }
  console.log('\nDone. Review PNGs under ios/store/screenshots/ and macos/store/screenshots/')
  console.log('  node scripts/build-app-previews.mjs')
  console.log('  node scripts/upload-store-media.mjs --replace-ios --replace-mac')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
