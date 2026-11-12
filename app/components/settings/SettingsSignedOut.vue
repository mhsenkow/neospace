<script setup lang="ts">
/**
 * Guest empty-state for settings that live on a Mastodon account.
 */
import { useSettingsStore } from '~/stores/settings'

defineProps<{
  title?: string
  body?: string
}>()

const settingsStore = useSettingsStore()
const router = useRouter()

const signIn = () => {
  settingsStore.close()
  router.push('/login')
}
</script>

<template>
  <div class="settings-signed-out">
    <p class="settings-signed-out__title">{{ title || 'Sign in to continue' }}</p>
    <p class="settings-signed-out__body">
      {{ body || 'This setting lives on your Mastodon account.' }}
    </p>
    <button type="button" class="settings-btn settings-btn--primary" @click="signIn">
      Sign in
    </button>
  </div>
</template>

<style lang="scss" scoped>
@use '~/assets/css/settingsPanel' as panel;

@include panel.shared;
</style>
