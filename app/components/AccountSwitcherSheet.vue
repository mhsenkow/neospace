<script setup lang="ts">
/**
 * Threads-style account switcher sheet (mounted once in the layout).
 */

import { useInstancesStore, type ConnectedInstance } from '~/stores/instances'
import { useAccountsManager } from '~/composables/useAccountsManager'
import { useAccountSwitcher } from '~/composables/useAccountSwitcher'

const instancesStore = useInstancesStore()
const { open: openAccounts } = useAccountsManager()
const { isOpen: menuOpen, close: closeMenu } = useAccountSwitcher()
const route = useRoute()
const router = useRouter()
const sheetRef = ref<HTMLElement | null>(null)

useFocusTrap(sheetRef, menuOpen, {
  onEscape: closeMenu,
  initialFocus: '.acct-sheet__close, .acct-sheet__avatar-btn, button',
})

const switchedToast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

const accounts = computed(() => instancesStore.authenticatedInstances)
const multi = computed(() => accounts.value.length > 1)
const primary = computed(() => instancesStore.primaryAccount)

const handleOf = (instance: ConnectedInstance) => {
  const acct = instance.user?.acct || instance.user?.username || ''
  const host = instance.url.replace(/^https?:\/\//, '')
  if (acct.includes('@')) return `@${acct}`
  return `@${acct}@${host}`
}

const hostOf = (instance: ConnectedInstance) =>
  instance.url.replace(/^https?:\/\//, '').replace(/\/$/, '')

const isPrimary = (instance: ConnectedInstance) =>
  instance.id === (primary.value?.id ?? null)

const showSwitched = (instance: ConnectedInstance) => {
  switchedToast.value = `Posting as ${handleOf(instance)}`
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    switchedToast.value = null
  }, 1800)
}

const selectAccount = async (id: string) => {
  if (id === instancesStore.activeAccount?.id) {
    closeMenu()
    return
  }
  instancesStore.setActiveAccount(id)
  closeMenu()
  const account = accounts.value.find((a) => a.id === id)
  if (account) showSwitched(account)
  if (route.path === '/profile' && !route.query.user) {
    const { useProfileStore } = await import('~/stores/profile')
    await useProfileStore().fetchProfile()
  }
}

const goProfile = () => {
  closeMenu()
  router.push('/profile')
}

const manage = () => {
  closeMenu()
  openAccounts()
}

const addAccount = () => {
  closeMenu()
  router.push('/login?add=1')
}

const makeMain = (id: string) => {
  instancesStore.setPrimaryAccount(id)
  closeMenu()
}

watch(menuOpen, (open) => {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('acct-sheet-open', open)
})

onUnmounted(() => {
  document.documentElement.classList.remove('acct-sheet-open')
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="acct-toast">
      <div v-if="switchedToast" class="acct-switch__toast" role="status">
        {{ switchedToast }}
      </div>
    </Transition>

    <Transition name="acct-sheet">
      <div
        v-if="menuOpen && instancesStore.isAuthenticated"
        ref="sheetRef"
        class="acct-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acct-sheet-title"
      >
        <button
          type="button"
          class="acct-sheet__backdrop"
          aria-label="Close"
          @click="closeMenu"
        />

        <div class="acct-sheet__panel">
          <div class="acct-sheet__handle" aria-hidden="true" />

          <header class="acct-sheet__header">
            <h2 id="acct-sheet-title" class="acct-sheet__title">Accounts</h2>
            <p class="acct-sheet__subtitle">
              Switch which server you’re posting as. Feeds still mix across signed-in accounts.
            </p>
          </header>

          <ul v-if="accounts.length <= 4" class="acct-sheet__avatars">
            <li v-for="account in accounts" :key="account.id">
              <button
                type="button"
                class="acct-sheet__avatar-btn"
                :class="{ 'acct-sheet__avatar-btn--active': account.id === instancesStore.activeAccount?.id }"
                :aria-pressed="account.id === instancesStore.activeAccount?.id"
                :aria-current="account.id === instancesStore.activeAccount?.id ? 'true' : undefined"
                @click="selectAccount(account.id)"
              >
                <span class="acct-sheet__avatar-ring">
                  <img
                    v-if="account.user?.avatar"
                    :src="account.user.avatar"
                    alt=""
                    class="acct-sheet__avatar-img"
                  />
                  <span
                    v-if="account.id === instancesStore.activeAccount?.id"
                    class="acct-sheet__avatar-check"
                    aria-hidden="true"
                  >
                    <NeoIcon name="check" :size="14" :stroke="2.5" />
                  </span>
                </span>
                <span class="acct-sheet__avatar-name">
                  {{ account.user?.displayName || account.user?.username }}
                </span>
                <span class="acct-sheet__avatar-host">{{ hostOf(account) }}</span>
              </button>
            </li>

            <li>
              <button
                type="button"
                class="acct-sheet__avatar-btn acct-sheet__avatar-btn--add"
                @click="addAccount"
              >
                <span class="acct-sheet__avatar-ring acct-sheet__avatar-ring--add">
                  <NeoIcon name="plus" :size="22" :stroke="2" />
                </span>
                <span class="acct-sheet__avatar-name">Add</span>
                <span class="acct-sheet__avatar-host">server</span>
              </button>
            </li>
          </ul>

          <ul v-else class="acct-sheet__list">
            <li v-for="account in accounts" :key="account.id">
              <button
                type="button"
                class="acct-sheet__row"
                :class="{ 'acct-sheet__row--active': account.id === instancesStore.activeAccount?.id }"
                :aria-current="account.id === instancesStore.activeAccount?.id ? 'true' : undefined"
                @click="selectAccount(account.id)"
              >
                <img
                  v-if="account.user?.avatar"
                  :src="account.user.avatar"
                  alt=""
                  class="acct-sheet__row-avatar"
                />
                <span class="acct-sheet__row-text">
                  <span class="acct-sheet__row-name">
                    {{ account.user?.displayName || account.user?.username }}
                    <span v-if="isPrimary(account)" class="acct-sheet__pill">Main</span>
                  </span>
                  <span class="acct-sheet__row-handle">{{ handleOf(account) }}</span>
                </span>
                <span
                  v-if="account.id === instancesStore.activeAccount?.id"
                  class="acct-sheet__row-check"
                  aria-hidden="true"
                >
                  <NeoIcon name="check" :size="18" :stroke="2.5" />
                </span>
              </button>
            </li>
          </ul>

          <div class="acct-sheet__actions">
            <button type="button" class="acct-sheet__action" @click="goProfile">
              View profile
            </button>
            <button
              v-if="multi && instancesStore.activeAccount && !isPrimary(instancesStore.activeAccount)"
              type="button"
              class="acct-sheet__action"
              @click="makeMain(instancesStore.activeAccount.id)"
            >
              Make this main
            </button>
            <button
              v-if="accounts.length > 4"
              type="button"
              class="acct-sheet__action"
              @click="addAccount"
            >
              Add another server
            </button>
            <button type="button" class="acct-sheet__action" @click="manage">
              Manage servers
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss">
.acct-switch__toast {
  position: fixed;
  left: 50%;
  bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 320;
  white-space: nowrap;
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--neo-text-primary) 16%, transparent);
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  pointer-events: none;

  @media (min-width: 1024px) {
    bottom: 2rem;
  }
}

.acct-sheet {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: flex-end;
  justify-content: center;

  @media (min-width: 1024px) {
    align-items: center;
    padding: 1.5rem;
  }
}

.acct-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: color-mix(in srgb, var(--neo-text-primary) 42%, transparent);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.acct-sheet__panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  max-height: min(88dvh, 640px);
  overflow-y: auto;
  padding: 0.35rem 1rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
  background: var(--neo-bg-primary);
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -8px 40px color-mix(in srgb, var(--neo-text-primary) 18%, transparent);

  @media (min-width: 1024px) {
    border-radius: 18px;
    padding-bottom: 1.25rem;
    box-shadow: 0 16px 48px color-mix(in srgb, var(--neo-text-primary) 20%, transparent);
  }
}

.acct-sheet__handle {
  width: 36px;
  height: 4px;
  margin: 0.35rem auto 0.85rem;
  border-radius: 999px;
  background: var(--neo-border-color-dark, var(--neo-border-color));

  @media (min-width: 1024px) {
    display: none;
  }
}

.acct-sheet__header {
  text-align: center;
  margin-bottom: 1.15rem;
}

.acct-sheet__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--neo-text-primary);
}

.acct-sheet__subtitle {
  margin: 0.35rem auto 0;
  max-width: 20rem;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--neo-text-muted);
}

.acct-sheet__avatars {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1rem 1.15rem;
  margin: 0;
  padding: 0.25rem 0.25rem 1.15rem;
  list-style: none;

  > li {
    margin: 0;
    padding: 0;
  }
}

.acct-sheet__avatar-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  width: 5.5rem;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  -webkit-tap-highlight-color: transparent;

  &:active .acct-sheet__avatar-ring {
    transform: scale(0.96);
  }
}

.acct-sheet__avatar-ring {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  padding: 2px;
  border: 2px solid transparent;
  transition: transform 0.12s ease, border-color 0.15s ease;

  .acct-sheet__avatar-btn--active & {
    border-color: var(--neo-text-primary);
  }

  &--add {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--neo-bg-tertiary);
    border-color: var(--neo-border-color);
    color: var(--neo-text-secondary);
  }
}

.acct-sheet__avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  background: var(--neo-bg-tertiary);
}

.acct-sheet__avatar-check {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--neo-text-primary);
  color: var(--neo-bg-primary);
  border: 2px solid var(--neo-bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.acct-sheet__avatar-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.acct-sheet__avatar-host {
  font-size: 0.6875rem;
  color: var(--neo-text-muted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  margin-top: -0.2rem;
}

.acct-sheet__list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0 0 0.75rem;
  padding: 0;
  list-style: none;

  > li {
    margin: 0;
    padding: 0;
  }
}

.acct-sheet__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.65rem 0.5rem;
  border: none;
  border-radius: 12px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;

  &:hover,
  &--active {
    background: var(--neo-bg-hover);
  }
}

.acct-sheet__row-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.acct-sheet__row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.acct-sheet__row-name {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
}

.acct-sheet__row-handle {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acct-sheet__row-check {
  color: var(--neo-text-primary);
  flex-shrink: 0;
}

.acct-sheet__pill {
  flex-shrink: 0;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--neo-accent) 18%, transparent);
  color: var(--neo-accent);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.acct-sheet__actions {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--neo-border-color);
  padding-top: 0.35rem;
}

.acct-sheet__action {
  width: 100%;
  padding: 0.85rem 0.5rem;
  border: none;
  border-radius: 10px;
  background: transparent;
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  text-align: center;
  cursor: pointer;

  &:hover {
    background: var(--neo-bg-hover);
  }
}

.acct-sheet-enter-active,
.acct-sheet-leave-active {
  transition: opacity 0.2s ease;

  .acct-sheet__panel {
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  }
}

.acct-sheet-enter-from,
.acct-sheet-leave-to {
  opacity: 0;

  .acct-sheet__panel {
    transform: translateY(18px);

    @media (min-width: 1024px) {
      transform: translateY(8px) scale(0.98);
    }
  }
}

.acct-toast-enter-active,
.acct-toast-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.acct-toast-enter-from,
.acct-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}

html.acct-sheet-open {
  overflow: hidden;
}
</style>
