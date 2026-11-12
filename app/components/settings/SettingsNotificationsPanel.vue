<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import type { SettingsTopic } from '~/utils/serverCapabilities'
import { useWebPush } from '~/composables/useWebPush'
import { isNativeShell } from '~/utils/nativeShell'

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const toastStore = useToastStore()
const serverLink = (topic: SettingsTopic) => instancesStore.serverSettingsLink(topic)
const { supported, enabled, busy, error, enable, disable, refreshSupport } = useWebPush()
const nativeShell = isNativeShell()

onMounted(() => refreshSupport())

const togglePush = async () => {
  const ok = enabled.value ? await disable() : await enable()
  if (ok) {
    toastStore.show({
      message: enabled.value ? 'Activity push on' : 'Activity push off',
      duration: 2800,
    })
  } else if (error.value) {
    toastStore.show({ message: error.value, duration: 4200 })
  }
}
</script>

<template>
  <section class="settings-section">
    <SettingsSectionHeader :category="settingsStore.currentCategory" />

    <SettingsSignedOut
      v-if="!instancesStore.hasAuthenticatedInstance"
      title="Notifications follow your account"
      body="Sign in to manage Activity push and open your server’s notification settings."
    />

    <div
      v-if="instancesStore.hasAuthenticatedInstance && supported"
      class="settings-group"
    >
      <p class="settings-hint">
        Get system notifications for mentions, follows, likes, and boosts while LoomSpace is closed.
      </p>
      <button
        type="button"
        class="settings-btn"
        :class="enabled ? 'settings-btn--primary' : 'settings-btn--secondary'"
        :disabled="busy"
        @click="togglePush"
      >
        {{ busy ? 'Working…' : enabled ? 'Turn off Activity push' : 'Enable Activity push' }}
      </button>
      <p v-if="error" class="settings-hint settings-hint--warn">{{ error }}</p>
    </div>
    <div
      v-else-if="instancesStore.hasAuthenticatedInstance && !supported"
      class="settings-group"
    >
      <p class="settings-hint">
        <template v-if="nativeShell">
          Activity push isn’t available in the App Store build yet — check Notifications on your Mastodon
          server, or use LoomSpace in a desktop browser for web push.
        </template>
        <template v-else>
          This browser can’t receive web push. Try installing LoomSpace as an app, or use Chrome / Edge /
          Firefox.
        </template>
      </p>
    </div>

    <div v-if="instancesStore.hasAuthenticatedInstance" class="settings-group">
      <p class="settings-hint">
        Fine-grained filters (who can notify you, email digests) still live on your instance.
      </p>

      <a
        v-if="serverLink('notifications')"
        :href="serverLink('notifications')!"
        target="_blank"
        rel="noopener noreferrer"
        class="settings-btn settings-btn--primary"
      >
        Open Instance Notification Settings →
      </a>
      <p v-else-if="instancesStore.instanceUrl" class="settings-hint">
        Open your server's own website to change notification preferences.
      </p>
    </div>
  </section>
</template>

<style lang="scss" scoped>
@use '~/assets/css/settingsPanel' as panel;

@include panel.shared;
</style>
