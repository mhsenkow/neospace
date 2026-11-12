<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore, type ConnectedInstance } from '~/stores/instances'
import { useOverlayStore } from '~/stores/overlay'
import { useToastStore } from '~/stores/toast'
import { useAccountsManager } from '~/composables/useAccountsManager'
import { instanceHandle, switchActiveAccount } from '~/composables/useSwitchAccount'
import { friendlyServerError } from '~/utils/instances'
import { openOAuthAuthorize } from '~/utils/nativeAuth'
import { sanitizeReturnTo } from '~/utils/oauthPkce'
import type { SettingsTopic } from '~/utils/serverCapabilities'

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const overlayStore = useOverlayStore()
const toastStore = useToastStore()
const { open: openAccounts } = useAccountsManager()
const router = useRouter()
const route = useRoute()

const serverLink = (topic: SettingsTopic) => instancesStore.serverSettingsLink(topic)
/** Include expired sessions so Settings can offer Sign in again */
const linkedAccounts = computed(() => instancesStore.signedInInstances)
const {
  isAndroid,
  isIos,
  alreadyInstalled,
  canNativeInstall,
  installNative,
} = useInstallApp()

const handleOf = instanceHandle
const isExpired = (acct: ConnectedInstance) =>
  !!acct.sessionExpired || (!acct.accessToken && !!acct.user)
const isPrimary = (acct: ConnectedInstance) =>
  acct.id === (instancesStore.primaryAccount?.id ?? null)

const useForPosting = (acct: ConnectedInstance) => {
  if (isExpired(acct)) return
  switchActiveAccount(acct.id)
}

const makeMain = (acct: ConnectedInstance) => {
  if (isExpired(acct)) return
  instancesStore.setPrimaryAccount(acct.id)
  toastStore.show({
    message: `${handleOf(acct)} is now your main account — LoomSpace opens as it`,
  })
}

const reauthBusy = ref<Record<string, boolean>>({})

const reauthAccount = async (acct: ConnectedInstance) => {
  if (reauthBusy.value[acct.id]) return
  reauthBusy.value = { ...reauthBusy.value, [acct.id]: true }
  try {
    const returnTo = sanitizeReturnTo(route.fullPath) || '/'
    const authUrl = await instancesStore.startAuth(acct.id, {
      addMode: true,
      returnTo,
    })
    settingsStore.close()
    await openOAuthAuthorize(authUrl)
  } catch (e) {
    toastStore.show({ message: friendlyServerError(e), kind: 'error' })
    const row = instancesStore.instances.find((i) => i.id === acct.id)
    if (row) row.isConnecting = false
  } finally {
    const next = { ...reauthBusy.value }
    delete next[acct.id]
    reauthBusy.value = next
  }
}

const manageServers = () => {
  settingsStore.close()
  openAccounts()
}

const addAccount = () => {
  settingsStore.close()
  const returnTo = sanitizeReturnTo(route.fullPath) || '/'
  router.push(`/login?add=1&returnTo=${encodeURIComponent(returnTo)}`)
}

const signOutAll = async () => {
  const ok = await overlayStore.openConfirm({
    title: 'Sign out of all accounts?',
    body: 'You will need to sign in again on each instance.',
    confirmLabel: 'Sign out all',
    danger: true,
  })
  if (!ok) return
  await instancesStore.logoutAll()
  settingsStore.close()
  toastStore.show({ message: 'Signed out of all accounts', duration: 2500 })
  router.push('/login')
}

const clearDeviceData = async () => {
  const ok = await overlayStore.openConfirm({
    title: 'Clear data on this device?',
    body: 'Removes local drafts, settings, columns, and cached accounts from this browser. Remote posts are not deleted.',
    confirmLabel: 'Clear data',
    danger: true,
  })
  if (!ok) return
  await instancesStore.logoutAll()
  instancesStore.clearLocalDeviceData()
  settingsStore.close()
  toastStore.show({ message: 'Local data cleared', duration: 2500 })
  router.push('/login')
}
</script>

<template>
  <section class="settings-section">
    <SettingsSectionHeader :category="settingsStore.currentCategory" />

    <SettingsSignedOut
      v-if="!linkedAccounts.length"
      title="No account on this device"
      body="Sign in to a Mastodon server to sync profile, privacy, and posting defaults."
    />

    <div class="settings-group">
      <template v-if="linkedAccounts.length">
      <h3 class="settings-subheading">Connected account</h3>

      <div v-if="settingsStore.account" class="settings-account-card">
        <img :src="settingsStore.account.avatar" alt="" class="settings-account-card__avatar" />
        <div class="settings-account-card__info">
          <span class="settings-account-card__name">
            {{ settingsStore.account.displayName || settingsStore.account.username }}
          </span>
          <span class="settings-account-card__handle">
            @{{ settingsStore.account.acct }}
          </span>
          <span class="settings-account-card__instance">
            {{ instancesStore.instanceUrl?.replace('https://', '') }}
          </span>
        </div>
      </div>

      <h3 class="settings-subheading">Linked accounts</h3>
      <ul v-if="linkedAccounts.length" class="settings-linked-list">
        <li
          v-for="acct in linkedAccounts"
          :key="acct.id"
          class="settings-linked-item"
        >
          <img
            v-if="acct.user?.avatar"
            :src="acct.user.avatar"
            alt=""
            class="settings-linked-item__avatar"
          />
          <div class="settings-linked-item__info">
            <span class="settings-linked-item__name">
              {{ acct.user?.displayName || acct.user?.username || 'Account' }}
            </span>
            <span class="settings-linked-item__handle">
              {{ handleOf(acct) }}
            </span>
            <div class="settings-linked-item__actions">
              <button
                v-if="isExpired(acct)"
                type="button"
                class="settings-linked-item__action"
                :disabled="reauthBusy[acct.id]"
                @click="reauthAccount(acct)"
              >
                {{ reauthBusy[acct.id] ? 'Opening…' : 'Sign in again' }}
              </button>
              <template v-else>
                <button
                  v-if="acct.id !== instancesStore.activeAccountId"
                  type="button"
                  class="settings-linked-item__action"
                  @click="useForPosting(acct)"
                >
                  Use for posting
                </button>
                <button
                  v-if="!isPrimary(acct)"
                  type="button"
                  class="settings-linked-item__action"
                  @click="makeMain(acct)"
                >
                  Make main
                </button>
              </template>
              <button
                type="button"
                class="settings-linked-item__action"
                @click="manageServers"
              >
                Manage servers
              </button>
            </div>
          </div>
          <span
            v-if="isExpired(acct)"
            class="settings-linked-item__badge settings-linked-item__badge--expired"
          >Expired</span>
          <span
            v-else-if="acct.id === instancesStore.activeAccountId"
            class="settings-linked-item__badge"
          >Active</span>
          <span
            v-else-if="isPrimary(acct)"
            class="settings-linked-item__badge settings-linked-item__badge--main"
          >Main</span>
        </li>
      </ul>
      <button
        type="button"
        class="settings-btn settings-btn--ghost"
        @click="addAccount"
      >
        Add account
      </button>

      <div class="settings-divider" />
      </template>

      <h3 class="settings-subheading">Install app</h3>
      <p v-if="alreadyInstalled" class="settings-hint">
        LoomSpace is already installed on this device.
      </p>
      <template v-else>
        <p class="settings-hint">
          {{
            canNativeInstall
              ? 'Install for a full-screen home-screen app.'
              : isAndroid
                ? 'Chrome often hides Install in ⋮ — use Add to Home screen, or tap below if Chrome offers a prompt.'
                : isIos
                  ? 'In Safari: Share → Add to Home Screen.'
                  : 'Install LoomSpace on a phone for the app experience.'
          }}
        </p>
        <button
          v-if="canNativeInstall"
          type="button"
          class="settings-btn settings-btn--primary"
          @click="installNative"
        >
          Install LoomSpace
        </button>
        <ol v-if="isAndroid && !canNativeInstall" class="settings-install-steps">
          <li>Open neospace.ibm.io in the <strong>Chrome</strong> app.</li>
          <li>Tap <strong>⋮</strong> → <strong>Add to Home screen</strong> (or Install app / Add to…).</li>
          <li>Confirm to pin the icon.</li>
        </ol>
        <ol v-else-if="isIos" class="settings-install-steps">
          <li>Open in <strong>Safari</strong>.</li>
          <li><strong>Share</strong> → <strong>Add to Home Screen</strong>.</li>
        </ol>
      </template>

      <div class="settings-divider" />

      <template v-if="linkedAccounts.length">
      <h3 class="settings-subheading">Sign out</h3>
      <p class="settings-hint">Revoke tokens and leave LoomSpace on this device.</p>
      <button
        type="button"
        class="settings-btn settings-btn--ghost"
        @click="signOutAll"
      >
        Sign out all accounts
      </button>
      </template>
      <button
        type="button"
        class="settings-btn settings-btn--danger"
        @click="clearDeviceData"
      >
        Clear data on this device
      </button>

      <template v-if="linkedAccounts.length">
      <div class="settings-divider" />

      <h3 class="settings-subheading">Instance Settings</h3>
      <p class="settings-hint">
        Advanced account settings like email, password, and two-factor authentication
        are managed on your instance.
      </p>

      <a
        v-if="serverLink('account')"
        :href="serverLink('account')!"
        target="_blank"
        rel="noopener noreferrer"
        class="settings-btn settings-btn--primary"
      >
        Open Instance Settings →
      </a>
      <p v-else-if="instancesStore.instanceUrl" class="settings-hint">
        This server's account settings page isn't known to LoomSpace — visit
        {{ instancesStore.instanceUrl.replace('https://', '') }} directly.
      </p>

      <div class="settings-divider" />

      <h3 class="settings-subheading">Data Export</h3>
      <p class="settings-hint">
        Download your data including posts, followers, and account information.
      </p>

      <a
        v-if="serverLink('export')"
        :href="serverLink('export')!"
        target="_blank"
        rel="noopener noreferrer"
        class="settings-btn settings-btn--ghost"
      >
        Export Data →
      </a>
      </template>
    </div>
  </section>
</template>

<style lang="scss" scoped>
@use '~/assets/css/settingsPanel' as panel;

@include panel.shared;
</style>
