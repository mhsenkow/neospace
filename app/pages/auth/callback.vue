<script setup lang="ts">
/**
 * OAuth callback — finish sign-in and send people home
 */

import { useThemeStore } from '~/stores/theme'
import { useInstancesStore } from '~/stores/instances'
import { friendlyAuthError } from '~/utils/authErrors'
import { clearPendingAuth, sanitizeReturnTo } from '~/utils/oauthPkce'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const instancesStore = useInstancesStore()

const error = ref<string | null>(null)
const status = ref('Signing you in…')
const errorHeadingRef = ref<HTMLElement | null>(null)

const scrubUrl = () => {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}

onMounted(async () => {
  // Repeated params arrive as arrays — only a single string is a real code/state
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const errorParam = route.query.error ? String(route.query.error) : ''

  if (errorParam) {
    error.value = friendlyAuthError(errorParam)
    clearPendingAuth()
    scrubUrl()
    await nextTick()
    errorHeadingRef.value?.focus()
    return
  }

  if (!code) {
    error.value = 'This sign-in link is incomplete. Please try again from the sign-in page.'
    clearPendingAuth()
    scrubUrl()
    await nextTick()
    errorHeadingRef.value?.focus()
    return
  }

  try {
    status.value = 'Finishing up…'
    instancesStore.loadFromStorage()
    const state = typeof route.query.state === 'string' ? route.query.state : null
    const result = await instancesStore.completeAuth(code, state)
    const instance = result.instance
    const pending = result.pending

    if (instancesStore.userCustomCSS) {
      themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
    }

    const handle = instance.user?.acct || instance.user?.username
    const host = instance.url.replace(/^https?:\/\//, '')
    const fullHandle = handle?.includes('@') ? `@${handle}` : handle ? `@${handle}@${host}` : null

    const wasAdd = pending?.addMode
    status.value = wasAdd
      ? fullHandle
        ? `Linked ${fullHandle} — opening your profile…`
        : 'Account linked — opening your profile…'
      : fullHandle
        ? `Now posting as ${fullHandle} — opening NeoSpace…`
        : 'You’re in — opening NeoSpace…'

    scrubUrl()

    const returnTo =
      sanitizeReturnTo(pending?.returnTo) ||
      sanitizeReturnTo(typeof route.query.returnTo === 'string' ? route.query.returnTo : null)
    const defaultPath = wasAdd ? '/profile?linked=1' : '/'
    await router.replace(returnTo || defaultPath)
  } catch (e: any) {
    error.value = friendlyAuthError(e.message || 'Authentication failed')
    clearPendingAuth()
    scrubUrl()
    await nextTick()
    errorHeadingRef.value?.focus()
  }
})

const handleRetry = () => {
  let wasAdd = false
  try {
    wasAdd = sessionStorage.getItem('neospace_auth_add') === '1'
  } catch {
    /* storage blocked */
  }
  router.push(wasAdd ? '/login?add=1' : '/login')
}

useHead({
  title: 'Signing in… | NeoSpace',
})

definePageMeta({
  layout: false,
})
</script>

<template>
  <div class="callback">
    <div class="callback__atmosphere" aria-hidden="true"></div>

    <main class="callback__card">
      <span class="callback__mark" aria-hidden="true">NS</span>

      <div v-if="error" class="callback__body" role="alert">
        <h1 ref="errorHeadingRef" tabindex="-1">Couldn’t sign in</h1>
        <p>{{ error }}</p>
        <button type="button" class="callback__btn" @click="handleRetry">
          Back to sign in
        </button>
      </div>

      <div v-else class="callback__body" role="status" aria-live="polite">
        <div class="callback__spinner" aria-hidden="true"></div>
        <h1>{{ status }}</h1>
        <p>Just a moment.</p>
      </div>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.callback {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.25rem;
  overflow: hidden;
}

.callback__atmosphere {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in srgb, var(--neo-accent) 14%, transparent), transparent 70%),
    linear-gradient(180deg, var(--neo-bg-secondary) 0%, var(--neo-bg-primary) 100%);
}

.callback__card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 400px;
  padding: 2.25rem 1.75rem;
  text-align: center;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 6px;
}

.callback__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-bottom: 1.25rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--neo-text-on-accent);
  background: var(--neo-accent);
  border-radius: 2px;
}

.callback__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.callback__spinner {
  width: 28px;
  height: 28px;
  margin-bottom: 0.75rem;
  border: 2px solid var(--neo-border-color);
  border-top-color: var(--neo-accent);
  border-radius: 50%;
  animation: callback-spin 0.7s linear infinite;
}

h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--neo-text-primary);
}

p {
  margin: 0;
  max-width: 32ch;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--neo-text-muted);
}

.callback__btn {
  margin-top: 1rem;
  min-height: 48px;
  padding: 0.75rem 1.5rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-on-accent);
  background: var(--neo-accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: var(--neo-accent-hover);
  }
}

@keyframes callback-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
