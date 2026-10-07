import { describe, expect, it } from 'vitest'
import { brandFromTitle } from '../src/brand.js'

/**
 * The brand is read from the homepage title only when the title plainly states it. Most of these
 * are the cases where it must return nothing, because a wrong brand is worse than a blank one:
 * every mention search and every outreach draft is built on it.
 */
describe('brandFromTitle', () => {
  it('takes the part of the title that is the domain, with its spaces and capitals', () => {
    expect(
      brandFromTitle('Heartbeest Safaris | Kenya safari tours', 'https://heartbeestsafaris.com'),
    ).toBe('Heartbeest Safaris')
  })

  it('finds the name wherever it sits in the title', () => {
    expect(
      brandFromTitle(
        'Kenya safari tours - Heartbeest Safaris',
        'https://www.heartbeestsafaris.com/',
      ),
    ).toBe('Heartbeest Safaris')
  })

  it('accepts a fuller name that contains the domain', () => {
    expect(brandFromTitle('Solian Girls High School | Home', 'https://soliangirls.sc.ke')).toBe(
      'Solian Girls High School',
    )
  })

  it('accepts a shorter name the domain was built from', () => {
    expect(brandFromTitle('Rangau Tiles: floor and wall tiles', 'https://rangautiles.com')).toBe(
      'Rangau Tiles',
    )
  })

  it('takes a title that is only the name', () => {
    expect(brandFromTitle('Lake Victoria Aquaculture', 'https://lakevictoriaaquaculture.com')).toBe(
      'Lake Victoria Aquaculture',
    )
  })

  it('returns nothing when no part of the title matches the domain', () => {
    // A generic title on a named domain. Guessing "Home" or "Welcome" would be a wrong brand.
    expect(
      brandFromTitle('Home | Welcome to our website', 'https://heartbeestsafaris.com'),
    ).toBeNull()
  })

  it('does not take a short word that merely appears inside the domain', () => {
    expect(brandFromTitle('Tiles | Shop', 'https://rangautilesandcarpets.com')).toBeNull()
  })

  it('does not take a whole sentence that happens to contain the name', () => {
    expect(
      brandFromTitle(
        'Welcome to the official website of Heartbeest Safaris and partners worldwide',
        'https://heartbeestsafaris.com',
      ),
    ).toBeNull()
  })

  it('takes a two-word name from a one-word domain', () => {
    expect(
      brandFromTitle('Named Safaris | Guided trips in Kenya', 'https://named.example.com'),
    ).toBe('Named Safaris')
  })

  it('does not take a short sentence that merely mentions the name', () => {
    expect(
      brandFromTitle('Book with Heartbeest Safaris today', 'https://heartbeestsafaris.com'),
    ).toBeNull()
  })

  it('does not split a hyphenated name that has no spaces around the hyphen', () => {
    expect(brandFromTitle('Coca-Cola | Refreshing the world', 'https://coca-cola.com')).toBe(
      'Coca-Cola',
    )
  })

  it.each([null, undefined, '', '   '])('returns nothing for the title %j', (title) => {
    expect(brandFromTitle(title, 'https://heartbeestsafaris.com')).toBeNull()
  })

  it('returns nothing when the address is not an address', () => {
    expect(brandFromTitle('Heartbeest Safaris', 'not a url')).toBeNull()
  })
})
