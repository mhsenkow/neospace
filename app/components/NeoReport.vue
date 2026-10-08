<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOverlayStore, type ReportCategory } from '~/stores/overlay'

const overlay = useOverlayStore()
const dialogRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => overlay.report.open)

const categories: { id: ReportCategory; label: string; hint: string }[] = [
  { id: 'spam', label: 'Spam', hint: 'Unwanted or repetitive content' },
  { id: 'violation', label: 'Policy violation', hint: 'Harassment, hate, or illegal content' },
  { id: 'other', label: 'Something else', hint: 'Other concerns for moderators' },
]

useFocusTrap(dialogRef, isOpen, {
  onEscape: () => overlay.resolveReport(null),
  initialFocus: '.neo-report__category',
})

watch(isOpen, (open) => {
  if (open) overlay.report.comment = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="overlay.report.open"
      class="neo-report-root"
      @click.self="overlay.resolveReport(null)"
    >
      <div
        ref="dialogRef"
        class="neo-report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="neo-report-title"
        aria-describedby="neo-report-desc"
      >
        <h2 id="neo-report-title" class="neo-report__title">
          Report @{{ overlay.report.accountAcct }}?
        </h2>
        <p id="neo-report-desc" class="neo-report__desc">
          Submit a report to your home server moderators.
        </p>

        <fieldset class="neo-report__fieldset">
          <legend class="neo-report__legend">Category</legend>
          <label
            v-for="cat in categories"
            :key="cat.id"
            class="neo-report__category"
          >
            <input
              v-model="overlay.report.category"
              type="radio"
              name="report-category"
              :value="cat.id"
            />
            <span class="neo-report__category-text">
              <strong>{{ cat.label }}</strong>
              <span>{{ cat.hint }}</span>
            </span>
          </label>
        </fieldset>

        <label class="neo-report__comment">
          <span class="neo-report__comment-label">Additional details (optional)</span>
          <textarea
            v-model="overlay.report.comment"
            class="neo-input"
            rows="3"
            maxlength="500"
            placeholder="Describe what happened…"
          />
        </label>

        <label class="neo-report__forward">
          <input v-model="overlay.report.forward" type="checkbox" />
          <span>Forward to the remote server (when applicable)</span>
        </label>

        <div class="neo-report__actions">
          <button
            type="button"
            class="neo-btn neo-btn--secondary"
            @click="overlay.resolveReport(null)"
          >
            Cancel
          </button>
          <button
            type="button"
            class="neo-btn neo-btn--danger"
            @click="overlay.resolveReport({
              category: overlay.report.category,
              comment: overlay.report.comment.trim(),
              forward: overlay.report.forward,
            })"
          >
            Submit report
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.neo-report-root {
  position: fixed;
  inset: 0;
  z-index: var(--neo-z-dialog-top, 1065);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--neo-spacing-6, 1.25rem);
  background: color-mix(in srgb, var(--neo-bg-primary) 35%, rgba(0, 0, 0, 0.45));
}

.neo-report {
  width: min(24rem, 100%);
  max-height: min(90vh, 640px);
  max-height: min(90dvh, 640px);
  overflow-y: auto;
  padding: var(--neo-spacing-6, 1.25rem);
  background: var(--neo-bg-card, var(--neo-bg-primary));
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md);
  box-shadow: var(--neo-chrome-card-shadow, 0 12px 40px rgba(0, 0, 0, 0.2));
}

.neo-report__title {
  margin: 0 0 var(--neo-spacing-2, 0.35rem);
  font-size: var(--neo-font-size-lg, 1.1rem);
  font-weight: var(--neo-font-weight-semibold, 600);
}

.neo-report__desc {
  margin: 0 0 var(--neo-spacing-4, 0.75rem);
  font-size: var(--neo-font-size-sm);
  color: var(--neo-text-secondary);
  line-height: var(--neo-leading-body, 1.45);
}

.neo-report__fieldset {
  margin: 0 0 var(--neo-spacing-4, 0.75rem);
  padding: 0;
  border: none;
}

.neo-report__legend {
  margin: 0 0 var(--neo-spacing-2, 0.35rem);
  font-size: var(--neo-font-size-sm);
  font-weight: 600;
  color: var(--neo-text-primary);
}

.neo-report__category {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.45rem 0;
  cursor: pointer;

  input {
    margin-top: 0.2rem;
    flex-shrink: 0;
  }
}

.neo-report__category-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-size: var(--neo-font-size-sm);
  color: var(--neo-text-secondary);

  strong {
    color: var(--neo-text-primary);
    font-weight: 600;
  }
}

.neo-report__comment {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: var(--neo-spacing-3, 0.5rem);
}

.neo-report__comment-label {
  font-size: var(--neo-font-size-sm);
  font-weight: 600;
  color: var(--neo-text-primary);
}

.neo-report__forward {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: var(--neo-spacing-5, 1rem);
  font-size: var(--neo-font-size-sm);
  color: var(--neo-text-secondary);
  cursor: pointer;

  input {
    margin-top: 0.15rem;
    flex-shrink: 0;
  }
}

.neo-report__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--neo-spacing-3, 0.5rem);
}

.neo-btn--danger {
  background-color: var(--neo-danger, #dc2626);
  color: var(--neo-text-on-accent, #fff);

  &:hover {
    filter: brightness(1.05);
  }
}
</style>
