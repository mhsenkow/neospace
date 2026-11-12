import { watch } from 'vue'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'

/**
 * gifv autoplay — one shared IntersectionObserver plays loops only while on
 * screen (and never under reduced motion). A bare `autoplay` attribute kept
 * every gifv in a long feed downloading and decoding offscreen.
 */
const gifvVisible = new Set<HTMLVideoElement>()
let gifvObserver: IntersectionObserver | null = null
let gifvMotionWatched = false

function syncGifv(video: HTMLVideoElement) {
  if (gifvVisible.has(video) && !usePrefersReducedMotion().value) {
    void video.play().catch(() => {})
  } else if (!video.paused) {
    video.pause()
  }
}

/** `v-gifv-autoplay="isGifv"` — a false value leaves the video alone (controls stay available) */
function attachGifv(video: HTMLVideoElement) {
  if (!gifvMotionWatched) {
    gifvMotionWatched = true
    // App-lifetime watcher: pause/resume visible loops when the setting flips
    watch(usePrefersReducedMotion(), () => gifvVisible.forEach(syncGifv))
  }
  if (typeof IntersectionObserver === 'undefined') {
    gifvVisible.add(video)
    syncGifv(video)
    return
  }
  gifvObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement
        if (entry.isIntersecting) gifvVisible.add(video)
        else gifvVisible.delete(video)
        syncGifv(video)
      }
    },
    { threshold: 0.25 },
  )
  gifvObserver.observe(video)
}

function detachGifv(video: HTMLVideoElement) {
  gifvVisible.delete(video)
  gifvObserver?.unobserve(video)
}

/** `v-gifv-autoplay` directive for post media videos. */
export const gifvAutoplay = {
  mounted(video: HTMLVideoElement, binding: { value?: boolean }) {
    if (binding.value === false) return
    attachGifv(video)
  },
  // The "autoplay GIFs" server preference can arrive after the card mounted
  updated(video: HTMLVideoElement, binding: { value?: boolean; oldValue?: boolean }) {
    if (binding.value === binding.oldValue) return
    if (binding.value === false) {
      detachGifv(video)
      if (!video.paused) video.pause()
    } else {
      attachGifv(video)
    }
  },
  beforeUnmount(video: HTMLVideoElement) {
    detachGifv(video)
  },
}
