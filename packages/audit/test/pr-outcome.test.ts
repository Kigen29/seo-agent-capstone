import { describe, expect, it } from 'vitest'
import { pullRequestNumberFrom } from '../src/pr-outcome.js'

/**
 * The URL-to-number conversion, which is the one part of the reconciler that can silently address
 * the wrong pull request.
 *
 * The transitions themselves are exercised against a real Postgres in
 * `pr-outcome.integration.test.ts`; row-level security and the `asOwner` escape are most of what
 * makes them correct, and a mocked database would prove neither.
 */
describe('pullRequestNumberFrom', () => {
  it('reads the number from a PR URL', () => {
    expect(pullRequestNumberFrom('https://github.com/Kigen29/kenya-safari-architect/pull/24')).toBe(
      24,
    )
  })

  it('tolerates a trailing path, query or fragment', () => {
    // GitHub hands these out from the UI: /files, /commits, ?w=1, #discussion_r123.
    expect(pullRequestNumberFrom('https://github.com/o/r/pull/24/files')).toBe(24)
    expect(pullRequestNumberFrom('https://github.com/o/r/pull/24#issuecomment-1')).toBe(24)
    expect(pullRequestNumberFrom('https://github.com/o/r/pull/24?w=1')).toBe(24)
  })

  it('refuses an issue URL, which looks almost identical', () => {
    // /issues/24 and /pull/24 are different objects that can both exist in one repo. A loose
    // parser would reconcile a finding against the state of an unrelated issue.
    expect(pullRequestNumberFrom('https://github.com/o/r/issues/24')).toBeNull()
  })

  it('refuses a host that is not github.com', () => {
    // The stored URL comes from GitHub today, but this is the function that decides which remote
    // object a database row is compared against, and it should not widen quietly.
    expect(pullRequestNumberFrom('https://evil.example/github.com/o/r/pull/24')).toBeNull()
    expect(pullRequestNumberFrom('http://github.com/o/r/pull/24')).toBeNull()
  })

  it('refuses anything without a positive integer', () => {
    expect(pullRequestNumberFrom('https://github.com/o/r/pull/abc')).toBeNull()
    expect(pullRequestNumberFrom('https://github.com/o/r/pull/0')).toBeNull()
    expect(pullRequestNumberFrom('')).toBeNull()
  })
})
