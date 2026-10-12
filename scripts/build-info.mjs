/**
 * Deployment provenance: ties a built static site to the commit and CI run that produced and
 * checked it.
 *
 *   node scripts/build-info.mjs write    after `npm run generate` — writes .output/public/build-info.json
 *   node scripts/build-info.mjs verify   before upload — fails unless the tree still matches its
 *                                        recorded digest and (in CI) the commit being deployed
 *
 * The digest covers every emitted file except build-info.json itself, so an artifact edited or
 * swapped between "checked" and "deployed" no longer verifies. The CI deploy job only ever uploads
 * the artifact the check job built — it never rebuilds.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BUILD_INFO_FILE = 'build-info.json'

/** Every file under `dir` (posix-style relative paths), sorted, excluding build-info.json */
export function listFiles(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base))
    else {
      const rel = relative(base, full).split(sep).join('/')
      if (rel !== BUILD_INFO_FILE) out.push(rel)
    }
  }
  return out.sort()
}

/** sha256 over `path:filehash` lines — order-independent of the filesystem */
export function treeDigest(dir) {
  const hash = createHash('sha256')
  for (const rel of listFiles(dir)) {
    const fileHash = createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')
    hash.update(`${rel}:${fileHash}\n`)
  }
  return hash.digest('hex')
}

export function buildInfo(dir, env = process.env, now = new Date()) {
  const files = listFiles(dir)
  return {
    commit: env.GITHUB_SHA || env.CI_COMMIT_SHA || null,
    ref: env.GITHUB_REF || null,
    runId: env.GITHUB_RUN_ID || null,
    runAttempt: env.GITHUB_RUN_ATTEMPT || null,
    workflow: env.GITHUB_WORKFLOW || null,
    builtAt: now.toISOString(),
    // The checks that must have passed before this artifact exists (CI `check` job, in order)
    checks: ['lint:rules', 'typecheck', 'typecheck:e2e', 'typecheck:app', 'test', 'generate'],
    fileCount: files.length,
    digest: treeDigest(dir),
  }
}

/** Why an artifact can't be deployed, or null when it is the checked one */
export function verifyBuildInfo(dir, env = process.env) {
  const file = join(dir, BUILD_INFO_FILE)
  if (!existsSync(file)) return `missing ${BUILD_INFO_FILE} — this artifact never went through CI`
  let info
  try {
    info = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return `${BUILD_INFO_FILE} is not valid JSON`
  }
  if (!info.commit) return `${BUILD_INFO_FILE} has no commit — it was not built by CI`
  const expected = env.GITHUB_SHA || env.CI_COMMIT_SHA
  if (expected && info.commit !== expected) {
    return `artifact was built from ${info.commit}, but ${expected} is being deployed`
  }
  const actual = treeDigest(dir)
  if (actual !== info.digest) return 'artifact contents changed after it was checked (digest mismatch)'
  return null
}

function main() {
  const [mode, dirArg] = process.argv.slice(2)
  const dir = resolve(dirArg || '.output/public')
  if (!existsSync(dir)) {
    console.error(`build-info: ${dir} does not exist — run \`npm run generate\` first`)
    process.exit(1)
  }
  if (mode === 'write') {
    const info = buildInfo(dir)
    writeFileSync(join(dir, BUILD_INFO_FILE), JSON.stringify(info, null, 2) + '\n')
    console.log(`build-info: ${info.commit ?? '(no commit — local build)'} ${info.digest.slice(0, 12)} (${info.fileCount} files)`)
  } else if (mode === 'verify') {
    const problem = verifyBuildInfo(dir)
    if (problem) {
      console.error(`build-info: refusing to deploy — ${problem}`)
      process.exit(1)
    }
    console.log('build-info: artifact matches the checked commit')
  } else {
    console.error('usage: node scripts/build-info.mjs <write|verify> [dir]')
    process.exit(2)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
