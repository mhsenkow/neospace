<script setup lang="ts">
import type { CuratedInstance } from '~/composables/useCuratedInstances'
import { useInstancesStore } from '~/stores/instances'

const props = defineProps<{
  instance: CuratedInstance
}>()

const emit = defineEmits<{
  visit: [domain: string]
}>()

const instancesStore = useInstancesStore()

// Fetch live data on mount
const liveData = ref<any>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    liveData.value = await instancesStore.fetchInstanceInfo(props.instance.domain)
  } finally {
    loading.value = false
  }
})

const handleVisit = () => {
  emit('visit', props.instance.domain)
}
</script>

<template>
  <article 
    class="instance-card"
    :style="{ '--accent': instance.color }"
  >
    <div class="card-header">
      <span class="emoji">{{ instance.emoji }}</span>
      <div class="header-text">
        <h3>{{ instance.name }}</h3>
        <span class="domain">{{ instance.domain }}</span>
      </div>
    </div>

    <p class="vibe">{{ instance.vibe }}</p>
    <p class="description">{{ instance.description }}</p>

    <div class="stats" v-if="liveData?.stats">
      <div class="stat">
        <span class="stat-value">{{ liveData.stats.userCount?.toLocaleString() || '?' }}</span>
        <span class="stat-label">active users</span>
      </div>
      <div class="stat" v-if="liveData.registrations !== undefined">
        <span class="stat-value">{{ liveData.registrations ? '✓' : '✗' }}</span>
        <span class="stat-label">{{ liveData.registrations ? 'open' : 'closed' }}</span>
      </div>
    </div>

    <div class="card-actions">
      <button class="visit-btn" @click="handleVisit">
        <span>Visit</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
    </div>

    <div class="accent-bar" />
  </article>
</template>

<style scoped lang="scss">
.instance-card {
  --accent: #6364ff;
  
  position: relative;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  }
}

.card-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.emoji {
  font-size: 2.5rem;
  line-height: 1;
}

.header-text {
  h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-color);
  }

  .domain {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
}

.vibe {
  display: inline-block;
  background: var(--accent);
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.75rem;
  border-radius: 100px;
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.description {
  color: var(--text-muted);
  font-size: 0.95rem;
  line-height: 1.5;
  margin-bottom: 1rem;
}

.stats {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.stat {
  display: flex;
  flex-direction: column;
  
  .stat-value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-color);
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
}

.card-actions {
  display: flex;
  justify-content: flex-end;
}

.visit-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--accent);
  color: white;
  border: none;
  padding: 0.75rem 1.25rem;
  border-radius: 100px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;

  &:hover {
    opacity: 0.9;
    transform: scale(1.02);
  }

  svg {
    transition: transform 0.15s ease;
  }

  &:hover svg {
    transform: translateX(3px);
  }
}

.accent-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--accent);
}
</style>

