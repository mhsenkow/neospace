<script setup lang="ts">
/**
 * NeoSpace — root app shell
 */

import { getMainScroller } from '~/utils/pageScroll'

const route = useRoute()
const router = useRouter()

/**
 * Mobile pages scroll `#main-content`, which outlives route changes, so the
 * router's window scrollBehavior can't reset/restore it. Start new pages at the
 * top; on back/forward put the reader back where they were.
 */
const mainScrollByPath = new Map<string, number>()
let poppedHistory = false
/** Whether the navigation in flight came from Back/Forward (consumed per navigation) */
let navIsPop = false

if (import.meta.client) {
  window.addEventListener('popstate', () => {
    poppedHistory = true
  })
}

router.beforeEach((to, from) => {
  // Consume on every navigation — query-only Back must not leak into the next push
  navIsPop = poppedHistory
  poppedHistory = false
  const main = getMainScroller()
  if (!main || to.path === from.path) return
  mainScrollByPath.delete(from.fullPath)
  mainScrollByPath.set(from.fullPath, main.scrollTop)
  if (mainScrollByPath.size > 40) {
    mainScrollByPath.delete(mainScrollByPath.keys().next().value!)
  }
})

const restoreMainScroll = (top: number) => {
  let frames = 0
  let cancelled = false
  // The reader takes over — stop re-applying the saved offset
  const cancel = () => {
    cancelled = true
  }
  const opts = { once: true, passive: true, capture: true } as const
  window.addEventListener('wheel', cancel, opts)
  window.addEventListener('touchstart', cancel, opts)
  window.addEventListener('keydown', cancel, opts)
  const cleanup = () => {
    window.removeEventListener('wheel', cancel, opts)
    window.removeEventListener('touchstart', cancel, opts)
    window.removeEventListener('keydown', cancel, opts)
  }
  const tick = () => {
    const main = getMainScroller()
    if (!main || cancelled) return cleanup()
    main.scrollTop = top
    // Async page data may still be rendering — retry briefly until it fits.
    if (Math.abs(main.scrollTop - top) > 2 && frames++ < 60) requestAnimationFrame(tick)
    else cleanup()
  }
  tick()
}

let lastFocusPath = route.path

watch(
  () => route.path,
  async () => {
    const popped = navIsPop
    await nextTick()
    const main = getMainScroller()
    if (!main) return
    const saved = popped ? mainScrollByPath.get(route.fullPath) : undefined
    if (saved) restoreMainScroll(saved)
    else main.scrollTop = 0
  },
)

watch(
  () => route.fullPath,
  async () => {
    const pathChanged = route.path !== lastFocusPath
    lastFocusPath = route.path
    // Query-only replaces (notification filter tabs, explore ?q=/?tab=) are
    // in-page state — refocusing `main` there yanked focus out of the tablist /
    // search field on every arrow key or keystroke.
    if (!pathChanged && (window.history.state as { replaced?: boolean } | null)?.replaced) return
    await nextTick()
    const main = document.getElementById('main-content')
    if (main instanceof HTMLElement) {
      main.focus({ preventScroll: true })
    }
  },
)
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<style>
/* Global app styles are in assets/css/main.scss */
</style>
