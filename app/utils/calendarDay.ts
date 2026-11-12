/** Local calendar day as YYYY-M-D — used to invalidate Today/Yesterday buckets. */
export function localDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function msUntilNextLocalDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return Math.max(50, next.getTime() - now.getTime() + 25)
}
