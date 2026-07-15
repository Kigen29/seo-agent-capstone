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
  execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', '../../packages/audit/dist/seed-cli.js'],
    {
      stdio: 'inherit',
      // The seed refuses to run without this, because it writes a tenant whose API token is a
      // public literal in the repo. Saying so here is the "yes, this database is disposable".
      env: { ...process.env, ALLOW_E2E_SEED: '1' },
    },
  )
}
