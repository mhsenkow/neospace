<script setup lang="ts">
/**
 * Login — keep this simple enough for anyone
 */

import { ref, nextTick } from 'vue'
import { useInstancesStore } from '~/stores/instances'
import { useSettingsStore } from '~/stores/settings'

const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()
const router = useRouter()
const route = useRoute()

const instanceUrl = ref('')
const isConnecting = ref(false)
const connectingTo = ref<string | null>(null)
const error = ref<string | null>(null)
const showCustom = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

/** Adding another account while already signed in */
const isAddMode = computed(() => route.query.add === '1' || route.query.add === 'true')

const popularServers = [
  { name: 'mastodon.social', url: 'https://mastodon.social', blurb: 'Most popular' },
  { name: 'fosstodon.org', url: 'https://fosstodon.org', blurb: 'Open source & tech' },
  { name: 'hachyderm.io', url: 'https://hachyderm.io', blurb: 'Welcoming community' },
  { name: 'infosec.exchange', url: 'https://infosec.exchange', blurb: 'Security folks' },
  { name: 'mastodon.art', url: 'https://mastodon.art', blurb: 'Artists & makers' },
]

onMounted(async () => {
  await instancesStore.initialize()
  settingsStore.loadLocalPreferences()
  if (instancesStore.isAuthenticated && !isAddMode.value) {
    router.replace('/')
  }
})

/** Accept pasted URLs, @user@host, or bare hostnames */
const normalizeServer = (raw: string): string | null => {
  let value = raw.trim().toLowerCase()
  if (!value) return null

  // @alice@mastodon.social → mastodon.social
  const atMatch = value.match(/^@?[^@\s]+@([^@\s]+)$/)
  if (atMatch) value = atMatch[1]

  value = value.replace(/^https?:\/\//, '')
  value = value.replace(/\/.*$/, '')
  value = value.replace(/\/+$/, '')

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return null
  }

  return `https://${value}`
}

const friendlyError = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err || '')
  const lower = message.toLowerCase()

  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('cors')) {
    return "We couldn't reach that server. Check the name and your internet connection, then try again."
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return "We couldn't find that server. Double-check the spelling — it usually looks like mastodon.social."
  }
  if (lower.includes('timeout')) {
    return 'That server took too long to respond. Try again in a moment.'
  }
  if (message && message.length < 120 && !lower.includes('error:')) {
    return message
  }
  return "Something went wrong connecting to that server. Please try again."
}

const startLogin = async (raw: string) => {
  const url = normalizeServer(raw)
  if (!url) {
    error.value = 'Enter a server name like mastodon.social'
    showCustom.value = true
    await nextTick()
    inputRef.value?.focus()
    return
  }

  const host = url.replace('https://', '')
  isConnecting.value = true
  connectingTo.value = host
  error.value = null

  try {
    const authUrl = await instancesStore.loginWithInstance(url)
    // Brief pause so the "Taking you to…" state is readable
    await new Promise((r) => setTimeout(r, 280))
    window.location.href = authUrl
  } catch (e) {
    error.value = friendlyError(e)
    isConnecting.value = false
    connectingTo.value = null
  }
}

const handleSubmit = () => startLogin(instanceUrl.value)

const pickServer = (url: string) => startLogin(url)

const openCustom = async () => {
  showCustom.value = true
  error.value = null
  await nextTick()
  inputRef.value?.focus()
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

      <!-- Connecting state -->
      <div v-if="isConnecting" class="login__connecting" role="status" aria-live="polite">
        <div class="login__spinner" aria-hidden="true"></div>
        <p class="login__connecting-title">Taking you to {{ connectingTo }}</p>
        <p class="login__connecting-hint">Sign in there if asked, then approve NeoSpace.</p>
      </div>

      <template v-else>
        <div class="login__servers">
          <button
            v-for="server in popularServers"
            :key="server.url"
            type="button"
            class="login__server"
            @click="pickServer(server.url)"
          >
            <span class="login__server-name">{{ server.name }}</span>
            <span class="login__server-blurb">{{ server.blurb }}</span>
            <span class="login__server-arrow" aria-hidden="true">→</span>
          </button>
        </div>

        <div v-if="error" class="login__error" role="alert">{{ error }}</div>

        <div class="login__custom">
          <button
            v-if="!showCustom"
            type="button"
            class="login__custom-toggle"
            @click="openCustom"
          >
            My server isn’t listed
          </button>

          <form v-else class="login__form" @submit.prevent="handleSubmit">
            <label class="login__label" for="instance">Your server name</label>
            <input
              id="instance"
              ref="inputRef"
              v-model="instanceUrl"
              type="text"
              class="login__input"
              placeholder="example.social"
              inputmode="url"
              autocomplete="url"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
            />
            <p class="login__hint">
              Just the name — like <strong>mastodon.social</strong>. No https:// needed.
            </p>
            <button type="submit" class="login__submit" :disabled="!instanceUrl.trim()">
              Continue
            </button>
          </form>
        </div>

        <footer class="login__footer">
          <p>New here?</p>
          <a href="https://joinmastodon.org/servers" target="_blank" rel="noopener">
            Create a free Mastodon account
          </a>
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

.login__servers {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.login__server {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  column-gap: 0.75rem;
  align-items: center;
  width: 100%;
  min-height: 56px;
  padding: 0.75rem 1rem;
  text-align: left;
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color-dark);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color var(--neo-transition-fast), background-color var(--neo-transition-fast);

  &:hover,
  &:focus-visible {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
    outline: none;
  }

  &:active {
    transform: translateY(1px);
  }
}

.login__server-name {
  grid-column: 1;
  grid-row: 1;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
}

.login__server-blurb {
  grid-column: 1;
  grid-row: 2;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.login__server-arrow {
  grid-column: 2;
  grid-row: 1 / span 2;
  font-size: 1.125rem;
  color: var(--neo-accent);
}

.login__error {
  margin-top: 1rem;
  padding: 0.75rem 0.875rem;
  background: var(--neo-danger-soft);
  border: 1px solid color-mix(in srgb, var(--neo-danger) 35%, transparent);
  border-radius: 4px;
  color: var(--neo-danger);
  font-size: 0.875rem;
  line-height: 1.45;
}

.login__custom {
  margin-top: 1.25rem;
}

.login__custom-toggle {
  display: block;
  width: 100%;
  padding: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--neo-text-secondary);
  background: transparent;
  border: 1px dashed var(--neo-border-color-dark);
  border-radius: 4px;
  cursor: pointer;
  transition: color var(--neo-transition-fast), border-color var(--neo-transition-fast);

  &:hover,
  &:focus-visible {
    color: var(--neo-accent);
    border-color: var(--neo-accent);
    outline: none;
  }
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.login__label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
}

.login__input {
  width: 100%;
  padding: 0.875rem 1rem;
  font-size: 1rem;
  color: var(--neo-text-primary);
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color-dark);
  border-radius: 4px;
  outline: none;

  &::placeholder {
    color: var(--neo-text-disabled);
  }

  &:focus {
    border-color: var(--neo-accent);
  }
}

.login__hint {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-muted);

  strong {
    color: var(--neo-text-secondary);
    font-weight: 600;
  }
}

.login__submit {
  width: 100%;
  margin-top: 0.5rem;
  min-height: 48px;
  padding: 0.875rem 1rem;
  font-size: 1rem;
  font-weight: 600;
  color: #fafaf8;
  background: var(--neo-accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color var(--neo-transition-fast), opacity var(--neo-transition-fast);

  &:hover:not(:disabled) {
    background: var(--neo-accent-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.login__footer {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--neo-border-color);
  text-align: center;

  p {
    margin: 0 0 0.25rem;
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }

  a {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--neo-accent);
    text-decoration: none;

    &:hover {
      color: var(--neo-accent-hover);
      text-decoration: underline;
    }
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
