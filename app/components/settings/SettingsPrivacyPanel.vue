<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'

const emit = defineEmits<{ 'update:dirty': [boolean] }>()
const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const toastStore = useToastStore()

const locked = ref(false)
const lockedBaseline = ref(false)
const privacyDirty = computed(() => locked.value !== lockedBaseline.value)

watch(
  () => settingsStore.account,
  (account) => {
    locked.value = account?.locked || false
    lockedBaseline.value = locked.value
  },
  { immediate: true },
)

watch(privacyDirty, (dirty) => emit('update:dirty', dirty), { immediate: true })

const privacyListsLoaded = ref(false)

const loadLists = async () => {
  if (privacyListsLoaded.value) return
  privacyListsLoaded.value = true
  await Promise.all([
    settingsStore.loadMutedAccounts(),
    settingsStore.loadBlockedAccounts(),
    settingsStore.loadBlockedDomains(),
  ])
}

watch(
  () => settingsStore.activeCategory,
  async (cat) => {
    if (cat === 'privacy') await loadLists()
  },
  { immediate: true },
)

watch(
  () => instancesStore.activeAccountId,
  async () => {
    settingsStore.clearModerationLists()
    privacyListsLoaded.value = false
    if (settingsStore.isOpen && settingsStore.activeCategory === 'privacy') {
      await loadLists()
    }
  },
)

const savePrivacy = async () => {
  if (!settingsStore.account) return
  try {
    await settingsStore.updateProfile({ locked: locked.value })
  } catch {
    return
  }
  lockedBaseline.value = locked.value
  settingsStore.clearSuccess()
}

const runModeration = (action: () => Promise<unknown>) => {
  action().catch(() => {})
}

const newBlockDomain = ref('')
const isBlockingDomain = ref(false)

const submitBlockDomain = async () => {
  const domain = newBlockDomain.value.trim()
  if (!domain) return
  isBlockingDomain.value = true
  try {
    await settingsStore.blockDomain(domain)
    newBlockDomain.value = ''
    toastStore.show({ message: `Blocked ${domain}`, duration: 2500 })
  } catch {
    /* store sets error */
  } finally {
    isBlockingDomain.value = false
  }
}
</script>

<template>
  <section class="settings-section">
    <SettingsSectionHeader :category="settingsStore.currentCategory" />

    <div class="settings-group">
      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Post Privacy</legend>
        <label class="settings-toggle">
          <div class="settings-toggle__info">
            <span class="settings-toggle__label">Require follow approval</span>
            <span class="settings-toggle__desc">New followers must be approved</span>
          </div>
          <input v-model="locked" type="checkbox" class="settings-checkbox" />
        </label>

        <div class="settings-actions" style="margin-top: 1rem;">
          <button
            class="settings-btn settings-btn--primary"
            :disabled="settingsStore.isSaving || !privacyDirty || !settingsStore.account"
            @click="savePrivacy"
          >
            {{ settingsStore.isSaving ? 'Saving...' : 'Save Privacy' }}
          </button>
        </div>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Muted Accounts</legend>
        <p class="settings-hint">Accounts you've muted won't appear in your timelines.</p>

        <div v-if="settingsStore.isLoadingMuted && !settingsStore.mutedAccounts.length" class="settings-empty" aria-busy="true">
          Loading muted accounts…
        </div>
        <div v-else-if="settingsStore.mutedAccounts.length === 0" class="settings-empty">
          No muted accounts
        </div>
        <div v-else class="settings-account-list">
          <div
            v-for="account in settingsStore.mutedAccounts"
            :key="account.id"
            class="settings-account-item"
          >
            <img :src="account.avatar" alt="" class="settings-account-avatar" />
            <div class="settings-account-info">
              <span class="settings-account-name">{{ account.displayName || account.username }}</span>
              <span class="settings-account-handle">@{{ account.acct }}</span>
            </div>
            <button
              class="settings-btn settings-btn--small"
              type="button"
              :aria-label="`Unmute @${account.acct}`"
              :disabled="settingsStore.isModerationPending('unmute', account.id)"
              @click="runModeration(() => settingsStore.unmuteAccount(account.id))"
            >
              {{ settingsStore.isModerationPending('unmute', account.id) ? 'Unmuting…' : 'Unmute' }}
            </button>
          </div>
        </div>

        <button
          v-if="settingsStore.hasMoreMuted"
          class="settings-btn settings-btn--ghost"
          :disabled="settingsStore.isLoadingMuted"
          @click="settingsStore.loadMutedAccounts({ more: true })"
        >
          {{ settingsStore.isLoadingMuted ? 'Loading…' : 'Load more muted accounts' }}
        </button>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Blocked Accounts</legend>
        <p class="settings-hint">Blocked accounts cannot follow you or see your posts.</p>

        <div v-if="settingsStore.isLoadingBlocked && !settingsStore.blockedAccounts.length" class="settings-empty" aria-busy="true">
          Loading blocked accounts…
        </div>
        <div v-else-if="settingsStore.blockedAccounts.length === 0" class="settings-empty">
          No blocked accounts
        </div>
        <div v-else class="settings-account-list">
          <div
            v-for="account in settingsStore.blockedAccounts"
            :key="account.id"
            class="settings-account-item"
          >
            <img :src="account.avatar" alt="" class="settings-account-avatar" />
            <div class="settings-account-info">
              <span class="settings-account-name">{{ account.displayName || account.username }}</span>
              <span class="settings-account-handle">@{{ account.acct }}</span>
            </div>
            <button
              class="settings-btn settings-btn--small"
              type="button"
              :aria-label="`Unblock @${account.acct}`"
              :disabled="settingsStore.isModerationPending('unblock', account.id)"
              @click="runModeration(() => settingsStore.unblockAccount(account.id))"
            >
              {{ settingsStore.isModerationPending('unblock', account.id) ? 'Unblocking…' : 'Unblock' }}
            </button>
          </div>
        </div>

        <button
          v-if="settingsStore.hasMoreBlocked"
          class="settings-btn settings-btn--ghost"
          :disabled="settingsStore.isLoadingBlocked"
          @click="settingsStore.loadBlockedAccounts({ more: true })"
        >
          {{ settingsStore.isLoadingBlocked ? 'Loading…' : 'Load more blocked accounts' }}
        </button>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Blocked Domains</legend>
        <p class="settings-hint">Block every account from a server domain.</p>
        <form class="settings-inline-form" @submit.prevent="submitBlockDomain">
          <label class="sr-only" for="settings-block-domain">Domain to block</label>
          <input
            id="settings-block-domain"
            v-model="newBlockDomain"
            type="text"
            class="settings-input"
            placeholder="example.social"
            :disabled="isBlockingDomain"
          />
          <button
            type="submit"
            class="settings-btn settings-btn--primary"
            :disabled="isBlockingDomain || !newBlockDomain.trim()"
          >
            {{ isBlockingDomain ? 'Blocking…' : 'Block domain' }}
          </button>
        </form>
        <div v-if="settingsStore.blockedDomains.length === 0" class="settings-empty">
          No blocked domains
        </div>
        <div v-else class="settings-account-list">
          <div
            v-for="domain in settingsStore.blockedDomains"
            :key="domain"
            class="settings-account-item"
          >
            <div class="settings-account-info">
              <span class="settings-account-name">{{ domain }}</span>
            </div>
            <button
              class="settings-btn settings-btn--small"
              type="button"
              :aria-label="`Unblock ${domain}`"
              :disabled="settingsStore.isModerationPending('unblock-domain', domain)"
              @click="runModeration(() => settingsStore.unblockDomain(domain))"
            >
              {{ settingsStore.isModerationPending('unblock-domain', domain) ? 'Unblocking…' : 'Unblock' }}
            </button>
          </div>
        </div>
      </fieldset>
    </div>
  </section>
</template>
