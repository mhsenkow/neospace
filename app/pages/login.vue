<script setup lang="ts">
/**
 * Login — pick a server you already use, approve LoomSpace, come back.
 */

import { useInstancesStore, type ConnectedInstance } from '~/stores/instances'
import { useSettingsStore } from '~/stores/settings'
import { useToastStore } from '~/stores/toast'
import { friendlyServerError } from '~/utils/instances'
import { openOAuthAuthorize } from '~/utils/nativeAuth'
import { sanitizeReturnTo } from '~/utils/oauthPkce'
import { instanceHandle } from '~/composables/useSwitchAccount'
import { plainDisplayName } from '~/utils/displayName'

const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()
const toastStore = useToastStore()
const router = useRouter()
const route = useRoute()

/** Signed-in fast path is leaving — keep the picker from flashing */
const redirecting = ref(false)
const isConnecting = ref(false)
const connectingTo = ref<string | null>(null)
const pickerRef = ref<{ setError: (msg: string | null) => void } | null>(null)
const reauthBusy = ref<Record<string, boolean>>({})

/** Adding another account while already signed in */
const isAddMode = computed(() => route.query.add === '1' || route.query.add === 'true')

const returnTo = computed(() =>
  sanitizeReturnTo(typeof route.query.returnTo === 'string' ? route.query.returnTo : null),
)

const mainHandle = computed(() => {
  const main = instancesStore.primaryAccount || instancesStore.activeAccount
  if (!main?.user) return null
  return instanceHandle(main)
})

/** Accounts already on this device (signed in or expired) — shown in add mode */
const linkedAccounts = computed(() =>
  instancesStore.signedInInstances.filter((i) => !!i.user),
)

const expiredAccounts = computed(() =>
  instancesStore.signedInInstances.filter((i) => i.sessionExpired || (!i.accessToken && i.user)),
)

/** Add mode returns to where it was opened from: returnTo, else the previous page, else Profile */
const goBack = () => {
  if (returnTo.value) return router.push(returnTo.value)
  if (typeof window !== 'undefined' && window.history.length > 1 && window.history.state?.back) {
    return router.back()
  }
  return router.push('/profile')
}
const backLabel = computed(() =>
  returnTo.value || (typeof window !== 'undefined' && window.history.state?.back)
    ? '← Back'
    : '← Back to profile',
)

/** Bumped by Cancel / bfcache restore so a slow app-registration can't redirect afterwards */
let loginAttempt = 0

const resetConnecting = () => {
  loginAttempt++
  isConnecting.value = false
  connectingTo.value = null
}

const onPageShow = (e: PageTransitionEvent) => {
  // bfcache restore after OAuth Back leaves a stuck spinner
  if (e.persisted) resetConnecting()
}

onMounted(async () => {
  window.addEventListener('pageshow', onPageShow)

  // Fast path: stored tokens mean we're already signed in — don't wait on network verify
  if (!isAddMode.value && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('neospace_instances')
      if (raw) {
        const parsed = JSON.parse(raw) as { instances?: { accessToken?: string }[] }
        const hasToken = parsed?.instances?.some((i) => !!i.accessToken)
        if (hasToken) {
          redirecting.value = true
          router.replace(returnTo.value || '/')
        }
      }
    } catch {
      /* ignore */
    }
  }

  await instancesStore.initialize()
  settingsStore.loadLocalPreferences()
  // The fast path may already have left /login — don't yank the user back
  if (router.currentRoute.value.path !== '/login') return
  // Stored tokens didn't hold up — show the picker after all
  redirecting.value = false
  if (instancesStore.isAuthenticated && !isAddMode.value) {
    router.replace(returnTo.value || '/')
  }
})

onUnmounted(() => {
  window.removeEventListener('pageshow', onPageShow)
})

const startLogin = async (url: string) => {
  const host = url.replace(/^https?:\/\//, '')
  const attempt = ++loginAttempt
  isConnecting.value = true
  connectingTo.value = host
  pickerRef.value?.setError(null)

  try {
    const authUrl = await instancesStore.loginWithInstance(url, {
      addMode: isAddMode.value,
      returnTo: returnTo.value,
    })
    if (attempt !== loginAttempt) return
    await openOAuthAuthorize(authUrl)
  } catch (e) {
    if (attempt !== loginAttempt) return
    pickerRef.value?.setError(friendlyServerError(e))
    resetConnecting()
  }
}

const reauthAccount = async (instance: ConnectedInstance) => {
  if (reauthBusy.value[instance.id]) return
  reauthBusy.value = { ...reauthBusy.value, [instance.id]: true }
  try {
    const authUrl = await instancesStore.startAuth(instance.id, {
      addMode: isAddMode.value,
      returnTo: returnTo.value,
    })
    await openOAuthAuthorize(authUrl)
  } catch (e) {
    pickerRef.value?.setError(friendlyServerError(e))
    const row = instancesStore.instances.find((i) => i.id === instance.id)
    if (row) row.isConnecting = false
  } finally {
    const next = { ...reauthBusy.value }
    delete next[instance.id]
    reauthBusy.value = next
  }
}

const watchServer = async (url: string) => {
  try {
    const instance = await instancesStore.addInstance(url)
    const host = instance.url.replace(/^https?:\/\//, '')
    toastStore.show({ message: `Watching ${host} — browsing the public feed`, duration: 3200 })
    await router.push(returnTo.value || '/')
  } catch (e) {
    pickerRef.value?.setError(friendlyServerError(e))
  }
}

const handleOf = instanceHandle
const displayOf = (account: ConnectedInstance) =>
  plainDisplayName(account.user?.displayName, account.user?.username)

useHead({
  title: computed(() => (isAddMode.value ? 'Add account | LoomSpace' : 'Sign in | LoomSpace')),
})

definePageMeta({
  layout: false,
})
</script>

<template>
  <div class="login">
    <div class="login__atmosphere" aria-hidden="true"></div>

    <main v-if="!redirecting" class="login__stage">
      <header class="login__brand">
        <span class="login__mark" aria-hidden="true">NS</span>
        <h1 class="login__wordmark">
          {{ isAddMode ? 'Add account' : 'Sign in' }}
        </h1>
        <p class="login__lede">
          <template v-if="isAddMode">
            <template v-if="mainHandle">
              Linked under <strong>{{ mainHandle }}</strong>.
            </template>
            Choose the server for the account you want to add — it can be one you’re already on.
          </template>
          <template v-else>
            Choose your server. Approve LoomSpace, then you’re in.
          </template>
        </p>
        <a v-if="isAddMode" href="#" class="login__back" @click.prevent="goBack">{{ backLabel }}</a>
      </header>

      <ol
        v-if="!isConnecting && !isAddMode"
        class="login__steps"
        aria-label="How sign-in works"
      >
        <li class="login__step">
          <span class="login__step-num" aria-hidden="true">1</span>
          <span class="login__step-text">
            <strong>Pick your server</strong>
            <em>Where your account lives</em>
          </span>
        </li>
        <li class="login__step">
          <span class="login__step-num" aria-hidden="true">2</span>
          <span class="login__step-text">
            <strong>Approve on your server</strong>
            <em>Your password stays with them</em>
          </span>
        </li>
        <li class="login__step">
          <span class="login__step-num" aria-hidden="true">3</span>
          <span class="login__step-text">
            <strong>Back in LoomSpace</strong>
            <em>All your servers, one place</em>
          </span>
        </li>
      </ol>

      <div
        v-if="!isConnecting && ((isAddMode && linkedAccounts.length) || expiredAccounts.length)"
        class="login__linked"
      >
        <p class="login__linked-label">
          {{ isAddMode ? 'Already on this device' : 'Welcome back — sign in again' }}
        </p>
        <ul class="login__linked-list">
          <li
            v-for="account in (isAddMode ? linkedAccounts : expiredAccounts)"
            :key="account.id"
            class="login__linked-item"
          >
            <img
              v-if="account.user?.avatar"
              :src="account.user.avatar"
              alt=""
              class="login__linked-avatar"
            />
            <span class="login__linked-meta">
              <span class="login__linked-name">{{ displayOf(account) }}</span>
              <span class="login__linked-handle">{{ handleOf(account) }}</span>
            </span>
            <span
              v-if="account.sessionExpired || !account.accessToken"
              class="login__linked-badge"
            >Expired</span>
            <button
              v-if="account.sessionExpired || !account.accessToken"
              type="button"
              class="neo-btn neo-btn--primary neo-btn--sm"
              :disabled="reauthBusy[account.id]"
              @click="reauthAccount(account)"
            >
              {{ reauthBusy[account.id] ? 'Opening…' : 'Sign in again' }}
            </button>
          </li>
        </ul>
        <p v-if="isAddMode && expiredAccounts.length === 0" class="login__linked-hint">
          Adding another account below — same or different server is fine.
        </p>
      </div>

      <div v-if="isConnecting" class="login__connecting" role="status" aria-live="polite">
        <div class="login__spinner" aria-hidden="true"></div>
        <p class="login__connecting-title">Taking you to {{ connectingTo }}</p>
        <p class="login__connecting-hint">Sign in there if asked, then approve LoomSpace.</p>
        <button type="button" class="neo-btn neo-btn--secondary" @click="resetConnecting">
          Cancel
        </button>
      </div>

      <template v-else>
        <ServerPicker
          ref="pickerRef"
          :submit-label="isAddMode ? 'Add account on this server' : 'Sign in on this server'"
          show-known-servers
          allow-watch
          @select="startLogin"
          @watch="watchServer"
        />

        <footer class="login__footer">
          <p>New to the fediverse?</p>
          <div class="login__footer-links">
            <NuxtLink v-if="!isAddMode" to="/">Just browse</NuxtLink>
            <span v-if="!isAddMode" aria-hidden="true">·</span>
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
  min-height: 100dvh;
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
  margin-bottom: 1.25rem;
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
  color: var(--neo-text-on-accent);
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

  @media (hover: hover) {
    &:hover {
      text-decoration: underline;
    }
  }
}

.login__steps {
  list-style: none;
  margin: 0 0 1.35rem;
  padding: 0.7rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 6px;
  background: var(--neo-bg-secondary);

  @media (min-width: 420px) {
    flex-direction: row;
    align-items: stretch;
    gap: 0.35rem;
    padding: 0.65rem;
  }
}

.login__step {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  min-width: 0;

  @media (min-width: 420px) {
    flex: 1;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.35rem 0.4rem;
  }
}

.login__step-num {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 50%;
  background: var(--neo-accent-soft);
  color: var(--neo-accent);
  font-size: 0.6875rem;
  font-weight: 700;
}

.login__step-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;

  strong {
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--neo-text-primary);
  }

  em {
    font-style: normal;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }
}

.login__linked {
  margin: 0 0 1.25rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 6px;
  background: var(--neo-bg-secondary);
}

.login__linked-label {
  margin: 0 0 0.55rem;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--neo-text-tertiary);
  text-transform: uppercase;
}

.login__linked-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.login__linked-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.login__linked-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--neo-bg-tertiary);
}

.login__linked-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.login__linked-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.login__linked-handle {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.login__linked-badge {
  flex-shrink: 0;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
  background: var(--neo-warning-soft, color-mix(in srgb, var(--neo-warning) 14%, transparent));
  color: var(--neo-warning);
  font-size: 0.6875rem;
  font-weight: 700;
}

.login__linked-hint {
  margin: 0.65rem 0 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
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

    @media (hover: hover) {
      &:hover {
        text-decoration: underline;
      }
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

@media (max-width: 720px) {
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
