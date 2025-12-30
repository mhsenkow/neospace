<script setup lang="ts">
/**
 * Login Page
 * 
 * OAuth flow start - enter your instance URL and get redirected
 * to authorize NeoSpace.
 */

import { ref } from 'vue'
import { useAuthStore } from '~/stores/auth'

const authStore = useAuthStore()
const router = useRouter()

const instanceUrl = ref('')
const isConnecting = ref(false)
const error = ref<string | null>(null)

// Popular instances for quick selection
const popularInstances = [
  { name: 'mastodon.social', url: 'https://mastodon.social' },
  { name: 'fosstodon.org', url: 'https://fosstodon.org' },
  { name: 'hachyderm.io', url: 'https://hachyderm.io' },
  { name: 'infosec.exchange', url: 'https://infosec.exchange' },
  { name: 'mastodon.art', url: 'https://mastodon.art' },
]

// If already authenticated, redirect to home
onMounted(() => {
  if (authStore.isAuthenticated) {
    router.push('/')
  }
})

const normalizeUrl = (url: string): string => {
  let normalized = url.trim().toLowerCase()
  
  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '')
  
  // Add https if no protocol
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized
  }
  
  return normalized
}

const handleConnect = async () => {
  if (!instanceUrl.value) {
    error.value = 'Please enter an instance URL'
    return
  }
  
  isConnecting.value = true
  error.value = null
  
  try {
    const url = normalizeUrl(instanceUrl.value)
    
    // Register the app with the instance
    await authStore.registerApp(url)
    
    // Redirect to OAuth authorization
    const authUrl = authStore.getAuthUrl()
    window.location.href = authUrl
  } catch (e: any) {
    error.value = e.message || 'Failed to connect to instance'
    isConnecting.value = false
  }
}

const selectInstance = (url: string) => {
  instanceUrl.value = url.replace('https://', '')
  handleConnect()
}

useHead({
  title: 'Login | NeoSpace'
})
</script>

<template>
  <div class="login-page">
    <div class="login-card neo-card">
      <div class="login-header">
        <span class="login-logo">🌌</span>
        <h1 class="login-title">Welcome to NeoSpace</h1>
        <p class="login-subtitle">Connect to your Fediverse instance</p>
      </div>

      <form class="login-form" @submit.prevent="handleConnect">
        <div class="login-field">
          <label class="login-label" for="instance">Instance URL</label>
          <div class="login-input-wrapper">
            <span class="login-input-prefix">https://</span>
            <input
              id="instance"
              v-model="instanceUrl"
              type="text"
              class="login-input neo-input"
              placeholder="mastodon.social"
              :disabled="isConnecting"
              autocomplete="url"
              autocapitalize="none"
            />
          </div>
          <p class="login-hint">Enter your Mastodon, GoToSocial, or compatible instance</p>
        </div>

        <div v-if="error" class="login-error">
          {{ error }}
        </div>

        <button 
          type="submit" 
          class="login-submit neo-btn neo-btn--primary"
          :disabled="isConnecting || !instanceUrl"
        >
          <span v-if="isConnecting" class="login-spinner">⏳</span>
          <span v-else>Connect</span>
        </button>
      </form>

      <div class="login-divider">
        <span>or choose a popular instance</span>
      </div>

      <div class="login-instances">
        <button
          v-for="instance in popularInstances"
          :key="instance.url"
          class="login-instance neo-btn neo-btn--ghost"
          :disabled="isConnecting"
          @click="selectInstance(instance.url)"
        >
          {{ instance.name }}
        </button>
      </div>

      <div class="login-footer">
        <p>New to the Fediverse?</p>
        <a href="https://joinmastodon.org/servers" target="_blank" rel="noopener">
          Find an instance →
        </a>
      </div>
    </div>

    <div class="login-features">
      <div class="login-feature">
        <span class="login-feature-icon">👩</span>
        <h3>Mom Mode</h3>
        <p>Clean, accessible design your mother would approve of.</p>
      </div>
      <div class="login-feature">
        <span class="login-feature-icon">🌀</span>
        <h3>Chaos Mode</h3>
        <p>Inject your own CSS and relive the Myspace glory days.</p>
      </div>
      <div class="login-feature">
        <span class="login-feature-icon">🔓</span>
        <h3>Open Protocol</h3>
        <p>Works with Mastodon, GoToSocial, Pleroma, and more.</p>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 3rem;
}

.login-card {
  width: 100%;
  max-width: 420px;
  padding: 2.5rem;
}

.login-header {
  text-align: center;
  margin-bottom: 2rem;
}

.login-logo {
  font-size: 3rem;
  display: block;
  margin-bottom: 1rem;
}

.login-title {
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--neo-text-primary);
  margin-bottom: 0.5rem;
}

.login-subtitle {
  color: var(--neo-text-muted);
  font-size: 0.9375rem;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.login-label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--neo-text-secondary);
}

.login-input-wrapper {
  display: flex;
  align-items: center;
  background-color: var(--neo-bg-secondary);
  border: var(--neo-border-width) solid var(--neo-border-color);
  border-radius: var(--neo-radius-md);
  overflow: hidden;
  transition: border-color var(--neo-transition);

  &:focus-within {
    border-color: var(--neo-accent);
  }
}

.login-input-prefix {
  padding: 0.75rem;
  padding-right: 0;
  color: var(--neo-text-muted);
  font-size: 0.9375rem;
  user-select: none;
}

.login-input {
  border: none;
  background: transparent;
  padding-left: 0.25rem;

  &:focus {
    box-shadow: none;
  }
}

.login-hint {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.login-error {
  padding: 0.75rem 1rem;
  background-color: rgba(220, 53, 69, 0.1);
  border: 1px solid var(--neo-danger);
  border-radius: var(--neo-radius-md);
  color: var(--neo-danger);
  font-size: 0.875rem;
}

.login-submit {
  width: 100%;
  padding: 1rem;
  font-size: 1rem;
  margin-top: 0.5rem;
}

.login-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.login-divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1.5rem 0;
  color: var(--neo-text-muted);
  font-size: 0.8125rem;

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background-color: var(--neo-border-color);
  }
}

.login-instances {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.login-instance {
  font-size: 0.8125rem;
  padding: 0.5rem 0.875rem;
}

.login-footer {
  margin-top: 2rem;
  text-align: center;
  font-size: 0.875rem;

  p {
    color: var(--neo-text-muted);
    margin-bottom: 0.25rem;
  }

  a {
    color: var(--neo-accent);
    font-weight: 500;
  }
}

// Features grid
.login-features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  max-width: 800px;
  width: 100%;
}

.login-feature {
  text-align: center;
  padding: 1.5rem;

  &-icon {
    font-size: 2rem;
    display: block;
    margin-bottom: 0.75rem;
  }

  h3 {
    font-size: 1rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    margin-bottom: 0.5rem;
  }

  p {
    font-size: 0.875rem;
    color: var(--neo-text-muted);
    line-height: 1.5;
  }
}
</style>

