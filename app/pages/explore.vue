<script setup lang="ts">
import { useCuratedInstances } from '~/composables/useCuratedInstances'
import { useInstancesStore } from '~/stores/instances'

const { instances, categories, getByCategory } = useCuratedInstances()
const instancesStore = useInstancesStore()

const selectedCategory = ref('all')

const filteredInstances = computed(() => getByCategory(selectedCategory.value))

const handleVisit = (domain: string) => {
  instancesStore.openPreview(domain)
}

// Page meta
useHead({
  title: 'Explore - NeoSpace',
  meta: [
    { name: 'description', content: 'Discover Fediverse communities. Browse instances by vibe and interest.' }
  ]
})
</script>

<template>
  <div class="explore-page">
    <!-- Hero Section -->
    <header class="explore-hero">
      <div class="hero-content">
        <span class="hero-emoji">🏘️</span>
        <h1>Instance Hopper</h1>
        <p class="hero-subtitle">
          The Fediverse is a galaxy of communities. Each instance is a neighborhood with its own vibe, rules, and people. 
          Explore them without leaving NeoSpace.
        </p>
      </div>
      <div class="hero-decoration">
        <div class="orbit orbit-1"></div>
        <div class="orbit orbit-2"></div>
        <div class="orbit orbit-3"></div>
      </div>
    </header>

    <!-- Category Filter -->
    <nav class="category-nav">
      <button
        v-for="cat in categories"
        :key="cat.id"
        :class="['category-btn', { active: selectedCategory === cat.id }]"
        @click="selectedCategory = cat.id"
      >
        <span class="cat-emoji">{{ cat.emoji }}</span>
        <span class="cat-label">{{ cat.label }}</span>
      </button>
    </nav>

    <!-- Instances Grid -->
    <section class="instances-grid">
      <TransitionGroup name="card">
        <InstanceCard
          v-for="instance in filteredInstances"
          :key="instance.domain"
          :instance="instance"
          @visit="handleVisit"
        />
      </TransitionGroup>
    </section>

    <!-- Empty State -->
    <div v-if="filteredInstances.length === 0" class="empty-state">
      <span class="empty-emoji">🔍</span>
      <p>No instances found in this category yet.</p>
    </div>

    <!-- Info Section -->
    <section class="info-section">
      <div class="info-card">
        <h3>🤔 What's an instance?</h3>
        <p>
          The Fediverse is made up of independent servers called "instances." Each one is run by different people 
          with different rules and communities. Unlike Twitter or Facebook, there's no single company in control. 
          You can join any instance and still talk to people on other instances!
        </p>
      </div>
      <div class="info-card">
        <h3>🔗 Already have an account?</h3>
        <p>
          You don't need to join these instances to see their content. If you're already logged into NeoSpace, 
          you can follow anyone from any instance. The Fediverse is all connected!
        </p>
      </div>
    </section>

    <!-- Preview Modal -->
    <InstancePreview />
  </div>
</template>

<style scoped lang="scss">
.explore-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

// Hero Section
.explore-hero {
  position: relative;
  text-align: center;
  padding: 4rem 2rem;
  margin-bottom: 3rem;
  background: linear-gradient(135deg, var(--primary-color) 0%, #4f46e5 100%);
  border-radius: 24px;
  overflow: hidden;
}

.hero-content {
  position: relative;
  z-index: 2;
}

.hero-emoji {
  font-size: 4rem;
  display: block;
  margin-bottom: 1rem;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.explore-hero h1 {
  font-size: 3rem;
  font-weight: 800;
  color: white;
  margin: 0 0 1rem;
  letter-spacing: -0.02em;
}

.hero-subtitle {
  color: rgba(255, 255, 255, 0.85);
  font-size: 1.15rem;
  line-height: 1.6;
  max-width: 600px;
  margin: 0 auto;
}

.hero-decoration {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.orbit {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 50%;

  &.orbit-1 {
    width: 300px;
    height: 300px;
    top: -100px;
    right: -100px;
  }

  &.orbit-2 {
    width: 200px;
    height: 200px;
    bottom: -50px;
    left: -50px;
  }

  &.orbit-3 {
    width: 150px;
    height: 150px;
    top: 50%;
    left: 10%;
    opacity: 0.5;
  }
}

// Category Navigation
.category-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
  margin-bottom: 2.5rem;
}

.category-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  background: var(--card-bg);
  border: 2px solid var(--border-color);
  border-radius: 100px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.9rem;

  .cat-emoji {
    font-size: 1.1rem;
  }

  .cat-label {
    color: var(--text-color);
    font-weight: 500;
  }

  &:hover {
    border-color: var(--primary-color);
    background: var(--bg-color);
  }

  &.active {
    background: var(--primary-color);
    border-color: var(--primary-color);

    .cat-label {
      color: white;
    }
  }
}

// Instances Grid
.instances-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 1.5rem;
  margin-bottom: 3rem;
}

// Card transitions
.card-enter-active,
.card-leave-active {
  transition: all 0.3s ease;
}

.card-enter-from {
  opacity: 0;
  transform: scale(0.95) translateY(10px);
}

.card-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.card-move {
  transition: transform 0.3s ease;
}

// Empty State
.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  color: var(--text-muted);

  .empty-emoji {
    font-size: 3rem;
    display: block;
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  p {
    font-size: 1.1rem;
  }
}

// Info Section
.info-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-top: 2rem;
}

.info-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;

  h3 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
    color: var(--text-color);
  }

  p {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.6;
    font-size: 0.95rem;
  }
}

// Responsive
@media (max-width: 768px) {
  .explore-page {
    padding: 1rem;
  }

  .explore-hero {
    padding: 2.5rem 1.5rem;
  }

  .explore-hero h1 {
    font-size: 2rem;
  }

  .hero-subtitle {
    font-size: 1rem;
  }

  .instances-grid {
    grid-template-columns: 1fr;
  }
}
</style>

