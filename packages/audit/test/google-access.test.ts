import { describe, expect, it } from 'vitest'
import { matchProperty } from '../src/google-access.js'

const owner = (siteUrl: string) => ({ siteUrl, permissionLevel: 'siteOwner' })

describe('matchProperty', () => {
  it('prefers a domain property, which covers every host under the domain', () => {
    expect(
      matchProperty(
        [owner('https://example.com/'), owner('sc-domain:example.com')],
        'https://example.com',
      ),
    ).toBe('sc-domain:example.com')
  })

  it('treats www and the bare host as one site, in either direction', () => {
    // The case that reported "no property" for a real site: added bare, verified with www.
    expect(matchProperty([owner('https://www.example.com/')], 'https://example.com')).toBe(
      'https://www.example.com/',
    )
    expect(matchProperty([owner('https://example.com/')], 'https://www.example.com')).toBe(
      'https://example.com/',
    )
    expect(matchProperty([owner('sc-domain:example.com')], 'https://www.example.com')).toBe(
      'sc-domain:example.com',
    )
  })

  it('takes the host as it was typed before its twin, https before http, the root before a path', () => {
    expect(
      matchProperty(
        [
          owner('https://www.example.com/'),
          owner('http://example.com/'),
          owner('https://example.com/blog/'),
          owner('https://example.com/'),
        ],
        'https://example.com',
      ),
    ).toBe('https://example.com/')
  })

  it('never takes a property the account has added and not verified', () => {
    expect(
      matchProperty(
        [{ siteUrl: 'https://example.com/', permissionLevel: 'siteUnverifiedUser' }],
        'https://example.com',
      ),
    ).toBeUndefined()
  })

  it('does not match another site, a subdomain, or a name that merely contains this one', () => {
    const others = [
      owner('https://example.org/'),
      owner('https://shop.example.com/'),
      owner('https://notexample.com/'),
      owner('sc-domain:example.co'),
    ]
    expect(matchProperty(others, 'https://example.com')).toBeUndefined()
  })

  it('answers nothing for an address that is not one', () => {
    expect(matchProperty([owner('https://example.com/')], 'not a url')).toBeUndefined()
  })
})
