/**
 * Ed's running commentary — a one-liner about what's actually in the stream,
 * in Radical Edward's voice (lowercase, third person, repeats, kaomoji).
 * Pure: the HUD passes a snapshot and a random source.
 */

import type { EdwardBallDescriptor } from '~/utils/edwardSemantics'
import type { EdwardSpeed } from '~/utils/edwardPace'

export type EdQuipContext = {
  speed: EdwardSpeed
  touring: boolean
  scrubbing: boolean
  filtered: boolean
  matched: number
  total: number
  backpack: number
  fromHome: number
  /** What's on stage after filters */
  visible: readonly EdwardBallDescriptor[]
  /** Name on deck (tour / lens) */
  watching: string | null
}

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length) % list.length]!

/** Most common hashtag on stage (needs at least 3 posts to be "a thing") */
export function hotTag(balls: readonly EdwardBallDescriptor[]): { tag: string; n: number } | null {
  const counts = new Map<string, number>()
  for (const b of balls) {
    if (!b.topTag) continue
    const t = b.topTag.toLowerCase()
    counts.set(t, (counts.get(t) || 0) + 1)
  }
  let best: { tag: string; n: number } | null = null
  for (const [tag, n] of counts) if (n >= 3 && (!best || n > best.n)) best = { tag, n }
  return best
}

export function edQuip(ctx: EdQuipContext, rand: () => number = Math.random): string {
  const v = ctx.visible
  if (ctx.filtered && ctx.matched === 0) {
    return pick(['nothing here... ed looked everywhere (´・ω・`)', 'empty empty~ try fewer filters?? ♪'], rand)
  }
  if (rand() < 0.04) return pick(['ein says woof (◕ᴥ◕)', 'edward wong hau pepelu tivrusky iv is watching~ ✌'], rand)

  const lines: string[] = []
  if (ctx.speed === 'still') lines.push('ed froze time!! hover hover ♪', 'shhh... everything holds still for ed')
  if (ctx.speed === 'rush') lines.push('wheeee firehose firehose (≧▽≦)', 'too fast too fast — ed loves it')
  if (ctx.touring && ctx.watching) lines.push(`next stop: ${ctx.watching}!! let's go let's go`, `ed found ${ctx.watching} ✈`)
  if (ctx.scrubbing) lines.push('rewind rewind~ ed remembers everything')

  const gems = v.filter((b) => b.engagement === 0 && b.preview.length > 100 && !b.isBot).length
  if (gems >= 2) lines.push(`psst. ${gems} quiet ones nobody saw yet ✧`)
  const asks = v.filter((b) => b.mood === 'ask').length
  if (asks >= 3) lines.push(`${asks} people asking things?? ed knows ed knows`)
  const threads = v.filter((b) => b.isThread).length
  if (threads >= 2) lines.push(`${threads} threads unspooling 🧵`)
  const langs = new Set(v.map((b) => b.language).filter(Boolean)).size
  if (langs >= 4) lines.push(`${langs} languages in the soup 文 yum`)
  const tag = hotTag(v)
  if (tag) lines.push(`everybody's on about #${tag.tag} (${tag.n}!!)`)
  if (ctx.fromHome >= 3) lines.push(`${ctx.fromHome} from your home floating by ⌂`)
  if (ctx.backpack >= 40) lines.push(`ed's backpack is stuffed — ${ctx.backpack} more thoughts waiting`)
  else if (ctx.backpack > 0 && ctx.backpack < 6) lines.push('backpack almost empty... ed is fetching more ♪')
  if (ctx.filtered) lines.push(`ed sifted it down to ${ctx.matched}/${ctx.total} ♪`)

  lines.push('hack hack hack ✌', 'the net is so big ★', 'ed is listening to the whole fediverse~', 'bubble bubble bubble (・∀・)')
  return pick(lines, rand)
}
