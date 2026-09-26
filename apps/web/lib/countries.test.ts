import { describe, expect, it } from 'vitest'
import { countryFromUrl, countryOptions, isCountryCode } from './countries'

describe('countries', () => {
  it('offers every country by name, not only Kenya', () => {
    const options = countryOptions()
    expect(options.length).toBeGreaterThan(240)
    expect(options).toContainEqual({ code: 'ke', name: 'Kenya' })
    expect(options).toContainEqual({ code: 'us', name: 'United States' })
    expect(options).toContainEqual({ code: 'jp', name: 'Japan' })
    const names = options.map((option) => option.name)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
  })

  it.each([
    ['https://soliangirls.sc.ke/', 'ke'],
    ['https://www.example.co.uk/', 'gb'],
    ['https://example.de', 'de'],
    ['https://example.com', undefined],
    ['https://startup.io', undefined],
    ['not a url', undefined],
  ])('infers the market of %s', (url, expected) => {
    expect(countryFromUrl(url)).toBe(expected)
  })

  it('recognises real codes only', () => {
    expect(isCountryCode('KE')).toBe(true)
    expect(isCountryCode('zz')).toBe(false)
    expect(isCountryCode(undefined)).toBe(false)
  })
})
