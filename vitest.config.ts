import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'functions/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'app/utils/**/*.ts',
        'app/stores/**/*.ts',
        'app/composables/**/*.ts',
        'functions/**/*.ts',
        'shared/**/*.ts',
      ],
      thresholds: {
        lines: 18,
        functions: 12,
        branches: 10,
        statements: 18,
      },
    },
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
})
