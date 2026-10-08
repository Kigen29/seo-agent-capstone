import { describe, expect, it } from 'vitest'
import { classifyMentions, confirmMentions } from '../src/authority/mentions.js'
import { DIRECTORIES, matches } from '../src/authority/platforms.js'

/**
 * A search result is a mention only if it contains the name that was searched for.
 *
 * The first block is the production fault this exists for, with the results as they came back.
 * The client is Heartbeest Safaris at heartbeestsafaris.com. Google read "Heartbeest" as a
 * misspelling of "hartebeest" and returned African Hartebeest Safaris, another company, and
 * every result was reported to the client as coverage of them.
 */
const BRAND = 'Heartbeest Safaris'

/**
 * What the audit of 8 October 2026 was given, and counted. Every one is the other company.
 * The addresses and titles are as the client reported them; the two summaries are illustrative,
 * since the report did not include them.
 */
const RETURNED_FOR_THE_WRONG_COMPANY = [
  {
    url: 'https://africanhartebeest.com/7-days-treasures-of-north-tanzania-safari',
    title: '7-Days Treasures of North Tanzania Safari',
    snippet: 'African Hartebeest Safaris Limited offers a 7 day northern circuit safari.',
  },
  {
    url: 'https://africanhartebeest.com/8-days-discover-tanzania-northern-circuit',
    title: '8 Days Discover Tanzania Northern Circuit',
  },
  {
    url: 'https://africantravelcenter.net/tour-agency/african-hartebeest/',
    title: 'African Hartebeest | Tour Operator Profile in Kenya',
  },
  {
    url: 'https://pt.slideshare.net/slideshow/african-hartebeest-safarisbrochure-profile-mail/50549316',
    title: 'African Hartebeest Safaris_Brochure Profile Mail | PDF',
  },
  {
    url: 'https://www.safaribookings.com/tours/t115976',
    title: '5-Day Luxury Rift Valley & Maasai Mara Safari Experience',
    snippet: 'Offered by African Hartebeest Safaris. Rated 5 out of 5.',
  },
  {
    url: 'https://www.tourtravelworld.com/travel-agents/african-hartebeest-safaris-nairobi-377189/nairobi_tour_packages.htm',
    title: 'Nairobi Tour Packages of African Hartebeest Safaris',
  },
  {
    url: 'https://www.tripadvisor.ru/Attraction_Review-g294207-d17709019-Reviews-African_Hartebeest_Safaris-Nairobi.html',
    title: 'African Hartebeest Safaris, Найроби',
  },
  {
    url: 'https://www.facebook.com/AfricanHartebeestSafaris/videos/a-glimpse-of-the-beautiful-masaai-mara/874297169568974/',
    title: 'A glimpse of the beautiful Masaai mara in Kenya. A must ...',
  },
]

describe('confirmMentions, on the fault that was reported', () => {
  it('refuses every result about the similarly named company', () => {
    const { confirmed, rejected } = confirmMentions(RETURNED_FOR_THE_WRONG_COMPANY, BRAND)

    expect(confirmed).toEqual([])
    expect(rejected).toHaveLength(RETURNED_FOR_THE_WRONG_COMPANY.length)
  })

  it('so the client is no longer told that six sites wrote about them', () => {
    const { confirmed } = confirmMentions(RETURNED_FOR_THE_WRONG_COMPANY, BRAND)
    const footprint = classifyMentions(confirmed, 'heartbeestsafaris.com')

    expect(footprint.earnedDomains).toEqual([])
    expect(footprint.selfPublishedDomains).toEqual([])
  })

  it('keeps a real mention sitting among them', () => {
    const real = {
      url: 'https://travelweekly.example/kenya-operators',
      title: 'Kenya operators to watch',
      snippet: 'Newcomer Heartbeest Safaris runs private departures from Nairobi.',
    }
    const { confirmed } = confirmMentions([...RETURNED_FOR_THE_WRONG_COMPANY, real], BRAND)

    expect(confirmed).toEqual([real])
  })
})

describe('confirmMentions', () => {
  const kept = (source: { url: string; title?: string; snippet?: string }, brand = BRAND) =>
    confirmMentions([source], brand).confirmed.length === 1

  it('finds the name in the title, the summary or the address', () => {
    expect(kept({ url: 'https://a.example/x', title: 'Heartbeest Safaris reviewed' })).toBe(true)
    expect(
      kept({ url: 'https://a.example/x', snippet: 'We travelled with Heartbeest Safaris.' }),
    ).toBe(true)
    expect(kept({ url: 'https://a.example/operators/heartbeest-safaris' })).toBe(true)
  })

  it('does not mind capitals, punctuation, spacing or accents', () => {
    expect(kept({ url: 'https://a.example/x', title: 'HEARTBEEST   SAFARIS: a review' })).toBe(true)
    expect(kept({ url: 'https://a.example/x', title: 'Heartbeest-Safaris' })).toBe(true)
    expect(kept({ url: 'https://a.example/x', title: 'Café Zoë opens' }, 'Cafe Zoe')).toBe(true)
  })

  it('needs the whole name, as whole words, in order', () => {
    expect(kept({ url: 'https://a.example/x', title: 'Heartbeest' })).toBe(false)
    expect(kept({ url: 'https://a.example/x', title: 'Safaris by Heartbeest' })).toBe(false)
    expect(kept({ url: 'https://a.example/x', title: 'Heartbeest Safarisland' })).toBe(false)
    expect(kept({ url: 'https://a.example/x', title: 'Sweetheartbeest Safaris' })).toBe(false)
  })

  it('refuses a result with nothing to check, since it cannot be confirmed', () => {
    expect(kept({ url: 'https://a.example/x' })).toBe(false)
    expect(kept({ url: 'not a url at all' })).toBe(false)
  })

  it('refuses everything for an empty name, and never matches on nothing', () => {
    const { confirmed } = confirmMentions([{ url: 'https://a.example/x', title: 'Anything' }], '  ')

    expect(confirmed).toEqual([])
  })
})

describe('listing sites are not publications', () => {
  it.each([
    'tripadvisor.ru',
    'www.tripadvisor.co.uk',
    'tripadvisor.com.au',
    'yelp.de',
    'safaribookings.com',
    'pt.slideshare.net',
    'tourtravelworld.com',
  ])('treats %s as a listing', (host) => {
    expect(matches(host, DIRECTORIES)).toBe(true)
  })

  it.each(['nottripadvisor.ru', 'tripadvisor.example.org', 'travelweekly.example'])(
    'does not mistake %s for one',
    (host) => {
      expect(matches(host, DIRECTORIES)).toBe(false)
    },
  )
})
