import type { Site } from '@seo/api-client'
import { describe, expect, it } from 'vitest'
import { setupProgress, setupSteps } from './setup-progress'

const site = (over: Partial<Site> = {}): Site => ({ id: 's1', url: 'https://example.com', ...over })

describe('setupSteps', () => {
  it('counts nothing as done for a site that was only just added', () => {
    const progress = setupProgress(setupSteps(site(), { connected: false }, null))

    expect(progress.done).toBe(0)
    expect(progress.total).toBe(7)
    expect(progress.next?.id).toBe('details')
  })

  it('needs all three business details before calling them done', () => {
    const partial = setupSteps(
      site(),
      { connected: false },
      {
        brand: 'Example',
        offering: null,
        market: 'Kenya',
        competitors: [],
      },
    )

    expect(partial.find((step) => step.id === 'details')?.done).toBe(false)
  })

  it('suggests the repository once the details are filled in', () => {
    const steps = setupSteps(
      site(),
      { connected: true },
      {
        brand: 'Example',
        offering: 'Guided safaris',
        market: 'Kenya',
        competitors: ['rival.com'],
      },
    )

    expect(setupProgress(steps).next?.id).toBe('repository')
  })

  it('has no next step when everything is set up', () => {
    const steps = setupSteps(
      site({
        repoFullName: 'owner/repo',
        gscVerificationStatus: 'verified',
        businessProfileConnected: true,
        trackedPrompts: 4,
      }),
      { connected: true },
      { brand: 'Example', offering: 'Guided safaris', market: 'Kenya', competitors: ['rival.com'] },
    )
    const progress = setupProgress(steps)

    expect(progress.done).toBe(progress.total)
    expect(progress.next).toBeUndefined()
  })

  it('does not count a merged verification tag as verified', () => {
    const steps = setupSteps(site({ gscVerificationStatus: 'merged' }), { connected: true }, null)

    expect(steps.find((step) => step.id === 'ownership')?.done).toBe(false)
  })

  it('does not count a Google connection that Google has stopped accepting', () => {
    // ADR-0048. The row is still there, and the step is not done: nothing can read search data.
    const usable = setupSteps(site(), { connected: true, needsReconnect: false }, null)
    const refused = setupSteps(site(), { connected: true, needsReconnect: true }, null)

    expect(usable.find((step) => step.id === 'search_console')?.done).toBe(true)
    expect(refused.find((step) => step.id === 'search_console')?.done).toBe(false)
  })
})
