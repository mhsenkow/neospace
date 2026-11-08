#!/usr/bin/env node
/**
 * Build App Store preview videos (Apple-spec H.264 + AAC) from screenshot sets.
 * Specs: https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications/
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const JOBS = [
  {
    name: 'iphone67',
    dir: 'ios/store/screenshots/iphone67',
    out: 'ios/store/preview-iphone67.mp4',
    w: 886,
    h: 1920,
    files: [
      '01-home.png',
      '02-explore.png',
      '03-groups.png',
      '04-login.png',
      '05-privacy.png',
      '06-algorithms.png',
    ],
  },
  {
    name: 'ipad13',
    dir: 'ios/store/screenshots/ipad13',
    out: 'ios/store/preview-ipad13.mp4',
    w: 1200,
    h: 1600,
    files: [
      '01-home.png',
      '02-explore.png',
      '03-groups.png',
      '04-login.png',
      '05-privacy.png',
      '06-algorithms.png',
    ],
  },
]

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status})`)
}

function buildJob(job) {
  const absDir = path.join(ROOT, job.dir)
  const out = path.join(ROOT, job.out)
  const inputs = job.files.map((f) => path.join(absDir, f)).filter((p) => fs.existsSync(p))
  if (inputs.length < 3) throw new Error(`${job.name}: need ≥3 screenshots in ${job.dir}`)

  const hold = Math.max(2.6, 15.2 / inputs.length)
  const args = ['-y']
  for (const p of inputs) {
    args.push('-loop', '1', '-t', hold.toFixed(2), '-i', p)
  }
  args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')

  const n = inputs.length
  const parts = []
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]scale=${job.w}:${job.h}:force_original_aspect_ratio=decrease,pad=${job.w}:${job.h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p[v${i}]`,
    )
  }
  parts.push(`${inputs.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[vout]`)

  args.push(
    '-filter_complex',
    parts.join(';'),
    '-map',
    '[vout]',
    '-map',
    `${n}:a`,
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level',
    '4.0',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-b:v',
    '10M',
    '-maxrate',
    '12M',
    '-bufsize',
    '20M',
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-ac',
    '2',
    '-shortest',
    '-movflags',
    '+faststart',
    out,
  )

  console.log(`→ ${job.name} (${inputs.length} frames) → ${path.relative(ROOT, out)}`)
  run('ffmpeg', args)
  console.log(`  ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB`)
}

function main() {
  for (const job of JOBS) buildJob(job)
  console.log('\nPreviews ready. Upload with:')
  console.log('  node scripts/upload-store-media.mjs --ios-only --replace-ios')
}

main()
