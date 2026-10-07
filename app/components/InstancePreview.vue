<script setup lang="ts">
import { useInstancesStore } from '~/stores/instances'
import { useCuratedInstances } from '~/composables/useCuratedInstances'
import { friendlyServerError, hostnameMatches, isAuthGatedPublicHost } from '~/utils/instances'
import { stripHtml } from '~/utils/stripHtml'

const emit = defineEmits<{
  watched: [domain: string]
}>()

const instancesStore = useInstancesStore()
const { getByDomain } = useCuratedInstances()

const modalRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => !!instancesStore.previewingInstance)
const domain = computed(() => instancesStore.previewingInstance)
const instanceInfo = computed(() => (domain.value ? instancesStore.getInstance(domain.value) : null))
const curatedInfo = computed(() => (domain.value ? getByDomain(domain.value) : undefined))

const isWatching = computed(() => {
  if (!domain.value) return false
  return instancesStore.instances.some((i) => hostnameMatches(i.url, domain.value!))
})

const isLoggedIn = computed(() => {
  if (!domain.value) return false
  const instance = instancesStore.instances.find((i) => hostnameMatches(i.url, domain.value!))
  return !!(instance?.accessToken && instance?.user)
})

const isGated = computed(() => !!domain.value && isAuthGatedPublicHost(domain.value))

const isAdding = ref(false)
const isSigningIn = ref(false)
const addError = ref<string | null>(null)

const registrationState = computed(() => {
  const reg = instanceInfo.value?.registrations
  if (reg === true) return 'open' as const
  if (reg === false) return 'closed' as const
  return 'unknown' as const
})

const signupUrl = computed(() => {
  const d = domain.value
  if (!d) return '#'
  const url = instanceInfo.value?.registrationsUrl
  return url || `https://${d}/auth/sign_up`
})

const close = () => {
  instancesStore.closePreview()
}

useFocusTrap(modalRef, isOpen, {
  onEscape: () => close(),
  initialFocus: '.close-btn',
})

const handleWatch = async () => {
  if (!domain.value || isWatching.value) return

  isAdding.value = true
  addError.value = null

  try {
    await instancesStore.addInstance(`https://${domain.value}`)
    emit('watched', domain.value)
  } catch (e: any) {
    addError.value = friendlyServerError(e)
  } finally {
    isAdding.value = false
  }
}

const handleLogin = async () => {
  if (!domain.value || isSigningIn.value) return
  isSigningIn.value = true
  addError.value = null

  try {
    const authUrl = await instancesStore.loginWithInstance(`https://${domain.value}`)
    window.location.href = authUrl
  } catch (e: any) {
    addError.value = friendlyServerError(e)
    isSigningIn.value = false
  }
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="preview-overlay" @click.self="close">
        <div
          ref="modalRef"
          class="preview-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="instance-preview-title"
          :style="{ '--neo-preview-accent': curatedInfo?.color || 'var(--neo-accent)' }"
        >
          <!-- Header -->
          <header class="preview-header">
            <div class="header-content">
              <span class="emoji">{{ curatedInfo?.emoji || '🌐' }}</span>
              <div>
                <h2 id="instance-preview-title">{{ instanceInfo?.title || domain }}</h2>
                <a
                  :href="`https://${domain}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="domain-link"
                >
                  {{ domain }}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
                  </svg>
                </a>
              </div>
            </div>
            <button
              type="button"
              class="close-btn neo-tip"
              title="Close"
              aria-label="Close"
              @click="close"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </header>

          <!-- Instance Info -->
          <div class="instance-info" v-if="instanceInfo">
            <p class="description">{{ curatedInfo?.description || instanceInfo.description }}</p>
            
            <div class="info-grid" v-if="instanceInfo.stats">
              <div class="info-item">
                <span class="label">Active Users</span>
                <span class="value">{{ instanceInfo.stats.userCount?.toLocaleString() || 'N/A' }}</span>
              </div>
              <div class="info-item">
                <span class="label">Registration</span>
                <span class="value">
                  {{
                    registrationState === 'open'
                      ? 'Open'
                      : registrationState === 'closed'
                        ? 'Closed'
                        : 'Unknown'
                  }}
                </span>
              </div>
              <div class="info-item" v-if="instanceInfo.languages?.length">
                <span class="label">Languages</span>
                <span class="value">{{ instanceInfo.languages.slice(0, 3).join(', ') }}</span>
              </div>
            </div>

            <!-- Rules -->
            <div class="rules" v-if="instanceInfo.rules?.length">
              <h4>Community Rules</h4>
              <ol>
                <li v-for="rule in instanceInfo.rules.slice(0, 5)" :key="rule.id">
                  {{ rule.text }}
                </li>
              </ol>
            </div>
          </div>

          <!-- Timeline Preview -->
          <div class="timeline-section">
            <h3>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              Local Timeline
            </h3>

            <div v-if="instancesStore.previewLoading" class="loading">
              <div class="spinner"></div>
              <span>Loading timeline...</span>
            </div>

            <div v-else-if="instancesStore.previewError" class="error">
              {{ instancesStore.previewError }}
            </div>

            <div v-else class="timeline-posts">
              <article 
                v-for="status in instancesStore.previewTimeline.slice(0, 10)" 
                :key="status.id"
                class="preview-post"
              >
                <img 
                  :src="status.account.avatar" 
                  :alt="status.account.displayName"
                  class="avatar"
                />
                <div class="post-content">
                  <div class="post-header">
                    <strong>{{ status.account.displayName || status.account.username }}</strong>
                    <span class="handle">@{{ status.account.acct }}</span>
                    <span class="time">{{ formatDate(status.createdAt) }}</span>
                  </div>
                  <p class="post-text">{{ stripHtml(status.content) }}</p>
                  
                  <!-- Media preview -->
                  <div v-if="status.mediaAttachments?.length" class="media-preview">
                    <img 
                      v-for="media in status.mediaAttachments.slice(0, 2)" 
                      :key="media.id"
                      :src="media.previewUrl"
                      :alt="media.description || 'Media'"
                    />
                  </div>
                </div>
              </article>

              <p v-if="!instancesStore.previewTimeline.length" class="no-posts">
                <template v-if="isGated">
                  This server hides its public feed until you sign in. You can still Sign in or create an account.
                </template>
                <template v-else>
                  No recent public posts to show right now.
                </template>
              </p>
            </div>
          </div>

          <div v-if="addError" class="preview-error">
            {{ addError }}
          </div>

          <footer class="preview-footer">
            <button
              v-if="!isLoggedIn"
              type="button"
              class="action-btn action-btn--login"
              :disabled="isSigningIn"
              :aria-busy="isSigningIn"
              @click="handleLogin"
            >
              {{ isSigningIn ? 'Signing in…' : 'Sign in to this server' }}
            </button>
            <div v-else class="logged-in-badge">Signed in</div>

            <button
              v-if="!isWatching"
              type="button"
              class="action-btn action-btn--watch"
              :disabled="isAdding"
              @click="handleWatch"
            >
              {{ isAdding ? 'Adding…' : 'Watch public posts' }}
            </button>
            <div v-else class="watching-badge">Watching</div>

            <a
              v-if="registrationState !== 'closed'"
              :href="signupUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="action-btn action-btn--join"
            >
              Create account →
            </a>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--neo-z-modal, 1000);
  padding: 2rem;
}

.preview-modal {
  --neo-preview-accent: var(--neo-accent);

  background: var(--neo-bg-card);
  border-radius: 24px;
  width: 100%;
  max-width: 640px;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 80px color-mix(in srgb, var(--neo-text-primary) 35%, transparent);
  border: 1px solid var(--neo-border-color);
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem 2rem;
  background: var(--neo-preview-accent);
  color: var(--neo-text-on-accent);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 1rem;

  .emoji {
    font-size: 2.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
  }

  .domain-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: color-mix(in srgb, var(--neo-text-on-accent) 80%, transparent);
    font-size: 0.9rem;
    text-decoration: none;

    &:hover {
      color: var(--neo-text-on-accent);
    }
  }
}

.close-btn {
  background: color-mix(in srgb, var(--neo-text-on-accent) 20%, transparent);
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--neo-text-on-accent);
  transition: background 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--neo-text-on-accent) 30%, transparent);
  }
}

.instance-info {
  padding: 1.5rem 2rem;
  border-bottom: 1px solid var(--neo-border-color);
  background: var(--neo-bg-card);

  .description {
    color: var(--neo-text-secondary);
    line-height: 1.6;
    margin-bottom: 1.25rem;
  }
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.info-item {
  .label {
    display: block;
    font-size: 0.75rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }

  .value {
    font-weight: 600;
    color: #111827;
    font-size: 1.1rem;
  }
}

.rules {
  background: var(--neo-bg-secondary, var(--neo-bg-tertiary));
  border-radius: 12px;
  padding: 1rem 1.25rem;
  border: 1px solid var(--neo-border-color);

  h4 {
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--neo-text-muted);
  }

  ol {
    margin: 0;
    padding-left: 1.25rem;
    
    li {
      font-size: 0.9rem;
      color: var(--neo-text-secondary);
      margin-bottom: 0.5rem;
      line-height: 1.4;

      &:last-child {
        margin-bottom: 0;
      }
    }
  }
}

.timeline-section {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem 2rem;
  background: var(--neo-bg-primary);

  h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
    font-size: 1rem;
    color: var(--neo-text-primary);
    font-weight: 600;
  }
}

.loading, .error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: var(--neo-text-muted);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--neo-border-color);
  border-top-color: var(--neo-preview-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 0.75rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.timeline-posts {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.preview-post {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--neo-bg-card);
  border-radius: 12px;
  border: 1px solid var(--neo-border-color);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--neo-text-primary) 6%, transparent);
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
}

.post-content {
  flex: 1;
  min-width: 0;
}

.post-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.25rem;

  strong {
    color: #111827;
    font-size: 0.9rem;
  }

  .handle {
    color: #6b7280;
    font-size: 0.85rem;
  }

  .time {
    color: #9ca3af;
    font-size: 0.8rem;
    margin-left: auto;
  }
}

.post-text {
  margin: 0;
  color: #374151;
  font-size: 0.9rem;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.media-preview {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;

  img {
    width: 80px;
    height: 80px;
    object-fit: cover;
    border-radius: 8px;
  }
}

.no-posts {
  text-align: center;
  color: #6b7280;
  padding: 2rem;
}

.preview-error {
  padding: 0.75rem 2rem;
  background: #fef2f2;
  color: var(--neo-danger);
  text-align: center;
  font-size: 0.875rem;
}

.preview-footer {
  padding: 1.25rem 2rem;
  border-top: 1px solid var(--neo-border-color);
  background: var(--neo-bg-card);
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: 100px;
  font-weight: 600;
  font-size: 0.9rem;
  text-decoration: none;
  transition: transform 0.15s ease, opacity 0.15s ease, background 0.15s ease;
  border: none;
  cursor: pointer;

  &:hover {
    transform: scale(1.02);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
}

.action-btn--watch {
  background: var(--neo-preview-accent);
  color: var(--neo-text-on-accent);

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
}

.action-btn--login {
  background: var(--neo-success);
  color: var(--neo-text-on-accent, #fff);

  &:hover {
    background: var(--neo-success-dark, var(--neo-success));
  }
}

.action-btn--join {
  background: transparent;
  border: 2px solid var(--neo-preview-accent);
  color: var(--neo-preview-accent);

  &:hover {
    background: rgba(99, 100, 255, 0.1);
  }
}

.watching-badge,
.logged-in-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.75rem 1.25rem;
  border-radius: 100px;
  font-weight: 600;
  font-size: 0.875rem;
}

.watching-badge {
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}

.logged-in-badge {
  background: #f0f9ff;
  color: #0284c7;
  border: 1px solid #bae6fd;
}

// Transition
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;

  .preview-modal {
    transition: transform 0.2s ease;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .preview-modal {
    transform: scale(0.95) translateY(20px);
  }
}
</style>

