<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import type { SettingsTopic } from '~/utils/serverCapabilities'
import { useWebPush } from '~/composables/useWebPush'

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const toastStore = useToastStore()
const serverLink = (topic: SettingsTopic) => instancesStore.serverSettingsLink(topic)
const { supported, enabled, busy, error, enable, disable, refreshSupport } = useWebPush()

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
        This browser can’t receive web push. Try installing LoomSpace as an app, or use Chrome / Edge / Firefox.
      </p>
    </div>

    <div class="settings-group">
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
