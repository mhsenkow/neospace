/**
 * Radical Edward–style emoticoin faces — semantic data-viz moods.
 * Mood is derived from post structure + lightweight content cues (not ML).
 */

import type { EdwardBadge, EdwardKind } from '~/utils/edwardSemantics'

export type EdwardFaceMood =
  | 'curious' // calm original thought
  | 'yapping' // reply / conversation
  | 'starry' // boost / amplification
  | 'sparkle' // media-heavy
  | 'hmm' // poll / pondering
  | 'shy' // CW / sensitive
  | 'manic' // viral engagement
  | 'giggle' // laughter cues
  | 'swoon' // love / heart cues
  | 'rage' // anger / ALL CAPS energy
  | 'sad' // sadness cues
  | 'ask' // question
  | 'linky' // link card / URL share
  | 'bot' // bot account
  | 'eggplant' // spicy 🍆 energy
  | 'peach' // spicy 🍑 energy
  | 'kitty' // spicy cat energy
  | 'booby' // blue-footed booby bird (wink wink)
  | 'anger' // pointed anger (vs manic rage)
  | 'fear' // spooked / anxious
  | 'smug' // self-satisfied
  | 'sleepy' // tired / zzz
  | 'party' // celebration / hype
  | 'confused' // scrambled
  | 'sick' // grossed out / ill
  | 'cool' // sunglasses chill

export type EdwardFaceSignals = {
  kind: EdwardKind
  badges: EdwardBadge[]
  engagement: number
  /** Plain-text preview for cue matching */
  text?: string
  hasCard?: boolean
  isBot?: boolean
  mentionCount?: number
  tagCount?: number
}

export type EdwardFaceSpec = {
  mood: EdwardFaceMood
  fill: string
  rim: string
  tag: string
  /** Why this face — shown in hover / legend */
  why: string
}

const FILL: Record<EdwardFaceMood, { fill: string; rim: string; tag: string; why: string }> = {
  curious: { fill: '#ffe566', rim: '#59d1e0', tag: '··', why: 'thought' },
  yapping: { fill: '#ffc078', rim: '#f2ad52', tag: '>>', why: 'reply' },
  starry: { fill: '#e8c4ff', rim: '#b794f6', tag: '↑↑', why: 'boost' },
  sparkle: { fill: '#ffd6e8', rim: '#ff7eb3', tag: 'pic', why: 'media' },
  hmm: { fill: '#d4f5c8', rim: '#8fd17a', tag: '??', why: 'poll' },
  shy: { fill: '#c8d0dc', rim: '#7a8494', tag: 'shh', why: 'cw' },
  manic: { fill: '#fff1a8', rim: '#ff6b6b', tag: '!!', why: 'viral' },
  giggle: { fill: '#ffef9a', rim: '#f6c945', tag: 'ha', why: 'laugh' },
  swoon: { fill: '#ffd0e4', rim: '#ff5c8a', tag: '<3', why: 'love' },
  rage: { fill: '#ff8a7a', rim: '#e23d28', tag: '!!', why: 'heat' },
  sad: { fill: '#a8c4e8', rim: '#5a7aaa', tag: '..', why: 'sad' },
  ask: { fill: '#c8f0ff', rim: '#3db8e0', tag: '?', why: 'ask' },
  linky: { fill: '#d4ffe8', rim: '#2ecf8a', tag: '://', why: 'link' },
  bot: { fill: '#d8d8e8', rim: '#8888aa', tag: '01', why: 'bot' },
  eggplant: { fill: '#c4a0e8', rim: '#7b4fb8', tag: '🍆', why: 'spicy' },
  peach: { fill: '#ffb38a', rim: '#ff7a45', tag: '🍑', why: 'spicy' },
  kitty: { fill: '#ffd6f0', rim: '#ff7eb3', tag: '🐱', why: 'spicy' },
  booby: { fill: '#e8f4ff', rim: '#4aa3e0', tag: '🐦', why: 'booby' },
  anger: { fill: '#ff6b4a', rim: '#c42810', tag: '!!', why: 'anger' },
  fear: { fill: '#d8d0f0', rim: '#6a5a9a', tag: '!!', why: 'fear' },
  smug: { fill: '#ffe8a8', rim: '#d4a017', tag: '¬‿¬', why: 'smug' },
  sleepy: { fill: '#c8d8f0', rim: '#6a8ab8', tag: 'zz', why: 'sleepy' },
  party: { fill: '#ffef70', rim: '#ff5cad', tag: '!!', why: 'party' },
  confused: { fill: '#e0e8a8', rim: '#9aaa40', tag: '??', why: 'huh' },
  sick: { fill: '#c8e8b8', rim: '#5a9a40', tag: 'ux', why: 'sick' },
  cool: { fill: '#b8e0ff', rim: '#2a7ab8', tag: 'B)', why: 'cool' },
}

const LAUGH_RE =
  /\b(lol|lmao|rofl|haha|hehe|lololol|lulz|kek)\b|😂|🤣|😆|😹|www+|www{2,}/i
const LOVE_RE =
  /\b(love|luv|heart|adore|miss you|ily)\b|<3|♥|❤|💕|💖|💗|💘|🥰|😍|😘/i
const SAD_RE =
  /\b(sad|cry|miss|lonely|depress|grief|hurt|sorry|misses)\b|😢|😭|😔|💔|😿/i
const RAGE_RE =
  /\b(hate|furious|rage|destroy|kill|burn it|pissed)\b|🤬|💢/i
const ANGER_RE =
  /\b(angry|anger|mad|annoyed|irritat|frustrated|ugh|smh|bs|stupid|idiot|wtf)\b|😡|😤|😠/i
const FEAR_RE =
  /\b(scared|afraid|terrify|anxious|anxiety|panic|worried|nervous|spook)\b|😱|😨|😰|👻/i
const SMUG_RE =
  /\b(smug|as expected|obviously|deal with it|ratio|owned|ez)\b|😏|😎|💅/i
const SLEEPY_RE =
  /\b(tired|sleepy|exhausted|bedtime|goodnight|gn\b|zzz+)\b|😴|💤|😪/i
const PARTY_RE =
  /\b(congrats|celebration|birthday|yay|woo+|let'?s go|lfg|party|hype)\b|🎉|🥳|✨|🎊/i
const CONFUSED_RE =
  /\b(confused|whaa+t+|huh+|idk|wait what|bewilder)\b|\?{3,}|😕|🤔|😵|🥴/i
const SICK_RE =
  /\b(gross|disgust|nauseat|sick|vomit|ew+|yuck)\b|🤢|🤮|😷/i
const COOL_RE =
  /\b(cool|chill|based|nice\b|smooth|vibes)\b|😎|🧊|✨(?!\s)/i
const ASK_RE = /\?{1,}|¿|\b(anyone|anybody|does anyone|how do|what if|why is)\b/i

/** Cheeky spicy lexicon — cartoon moods, not graphic. */
const EGGPLANT_RE =
  /🍆|\beggplant\b|\bdick\b|\bcock\b|\bpenis\b|\bhorny\b|\bdong\b|\bthicc?\b/i
const PEACH_RE = /🍑|\bpeach\b|\bass\b|\bbutt\b|\bbooty\b|\bcake\b(?!\s*day)/i
const KITTY_RE =
  /🐱|😻|🐈|\bpussy\b|\bkitty\b|\bnsfw\b|\blewd\b|\bonlyfans\b|\bsfw\s*adjacent\b/i
const BOOBY_RE =
  /🍒|👙|\bboob(?:s|ies)?\b|\btits?\b|\bbreasts?\b|\bnipple\b|\bboobie\b|\bcleavage\b/i

function capsRatio(text: string): number {
  const letters = text.replace(/[^a-zA-Z]/g, '')
  if (letters.length < 12) return 0
  const upper = letters.replace(/[^A-Z]/g, '').length
  return upper / letters.length
}

function spicyMood(text: string): EdwardFaceMood | null {
  if (!text) return null
  // Pick the strongest / first matching spicy family
  if (EGGPLANT_RE.test(text)) return 'eggplant'
  if (PEACH_RE.test(text)) return 'peach'
  if (BOOBY_RE.test(text)) return 'booby'
  if (KITTY_RE.test(text)) return 'kitty'
  return null
}

/** Priority-ordered semantic classifier — structure first, then text cues. */
export function faceMoodFor(s: EdwardFaceSignals): EdwardFaceMood {
  const text = (s.text || '').trim()

  // Spicy emoji/text wins over generic CW veil — still cartoon, just dirtier
  const spicy = spicyMood(text)
  if (spicy) return spicy
  // Sensitive / CW without spicy keywords → shy peek
  if (s.badges.includes('cw')) return 'shy'

  if (s.isBot) return 'bot'
  if (s.engagement >= 50) return 'manic'

  if (text) {
    if (LAUGH_RE.test(text)) return 'giggle'
    if (LOVE_RE.test(text)) return 'swoon'
    if (RAGE_RE.test(text) || capsRatio(text) > 0.72) return 'rage'
    if (ANGER_RE.test(text) || capsRatio(text) > 0.55) return 'anger'
    if (FEAR_RE.test(text)) return 'fear'
    if (PARTY_RE.test(text)) return 'party'
    if (SMUG_RE.test(text)) return 'smug'
    if (SLEEPY_RE.test(text)) return 'sleepy'
    if (SICK_RE.test(text)) return 'sick'
    if (CONFUSED_RE.test(text)) return 'confused'
    if (COOL_RE.test(text)) return 'cool'
    if (SAD_RE.test(text)) return 'sad'
    if (ASK_RE.test(text)) return 'ask'
  }

  if (s.badges.includes('media')) return 'sparkle'
  if (s.badges.includes('poll')) return 'hmm'
  if (s.hasCard && !s.badges.includes('media')) return 'linky'
  if (s.kind === 'boost') return 'starry'
  if (s.kind === 'reply' || (s.mentionCount || 0) >= 2) return 'yapping'
  if (ASK_RE.test(text)) return 'ask'
  return 'curious'
}

export function faceSpecFor(s: EdwardFaceSignals): EdwardFaceSpec {
  const mood = faceMoodFor(s)
  const base = FILL[mood]
  return { mood, fill: base.fill, rim: base.rim, tag: base.tag, why: base.why }
}

/** Draw a fat 512×512 emoticoin face onto an existing 2d context. */
export function drawEmoticoin(
  ctx: CanvasRenderingContext2D,
  spec: EdwardFaceSpec,
  seed: number,
): void {
  const S = 512
  const cx = S / 2
  const cy = S / 2 - 8
  const R = 220

  ctx.clearRect(0, 0, S, S)

  const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.15)
  glow.addColorStop(0, spec.rim + '88')
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2)
  ctx.fill()

  const body = ctx.createRadialGradient(cx - 40, cy - 50, 20, cx, cy, R)
  body.addColorStop(0, '#fff8d6')
  body.addColorStop(0.35, spec.fill)
  body.addColorStop(1, shade(spec.fill, -35))
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#1a1420'
  ctx.lineWidth = 14
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = spec.rim
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(cx, cy, R - 18, 0, Math.PI * 2)
  ctx.stroke()

  const jx = (seed % 1) * 10 - 5
  const jy = ((seed * 7) % 1) * 8 - 4
  drawFace(ctx, spec.mood, cx + jx, cy + jy, seed)

  ctx.fillStyle = '#1a1420'
  ctx.font = '700 28px "Courier New", ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(spec.tag, cx, cy + R - 48)
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + amt))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt))
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt))
  return `rgb(${r},${g},${b})`
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  mood: EdwardFaceMood,
  cx: number,
  cy: number,
  seed: number,
) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#1a1420'
  ctx.fillStyle = '#1a1420'

  const eyeY = cy - 28
  const leftX = cx - 58
  const rightX = cx + 58

  if (mood === 'shy' || mood === 'sparkle' || mood === 'curious' || mood === 'swoon' || mood === 'giggle') {
    ctx.fillStyle = 'rgba(255,110,140,0.35)'
    ctx.beginPath()
    ctx.ellipse(cx - 95, cy + 20, 28, 16, 0, 0, Math.PI * 2)
    ctx.ellipse(cx + 95, cy + 20, 28, 16, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1a1420'
  }

  switch (mood) {
    case 'curious': {
      dotEye(ctx, leftX, eyeY, 22)
      dotEye(ctx, rightX, eyeY, 22)
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.arc(cx, cy + 35, 48, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      break
    }
    case 'yapping': {
      dotEye(ctx, leftX, eyeY, 18)
      dotEye(ctx, rightX, eyeY, 18)
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(leftX - 10, eyeY - 28)
      ctx.quadraticCurveTo(leftX, eyeY - 42, leftX + 14, eyeY - 30)
      ctx.moveTo(rightX - 14, eyeY - 30)
      ctx.quadraticCurveTo(rightX, eyeY - 42, rightX + 10, eyeY - 28)
      ctx.stroke()
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.ellipse(cx, cy + 48, 36, 42, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ff6b8a'
      ctx.beginPath()
      ctx.ellipse(cx, cy + 58, 22, 18, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'starry': {
      starEye(ctx, leftX, eyeY, 34)
      starEye(ctx, rightX, eyeY, 34)
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.arc(cx, cy + 40, 55, 0.1 * Math.PI, 0.9 * Math.PI)
      ctx.stroke()
      spark(ctx, cx - 120, cy - 90, 10)
      spark(ctx, cx + 125, cy - 70, 8)
      break
    }
    case 'sparkle': {
      heartEye(ctx, leftX, eyeY, 26)
      heartEye(ctx, rightX, eyeY, 26)
      ctx.lineWidth = 11
      ctx.beginPath()
      ctx.arc(cx, cy + 38, 50, 0.12 * Math.PI, 0.88 * Math.PI)
      ctx.stroke()
      spark(ctx, cx + 110, cy - 100, 12)
      spark(ctx, cx - 100, cy - 80, 9)
      break
    }
    case 'hmm': {
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(leftX - 22, eyeY - 38)
      ctx.quadraticCurveTo(leftX, eyeY - 52, leftX + 22, eyeY - 36)
      ctx.stroke()
      dotEye(ctx, leftX, eyeY, 18)
      dotEye(ctx, rightX, eyeY + 4, 18)
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.moveTo(cx - 40, cy + 55)
      ctx.lineTo(cx + 40, cy + 48)
      ctx.stroke()
      ctx.fillStyle = '#59d1e0'
      ctx.beginPath()
      ctx.moveTo(cx + 110, cy - 40)
      ctx.quadraticCurveTo(cx + 130, cy, cx + 110, cy + 30)
      ctx.quadraticCurveTo(cx + 90, cy, cx + 110, cy - 40)
      ctx.fill()
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 6
      ctx.stroke()
      break
    }
    case 'shy': {
      ctx.fillStyle = '#1a1420'
      ctx.globalAlpha = 0.15
      ctx.fillRect(cx - 160, cy - 40, 320, 160)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.ellipse(leftX, eyeY + 10, 16, 10, 0, 0, Math.PI * 2)
      ctx.ellipse(rightX, eyeY + 10, 16, 10, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffe566'
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 8
      roundRect(ctx, cx - 130, cy + 20, 90, 70, 20)
      roundRect(ctx, cx + 40, cy + 20, 90, 70, 20)
      break
    }
    case 'manic': {
      swirlEye(ctx, leftX, eyeY, 28, seed)
      swirlEye(ctx, rightX, eyeY, 28, seed + 1)
      ctx.lineWidth = 14
      ctx.beginPath()
      ctx.moveTo(cx - 70, cy + 30)
      ctx.quadraticCurveTo(cx - 20, cy + 90, cx + 70, cy + 35)
      ctx.quadraticCurveTo(cx + 20, cy + 100, cx - 70, cy + 30)
      ctx.stroke()
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.moveTo(cx - 55, cy + 42)
      ctx.quadraticCurveTo(cx, cy + 88, cx + 55, cy + 45)
      ctx.quadraticCurveTo(cx, cy + 70, cx - 55, cy + 42)
      ctx.fill()
      ctx.strokeStyle = '#fff8d6'
      ctx.lineWidth = 4
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.moveTo(cx + i * 18, cy + 48)
        ctx.lineTo(cx + i * 18, cy + 68)
        ctx.stroke()
      }
      spark(ctx, cx - 130, cy - 100, 14)
      spark(ctx, cx + 140, cy - 60, 11)
      break
    }
    case 'giggle': {
      // Closed happy crescents + big open laugh
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.arc(leftX, eyeY, 18, 1.1 * Math.PI, 1.9 * Math.PI)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(rightX, eyeY, 18, 1.1 * Math.PI, 1.9 * Math.PI)
      ctx.stroke()
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.ellipse(cx, cy + 50, 48, 36, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ff8aaa'
      ctx.beginPath()
      ctx.ellipse(cx, cy + 62, 30, 16, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'swoon': {
      heartEye(ctx, leftX, eyeY - 4, 30)
      heartEye(ctx, rightX, eyeY - 4, 30)
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.arc(cx, cy + 42, 42, 0.2 * Math.PI, 0.8 * Math.PI)
      ctx.stroke()
      spark(ctx, cx - 125, cy - 95, 11)
      break
    }
    case 'rage': {
      // Angry brows + gritted teeth
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.moveTo(leftX - 24, eyeY - 30)
      ctx.lineTo(leftX + 20, eyeY - 12)
      ctx.moveTo(rightX + 24, eyeY - 30)
      ctx.lineTo(rightX - 20, eyeY - 12)
      ctx.stroke()
      dotEye(ctx, leftX, eyeY + 4, 16)
      dotEye(ctx, rightX, eyeY + 4, 16)
      ctx.fillStyle = '#1a1420'
      ctx.fillRect(cx - 50, cy + 40, 100, 28)
      ctx.strokeStyle = '#fff8d6'
      ctx.lineWidth = 4
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath()
        ctx.moveTo(cx + i * 14, cy + 42)
        ctx.lineTo(cx + i * 14, cy + 66)
        ctx.stroke()
      }
      break
    }
    case 'sad': {
      // Downturned brows + frown + tear
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(leftX - 20, eyeY - 18)
      ctx.quadraticCurveTo(leftX, eyeY - 8, leftX + 22, eyeY - 22)
      ctx.moveTo(rightX - 22, eyeY - 22)
      ctx.quadraticCurveTo(rightX, eyeY - 8, rightX + 20, eyeY - 18)
      ctx.stroke()
      dotEye(ctx, leftX, eyeY, 18)
      dotEye(ctx, rightX, eyeY, 18)
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.arc(cx, cy + 70, 40, 1.15 * Math.PI, 1.85 * Math.PI)
      ctx.stroke()
      ctx.fillStyle = '#59d1e0'
      ctx.beginPath()
      ctx.ellipse(rightX + 28, eyeY + 40, 10, 18, 0.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 5
      ctx.stroke()
      break
    }
    case 'ask': {
      // One big ? floating, curious blink
      dotEye(ctx, leftX, eyeY, 20)
      dotEye(ctx, rightX, eyeY, 20)
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.arc(cx, cy + 45, 28, 0.1 * Math.PI, 0.9 * Math.PI)
      ctx.stroke()
      ctx.fillStyle = '#1a1420'
      ctx.font = '900 120px "Courier New", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('?', cx + 130, cy - 80)
      break
    }
    case 'linky': {
      // Tiny link glyphs as eyes
      ctx.lineWidth = 10
      ctx.strokeStyle = '#1a1420'
      chainEye(ctx, leftX, eyeY, 22)
      chainEye(ctx, rightX, eyeY, 22)
      ctx.lineWidth = 11
      ctx.beginPath()
      ctx.arc(cx, cy + 40, 40, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      break
    }
    case 'bot': {
      // Square LED eyes + flat grill mouth
      ctx.fillStyle = '#1a1420'
      ctx.fillRect(leftX - 18, eyeY - 18, 36, 36)
      ctx.fillRect(rightX - 18, eyeY - 18, 36, 36)
      ctx.fillStyle = '#59d1e0'
      ctx.fillRect(leftX - 8, eyeY - 8, 16, 16)
      ctx.fillRect(rightX - 8, eyeY - 8, 16, 16)
      ctx.fillStyle = '#1a1420'
      ctx.fillRect(cx - 55, cy + 40, 110, 18)
      ctx.fillStyle = '#ffe566'
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(cx - 45 + i * 20, cy + 44, 10, 10)
      }
      break
    }
    case 'eggplant': {
      // Cute purple eggplant with a wink — emoji energy, not anatomy class
      ctx.fillStyle = '#7b4fb8'
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.ellipse(cx, cy + 10, 70, 110, 0.15, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#5a9e4a'
      ctx.beginPath()
      ctx.ellipse(cx - 10, cy - 100, 36, 22, -0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      // Face on the eggplant
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.arc(cx - 22, cy - 10, 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.arc(cx + 24, cy - 10, 12, 1.1 * Math.PI, 1.9 * Math.PI)
      ctx.stroke()
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.arc(cx, cy + 30, 22, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      spark(ctx, cx + 90, cy - 80, 12)
      break
    }
    case 'peach': {
      // Twin peach lobes + leaf + blushy face
      ctx.fillStyle = '#ff8f5a'
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.ellipse(cx - 48, cy + 8, 78, 90, -0.15, 0, Math.PI * 2)
      ctx.ellipse(cx + 48, cy + 8, 78, 90, 0.15, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#5a9e4a'
      ctx.beginPath()
      ctx.ellipse(cx + 8, cy - 95, 40, 18, 0.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,110,140,0.4)'
      ctx.beginPath()
      ctx.ellipse(cx - 70, cy + 30, 24, 14, 0, 0, Math.PI * 2)
      ctx.ellipse(cx + 70, cy + 30, 24, 14, 0, 0, Math.PI * 2)
      ctx.fill()
      dotEye(ctx, cx - 28, cy - 5, 14)
      dotEye(ctx, cx + 28, cy - 5, 14)
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 9
      ctx.beginPath()
      ctx.arc(cx, cy + 28, 20, 0.2 * Math.PI, 0.8 * Math.PI)
      ctx.stroke()
      break
    }
    case 'kitty': {
      // Cat ears + whiskers + mischievous smile
      ctx.fillStyle = '#ffd6f0'
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.arc(cx, cy + 10, 120, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      // Ears
      ctx.beginPath()
      ctx.moveTo(cx - 95, cy - 40)
      ctx.lineTo(cx - 130, cy - 130)
      ctx.lineTo(cx - 40, cy - 85)
      ctx.closePath()
      ctx.moveTo(cx + 95, cy - 40)
      ctx.lineTo(cx + 130, cy - 130)
      ctx.lineTo(cx + 40, cy - 85)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#ff7eb3'
      ctx.beginPath()
      ctx.moveTo(cx - 90, cy - 50)
      ctx.lineTo(cx - 115, cy - 110)
      ctx.lineTo(cx - 55, cy - 80)
      ctx.closePath()
      ctx.moveTo(cx + 90, cy - 50)
      ctx.lineTo(cx + 115, cy - 110)
      ctx.lineTo(cx + 55, cy - 80)
      ctx.closePath()
      ctx.fill()
      // Eyes (cat slits)
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.ellipse(leftX, eyeY, 16, 28, 0, 0, Math.PI * 2)
      ctx.ellipse(rightX, eyeY, 16, 28, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffe566'
      ctx.beginPath()
      ctx.ellipse(leftX, eyeY, 6, 14, 0, 0, Math.PI * 2)
      ctx.ellipse(rightX, eyeY, 6, 14, 0, 0, Math.PI * 2)
      ctx.fill()
      // Whiskers + mouth
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(cx - 20, cy + 25)
      ctx.lineTo(cx - 110, cy + 10)
      ctx.moveTo(cx - 20, cy + 35)
      ctx.lineTo(cx - 110, cy + 45)
      ctx.moveTo(cx + 20, cy + 25)
      ctx.lineTo(cx + 110, cy + 10)
      ctx.moveTo(cx + 20, cy + 35)
      ctx.lineTo(cx + 110, cy + 45)
      ctx.stroke()
      ctx.lineWidth = 9
      ctx.beginPath()
      ctx.moveTo(cx - 8, cy + 40)
      ctx.lineTo(cx, cy + 52)
      ctx.lineTo(cx + 8, cy + 40)
      ctx.stroke()
      break
    }
    case 'booby': {
      // Blue-footed booby bird — the bit is the bird
      ctx.fillStyle = '#f4f7fa'
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.ellipse(cx, cy + 5, 100, 115, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#3a8fd4'
      ctx.beginPath()
      ctx.ellipse(cx - 45, cy + 130, 28, 16, -0.2, 0, Math.PI * 2)
      ctx.ellipse(cx + 45, cy + 130, 28, 16, 0.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.moveTo(cx - 10, cy + 20)
      ctx.lineTo(cx + 70, cy + 35)
      ctx.lineTo(cx - 10, cy + 50)
      ctx.closePath()
      ctx.fill()
      dotEye(ctx, cx - 35, cy - 25, 22)
      dotEye(ctx, cx + 15, cy - 30, 18)
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.arc(cx - 95, cy + 20, 40, 0.8 * Math.PI, 1.6 * Math.PI)
      ctx.stroke()
      spark(ctx, cx + 110, cy - 90, 10)
      break
    }
    case 'anger': {
      // Pointed brows + red flush + scowl (angrier than sad, calmer than manic rage)
      ctx.fillStyle = 'rgba(255,60,40,0.35)'
      ctx.beginPath()
      ctx.ellipse(cx - 90, cy + 15, 32, 18, 0, 0, Math.PI * 2)
      ctx.ellipse(cx + 90, cy + 15, 32, 18, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 14
      ctx.beginPath()
      ctx.moveTo(leftX - 28, eyeY - 36)
      ctx.lineTo(leftX + 22, eyeY - 8)
      ctx.moveTo(rightX + 28, eyeY - 36)
      ctx.lineTo(rightX - 22, eyeY - 8)
      ctx.stroke()
      dotEye(ctx, leftX, eyeY + 6, 18)
      dotEye(ctx, rightX, eyeY + 6, 18)
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.moveTo(cx - 48, cy + 58)
      ctx.quadraticCurveTo(cx, cy + 28, cx + 48, cy + 58)
      ctx.stroke()
      // Steam puff
      ctx.strokeStyle = '#ff6b4a'
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.arc(cx + 115, cy - 70, 14, 0, Math.PI * 1.5)
      ctx.stroke()
      break
    }
    case 'fear': {
      // Wide eyes + tiny mouth + sweat
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.ellipse(leftX, eyeY, 28, 36, 0, 0, Math.PI * 2)
      ctx.ellipse(rightX, eyeY, 28, 36, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.ellipse(leftX, eyeY, 14, 20, 0, 0, Math.PI * 2)
      ctx.ellipse(rightX, eyeY, 14, 20, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.arc(leftX, eyeY + 4, 8, 0, Math.PI * 2)
      ctx.arc(rightX, eyeY + 4, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(cx, cy + 55, 14, 20, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#59d1e0'
      ctx.beginPath()
      ctx.ellipse(cx + 105, cy - 20, 12, 22, 0.15, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 5
      ctx.stroke()
      break
    }
    case 'smug': {
      // Half-lidded eyes + sideways smirk
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(leftX - 22, eyeY)
      ctx.quadraticCurveTo(leftX, eyeY + 8, leftX + 22, eyeY)
      ctx.moveTo(rightX - 22, eyeY - 4)
      ctx.quadraticCurveTo(rightX, eyeY + 4, rightX + 22, eyeY - 4)
      ctx.stroke()
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.moveTo(cx - 10, cy + 40)
      ctx.quadraticCurveTo(cx + 40, cy + 55, cx + 55, cy + 28)
      ctx.stroke()
      break
    }
    case 'sleepy': {
      // Closed crescents + zzz
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.arc(leftX, eyeY, 20, 1.15 * Math.PI, 1.85 * Math.PI)
      ctx.arc(rightX, eyeY, 20, 1.15 * Math.PI, 1.85 * Math.PI)
      ctx.stroke()
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.arc(cx, cy + 45, 28, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      ctx.fillStyle = '#1a1420'
      ctx.font = '700 48px "Courier New", monospace'
      ctx.textAlign = 'left'
      ctx.fillText('z', cx + 90, cy - 90)
      ctx.font = '700 36px "Courier New", monospace'
      ctx.fillText('z', cx + 120, cy - 120)
      break
    }
    case 'party': {
      starEye(ctx, leftX, eyeY, 30)
      starEye(ctx, rightX, eyeY, 30)
      ctx.lineWidth = 12
      ctx.strokeStyle = '#1a1420'
      ctx.beginPath()
      ctx.arc(cx, cy + 42, 52, 0.1 * Math.PI, 0.9 * Math.PI)
      ctx.stroke()
      spark(ctx, cx - 130, cy - 100, 14)
      spark(ctx, cx + 130, cy - 70, 12)
      spark(ctx, cx + 40, cy - 130, 10)
      ctx.fillStyle = '#ff5cad'
      ctx.beginPath()
      ctx.arc(cx - 100, cy + 90, 8, 0, Math.PI * 2)
      ctx.arc(cx + 110, cy + 70, 6, 0, Math.PI * 2)
      ctx.arc(cx + 20, cy - 110, 7, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'confused': {
      // Cross-eye + squiggle mouth + ?
      dotEye(ctx, leftX + 8, eyeY, 18)
      dotEye(ctx, rightX - 8, eyeY + 6, 18)
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(cx - 40, cy + 50)
      ctx.quadraticCurveTo(cx - 10, cy + 70, cx + 10, cy + 45)
      ctx.quadraticCurveTo(cx + 30, cy + 25, cx + 45, cy + 55)
      ctx.stroke()
      ctx.fillStyle = '#1a1420'
      ctx.font = '900 100px "Courier New", monospace'
      ctx.textAlign = 'center'
      ctx.fillText('?', cx + 125, cy - 70)
      break
    }
    case 'sick': {
      // Green face already from fill; x eyes + wavy mouth
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(leftX - 16, eyeY - 16)
      ctx.lineTo(leftX + 16, eyeY + 16)
      ctx.moveTo(leftX + 16, eyeY - 16)
      ctx.lineTo(leftX - 16, eyeY + 16)
      ctx.moveTo(rightX - 16, eyeY - 16)
      ctx.lineTo(rightX + 16, eyeY + 16)
      ctx.moveTo(rightX + 16, eyeY - 16)
      ctx.lineTo(rightX - 16, eyeY + 16)
      ctx.stroke()
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(cx - 40, cy + 45)
      ctx.quadraticCurveTo(cx - 15, cy + 65, cx + 5, cy + 45)
      ctx.quadraticCurveTo(cx + 25, cy + 25, cx + 45, cy + 50)
      ctx.stroke()
      break
    }
    case 'cool': {
      // Sunglasses + slight smile
      ctx.fillStyle = '#1a1420'
      ctx.fillRect(leftX - 28, eyeY - 18, 56, 36)
      ctx.fillRect(rightX - 28, eyeY - 18, 56, 36)
      ctx.fillRect(leftX + 28, eyeY - 4, Math.max(8, rightX - leftX - 56), 8)
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.arc(cx, cy + 48, 36, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      break
    }
  }
}

function chainEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x - r * 0.35, y, r * 0.55, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x + r * 0.35, y, r * 0.55, 0, Math.PI * 2)
  ctx.stroke()
}

function dotEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#1a1420'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, Math.PI * 2)
  ctx.fill()
}

function starEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#1a1420'
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    const rad = i % 2 === 0 ? r : r * 0.4
    const px = x + Math.cos(a) * rad
    const py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
}

function heartEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#ff4d6d'
  ctx.strokeStyle = '#1a1420'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(x, y + r * 0.55)
  ctx.bezierCurveTo(x - r * 1.2, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.35)
  ctx.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.2, y - r * 0.1, x, y + r * 0.55)
  ctx.fill()
  ctx.stroke()
}

function swirlEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
) {
  ctx.strokeStyle = '#1a1420'
  ctx.lineWidth = 8
  ctx.beginPath()
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 4 + seed
    const rad = (i / 24) * r
    const px = x + Math.cos(a) * rad
    const py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
}

function spark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.strokeStyle = '#1a1420'
  ctx.fillStyle = '#fff8d6'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x, y + r)
  ctx.moveTo(x - r, y)
  ctx.lineTo(x + r, y)
  ctx.moveTo(x - r * 0.6, y - r * 0.6)
  ctx.lineTo(x + r * 0.6, y + r * 0.6)
  ctx.moveTo(x + r * 0.6, y - r * 0.6)
  ctx.lineTo(x - r * 0.6, y + r * 0.6)
  ctx.stroke()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

/** Compact HUD legend — full mood set still lives in faceMoodFor / drawEmoticoin. */
export const EDWARD_FACE_LEGEND: { mood: EdwardFaceMood; label: string; glyph: string }[] = [
  { mood: 'curious', label: 'thought', glyph: '◉‿◉' },
  { mood: 'yapping', label: 'reply', glyph: 'ᕕ(ᐛ)' },
  { mood: 'starry', label: 'boost', glyph: '★◇★' },
  { mood: 'giggle', label: 'laugh', glyph: '＾▽＾' },
  { mood: 'swoon', label: 'love', glyph: '♡‿♡' },
  { mood: 'anger', label: 'anger', glyph: '╬' },
  { mood: 'rage', label: 'rage', glyph: '✧ヮ✧' },
  { mood: 'fear', label: 'fear', glyph: '◦◦' },
  { mood: 'sad', label: 'sad', glyph: '╥_╥' },
  { mood: 'party', label: 'party', glyph: '✦' },
  { mood: 'cool', label: 'cool', glyph: 'B)' },
  { mood: 'smug', label: 'smug', glyph: '¬‿¬' },
  { mood: 'confused', label: 'huh', glyph: '¿?' },
  { mood: 'sleepy', label: 'sleepy', glyph: 'zz' },
  { mood: 'shy', label: 'cw', glyph: '(⁄⁄)' },
]

/** Glyph lookup for every mood (including spicy / niche not in HUD legend). */
export const EDWARD_MOOD_GLYPHS: Record<EdwardFaceMood, string> = {
  curious: '◉‿◉',
  yapping: 'ᕕ(ᐛ)',
  starry: '★◇★',
  sparkle: '♥‿♥',
  hmm: '·_·?',
  shy: '(⁄⁄)',
  manic: '✧ヮ✧',
  giggle: '＾▽＾',
  swoon: '♡‿♡',
  rage: '✧ヮ✧',
  sad: '╥_╥',
  ask: '·?·',
  linky: '⛓',
  bot: '▣▣',
  eggplant: '🍆',
  peach: '🍑',
  kitty: '🐱',
  booby: '🐦',
  anger: '╬',
  fear: '◦◦',
  smug: '¬‿¬',
  sleepy: 'zz',
  party: '✦',
  confused: '¿?',
  sick: 'x_x',
  cool: 'B)',
}

export const MOOD_GLYPH: Record<EdwardFaceMood, string> = EDWARD_MOOD_GLYPHS
