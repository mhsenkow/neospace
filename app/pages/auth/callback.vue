<script setup lang="ts">
/**
 * OAuth callback — finish sign-in and send people home
 */

import { useThemeStore } from '~/stores/theme'
import { useInstancesStore } from '~/stores/instances'
import { friendlyAuthError } from '~/utils/authErrors'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const instancesStore = useInstancesStore()

const error = ref<string | null>(null)
const status = ref('Signing you in…')

onMounted(async () => {
  const code = route.query.code as string
  const errorParam = route.query.error as string

  if (errorParam) {
    error.value = friendlyAuthError(
      (route.query.error_description as string) || errorParam,
    )
    return
  }

  if (!code) {
    error.value = 'This sign-in link is incomplete. Please try again from the sign-in page.'
    return
  }

  try {
    status.value = 'Finishing up…'
    instancesStore.loadFromStorage()
    await instancesStore.completeAuth(code)

    if (instancesStore.userCustomCSS) {
      themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
    }

    status.value = 'You’re in — opening NeoSpace…'
    await new Promise((r) => setTimeout(r, 400))
    await router.replace('/')
  } catch (e: any) {
    error.value = friendlyAuthError(e.message || 'Authentication failed')
  }
})

const handleRetry = () => {
  router.push('/login')
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

      <div v-if="error" class="callback__body">
        <h1>Couldn’t sign in</h1>
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
  color: #fafaf8;
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
  color: #fafaf8;
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
