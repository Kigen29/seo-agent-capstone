import { ApiRequestError } from '@seo/api-client'
import { describe, expect, it, vi } from 'vitest'

// `redirect` and `notFound` work by throwing in Next; the mocks throw recognisable sentinels
// so a test can assert which one fired.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

import { handleApiError } from './api-error'

describe('handleApiError', () => {
  it('treats a cold-start gateway error as "the API is waking", not a crash', () => {
    // The production bug this test exists for. Render answers 502/503/504 while it spins up.
    // These reached the page as ApiRequestErrors and were rethrown, so the dashboard crashed
    // with a Server Components 500 instead of showing the waking page. They must return
    // cleanly, exactly like a dropped connection, so the caller can render ApiAsleep.
    for (const status of [502, 503, 504]) {
      expect(() => handleApiError(new ApiRequestError(status, 'unavailable'))).not.toThrow()
    }
  })

  it('treats a network failure the same way, since the fetch never landed', () => {
    expect(() => handleApiError(new TypeError('fetch failed'))).not.toThrow()
  })

  it('sends an expired or invalid token back to sign in', () => {
    expect(() => handleApiError(new ApiRequestError(401, 'bad token'))).toThrow(
      'REDIRECT:/login?expired=1',
    )
  })

  it('renders not-found for a 404, which the API returns for another tenant resource too', () => {
    expect(() => handleApiError(new ApiRequestError(404, 'nope'))).toThrow('NOT_FOUND')
  })

  it('rethrows a genuine server error, so a real bug is not hidden behind the waking page', () => {
    // A 500 is our code failing, not infrastructure warming. It should surface, not be
    // disguised as a cold start, or we would never see our own bugs in production.
    expect(() => handleApiError(new ApiRequestError(500, 'boom'))).toThrow(ApiRequestError)
  })

  it('rethrows a 400, which is a real client error and not a transient one', () => {
    expect(() => handleApiError(new ApiRequestError(400, 'bad request'))).toThrow(ApiRequestError)
  })
})
