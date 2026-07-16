import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the web app's pure helpers. Scoped to `lib/**` so it never picks up the
 * Playwright specs in `e2e/`, which are a different runner entirely.
 */
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
  },
})
