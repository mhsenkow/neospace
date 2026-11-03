<script setup lang="ts">
import type { mastodon } from 'masto'
import { useInstancesStore } from '~/stores/instances'
import { useCuratedInstances } from '~/composables/useCuratedInstances'
import { useCrossAccountAction } from '~/composables/useCrossAccountAction'
import { useBoardNav } from '~/composables/useBoardNav'
import { friendlyServerError, hostnameMatches, isAuthGatedPublicHost } from '~/utils/instances'
import { openOAuthAuthorize } from '~/utils/nativeAuth'
import { createRestClient, publicClient } from '~/composables/useMasto'
import { useToastStore } from '~/stores/toast'
import SearchPersonRow from '~/components/search/SearchPersonRow.vue'
import SearchTagRow from '~/components/search/SearchTagRow.vue'

type PreviewTab = 'posts' | 'people' | 'tags' | 'about'

const emit = defineEmits<{
  watched: [domain: string]
}>()

const instancesStore = useInstancesStore()
const toastStore = useToastStore()
const route = useRoute()
const { getByDomain } = useCuratedInstances()
const { openServerOnBoard } = useBoardNav()
const { toggleFollow } = useCrossAccountAction()

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
  return instancesStore.instances.some(
    (i) => hostnameMatches(i.url, domain.value!) && i.accessToken && i.user,
  )
})

const isGated = computed(() => !!domain.value && isAuthGatedPublicHost(domain.value))
const isSignedInAnywhere = computed(() => instancesStore.hasAuthenticatedInstance)

const isAdding = ref(false)
const isSigningIn = ref(false)
const addError = ref<string | null>(null)
const tab = ref<PreviewTab>('posts')

const previewStatuses = computed(() => {
  const host = domain.value
  if (!host) return [] as mastodon.v1.Status[]
  const url = `https://${host}`
  return instancesStore.previewTimeline.map(
    (s) => ({ ...s, _instanceUrl: url, _instanceId: `host:${host}` }) as mastodon.v1.Status,
  )
})

const directory = ref<mastodon.v1.Account[]>([])
const directoryBusy = ref(false)
const directoryError = ref<string | null>(null)
const trendingTags = ref<mastodon.v1.Tag[]>([])
const tagsBusy = ref(false)
const followBusy = ref<Record<string, boolean>>({})
const relationships = ref<Record<string, mastodon.v1.Relationship>>({})
const followedTags = ref<Set<string>>(new Set())

const registrationState = computed(() => {
  const reg = instanceInfo.value?.registrations
  if (reg === true) return 'open' as const
  if (reg === false) return 'closed' as const
  return 'unknown' as const
})

const safeRemoteUrl = (raw: string | null | undefined): string | null => {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

const signupUrl = computed(() => {
  const d = domain.value
  if (!d) return '#'
  return safeRemoteUrl(instanceInfo.value?.registrationsUrl) || `https://${d}`
})

const close = () => {
  instancesStore.closePreview()
}

useFocusTrap(modalRef, isOpen, {
  onEscape: () => close(),
  initialFocus: '.close-btn',
})

watch(isOpen, (open) => {
  if (!open) {
    tab.value = 'posts'
    directory.value = []
    trendingTags.value = []
    relationships.value = {}
    directoryError.value = null
    addError.value = null
  }
})

const hostClient = () => {
  const d = domain.value
  if (!d) throw new Error('No server')
  return publicClient(`https://${d}`)
}

const loadDirectory = async () => {
  if (!domain.value || directory.value.length || directoryBusy.value) return
  directoryBusy.value = true
  directoryError.value = null
  try {
    const people = await hostClient().v1.directory.list({
      order: 'active',
      local: true,
      limit: 20,
    })
    directory.value = people.map((a) => ({
      ...a,
      _sourceUrl: `https://${domain.value}`,
    })) as mastodon.v1.Account[]
  } catch (e) {
    directoryError.value = friendlyServerError(e)
  } finally {
    directoryBusy.value = false
  }
}

const loadTags = async () => {
  if (!domain.value || trendingTags.value.length || tagsBusy.value) return
  tagsBusy.value = true
  try {
    trendingTags.value = await hostClient().v1.trends.tags.list({ limit: 12 })
  } catch {
    trendingTags.value = []
  } finally {
    tagsBusy.value = false
  }
}

watch(tab, (t) => {
  if (t === 'people') void loadDirectory()
  if (t === 'tags') void loadTags()
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
    const authUrl = await instancesStore.loginWithInstance(`https://${domain.value}`, {
      returnTo: route.fullPath,
    })
    await openOAuthAuthorize(authUrl)
  } catch (e: any) {
    addError.value = friendlyServerError(e)
    isSigningIn.value = false
  }
}

const handleAddToBoard = async () => {
  if (!domain.value) return
  const host = domain.value
  // Keep a watch row so Local can reuse an authenticated reader when available
  if (!isWatching.value) {
    try {
      await instancesStore.addInstance(`https://${host}`)
      emit('watched', host)
    } catch {
      /* still open the host-pinned column */
    }
  }
  close()
  await openServerOnBoard(host, 'local')
  toastStore.show({ message: `Opened Local · ${host} on your board`, duration: 2800 })
}

const handleFollowPerson = async (account: mastodon.v1.Account, e: Event) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isSignedInAnywhere.value) {
    toastStore.show({ message: 'Sign in to follow people' })
    return
  }
  const key = account.id
  if (followBusy.value[key]) return
  followBusy.value = { ...followBusy.value, [key]: true }
  try {
    const rel = await toggleFollow(
      { ...account, _sourceUrl: domain.value ? `https://${domain.value}` : null },
      domain.value,
    )
    if (rel) relationships.value = { ...relationships.value, [account.id]: rel }
  } catch (err: any) {
    toastStore.show({ message: err?.message || 'Couldn’t update follow' })
  } finally {
    const next = { ...followBusy.value }
    delete next[key]
    followBusy.value = next
  }
}

const handleFollowTag = async (tag: mastodon.v1.Tag, e: Event) => {
  e.preventDefault()
  e.stopPropagation()
  if (!instancesStore.activeAccount?.accessToken) {
    toastStore.show({ message: 'Sign in to follow tags' })
    return
  }
  const key = tag.name.toLowerCase()
  try {
    const client = createRestClient({
      url: instancesStore.activeAccount.url,
      accessToken: instancesStore.activeAccount.accessToken,
      timeout: 15_000,
    })
    const sel = client.v1.tags.$select(encodeURIComponent(tag.name))
    if (followedTags.value.has(key)) {
      await sel.unfollow()
      const next = new Set(followedTags.value)
      next.delete(key)
      followedTags.value = next
    } else {
      await sel.follow()
      followedTags.value = new Set([...followedTags.value, key])
    }
  } catch {
    toastStore.show({ message: 'Couldn’t update tag follow' })
  }
}

const languageList = computed(() => {
  const codes = (instanceInfo.value?.languages ?? []).slice(0, 3)
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames([], { type: 'language' })
  } catch {
    /* unsupported runtime */
  }
  return codes
    .map((code) => {
      try {
        return names?.of(code) || code
      } catch {
        return code
      }
    })
    .join(', ')
})

const RULES_SHOWN = 5
const extraRules = computed(() => Math.max(0, (instanceInfo.value?.rules?.length ?? 0) - RULES_SHOWN))

const TABS: { id: PreviewTab; label: string }[] = [
  { id: 'posts', label: 'Local posts' },
  { id: 'people', label: 'People' },
  { id: 'tags', label: 'Tags' },
  { id: 'about', label: 'About' },
]
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
          <header class="preview-header">
            <div class="header-content">
              <span class="emoji" aria-hidden="true">{{ curatedInfo?.emoji || '🌐' }}</span>
              <div>
                <h2 id="instance-preview-title">{{ instanceInfo?.title || domain }}</h2>
                <a
                  :href="`https://${domain}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="domain-link"
                >
                  {{ domain }}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
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

          <div class="preview-tabs" role="tablist" aria-label="Server preview">
            <button
              v-for="t in TABS"
              :key="t.id"
              type="button"
              role="tab"
              class="preview-tab"
              :aria-selected="tab === t.id"
              @click="tab = t.id"
            >
              {{ t.label }}
            </button>
          </div>

          <div class="preview-body">
            <!-- Local posts -->
            <div v-if="tab === 'posts'" class="timeline-section">
              <div v-if="instancesStore.previewLoading" class="loading" role="status">
                <div class="spinner" />
                <span>Loading timeline…</span>
              </div>
              <div v-else-if="instancesStore.previewError" class="error" role="alert">
                {{ instancesStore.previewError }}
              </div>
              <div v-else-if="previewStatuses.length" class="timeline-posts">
                <RealPostCard
                  v-for="status in previewStatuses.slice(0, 10)"
                  :key="status.id"
                  :status="status"
                />
              </div>
              <p v-else class="no-posts">
                <template v-if="isGated">
                  This server hides its public feed until you sign in. You can still sign in, browse people, or add it to your board.
                </template>
                <template v-else>
                  No recent public posts to show right now.
                </template>
              </p>
            </div>

            <!-- People directory -->
            <div v-else-if="tab === 'people'" class="people-section">
              <p v-if="!isSignedInAnywhere" class="hint">
                Sign in to follow people on {{ domain }} from your account without switching servers.
              </p>
              <div v-if="directoryBusy && !directory.length" class="loading" role="status">
                <div class="spinner" />
                <span>Loading people…</span>
              </div>
              <p v-else-if="directoryError" class="error" role="alert">{{ directoryError }}</p>
              <template v-else-if="directory.length">
                <SearchPersonRow
                  v-for="acct in directory"
                  :key="acct.id"
                  :account="acct"
                  :relationship="relationships[acct.id]"
                  :can-follow="isSignedInAnywhere"
                  @follow="handleFollowPerson"
                />
              </template>
              <p v-else class="no-posts">No public directory entries right now.</p>
            </div>

            <!-- Tags -->
            <div v-else-if="tab === 'tags'" class="tags-section">
              <div v-if="tagsBusy && !trendingTags.length" class="loading" role="status">
                <div class="spinner" />
                <span>Loading tags…</span>
              </div>
              <template v-else-if="trendingTags.length">
                <SearchTagRow
                  v-for="t in trendingTags"
                  :key="t.name"
                  :tag="t"
                  :following="followedTags.has(t.name.toLowerCase())"
                  :can-follow="isSignedInAnywhere"
                  @follow="handleFollowTag"
                />
              </template>
              <p v-else class="no-posts">No trending tags available.</p>
            </div>

            <!-- About -->
            <div v-else class="instance-info">
              <p v-if="instanceInfo || curatedInfo" class="description">
                {{ curatedInfo?.description || instanceInfo?.description }}
              </p>
              <div v-if="instanceInfo?.stats" class="info-grid">
                <div v-if="instanceInfo.stats.userCount != null" class="info-item">
                  <span class="label">Active this month</span>
                  <span class="value">{{ instanceInfo.stats.userCount.toLocaleString() }}</span>
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
                <div v-if="instanceInfo.languages?.length" class="info-item">
                  <span class="label">Languages</span>
                  <span class="value">{{ languageList }}</span>
                </div>
              </div>
              <div v-if="instanceInfo?.rules?.length" class="rules">
                <h3>Community Rules</h3>
                <ol>
                  <li v-for="rule in instanceInfo.rules.slice(0, RULES_SHOWN)" :key="rule.id">
                    {{ rule.text }}
                  </li>
                </ol>
                <a
                  v-if="extraRules"
                  :href="`https://${domain}/about`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="rules-more"
                >+{{ extraRules }} more {{ extraRules === 1 ? 'rule' : 'rules' }}</a>
              </div>
            </div>
          </div>

          <div v-if="addError" class="preview-error" role="alert">
            {{ addError }}
          </div>

          <footer class="preview-footer">
            <button
              type="button"
              class="action-btn action-btn--board"
              @click="handleAddToBoard"
            >
              Add to board
            </button>
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
  background: var(--neo-scrim);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--neo-z-modal, 1050);
  padding: 2rem;
}

.preview-modal {
  --neo-preview-accent: var(--neo-accent);
  background: var(--neo-bg-card);
  border-radius: 24px;
  width: 100%;
  max-width: 640px;
  max-height: 85vh;
  max-height: 85dvh;
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
  gap: 0.75rem;
  padding: 1.5rem 2rem;
  background: var(--neo-accent);
  border-bottom: 4px solid var(--neo-preview-accent);
  color: var(--neo-text-on-accent);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;

  > div {
    min-width: 0;
    overflow-wrap: anywhere;
  }

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
  flex-shrink: 0;
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

  &:hover {
    background: color-mix(in srgb, var(--neo-text-on-accent) 30%, transparent);
  }
}

.preview-tabs {
  display: flex;
  gap: 0.15rem;
  padding: 0.45rem 1rem 0;
  border-bottom: 1px solid var(--neo-border-color);
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.preview-tab {
  flex-shrink: 0;
  min-height: 2.4rem;
  padding: 0.35rem 0.75rem;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--neo-text-secondary);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 650;
  cursor: pointer;

  &[aria-selected='true'] {
    color: var(--neo-text-primary);
    border-bottom-color: var(--neo-accent);
  }
}

.preview-body {
  flex: 1;
  overflow-y: auto;
  background: var(--neo-bg-primary);
}

.instance-info {
  padding: 1.5rem 2rem;

  .description {
    color: var(--neo-text-secondary);
    line-height: 1.6;
    margin-bottom: 1.25rem;
  }
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.info-item {
  .label {
    display: block;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }

  .value {
    font-weight: 600;
    color: var(--neo-text-primary);
    font-size: 1.1rem;
  }
}

.rules {
  background: var(--neo-bg-secondary, var(--neo-bg-tertiary));
  border-radius: 12px;
  padding: 1rem 1.25rem;
  border: 1px solid var(--neo-border-color);

  h3 {
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--neo-text-muted);
  }

  .rules-more {
    display: inline-block;
    margin-top: 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--neo-accent);
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

.timeline-section,
.people-section,
.tags-section {
  padding: 1rem 1.25rem 1.5rem;
}

.timeline-posts {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;

  :deep(.status-card) {
    border: 1px solid var(--neo-border-color);
    border-radius: var(--neo-radius-md, 8px);
  }
}

.loading,
.error {
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
  to {
    transform: rotate(360deg);
  }
}

.no-posts,
.hint {
  text-align: center;
  color: var(--neo-text-muted);
  padding: 1.25rem 0.5rem;
  font-size: 0.875rem;
  line-height: 1.45;
}

.hint {
  text-align: left;
  padding: 0 0 0.75rem;
}

.preview-error {
  padding: 0.75rem 2rem;
  background: color-mix(in srgb, var(--neo-danger) 12%, transparent);
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
  border: none;
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.action-btn--board {
  background: var(--neo-text-primary);
  color: var(--neo-bg-primary);
}

.action-btn--watch {
  background: var(--neo-accent);
  color: var(--neo-text-on-accent);
}

.action-btn--login {
  background: var(--neo-success);
  color: var(--neo-text-on-accent, #fff);
}

.action-btn--join {
  background: transparent;
  border: 2px solid var(--neo-accent);
  color: var(--neo-accent);
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
  background: var(--neo-success-soft);
  color: var(--neo-success);
  border: 1px solid color-mix(in srgb, var(--neo-success) 40%, transparent);
}

.logged-in-badge {
  background: var(--neo-info-soft);
  color: var(--neo-info);
  border: 1px solid color-mix(in srgb, var(--neo-info) 40%, transparent);
}

.modal-enter-active {
  transition: opacity var(--neo-dur-sheet-enter, 300ms) var(--neo-ease-out);

  .preview-modal {
    transition: transform var(--neo-dur-sheet-enter, 300ms) var(--neo-ease-spring, var(--neo-ease-out));
  }

  .preview-header {
    animation: preview-layer-in var(--neo-dur-normal, 240ms) var(--neo-ease-out)
      calc(var(--neo-delay-secondary, 50ms) * 0.4) both;
  }

  .preview-body {
    animation: preview-layer-in var(--neo-dur-normal, 240ms) var(--neo-ease-out)
      var(--neo-delay-secondary, 50ms) both;
  }

  .preview-footer {
    animation: preview-layer-in var(--neo-dur-normal, 240ms) var(--neo-ease-out)
      calc(var(--neo-delay-secondary, 50ms) * 1.5) both;
  }
}

.modal-leave-active {
  transition: opacity var(--neo-dur-sheet-leave, 190ms) var(--neo-ease-in);

  .preview-modal {
    transition: transform var(--neo-dur-sheet-leave, 190ms) var(--neo-ease-in);
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .preview-modal {
    transform: scale(0.95) translateY(18px);
  }
}

@keyframes preview-layer-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 600px), (max-height: 560px) {
  .preview-overlay {
    padding: 0;
    align-items: stretch;
  }

  .preview-modal {
    max-width: none;
    max-height: none;
    height: 100%;
    border-radius: 0;
    border: none;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .preview-footer {
    position: sticky;
    bottom: 0;
    z-index: 1;
    padding: 0.85rem 1rem calc(0.85rem + env(safe-area-inset-bottom, 0px));
  }

  .preview-header {
    padding: max(0.85rem, env(safe-area-inset-top, 0px)) 1rem 0.85rem;
  }
}

/* Phone landscape: compact header + tabs into one row so posts retain height */
@media (max-height: 500px) and (orientation: landscape) and (max-width: 1023px) {
  .preview-overlay {
    padding: 0.4rem;
    align-items: center;
    justify-content: center;
  }

  .preview-modal {
    max-width: min(680px, 94vw);
    width: min(680px, 94vw);
    max-height: min(94dvh, 100%);
    height: auto;
    border-radius: 12px;
    border: 1px solid var(--neo-border-color);
  }

  .preview-header {
    padding: 0.45rem 0.75rem;
    border-bottom-width: 2px;
    gap: 0.5rem;

    .emoji {
      font-size: 1.35rem;
    }

    h2 {
      font-size: 1rem;
    }

    .domain-link {
      font-size: 0.75rem;
    }
  }

  .close-btn {
    width: 34px;
    height: 34px;
  }

  .preview-tabs {
    padding: 0 0.5rem;
    gap: 0;
  }

  .preview-tab {
    min-height: 2rem;
    padding: 0.2rem 0.55rem;
    font-size: 0.75rem;
  }

  .preview-footer {
    padding: 0.5rem 0.75rem;
  }
}

/* Tablet touch: floating centered card */
@media (min-width: 768px) and (max-width: 1366px) and (pointer: coarse) {
  .preview-overlay {
    padding: 1.25rem;
    align-items: center;
  }

  .preview-modal {
    max-width: 640px;
    width: min(640px, 94vw);
    max-height: min(88dvh, 720px);
    height: auto;
    border-radius: 16px;
    border: 1px solid var(--neo-border-color);
  }
}
</style>
