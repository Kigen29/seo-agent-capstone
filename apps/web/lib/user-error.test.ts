import { ApiRequestError } from '@seo/api-client'
import { describe, expect, it } from 'vitest'
import { toUserError } from './user-error'

/**
 * Every screen shows failures through this one function, so what it says is what the whole
 * product says. The cases are the handful of failures that really happen.
 */
describe('toUserError', () => {
  it("uses the API's own words for something the person can correct", () => {
    const error = toUserError(
      new ApiRequestError(400, 'That link carries no business identifier.'),
      'save the profile',
    )

    expect(error.kind).toBe('invalid')
    expect(error.title).toBe('We could not save the profile')
    expect(error.detail).toBe('That link carries no business identifier.')
  })

  it.each([409, 422])('treats a %i as something to correct, not as our fault', (status) => {
    expect(toUserError(new ApiRequestError(status, 'Connect a repository first.'), 'x').kind).toBe(
      'invalid',
    )
  })

  it('says a spent allowance is a spent allowance', () => {
    const error = toUserError(new ApiRequestError(429, ''), 'run that search')

    expect(error.kind).toBe('budget')
    expect(error.detail).toMatch(/Everything free still works/)
  })

  it('tells "slow down" from "the allowance is spent", which share a status', () => {
    const limited = toUserError(
      new ApiRequestError(429, 'Too many requests. Try again in 30 seconds.', 'Rate Limited'),
      'run that search',
    )

    expect(limited.kind).toBe('busy')
    expect(limited.detail).toMatch(/30 seconds/)
    expect(limited.title).not.toMatch(/allowance/)
  })

  it('tells a feature that is switched off from a service that is starting', () => {
    const off = toUserError(
      new ApiRequestError(503, 'Suggestions need a language model, and none is switched on.'),
      'suggest competitors',
    )
    const starting = toUserError(new ApiRequestError(503, 'Service Unavailable'), 'load')

    expect(off.kind).toBe('unavailable')
    expect(off.detail).toMatch(/language model/)
    expect(starting.kind).toBe('waking')
    expect(starting.detail).toMatch(/Nothing was lost/)
  })

  it.each([502, 504])('reads a %i from the gateway as the service starting', (status) => {
    expect(toUserError(new ApiRequestError(status, 'Bad Gateway'), 'load').kind).toBe('waking')
  })

  it('shows the sentence the API wrote when a model it depends on failed', () => {
    const error = toUserError(
      new ApiRequestError(
        502,
        'The language model did not give an answer: You have no credits remaining.',
      ),
      'suggest competitors',
    )

    // Not "starting up": that hid the one message that says what to fix.
    expect(error.kind).toBe('unavailable')
    expect(error.title).toBe('We could not suggest competitors')
    expect(error.detail).toContain('no credits remaining')
  })

  it('reads a dropped connection as the service starting', () => {
    expect(toUserError(new TypeError('fetch failed'), 'load').kind).toBe('waking')
  })

  it('never shows a server fault message, and owns the fault', () => {
    const error = toUserError(
      new ApiRequestError(500, 'relation "sites" does not exist'),
      'save your competitors',
    )

    expect(error.kind).toBe('failed')
    expect(error.title).toBe('We could not save your competitors')
    expect(error.detail).not.toMatch(/relation/)
    expect(error.detail).toMatch(/fault on our side/)
  })

  it('has both a title and a way forward for anything at all', () => {
    for (const thrown of [new Error('boom'), 'a string', null, undefined, 42]) {
      const error = toUserError(thrown, 'do that')
      expect(error.title.length).toBeGreaterThan(0)
      expect(error.detail.length).toBeGreaterThan(0)
    }
  })
})
