<script setup lang="ts">
/**
 * Login — pick a server you already use, approve NeoSpace, come back.
 */

import { useInstancesStore } from '~/stores/instances'
import { useSettingsStore } from '~/stores/settings'
import { friendlyServerError } from '~/utils/instances'

const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()
const router = useRouter()
const route = useRoute()

const isConnecting = ref(false)
const connectingTo = ref<string | null>(null)
const pickerRef = ref<{ setError: (msg: string | null) => void } | null>(null)

/** Adding another account while already signed in */
const isAddMode = computed(() => route.query.add === '1' || route.query.add === 'true')

onMounted(async () => {
  await instancesStore.initialize()
  settingsStore.loadLocalPreferences()
  if (instancesStore.isAuthenticated && !isAddMode.value) {
    router.replace('/')
  }
})

const startLogin = async (url: string) => {
  const host = url.replace(/^https?:\/\//, '')
  isConnecting.value = true
  connectingTo.value = host
  pickerRef.value?.setError(null)

  try {
    const authUrl = await instancesStore.loginWithInstance(url)
    await new Promise((r) => setTimeout(r, 280))
    window.location.href = authUrl
  } catch (e) {
    pickerRef.value?.setError(friendlyServerError(e))
    isConnecting.value = false
    connectingTo.value = null
  }
}

useHead({
  title: computed(() => (isAddMode.value ? 'Add account | NeoSpace' : 'Sign in | NeoSpace')),
})

definePageMeta({
  layout: false,
})
</script>

<template>
  <div class="login">
    <div class="login__atmosphere" aria-hidden="true"></div>

    <main class="login__stage">
      <header class="login__brand">
        <span class="login__mark" aria-hidden="true">NS</span>
        <h1 class="login__wordmark">
          {{ isAddMode ? 'Add another account' : 'Sign in to NeoSpace' }}
        </h1>
        <p class="login__lede">
          <template v-if="isAddMode">
            Pick another Mastodon server you have an account on.
            We’ll send you there to approve NeoSpace, then bring you back.
          </template>
          <template v-else>
            Pick the Mastodon server where you already have an account.
            We’ll send you there to approve NeoSpace, then bring you back.
          </template>
        </p>
        <NuxtLink v-if="isAddMode" to="/" class="login__back">← Back to NeoSpace</NuxtLink>
      </header>

      <div v-if="isConnecting" class="login__connecting" role="status" aria-live="polite">
        <div class="login__spinner" aria-hidden="true"></div>
        <p class="login__connecting-title">Taking you to {{ connectingTo }}</p>
        <p class="login__connecting-hint">Sign in there if asked, then approve NeoSpace.</p>
      </div>

      <template v-else>
        <ServerPicker
          ref="pickerRef"
          submit-label="Sign in on this server"
          @select="startLogin"
        />

        <footer class="login__footer">
          <p>New to Mastodon?</p>
          <div class="login__footer-links">
            <NuxtLink to="/explore">Browse servers by interest</NuxtLink>
            <span aria-hidden="true">·</span>
            <a href="https://joinmastodon.org/servers" target="_blank" rel="noopener">
              Create a free account
            </a>
          </div>
        </footer>
      </template>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.login {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1.25rem 3rem;
  overflow: hidden;
}

.login__atmosphere {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in srgb, var(--neo-accent) 14%, transparent), transparent 70%),
    linear-gradient(180deg, var(--neo-bg-secondary) 0%, var(--neo-bg-primary) 55%, var(--neo-bg-primary) 100%);
  z-index: 0;
}

.login__stage {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  padding: 2rem 1.5rem 1.5rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 6px;
}

.login__brand {
  margin-bottom: 1.5rem;
}

.login__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-bottom: 0.875rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #fafaf8;
  background: var(--neo-accent);
  border-radius: 2px;
}

.login__wordmark {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--neo-text-primary);
  margin: 0 0 0.5rem;
}

.login__lede {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.55;
  color: var(--neo-text-muted);
}

.login__back {
  display: inline-block;
  margin-top: 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-accent);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.login__footer {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--neo-border-color);
  text-align: center;

  p {
    margin: 0 0 0.35rem;
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }
}

.login__footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  justify-content: center;
  align-items: center;
  font-size: 0.875rem;

  a {
    font-weight: 600;
    color: var(--neo-accent);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  span {
    color: var(--neo-text-disabled);
  }
}

.login__connecting {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2rem 0.5rem 1.5rem;
  gap: 0.5rem;
}

.login__spinner {
  width: 28px;
  height: 28px;
  margin-bottom: 0.75rem;
  border: 2px solid var(--neo-border-color);
  border-top-color: var(--neo-accent);
  border-radius: 50%;
  animation: login-spin 0.7s linear infinite;
}

.login__connecting-title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--neo-text-primary);
}

.login__connecting-hint {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--neo-text-muted);
  max-width: 28ch;
}

@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 600px) {
  .login {
    align-items: flex-start;
    padding: 2rem 1rem 2.5rem;
  }

  .login__stage {
    padding: 1.5rem 1.25rem 1.25rem;
  }

  .login__wordmark {
    font-size: 1.375rem;
  }
}
</style>
