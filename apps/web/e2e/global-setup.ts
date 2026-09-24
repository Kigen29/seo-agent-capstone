import { assertTestDatabase } from '@seo/core'
import { execFileSync } from 'node:child_process'

/**
 * Seeds the known tenant, token, site, audit, and findings the specs navigate to.
 *
 * Runs the built seed CLI as a child process rather than importing `@seo/audit` directly.
 * Playwright loads this file through its own Babel transform, which reaches into the
 * workspace package's TypeScript source and then trips over the ESM `export * as` in
 * `@seo/db`. The seed is already a compiled, standalone entry point, so running it as one
 * sidesteps the problem rather than contorting the build to satisfy a test runner.
 */
export default function globalSetup(): void {
  assertTestDatabase(process.env)
  execFileSync('node', ['../../packages/audit/dist/seed-cli.js'], {
    stdio: 'inherit',
    env: process.env,
  })
}
