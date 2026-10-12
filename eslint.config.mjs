// Lint rules that catch what TypeScript alone cannot: Vue template mistakes, accessibility
// slips and a few JS footguns. `npm run lint` runs this *and* the typechecks.
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import tseslint from 'typescript-eslint'
import a11y from 'eslint-plugin-vuejs-accessibility'

export default [
  {
    ignores: [
      '.nuxt/**',
      '.output/**',
      'dist/**',
      'node_modules/**',
      'public/**',
      'playwright-report/**',
      'test-results/**',
      'docs/**',
    ],
  },
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, sourceType: 'module', extraFileExtensions: ['.vue'] },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: 'module' } },
  },
  {
    files: ['app/**/*.vue'],
    plugins: { 'vuejs-accessibility': a11y },
    rules: {
      'vuejs-accessibility/alt-text': 'error',
      'vuejs-accessibility/anchor-has-content': 'error',
      'vuejs-accessibility/aria-props': 'error',
      'vuejs-accessibility/aria-role': 'error',
      'vuejs-accessibility/form-control-has-label': 'error',
      'vuejs-accessibility/iframe-has-title': 'error',
      'vuejs-accessibility/no-autofocus': 'warn',
    },
  },
  {
    files: ['app/**/*.{vue,ts}', 'functions/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      'no-debugger': 'error',
      'no-var': 'error',
      'no-dupe-else-if': 'error',
      'no-self-compare': 'error',
      'no-unsafe-finally': 'error',
      'no-unreachable': 'error',
      'no-unused-labels': 'error',
      'no-useless-catch': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Multi-word names are the Nuxt convention for pages/layouts (index.vue, [id].vue, error.vue)
      'vue/multi-word-component-names': 'off',
    },
  },
]
