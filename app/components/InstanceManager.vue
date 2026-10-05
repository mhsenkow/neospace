<script setup lang="ts">
/**
 * Accounts & Servers — signed-in accounts vs watching servers.
 */

import { useInstancesStore, type ConnectedInstance } from '~/stores/instances'
import { useAccountsManager } from '~/composables/useAccountsManager'
import { normalizeServer, friendlyServerError } from '~/utils/instances'

const instancesStore = useInstancesStore()
const { isOpen, close } = useAccountsManager()
const router = useRouter()

const newServerUrl = ref('')
const isAdding = ref(false)
const addError = ref<string | null>(null)
const addSuccess = ref<string | null>(null)

const signedIn = computed(() => instancesStore.authenticatedInstances)
const watching = computed(() => instancesStore.watchingInstances)

const hostOf = (instance: ConnectedInstance) =>
  instance.url.replace(/^https?:\/\//, '')

const handleOf = (instance: ConnectedInstance) => {
  if (!instance.user) return ''
  const acct = instance.user.acct || instance.user.username
  if (acct.includes('@')) return `@${acct}`
  return `@${acct}@${hostOf(instance)}`
}

const closeAndReset = () => {
  close()
  newServerUrl.value = ''
  addError.value = null
  addSuccess.value = null
}

const watchServer = async () => {
  if (!newServerUrl.value.trim()) return
  isAdding.value = true
  addError.value = null
  addSuccess.value = null

  try {
    const url = normalizeServer(newServerUrl.value)
    if (!url) {
      addError.value = 'Enter a server name like mastodon.social'
      return
    }
    const instance = await instancesStore.addInstance(url)
    newServerUrl.value = ''
    addSuccess.value = `Watching ${hostOf(instance)}`
  } catch (e: any) {
    addError.value = friendlyServerError(e)
  } finally {
    isAdding.value = false
  }
}

const stopWatching = (instance: ConnectedInstance) => {
  if (confirm(`Stop watching ${instance.name}?`)) {
    instancesStore.removeInstance(instance.id)
  }
}

const removeAccount = (instance: ConnectedInstance) => {
  if (confirm(`Remove ${handleOf(instance)} from NeoSpace? You’ll be signed out of this server.`)) {
    instancesStore.removeInstance(instance.id)
  }
}

const signIn = async (instance: ConnectedInstance) => {
  try {
    const authUrl = await instancesStore.startAuth(instance.id)
    window.location.href = authUrl
  } catch (e) {
    console.error('Sign in error:', e)
  }
}

const signOut = async (instance: ConnectedInstance) => {
  if (confirm(`Sign out of ${instance.name}? You can keep watching public posts.`)) {
    await instancesStore.logoutInstance(instance.id)
  }
}

const useForPosting = (instance: ConnectedInstance) => {
  instancesStore.setActiveAccount(instance.id)
}

const addAccount = () => {
  closeAndReset()
  router.push('/login?add=1')
}

const isActive = (instance: ConnectedInstance) =>
  instancesStore.activeAccount?.id === instance.id
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="accounts-overlay" @click.self="closeAndReset">
        <div class="accounts-modal" role="dialog" aria-modal="true" aria-labelledby="accounts-title">
          <header class="accounts-header">
            <div>
              <h2 id="accounts-title">Accounts &amp; Servers</h2>
              <p class="accounts-lede">
                Sign in to post. Watch servers to browse public posts without an account.
              </p>
            </div>
            <button type="button" class="accounts-close" aria-label="Close" @click="closeAndReset">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div class="accounts-body">
            <!-- Signed in -->
            <section class="accounts-section">
              <div class="accounts-section__head">
                <h3>Signed in</h3>
                <button type="button" class="accounts-link-btn" @click="addAccount">
                  + Add account
                </button>
              </div>

              <div v-if="signedIn.length === 0" class="accounts-empty">
                No accounts yet.
                <button type="button" class="accounts-inline-link" @click="addAccount">
                  Sign in to a server
                </button>
              </div>

              <ul v-else class="accounts-list">
                <li
                  v-for="instance in signedIn"
                  :key="instance.id"
                  class="account-row"
                  :class="{ 'account-row--active': isActive(instance) }"
                >
                  <img
                    v-if="instance.user?.avatar"
                    :src="instance.user.avatar"
                    :alt="instance.user.displayName || instance.user.username"
                    class="account-row__avatar"
                  />
                  <div class="account-row__info">
                    <div class="account-row__name-row">
                      <span class="account-row__name">
                        {{ instance.user?.displayName || instance.user?.username }}
                      </span>
                      <span v-if="isActive(instance)" class="account-row__badge">Posting as</span>
                    </div>
                    <span class="account-row__handle">{{ handleOf(instance) }}</span>
                    <span class="account-row__server">{{ hostOf(instance) }}</span>
                  </div>
                  <div class="account-row__actions">
                    <button
                      v-if="!isActive(instance)"
                      type="button"
                      class="action-label action-label--primary"
                      @click="useForPosting(instance)"
                    >
                      Use for posting
                    </button>
                    <button type="button" class="action-label" @click="signOut(instance)">
                      Sign out
                    </button>
                    <button type="button" class="action-label action-label--danger" @click="removeAccount(instance)">
                      Remove
                    </button>
                  </div>
                </li>
              </ul>
            </section>

            <!-- Watching -->
            <section class="accounts-section">
              <div class="accounts-section__head">
                <h3>Watching</h3>
              </div>
              <p class="accounts-hint">
                Public timelines only — no login needed.
                <NuxtLink to="/explore" class="accounts-inline-link" @click="closeAndReset">Browse servers</NuxtLink>
              </p>

              <div class="watch-add">
                <input
                  v-model="newServerUrl"
                  type="text"
                  class="neo-input"
                  placeholder="mastodon.social or @you@example.social"
                  :disabled="isAdding"
                  @keydown.enter="watchServer"
                />
                <button
                  type="button"
                  class="neo-btn neo-btn--primary watch-add__btn"
                  :disabled="isAdding || !newServerUrl.trim()"
                  @click="watchServer"
                >
                  {{ isAdding ? 'Adding…' : 'Watch' }}
                </button>
              </div>
              <p v-if="addError" class="watch-error">{{ addError }}</p>
              <p v-if="addSuccess" class="watch-success">{{ addSuccess }}</p>

              <div v-if="watching.length === 0" class="accounts-empty accounts-empty--quiet">
                Not watching any extra servers.
              </div>

              <ul v-else class="accounts-list">
                <li v-for="instance in watching" :key="instance.id" class="account-row account-row--watch">
                  <div class="account-row__icon">
                    <img
                      v-if="instance.instanceInfo?.thumbnail"
                      :src="instance.instanceInfo.thumbnail"
                      :alt="instance.name"
                    />
                    <span v-else aria-hidden="true">🌐</span>
                  </div>
                  <div class="account-row__info">
                    <span class="account-row__name">{{ instance.name }}</span>
                    <span class="account-row__server">{{ hostOf(instance) }}</span>
                    <p v-if="instance.error" class="account-row__error">{{ instance.error }}</p>
                  </div>
                  <div class="account-row__actions">
                    <button
                      type="button"
                      class="action-label action-label--primary"
                      :disabled="instance.isConnecting"
                      @click="signIn(instance)"
                    >
                      Sign in
                    </button>
                    <button type="button" class="action-label" @click="stopWatching(instance)">
                      Stop watching
                    </button>
                  </div>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.accounts-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}

.accounts-modal {
  width: 100%;
  max-width: 32rem;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
}

.accounts-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.125rem 1.25rem 0.875rem;
  border-bottom: 1px solid var(--neo-border-color);

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }
}

.accounts-lede {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-muted);
  max-width: 36ch;
}

.accounts-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  color: var(--neo-text-muted);
  background: transparent;
  border: none;
  border-radius: 50%;
  cursor: pointer;

  &:hover {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
  }
}

.accounts-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.accounts-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;

  h3 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--neo-text-secondary);
  }
}

.accounts-link-btn,
.accounts-inline-link {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;

  &:hover {
    color: var(--neo-accent-hover);
    text-decoration: underline;
  }
}

.accounts-hint {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.accounts-empty {
  padding: 0.875rem 0;
  font-size: 0.875rem;
  color: var(--neo-text-muted);

  &--quiet {
    padding-top: 0.5rem;
  }
}

.accounts-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.account-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem;
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;

  &--active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  &__avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  &__icon {
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
  }

  &__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  &__name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  &__name {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--neo-text-primary);
  }

  &__badge {
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--neo-accent);
    background: color-mix(in srgb, var(--neo-accent) 16%, transparent);
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
  }

  &__handle,
  &__server {
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__error {
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    color: var(--neo-danger);
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    width: 100%;

    @media (min-width: 480px) {
      width: auto;
      flex-direction: column;
      align-items: stretch;
      min-width: 7.5rem;
    }
  }
}

.action-label {
  padding: 0.4rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled) {
    color: var(--neo-text-primary);
    border-color: var(--neo-border-color-dark);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--primary {
    color: var(--neo-text-on-accent, #fafaf8);
    background: var(--neo-accent);
    border-color: var(--neo-accent);

    &:hover:not(:disabled) {
      background: var(--neo-accent-hover);
      color: var(--neo-text-on-accent, #fafaf8);
    }
  }

  &--danger:hover:not(:disabled) {
    color: white;
    background: var(--neo-danger);
    border-color: var(--neo-danger);
  }
}

.watch-add {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;

  .neo-input {
    flex: 1;
    min-width: 0;
  }

  &__btn {
    flex-shrink: 0;
    padding: 0.65rem 0.9rem;
  }
}

.watch-error {
  margin: -0.35rem 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--neo-danger);
}

.watch-success {
  margin: -0.35rem 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--neo-success);
}

.accounts-inline-link {
  margin-left: 0.35rem;
  font-weight: 600;
  color: var(--neo-accent);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;

  .accounts-modal {
    transition: transform 0.2s ease;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .accounts-modal {
    transform: scale(0.96) translateY(8px);
  }
}
</style>
