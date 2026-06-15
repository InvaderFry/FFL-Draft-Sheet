import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Playwright drives tests/e2e/ with its own runner — keep them out of the
    // unit (vitest/jsdom) run, which only covers src/.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    css: false,
  },
})
