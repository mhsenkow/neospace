<script setup lang="ts">
/**
 * Single mount point for confirm, lightbox, and toasts.
 * Report and lightbox only render once opened — mount them lazily and keep them mounted afterwards
 * (so close transitions and focus restore still run).
 */
import { useOverlayStore } from '~/stores/overlay'

const overlay = useOverlayStore()
const mounted = reactive({ report: false, lightbox: false })

watch(
  () => overlay.report.open,
  (open) => {
    if (open) mounted.report = true
  },
  { immediate: true },
)
watch(
  () => overlay.lightbox.open,
  (open) => {
    if (open) mounted.lightbox = true
  },
  { immediate: true },
)
</script>

<template>
  <NeoConfirm />
  <LazyNeoReport v-if="mounted.report" />
  <LazyNeoLightbox v-if="mounted.lightbox" />
  <NeoToastHost />
</template>
