/**
 * Pure thread / activity anatomy for analytical progressive disclosure.
 * Tree shape, reply cadence, and instance diversity — no Pinia / DOM.
 */

export type AnatomyAccount = {
  id?: string | null
  acct?: string | null
  url?: string | null
}

export type AnatomyStatus = {
  id: string
  createdAt: string
  inReplyToId?: string | null
  account?: AnatomyAccount | null
  repliesCount?: number | null
}

export type InstanceShare = {
  host: string
  count: number
  percent: number
}

export type ThreadAnatomy = {
  totalNodes: number
  ancestorCount: number
  descendantCount: number
  maxDepth: number
  rootReplies: number
  nestedReplies: number
  uniqueParticipants: number
  authorSelfReplyRatio: number
  instances: InstanceShare[]
  instanceCount: number
  timeToFirstReplyMs: number | null
  medianReplyIntervalMs: number | null
  activeSpanMs: number | null
  /** Normalized 0–1 sparkline samples (oldest → newest reply timestamps) */
  replySparkline: number[]
}

export type AccountDistribution = {
  total: number
  instanceCount: number
  instances: InstanceShare[]
  localCount: number
  remoteCount: number
}

const hostOfAcct = (acct?: string | null, url?: string | null): string => {
  const a = (acct || '').replace(/^@/, '')
  if (a.includes('@')) return a.split('@').pop()!.toLowerCase()
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      /* ignore */
    }
  }
  return 'local'
}

const shareInstances = (hosts: string[], top = 4): InstanceShare[] => {
  const map = new Map<string, number>()
  for (const h of hosts) map.set(h, (map.get(h) || 0) + 1)
  const total = hosts.length || 1
  return [...map.entries()]
    .map(([host, count]) => ({ host, count, percent: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
    .slice(0, top)
}

const median = (nums: number[]): number | null => {
  if (!nums.length) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const sparkline = (times: number[], buckets = 12): number[] => {
  if (times.length < 2) return times.length ? [1] : []
  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = Math.max(1, max - min)
  const counts = Array.from({ length: buckets }, () => 0)
  for (const t of times) {
    const i = Math.min(buckets - 1, Math.floor(((t - min) / span) * buckets))
    counts[i]! += 1
  }
  const peak = Math.max(1, ...counts)
  return counts.map((c) => c / peak)
}

/** Depth of each descendant relative to the focus post (orphans = 0) */
export function replyDepths(
  focusId: string,
  descendants: AnatomyStatus[],
): Map<string, number> {
  const byParent = new Map<string, AnatomyStatus[]>()
  for (const s of descendants) {
    const parent = s.inReplyToId || focusId
    const list = byParent.get(parent)
    if (list) list.push(s)
    else byParent.set(parent, [s])
  }
  const depths = new Map<string, number>()
  const walk = (parentId: string, depth: number) => {
    for (const kid of byParent.get(parentId) || []) {
      if (depths.has(kid.id)) continue
      depths.set(kid.id, depth)
      walk(kid.id, depth + 1)
    }
  }
  walk(focusId, 1)
  for (const s of descendants) {
    if (!depths.has(s.id)) depths.set(s.id, 0)
  }
  return depths
}

export function computeThreadAnatomy(opts: {
  focus: AnatomyStatus
  ancestors?: AnatomyStatus[]
  descendants?: AnatomyStatus[]
}): ThreadAnatomy {
  const ancestors = opts.ancestors || []
  const descendants = opts.descendants || []
  const focus = opts.focus
  const all = [...ancestors, focus, ...descendants]
  const depths = replyDepths(focus.id, descendants)
  let maxDepth = 0
  let rootReplies = 0
  let nestedReplies = 0
  for (const s of descendants) {
    const d = depths.get(s.id) || 0
    if (d > maxDepth) maxDepth = d
    if (d <= 1) rootReplies += 1
    else nestedReplies += 1
  }

  const participantIds = new Set<string>()
  for (const s of all) {
    const id = s.account?.id || s.account?.acct
    if (id) participantIds.add(id)
  }

  const authorId = focus.account?.id || focus.account?.acct || ''
  const authorReplies = descendants.filter((s) => {
    const id = s.account?.id || s.account?.acct
    return !!authorId && id === authorId
  }).length
  const authorSelfReplyRatio = descendants.length ? authorReplies / descendants.length : 0

  const hosts = all.map((s) => hostOfAcct(s.account?.acct, s.account?.url))
  const instances = shareInstances(hosts)

  const focusT = Date.parse(focus.createdAt)
  const replyTimes = descendants
    .map((s) => Date.parse(s.createdAt))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)

  let timeToFirstReplyMs: number | null = null
  if (Number.isFinite(focusT) && replyTimes.length) {
    timeToFirstReplyMs = Math.max(0, replyTimes[0]! - focusT)
  }

  const intervals: number[] = []
  for (let i = 1; i < replyTimes.length; i++) {
    intervals.push(replyTimes[i]! - replyTimes[i - 1]!)
  }

  const allTimes = [focusT, ...replyTimes].filter(Number.isFinite)
  const activeSpanMs =
    allTimes.length >= 2 ? Math.max(...allTimes) - Math.min(...allTimes) : null

  return {
    totalNodes: all.length,
    ancestorCount: ancestors.length,
    descendantCount: descendants.length,
    maxDepth,
    rootReplies,
    nestedReplies,
    uniqueParticipants: participantIds.size,
    authorSelfReplyRatio,
    instances,
    instanceCount: new Set(hosts).size,
    timeToFirstReplyMs,
    medianReplyIntervalMs: median(intervals),
    activeSpanMs,
    replySparkline: sparkline(replyTimes),
  }
}

export function computeAccountDistribution(
  accounts: AnatomyAccount[],
  localHost?: string | null,
): AccountDistribution {
  const hosts = accounts.map((a) => hostOfAcct(a.acct, a.url))
  const local = (localHost || '').replace(/^www\./, '').toLowerCase()
  let localCount = 0
  let remoteCount = 0
  for (const h of hosts) {
    if (local && (h === local || h === 'local')) localCount += 1
    else if (h === 'local' && !local) localCount += 1
    else remoteCount += 1
  }
  return {
    total: accounts.length,
    instanceCount: new Set(hosts).size,
    instances: shareInstances(hosts),
    localCount,
    remoteCount,
  }
}

export function formatDurationShort(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}
