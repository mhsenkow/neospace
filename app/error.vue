<script setup lang="ts">
/**
 * App-level error page — replaces Nuxt's unbranded default.
 * 404s keep the normal shell (nav still works); anything else renders
 * standalone so a crash inside the layout can't re-crash the error page.
 */

import type { NuxtError } from '#app'

import { formatLogRingForFeedback } from '~/utils/log'

const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error?.statusCode === 404)

useHead({
  title: () => (notFound.value ? 'Page not found | NeoSpace' : 'Something went wrong | NeoSpace'),
})

const goHome = () => clearError({ redirect: '/' })
/** Someone following a stale in-app link can step back instead of losing their place */
const canGoBack = computed(() => import.meta.client && !!window.history.state?.back)
const goBack = () => clearError().then(() => window.history.back())
const reload = () => window.location.reload()

/** Short "Error 500 · message" line so a crash can be described in a report */
const errorSummary = computed(() => {
  const code = props.error?.statusCode || 500
  const raw = String(props.error?.statusMessage || props.error?.message || '').replace(/\s+/g, ' ').trim()
  return raw ? `Error ${code} · ${raw.slice(0, 160)}` : `Error ${code}`
})

const copied = ref<'idle' | 'ok' | 'failed'>('idle')
/** Copy the summary + recent (already redacted) client logs — nothing is sent anywhere */
const copyDetails = async () => {
  const logs = formatLogRingForFeedback()
  const text = [errorSummary.value, `Page: ${window.location.pathname}`, logs && `\nRecent client logs:\n${logs}`]
    .filter(Boolean)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = 'ok'
  } catch {
    copied.value = 'failed'
  }
}
</script>

<template>
  <NuxtLayout v-if="notFound">
    <div class="neo-error">
      <div class="neo-error__card">
        <p class="neo-error__eyebrow">404</p>
        <h1 class="neo-error__title">Page not found</h1>
        <p class="neo-error__desc">This link doesn’t go anywhere in NeoSpace.</p>
        <div class="neo-error__actions">
          <button v-if="canGoBack" type="button" class="neo-btn neo-btn--tertiary" @click="goBack">Go back</button>
          <button type="button" class="neo-btn neo-btn--primary" @click="goHome">Back home</button>
        </div>
      </div>
    </div>
  </NuxtLayout>
  <main v-else id="main-content" class="neo-error neo-error--standalone" tabindex="-1">
    <div class="neo-error__card">
      <p class="neo-error__eyebrow">Error</p>
      <h1 class="neo-error__title">Something went wrong</h1>
      <p class="neo-error__desc" role="alert">NeoSpace hit an unexpected problem. Reloading usually fixes it.</p>
      <p class="neo-error__detail">{{ errorSummary }}</p>
      <div class="neo-error__actions">
        <button type="button" class="neo-btn neo-btn--primary" @click="reload">Reload</button>
        <button type="button" class="neo-btn neo-btn--tertiary" @click="goHome">Back home</button>
        <button type="button" class="neo-btn neo-btn--tertiary" @click="copyDetails">Copy details</button>
      </div>
      <p class="neo-error__detail" role="status">
        <template v-if="copied === 'ok'">Copied — paste it into a feedback note.</template>
        <template v-else-if="copied === 'failed'">Couldn’t copy automatically.</template>
      </p>
    </div>
  </main>
</template>

<style lang="scss" scoped>
.neo-error {
  min-height: 60dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 1rem 3rem;
}

.neo-error--standalone {
  min-height: 100dvh;
  background: var(--neo-bg-primary);
}

.neo-error__card {
  width: min(28rem, 100%);
  padding: 1.5rem 1.25rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-lg, 16px);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.neo-error__eyebrow {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.neo-error__title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--neo-text-primary);
}

.neo-error__desc {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
}

.neo-error__detail {
  margin: 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  overflow-wrap: anywhere;

  &:empty {
    display: none;
  }
}

.neo-error__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
