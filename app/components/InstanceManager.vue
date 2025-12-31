<script setup lang="ts">
/**
 * Instance Manager Component
 * 
 * UI for managing multiple Mastodon instance connections.
 * Add/remove instances, log in/out of each.
 */

import { useInstancesStore, type ConnectedInstance } from '~/stores/instances'

const instancesStore = useInstancesStore()
const router = useRouter()

const isOpen = ref(false)
const newInstanceUrl = ref('')
const isAdding = ref(false)
const addError = ref<string | null>(null)

const open = () => {
  isOpen.value = true
}

const close = () => {
  isOpen.value = false
  newInstanceUrl.value = ''
  addError.value = null
}

const addInstance = async () => {
  if (!newInstanceUrl.value.trim()) return
  
  isAdding.value = true
  addError.value = null
  
  try {
    let url = newInstanceUrl.value.trim()
    if (!url.startsWith('http')) {
      url = `https://${url}`
    }
    
    await instancesStore.addInstance(url)
    newInstanceUrl.value = ''
  } catch (e: any) {
    addError.value = e.message || 'Failed to add instance'
  } finally {
    isAdding.value = false
  }
}

const removeInstance = (instance: ConnectedInstance) => {
  if (confirm(`Remove ${instance.name}? ${instance.user ? 'You will be logged out.' : ''}`)) {
    instancesStore.removeInstance(instance.id)
  }
}

const loginToInstance = async (instance: ConnectedInstance) => {
  try {
    const authUrl = await instancesStore.startAuth(instance.id)
    window.location.href = authUrl
  } catch (e: any) {
    console.error('Login error:', e)
  }
}

const logoutFromInstance = async (instance: ConnectedInstance) => {
  if (confirm(`Log out from ${instance.name}? You can still view public posts.`)) {
    await instancesStore.logoutInstance(instance.id)
  }
}

// Expose open method
defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="instance-modal-overlay" @click.self="close">
        <div class="instance-modal">
          <header class="modal-header">
            <h2>Manage Servers</h2>
            <button class="modal-close" @click="close" aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div class="modal-content">
            <!-- Add New Instance -->
            <div class="add-instance">
              <div class="add-instance-input">
                <input
                  v-model="newInstanceUrl"
                  type="text"
                  placeholder="mastodon.social, hachyderm.io..."
                  class="neo-input"
                  :disabled="isAdding"
                  @keydown.enter="addInstance"
                />
                <button 
                  class="add-btn neo-btn neo-btn--primary"
                  :disabled="isAdding || !newInstanceUrl.trim()"
                  @click="addInstance"
                >
                  {{ isAdding ? 'Adding...' : 'Add' }}
                </button>
              </div>
              <p v-if="addError" class="add-error">{{ addError }}</p>
              <p class="add-hint">Add servers to view their public timelines or log in to your accounts.</p>
            </div>

            <!-- Connected Instances -->
            <div class="instances-list">
              <div 
                v-for="instance in instancesStore.instances" 
                :key="instance.id"
                class="instance-card"
                :class="{ 'instance-card--authenticated': instance.user }"
              >
                <div class="instance-main">
                  <div class="instance-icon">
                    <img 
                      v-if="instance.instanceInfo?.thumbnail" 
                      :src="instance.instanceInfo.thumbnail" 
                      :alt="instance.name"
                    />
                    <span v-else>🌐</span>
                  </div>
                  
                  <div class="instance-info">
                    <h3 class="instance-name">{{ instance.name }}</h3>
                    <p class="instance-url">{{ instance.url.replace('https://', '') }}</p>
                    
                    <!-- User info if logged in -->
                    <div v-if="instance.user" class="instance-user">
                      <img :src="instance.user.avatar" :alt="instance.user.displayName" class="user-avatar" />
                      <span class="user-name">{{ instance.user.displayName || instance.user.username }}</span>
                      <span class="user-handle">@{{ instance.user.acct }}</span>
                    </div>
                    
                    <p v-if="instance.error" class="instance-error">{{ instance.error }}</p>
                  </div>
                </div>

                <div class="instance-actions">
                  <template v-if="instance.isConnecting">
                    <span class="connecting-spinner">⏳</span>
                  </template>
                  <template v-else-if="instance.user">
                    <button 
                      class="action-btn action-btn--logout" 
                      @click="logoutFromInstance(instance)"
                      title="Log out"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                    </button>
                  </template>
                  <template v-else>
                    <button 
                      class="action-btn action-btn--login" 
                      @click="loginToInstance(instance)"
                      title="Log in"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                        <polyline points="10 17 15 12 10 7" />
                        <line x1="15" y1="12" x2="3" y2="12" />
                      </svg>
                    </button>
                  </template>
                  
                  <button 
                    class="action-btn action-btn--remove" 
                    @click="removeInstance(instance)"
                    title="Remove server"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- Empty state -->
              <div v-if="instancesStore.instances.length === 0" class="instances-empty">
                <span>🌍</span>
                <p>No servers connected. Add one above!</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.instance-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.instance-modal {
  width: 100%;
  max-width: 500px;
  max-height: 85vh;
  background: var(--neo-bg-secondary);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--neo-border-color);
  
  h2 {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: transparent;
  color: var(--neo-text-muted);
  transition: all 0.15s ease;
  
  &:hover {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
  }
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
}

// Add Instance Section
.add-instance {
  margin-bottom: 1.5rem;
}

.add-instance-input {
  display: flex;
  gap: 0.5rem;
  
  .neo-input {
    flex: 1;
    min-width: 0;
  }
  
  .add-btn {
    flex-shrink: 0;
    padding: 0.75rem 1rem;
  }
}

.add-error {
  margin-top: 0.5rem;
  font-size: 0.8125rem;
  color: var(--neo-danger);
}

.add-hint {
  margin-top: 0.5rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

// Instances List
.instances-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.instance-card {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  background: var(--neo-bg-tertiary);
  border-radius: 12px;
  border: 1px solid var(--neo-border-color);
  
  &--authenticated {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }
}

.instance-main {
  flex: 1;
  display: flex;
  gap: 0.75rem;
  min-width: 0;
}

.instance-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--neo-bg-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  span {
    font-size: 1.25rem;
  }
}

.instance-info {
  flex: 1;
  min-width: 0;
}

.instance-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.instance-url {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.instance-user {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.5rem;
  padding: 0.375rem 0.5rem;
  background: var(--neo-bg-secondary);
  border-radius: 6px;
  
  .user-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
  }
  
  .user-name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--neo-text-primary);
  }
  
  .user-handle {
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }
}

.instance-error {
  font-size: 0.75rem;
  color: var(--neo-danger);
  margin-top: 0.25rem;
}

// Actions
.instance-actions {
  display: flex;
  gap: 0.375rem;
  flex-shrink: 0;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-muted);
  transition: all 0.15s ease;
  
  &:hover {
    color: var(--neo-text-primary);
  }
  
  &--login {
    background: var(--neo-accent);
    color: var(--neo-text-inverse);
    
    &:hover {
      filter: brightness(1.1);
    }
  }
  
  &--logout {
    &:hover {
      background: var(--neo-warning);
      color: #000;
    }
  }
  
  &--remove {
    &:hover {
      background: var(--neo-danger);
      color: white;
    }
  }
}

.connecting-spinner {
  font-size: 1.25rem;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.instances-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  text-align: center;
  
  span {
    font-size: 2rem;
  }
  
  p {
    color: var(--neo-text-muted);
    font-size: 0.875rem;
  }
}

// Modal transitions
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
  
  .instance-modal {
    transition: transform 0.2s ease;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
  
  .instance-modal {
    transform: scale(0.95) translateY(10px);
  }
}
</style>

