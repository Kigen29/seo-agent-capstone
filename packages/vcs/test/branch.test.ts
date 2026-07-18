import { describe, expect, it } from 'vitest'
import { BRANCH_NAMESPACE, branchNameFor, branchPrefixFor, slugify } from '../src/branch.js'
import { makeFinding } from './fixtures.js'

describe('branch naming', () => {
  it('names a fix branch seo-agent/<id>-<slug>', () => {
    const branch = branchNameFor(
      makeFinding({ id: 'TECH-006-abc', title: 'Missing canonical tag' }),
    )
    expect(branch).toBe('seo-agent/TECH-006-abc-missing-canonical-tag')
  })

  it('always sits under the seo-agent namespace so the provider recognises its own branches', () => {
    expect(branchNameFor(makeFinding())).toMatch(new RegExp(`^${BRANCH_NAMESPACE}/`))
  })

  it('exposes a stable prefix that does not depend on the title', () => {
    // The webhook maps a merged PR back to a finding by this prefix, so it must be the same
    // even if the title, and therefore the slug, changed between runs.
    expect(branchPrefixFor('TECH-006-abc')).toBe('seo-agent/TECH-006-abc-')
  })

  it('slugifies: lowercase, collapse non-alphanumerics, trim, cap length', () => {
    expect(slugify('  Hello,  World!!  ')).toBe('hello-world')
    expect(slugify('A'.repeat(100)).length).toBeLessThanOrEqual(40)
  })

  it('never yields an empty slug', () => {
    expect(slugify('!!!')).toBe('fix')
    expect(slugify('')).toBe('fix')
  })
})
