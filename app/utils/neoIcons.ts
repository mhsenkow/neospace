/**
 * Shared NeoIcon definitions — single source for names + SVG children.
 * Aliases (e.g. followers → users) resolve through `resolveIcon`.
 */

import { h, type VNode } from 'vue'

export type IconCtx = { filled: boolean }

type IconDef = ((ctx: IconCtx) => VNode[]) | string

export const ICONS = {
  home: ({ filled }: IconCtx) => [
    h('path', {
      d: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z',
      fill: filled ? 'currentColor' : 'none',
    }),
  ],
  search: () => [
    h('circle', { cx: 11, cy: 11, r: 8 }),
    h('path', { d: 'M21 21l-4.35-4.35' }),
  ],
  users: () => [
    h('path', { d: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2' }),
    h('circle', { cx: 9, cy: 7, r: 4 }),
    h('path', { d: 'M23 21v-2a4 4 0 00-3-3.87' }),
    h('path', { d: 'M16 3.13a4 4 0 010 7.75' }),
  ],
  /** Alias of users */
  followers: 'users',
  message: ({ filled }: IconCtx) => [
    h('path', {
      d: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
      fill: filled ? 'currentColor' : 'none',
    }),
  ],
  bell: () => [
    h('path', { d: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9' }),
    h('path', { d: 'M13.73 21a2 2 0 01-3.46 0' }),
  ],
  heart: ({ filled }: IconCtx) => [
    h('path', {
      d: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
      fill: filled ? 'currentColor' : 'none',
    }),
  ],
  bookmark: ({ filled }: IconCtx) => [
    h('path', {
      d: 'M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z',
      fill: filled ? 'currentColor' : 'none',
    }),
  ],
  /** Filter / algorithm glyph */
  filter: () => [
    h('polygon', { points: '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3' }),
  ],
  reblog: () => [
    h('polyline', { points: '17 1 21 5 17 9' }),
    h('path', { d: 'M3 11V9a4 4 0 014-4h14' }),
    h('polyline', { points: '7 23 3 19 7 15' }),
    h('path', { d: 'M21 13v2a4 4 0 01-4 4H3' }),
  ],
  user: () => [
    h('path', { d: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2' }),
    h('circle', { cx: 12, cy: 7, r: 4 }),
  ],
  lock: () => [
    h('rect', { x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2 }),
    h('path', { d: 'M7 11V7a5 5 0 0110 0v4' }),
  ],
  poll: () => [
    h('line', { x1: 18, y1: 20, x2: 18, y2: 10 }),
    h('line', { x1: 12, y1: 20, x2: 12, y2: 4 }),
    h('line', { x1: 6, y1: 20, x2: 6, y2: 14 }),
  ],
  edit: () => [
    h('path', { d: 'M12 20h9' }),
    h('path', { d: 'M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z' }),
  ],
  pen: () => [
    h('path', { d: 'M12 19l7-7 3 3-7 7-3-3z' }),
    h('path', { d: 'M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z' }),
    h('path', { d: 'M2 2l7.586 7.586' }),
  ],
  plus: () => [
    h('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
    h('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
  ],
  check: () => [h('polyline', { points: '20 6 9 17 4 12' })],
  x: () => [
    h('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
    h('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
  ],
  'chevron-left': () => [h('polyline', { points: '15 18 9 12 15 6' })],
  'chevron-right': () => [h('polyline', { points: '9 18 15 12 9 6' })],
  'chevron-down': () => [h('polyline', { points: '6 9 12 15 18 9' })],
  send: ({ filled }: IconCtx) => [
    h('line', { x1: 22, y1: 2, x2: 11, y2: 13 }),
    h('polygon', {
      points: '22 2 15 22 11 13 2 9 22 2',
      fill: filled ? 'currentColor' : 'none',
    }),
  ],
  image: () => [
    h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }),
    h('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
    h('path', { d: 'M21 15l-5-5L5 21' }),
  ],
  globe: () => [
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('line', { x1: 2, y1: 12, x2: 22, y2: 12 }),
    h('path', { d: 'M12 2a15.3 15.3 0 010 20 15.3 15.3 0 010-20z' }),
  ],
  unlisted: () => [
    h('rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }),
    h('path', { d: 'M7 11V7a5 5 0 019.9-1' }),
  ],
  mention: () => [
    h('circle', { cx: 12, cy: 12, r: 4 }),
    h('path', { d: 'M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94' }),
  ],
  settings: () => [
    h('circle', { cx: 12, cy: 12, r: 3 }),
    h('path', {
      d: 'M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
    }),
  ],
  palette: () => [
    h('path', {
      d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.7 1.7-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.6 1.7-1.6H16c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10z',
    }),
    h('circle', { cx: 7.5, cy: 11.5, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 10.5, cy: 7.5, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 14.5, cy: 7.5, r: 1.2, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 17.5, cy: 11.5, r: 1.2, fill: 'currentColor', stroke: 'none' }),
  ],
  ban: () => [
    h('circle', { cx: 12, cy: 12, r: 10 }),
    h('line', { x1: 4.93, y1: 4.93, x2: 19.07, y2: 19.07 }),
  ],
  alert: () => [
    h('path', {
      d: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
    }),
    h('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
    h('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }),
  ],
  sparkle: () => [
    h('path', { d: 'M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z' }),
    h('path', { d: 'M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15z' }),
  ],
  'eye-off': () => [
    h('path', { d: 'M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94' }),
    h('path', { d: 'M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19' }),
    h('line', { x1: 1, y1: 1, x2: 23, y2: 23 }),
  ],
  camera: () => [
    h('path', {
      d: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z',
    }),
    h('circle', { cx: 12, cy: 13, r: 4 }),
  ],
  more: () => [
    h('circle', { cx: 12, cy: 5, r: 1, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 12, cy: 19, r: 1, fill: 'currentColor', stroke: 'none' }),
  ],
  menu: () => [
    h('line', { x1: 3, y1: 6, x2: 21, y2: 6 }),
    h('line', { x1: 3, y1: 12, x2: 21, y2: 12 }),
    h('line', { x1: 3, y1: 18, x2: 21, y2: 18 }),
  ],
  servers: () => [
    h('rect', { x: 2, y: 2, width: 20, height: 8, rx: 2, ry: 2 }),
    h('rect', { x: 2, y: 14, width: 20, height: 8, rx: 2, ry: 2 }),
    h('line', { x1: 6, y1: 6, x2: 6.01, y2: 6 }),
    h('line', { x1: 6, y1: 18, x2: 6.01, y2: 18 }),
  ],
  'log-in': () => [
    h('path', { d: 'M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4' }),
    h('polyline', { points: '10 17 15 12 10 7' }),
    h('line', { x1: 15, y1: 12, x2: 3, y2: 12 }),
  ],
  share: () => [
    h('path', { d: 'M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8' }),
    h('polyline', { points: '16 6 12 2 8 6' }),
    h('line', { x1: 12, y1: 2, x2: 12, y2: 15 }),
  ],
  refresh: () => [
    h('polyline', { points: '23 4 23 10 17 10' }),
    h('polyline', { points: '1 20 1 14 7 14' }),
    h('path', {
      d: 'M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
    }),
  ],
  /** Play / resume live */
  play: ({ filled }: IconCtx) => [
    h('polygon', {
      points: '5 3 19 12 5 21 5 3',
      fill: filled ? 'currentColor' : 'none',
    }),
  ],
  /** Pause scrub */
  pause: ({ filled }: IconCtx) => [
    h('rect', {
      x: 6,
      y: 4,
      width: 4,
      height: 16,
      rx: 0.5,
      fill: filled ? 'currentColor' : 'none',
    }),
    h('rect', {
      x: 14,
      y: 4,
      width: 4,
      height: 16,
      rx: 0.5,
      fill: filled ? 'currentColor' : 'none',
    }),
  ],
  /** Focus lens — circle peephole */
  circle: () => [h('circle', { cx: 12, cy: 12, r: 9 })],
  /** Focus lens — square frame */
  square: () => [h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 1 })],
  /** Focus lens — horizontal bar */
  'focus-bar': () => [
    h('rect', { x: 2, y: 8, width: 20, height: 8, rx: 1 }),
  ],
  /** Sort / reorder */
  sort: () => [
    h('path', { d: 'M11 5h10' }),
    h('path', { d: 'M11 12h7' }),
    h('path', { d: 'M11 19h4' }),
    h('path', { d: 'M3 5l2 2 2-2' }),
    h('path', { d: 'M5 7V3' }),
    h('path', { d: 'M3 19l2-2 2 2' }),
    h('path', { d: 'M5 17v4' }),
  ],
  /** Zap / loud energy */
  zap: () => [
    h('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }),
  ],
} as const satisfies Record<string, IconDef>

export type NeoIconName = keyof typeof ICONS

export function resolveIcon(name: NeoIconName): (ctx: IconCtx) => VNode[] {
  let def: IconDef = ICONS[name]
  const seen = new Set<string>()
  while (typeof def === 'string') {
    if (seen.has(def)) {
      throw new Error(`NeoIcon alias loop: ${name}`)
    }
    seen.add(def)
    def = ICONS[def as NeoIconName]
  }
  return def
}
