<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useOverlayStore } from '~/stores/overlay'
import { useToastStore } from '~/stores/toast'
import type { SettingsTopic } from '~/utils/serverCapabilities'

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const overlayStore = useOverlayStore()
const toastStore = useToastStore()
const router = useRouter()

const serverLink = (topic: SettingsTopic) => instancesStore.serverSettingsLink(topic)
const linkedAccounts = computed(() => instancesStore.authenticatedInstances)
const {
  isAndroid,
  isIos,
  alreadyInstalled,
  canNativeInstall,
  installNative,
} = useInstallApp()

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

    <div class="settings-group">
      <h3 class="settings-subheading">Connected Account</h3>

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
              @{{ acct.user?.acct || acct.url.replace(/^https?:\/\//, '') }}
            </span>
          </div>
          <span
            v-if="acct.id === instancesStore.activeAccountId"
            class="settings-linked-item__badge"
          >Active</span>
        </li>
      </ul>
      <p v-else class="settings-hint">No signed-in accounts.</p>
      <NuxtLink
        to="/login"
        class="settings-btn settings-btn--ghost"
        @click="settingsStore.close()"
      >
        Add account
      </NuxtLink>

      <div class="settings-divider" />

      <h3 class="settings-subheading">Install app</h3>
      <p v-if="alreadyInstalled" class="settings-hint">
        NeoSpace is already installed on this device.
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
                  : 'Install NeoSpace on a phone for the app experience.'
          }}
        </p>
        <button
          v-if="canNativeInstall"
          type="button"
          class="settings-btn settings-btn--primary"
          @click="installNative"
        >
          Install NeoSpace
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

      <h3 class="settings-subheading">Sign out</h3>
      <p class="settings-hint">Revoke tokens and leave NeoSpace on this device.</p>
      <button
        type="button"
        class="settings-btn settings-btn--ghost"
        @click="signOutAll"
      >
        Sign out all accounts
      </button>
      <button
        type="button"
        class="settings-btn settings-btn--danger"
        @click="clearDeviceData"
      >
        Clear data on this device
      </button>

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
        This server's account settings page isn't known to NeoSpace — visit
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
    </div>
  </section>
</template>
