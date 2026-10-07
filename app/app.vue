<script setup lang="ts">
/**
 * NeoSpace — root app shell
 */

const route = useRoute()

watch(
  () => route.fullPath,
  async () => {
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
