<script setup lang="ts">
/**
 * OAuth Callback Handler
 * 
 * Receives the OAuth code from the instance and exchanges it
 * for an access token.
 */

import { useAuthStore } from '~/stores/auth'
import { useThemeStore } from '~/stores/theme'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const themeStore = useThemeStore()

const error = ref<string | null>(null)
const status = ref('Authenticating...')

onMounted(async () => {
  const code = route.query.code as string
  const errorParam = route.query.error as string
  
  if (errorParam) {
    error.value = route.query.error_description as string || errorParam
    return
  }
  
  if (!code) {
    error.value = 'No authorization code received'
    return
  }
  
  try {
    // Load stored credentials (clientId, clientSecret, instanceUrl)
    authStore.loadFromStorage()
    
    if (!authStore.clientId || !authStore.clientSecret) {
      error.value = 'OAuth session expired. Please try logging in again.'
      return
    }
    
    status.value = 'Exchanging token...'
    
    // Exchange code for token
    await authStore.handleCallback(code)
    
    status.value = 'Loading profile...'
    
    // If user has custom CSS, load it into theme store
    if (authStore.userCustomCSS) {
      themeStore.setUserCustomCSS(authStore.userCustomCSS)
    }
    
    status.value = 'Success! Redirecting...'
    
    // Redirect to home
    await router.push('/')
  } catch (e: any) {
    error.value = e.message || 'Authentication failed'
  }
})

const handleRetry = () => {
  router.push('/login')
}

useHead({
  title: 'Authenticating... | NeoSpace'
})
</script>

<template>
  <div class="callback-page">
    <div class="callback-card neo-card">
      <div v-if="error" class="callback-error">
        <span class="callback-icon">❌</span>
        <h1>Authentication Failed</h1>
        <p>{{ error }}</p>
        <button class="neo-btn neo-btn--primary" @click="handleRetry">
          Try Again
        </button>
      </div>
      
      <div v-else class="callback-loading">
        <span class="callback-spinner">🌀</span>
        <h1>{{ status }}</h1>
        <p>Please wait while we complete your authentication...</p>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.callback-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.callback-card {
  width: 100%;
  max-width: 400px;
  padding: 3rem;
  text-align: center;
}

.callback-error,
.callback-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.callback-icon {
  font-size: 3rem;
}

.callback-spinner {
  font-size: 3rem;
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--neo-text-primary);
}

p {
  color: var(--neo-text-muted);
  line-height: 1.5;
}

button {
  margin-top: 1rem;
}
</style>

