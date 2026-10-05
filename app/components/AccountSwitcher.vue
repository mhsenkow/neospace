<script setup lang="ts">
/**
 * Avatar account switcher — posting-as + manage accounts.
 */

import { useInstancesStore, type ConnectedInstance } from '~/stores/instances'
import { useAccountsManager } from '~/composables/useAccountsManager'

const props = withDefaults(
  defineProps<{
    compact?: boolean
  }>(),
  { compact: false },
)

const instancesStore = useInstancesStore()
const { open: openAccounts } = useAccountsManager()
const route = useRoute()
const router = useRouter()

const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const accounts = computed(() => instancesStore.authenticatedInstances)
const multi = computed(() => accounts.value.length > 1)

const handleOf = (instance: ConnectedInstance) => {
  const acct = instance.user?.acct || instance.user?.username || ''
  const host = instance.url.replace(/^https?:\/\//, '')
  if (acct.includes('@')) return `@${acct}`
  return `@${acct}@${host}`
}

const closeMenu = () => {
  menuOpen.value = false
}

const toggleMenu = () => {
  menuOpen.value = !menuOpen.value
}

const selectAccount = (id: string) => {
  instancesStore.setActiveAccount(id)
  closeMenu()
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

const onDocClick = (e: MouseEvent) => {
  if (!rootRef.value?.contains(e.target as Node)) closeMenu()
}

watch(menuOpen, (open) => {
  if (open) document.addEventListener('click', onDocClick)
  else document.removeEventListener('click', onDocClick)
})

onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="rootRef" class="acct-switch" :class="{ 'acct-switch--compact': compact }">
    <button
      type="button"
      class="acct-switch__trigger"
      :class="{ active: route.path === '/profile' || menuOpen }"
      :title="multi ? 'Switch account' : 'Account'"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      @click="toggleMenu"
    >
      <img
        v-if="instancesStore.userAvatar"
        :src="instancesStore.userAvatar"
        :alt="instancesStore.userDisplayName"
        class="acct-switch__avatar"
      />
      <div v-else class="acct-switch__avatar acct-switch__avatar--placeholder">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <span v-if="multi" class="acct-switch__dot" aria-hidden="true" />
    </button>

    <Transition name="acct-menu">
      <div v-if="menuOpen" class="acct-switch__menu" role="menu">
        <div class="acct-switch__posting">
          <span class="acct-switch__posting-label">Posting as</span>
          <span class="acct-switch__posting-handle">
            {{ instancesStore.activeAccount ? handleOf(instancesStore.activeAccount) : '—' }}
          </span>
        </div>

        <button
          v-for="account in accounts"
          :key="account.id"
          type="button"
          class="acct-switch__item"
          :class="{ 'acct-switch__item--active': account.id === instancesStore.activeAccount?.id }"
          role="menuitem"
          @click="selectAccount(account.id)"
        >
          <img
            v-if="account.user?.avatar"
            :src="account.user.avatar"
            alt=""
            class="acct-switch__item-avatar"
          />
          <div class="acct-switch__item-text">
            <span class="acct-switch__item-name">
              {{ account.user?.displayName || account.user?.username }}
            </span>
            <span class="acct-switch__item-handle">{{ handleOf(account) }}</span>
          </div>
          <span v-if="account.id === instancesStore.activeAccount?.id" class="acct-switch__check" aria-hidden="true">✓</span>
        </button>

        <div class="acct-switch__divider" />

        <button type="button" class="acct-switch__item acct-switch__item--action" role="menuitem" @click="goProfile">
          View profile
        </button>
        <button type="button" class="acct-switch__item acct-switch__item--action" role="menuitem" @click="addAccount">
          Add account
        </button>
        <button type="button" class="acct-switch__item acct-switch__item--action" role="menuitem" @click="manage">
          Accounts &amp; servers
        </button>
      </div>
    </Transition>
  </div>
</template>

<style lang="scss" scoped>
.acct-switch {
  position: relative;
}

.acct-switch__trigger {
  position: relative;
  display: block;
  padding: 4px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  transition: background-color var(--neo-transition-fast);

  &:hover,
  &.active {
    background: var(--neo-bg-hover);
  }

  &.active .acct-switch__avatar {
    border-color: var(--neo-accent);
  }
}

.acct-switch__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid transparent;
  display: block;

  &--placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-muted);
  }
}

.acct-switch__dot {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--neo-accent);
  border: 1.5px solid var(--neo-bg-secondary);
}

.acct-switch__menu {
  position: absolute;
  left: calc(100% + 0.5rem);
  bottom: 0;
  z-index: 200;
  width: 16.5rem;
  padding: 0.5rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 8px;
  box-shadow: 0 10px 28px color-mix(in srgb, var(--neo-text-primary) 14%, transparent);
}

.acct-switch--compact .acct-switch__menu {
  left: auto;
  right: 0;
  bottom: calc(100% + 0.5rem);
}

.acct-switch__posting {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.4rem 0.55rem 0.55rem;
}

.acct-switch__posting-label {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.acct-switch__posting-handle {
  font-size: 0.75rem;
  color: var(--neo-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acct-switch__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  color: var(--neo-text-primary);

  &:hover {
    background: var(--neo-bg-hover);
  }

  &--active {
    background: var(--neo-accent-soft);
  }

  &--action {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--neo-text-secondary);

    &:hover {
      color: var(--neo-text-primary);
    }
  }
}

.acct-switch__item-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.acct-switch__item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.acct-switch__item-name {
  font-size: 0.8125rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acct-switch__item-handle {
  font-size: 0.6875rem;
  color: var(--neo-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acct-switch__check {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--neo-accent);
  font-weight: 700;
}

.acct-switch__divider {
  height: 1px;
  margin: 0.35rem 0;
  background: var(--neo-border-color);
}

.acct-menu-enter-active,
.acct-menu-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.acct-menu-enter-from,
.acct-menu-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
