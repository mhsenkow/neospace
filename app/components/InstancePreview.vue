<script setup lang="ts">
import { useInstancesStore } from '~/stores/instances'
import { useCuratedInstances } from '~/composables/useCuratedInstances'

const instancesStore = useInstancesStore()
const { instances } = useCuratedInstances()

const isOpen = computed(() => !!instancesStore.previewingInstance)
const domain = computed(() => instancesStore.previewingInstance)
const instanceInfo = computed(() => domain.value ? instancesStore.getInstance(domain.value) : null)
const curatedInfo = computed(() => instances.find(i => i.domain === domain.value))

const close = () => {
  instancesStore.closePreview()
}

// Close on escape
onMounted(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  window.addEventListener('keydown', handleEscape)
  onUnmounted(() => window.removeEventListener('keydown', handleEscape))
})

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const stripHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="preview-overlay" @click.self="close">
        <div class="preview-modal" :style="{ '--accent': curatedInfo?.color || '#6364ff' }">
          <!-- Header -->
          <header class="preview-header">
            <div class="header-content">
              <span class="emoji">{{ curatedInfo?.emoji || '🌐' }}</span>
              <div>
                <h2>{{ instanceInfo?.title || domain }}</h2>
                <a :href="`https://${domain}`" target="_blank" class="domain-link">
                  {{ domain }}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
                  </svg>
                </a>
              </div>
            </div>
            <button class="close-btn" @click="close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
                <span class="value">{{ instanceInfo.registrations ? 'Open' : 'Closed' }}</span>
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
                No recent posts to show
              </p>
            </div>
          </div>

          <!-- Join CTA -->
          <footer class="preview-footer">
            <a 
              :href="`https://${domain}/auth/sign_up`" 
              target="_blank" 
              class="join-btn"
            >
              Join {{ instanceInfo?.title || domain }}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
              </svg>
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
  z-index: 1000;
  padding: 2rem;
}

.preview-modal {
  --accent: #6364ff;
  
  background: #ffffff;
  border-radius: 24px;
  width: 100%;
  max-width: 640px;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem 2rem;
  background: var(--accent);
  color: white;
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
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.9rem;
    text-decoration: none;

    &:hover {
      color: white;
    }
  }
}

.close-btn {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: white;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

.instance-info {
  padding: 1.5rem 2rem;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;

  .description {
    color: #4b5563;
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
  background: #f3f4f6;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  border: 1px solid #e5e7eb;

  h4 {
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
  }

  ol {
    margin: 0;
    padding-left: 1.25rem;
    
    li {
      font-size: 0.9rem;
      color: #374151;
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
  background: #fafafa;

  h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
    font-size: 1rem;
    color: #111827;
    font-weight: 600;
  }
}

.loading, .error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: #6b7280;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e7eb;
  border-top-color: var(--accent);
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
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
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

.preview-footer {
  padding: 1.25rem 2rem;
  border-top: 1px solid #e5e7eb;
  background: #ffffff;
  display: flex;
  justify-content: center;
}

.join-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--accent);
  color: white;
  padding: 0.875rem 2rem;
  border-radius: 100px;
  font-weight: 600;
  text-decoration: none;
  transition: transform 0.15s ease, opacity 0.15s ease;

  &:hover {
    opacity: 0.9;
    transform: scale(1.02);
  }
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

