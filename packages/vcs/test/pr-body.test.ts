import { describe, expect, it } from 'vitest'
import { IncompletePullRequestError, buildPrBody, buildPrTitle } from '../src/pr-body.js'
import { makeFinding } from './fixtures.js'

const complete = {
  finding: makeFinding(),
  expectedEffect: 'Google can pick the canonical URL, so ranking signals stop being split.',
  rollback: 'Revert the merge commit; the head reverts to having no canonical link.',
}

describe('the pull-request body', () => {
  it('carries all five required sections (rule 4)', () => {
    const body = buildPrBody(complete)
    expect(body).toContain('## The finding')
    expect(body).toContain('## The evidence')
    expect(body).toContain('## Expected effect')
    expect(body).toContain('## How we will know if this failed')
    expect(body).toContain('## Rollback')
  })

  it('renders the actual evidence, not prose', () => {
    const body = buildPrBody(complete)
    // The markup evidence had an absent canonical, which the renderer states explicitly.
    expect(body).toContain('the element was absent')
    expect(body).toContain('https://example.com/pricing')
  })

  it('includes the finding falsification, the expected effect, and the rollback verbatim', () => {
    const body = buildPrBody(complete)
    expect(body).toContain(complete.finding.falsification)
    expect(body).toContain(complete.expectedEffect)
    expect(body).toContain(complete.rollback)
  })

  it('refuses to render without a falsification condition', () => {
    const finding = makeFinding({ falsification: '   ' })
    expect(() => buildPrBody({ ...complete, finding })).toThrow(IncompletePullRequestError)
  })

  it('refuses to render without an expected effect', () => {
    expect(() => buildPrBody({ ...complete, expectedEffect: '' })).toThrow(IncompletePullRequestError)
  })

  it('refuses to render without a rollback note', () => {
    expect(() => buildPrBody({ ...complete, rollback: '' })).toThrow(IncompletePullRequestError)
  })

  it('prefixes the title so a maintainer can spot agent PRs', () => {
    expect(buildPrTitle(makeFinding())).toBe('[seo-agent] Missing canonical tag on the pricing page')
  })
})
