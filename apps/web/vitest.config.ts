import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the web app's pure helpers and its presentational components. Scoped to
 * `lib/**` and `components/**` so it never picks up the Playwright specs in `e2e/`, which are
 * a different runner entirely.
 *
 * The JSX override is required because `tsconfig.json` sets `jsx: "preserve"` for Next, which
 * leaves the transform to the framework. Vitest has no framework to hand it to, so it is told
 * to use the automatic runtime directly. Components rendered here go through
 * `react-dom/server`, which needs no DOM, so there is no jsdom dependency and no environment
 * to configure: a component that produces markup from props is a pure function wearing a
 * different hat, and is tested as one.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['lib/**/*.test.ts', 'components/**/*.test.tsx'],
  },
})
