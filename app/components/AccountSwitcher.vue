<script setup lang="ts">
/**
 * Avatar trigger for the Threads-style account switcher sheet.
 * Sheet lives in AccountSwitcherSheet (mounted once in the layout).
 */

import { useInstancesStore } from '~/stores/instances'
import { useAccountSwitcher } from '~/composables/useAccountSwitcher'

const props = withDefaults(
  defineProps<{
    compact?: boolean
    /** mobile bottom nav vs desktop sidebar */
    placement?: 'sidebar' | 'nav'
  }>(),
  { compact: false, placement: 'sidebar' },
)

const instancesStore = useInstancesStore()
const { isOpen: menuOpen, open: openMenu, toggle: toggleMenu } = useAccountSwitcher()
const route = useRoute()
const router = useRouter()

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let pendingNavTimer: ReturnType<typeof setTimeout> | null = null
let longPressFired = false
let lastTapAt = 0

const accounts = computed(() => instancesStore.authenticatedInstances)
const multi = computed(() => accounts.value.length > 1)
const isNav = computed(() => props.placement === 'nav')

const peekAccounts = computed(() => {
  if (!multi.value) return []
  const activeId = instancesStore.activeAccount?.id
  return accounts.value.filter((a) => a.id !== activeId).slice(0, 2)
})

const goProfile = () => {
  router.push('/profile')
}

const cycleAccount = async () => {
  if (!multi.value) return
  instancesStore.cycleActiveAccount()
  const active = instancesStore.activeAccount
  const name =
    active?.user?.displayName || active?.user?.username || active?.name || 'account'
  const { useToastStore } = await import('~/stores/toast')
  useToastStore().show({ message: `Posting as ${name}` })
  if (route.path === '/profile' && !route.query.user) {
    const { useProfileStore } = await import('~/stores/profile')
    await useProfileStore().fetchProfile()
  }
}

const onTriggerClick = (e: MouseEvent) => {
  if (longPressFired) {
    longPressFired = false
    e.preventDefault()
    return
  }

  // Nav + multi: delay profile so double-tap can cycle; single tap → profile
  // Long-press opens the sheet (Threads pattern)
  if (isNav.value && multi.value) {
    const now = Date.now()
    if (now - lastTapAt < 320) {
      lastTapAt = 0
      if (pendingNavTimer) {
        clearTimeout(pendingNavTimer)
        pendingNavTimer = null
      }
      e.preventDefault()
      void cycleAccount()
      return
    }
    lastTapAt = now
    if (pendingNavTimer) clearTimeout(pendingNavTimer)
    pendingNavTimer = setTimeout(() => {
      pendingNavTimer = null
      goProfile()
    }, 320)
    return
  }

  if (isNav.value) {
    goProfile()
    return
  }

  // Sidebar: tap opens switcher sheet
  toggleMenu()
}

const clearLongPress = () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

const onPointerDown = () => {
  longPressFired = false
  clearLongPress()
  longPressTimer = setTimeout(() => {
    longPressFired = true
    if (pendingNavTimer) {
      clearTimeout(pendingNavTimer)
      pendingNavTimer = null
    }
    openMenu()
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(12)
      } catch {
        /* ignore */
      }
    }
  }, 380)
}

const onPointerUp = () => clearLongPress()
const onPointerLeave = () => clearLongPress()

onUnmounted(() => {
  clearLongPress()
  if (pendingNavTimer) clearTimeout(pendingNavTimer)
})
</script>

<template>
  <div
    class="acct-switch"
    :class="{
      'acct-switch--compact': compact || isNav,
      'acct-switch--nav': isNav,
    }"
  >
    <button
      type="button"
      class="acct-switch__trigger"
      :class="{ active: route.path === '/profile' || menuOpen }"
      :title="
        multi
          ? 'Profile · hold to switch accounts · double-tap to cycle'
          : 'Profile'
      "
      :aria-label="multi ? 'Profile, hold to switch accounts' : 'Profile'"
      :aria-expanded="menuOpen"
      aria-haspopup="dialog"
      @click="onTriggerClick"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="onPointerLeave"
      @pointerleave="onPointerLeave"
      @contextmenu.prevent="openMenu"
    >
      <span class="acct-switch__stack" aria-hidden="true">
        <img
          v-for="(peek, i) in peekAccounts"
          :key="peek.id"
          :src="peek.user?.avatar"
          alt=""
          class="acct-switch__avatar acct-switch__avatar--peek"
          :style="{ '--peek-i': i }"
        />
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
      </span>
      <span v-if="multi" class="acct-switch__count" aria-hidden="true">{{ accounts.length }}</span>
      <span v-if="isNav" class="acct-switch__label">You</span>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.acct-switch {
  position: relative;
}

.acct-switch__trigger {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  -webkit-touch-callout: none;
  user-select: none;
  transition: background-color var(--neo-transition-fast);

  &:hover,
  &.active {
    background: var(--neo-bg-hover);
  }

  &.active .acct-switch__avatar {
    border-color: var(--neo-accent);
  }
}

.acct-switch--nav .acct-switch__trigger {
  flex-direction: column;
  gap: 2px;
  width: 52px;
  height: auto;
  min-height: 48px;
  padding: 4px 0 2px;
  border-radius: 4px;
  color: var(--neo-text-secondary);

  &.active {
    background: var(--neo-accent-soft);
    color: var(--neo-accent);
  }
}

.acct-switch__label {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: 0.01em;
}

.acct-switch__stack {
  position: relative;
  display: block;
  width: 28px;
  height: 28px;
}

.acct-switch--nav .acct-switch__stack {
  width: 26px;
  height: 26px;
}

.acct-switch__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid transparent;
  display: block;
  position: relative;
  z-index: 1;
  background: var(--neo-bg-tertiary);

  .acct-switch--nav & {
    width: 26px;
    height: 26px;
  }

  &--peek {
    position: absolute;
    z-index: 0;
    top: calc(-2px - (var(--peek-i, 0) * 2px));
    left: calc(7px + (var(--peek-i, 0) * 5px));
    width: 22px;
    height: 22px;
    opacity: calc(0.9 - (var(--peek-i, 0) * 0.15));
    border-color: var(--neo-bg-primary);
    box-shadow: 0 0 0 1px var(--neo-bg-primary);

    .acct-switch--nav & {
      width: 20px;
      height: 20px;
      left: calc(6px + (var(--peek-i, 0) * 4px));
    }
  }

  &--placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--neo-text-muted);
  }
}

.acct-switch__count {
  position: absolute;
  right: 0;
  bottom: 0;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--neo-accent);
  color: var(--neo-text-on-accent, #fff);
  border: 1.5px solid var(--neo-bg-primary);
  font-size: 0.5625rem;
  font-weight: 700;
  line-height: 11px;
  text-align: center;
  z-index: 2;
}
</style>
