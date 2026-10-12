<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import type { SettingsTopic } from '~/utils/serverCapabilities'

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const serverLink = (topic: SettingsTopic) => instancesStore.serverSettingsLink(topic)
</script>

<template>
  <section class="settings-section">
    <SettingsSectionHeader :category="settingsStore.currentCategory" />

    <div class="settings-group">
      <p class="settings-hint">
        Notification preferences are managed on your instance's settings page.
        NeoSpace will respect your instance's notification settings.
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
