import { describe, expect, it } from 'vitest'
import { classifyMentions, listMentions, MAX_MENTION_PAGES } from '../src/authority/mentions.js'

/**
 * The pages behind the mention count.
 *
 * The count is only worth believing if it can be opened. What is checked here is that every page
 * kept is one a person should be shown: a real mention, on somebody else's site, at an address
 * that is safe to render as a link, with "we did not check" never shown as "does not link".
 */
const CLIENT = 'heartbeestsafaris.com'

const footprint = (sources: { url: string; title?: string }[]) => classifyMentions(sources, CLIENT)

describe('listMentions', () => {
  it('keeps each page with its site, its title and what kind of site it is', () => {
    const pages = listMentions(
      footprint([
        { url: 'https://travelweekly.example/best-safaris', title: 'The best safaris of 2026' },
        { url: 'https://www.facebook.com/heartbeest', title: 'Heartbeest Safaris' },
      ]),
      CLIENT,
    )

    expect(pages).toEqual([
      {
        url: 'https://travelweekly.example/best-safaris',
        domain: 'travelweekly.example',
        title: 'The best safaris of 2026',
        kind: 'earned',
      },
      {
        url: 'https://www.facebook.com/heartbeest',
        domain: 'facebook.com',
        title: 'Heartbeest Safaris',
        kind: 'self_published',
      },
    ])
  })

  it("leaves out the client's own pages, which are not mentions", () => {
    const pages = listMentions(
      footprint([
        { url: 'https://heartbeestsafaris.com/about' },
        { url: 'https://blog.heartbeestsafaris.com/post' },
        { url: 'https://travelweekly.example/a' },
      ]),
      CLIENT,
    )

    expect(pages.map((page) => page.domain)).toEqual(['travelweekly.example'])
  })

  it('says whether a site links only when links were actually checked', () => {
    const sources = [
      { url: 'https://links-to-you.example/a' },
      { url: 'https://no-link.example/b' },
      { url: 'https://medium.com/@heartbeest' },
    ]

    const unchecked = listMentions(footprint(sources), CLIENT)
    expect(unchecked.every((page) => !('linked' in page))).toBe(true)

    const checked = listMentions(footprint(sources), CLIENT, ['no-link.example'])
    const by = Object.fromEntries(checked.map((page) => [page.domain, page.linked]))
    expect(by['links-to-you.example']).toBe(true)
    expect(by['no-link.example']).toBe(false)
    // A platform profile is never compared with the link index, so it claims neither.
    expect(by['medium.com']).toBeUndefined()
  })

  it('refuses an address that is not http or https, since these become links', () => {
    const pages = listMentions(
      footprint([
        { url: 'javascript:alert(1)//travelweekly.example' },
        { url: 'data:text/html,<script>alert(1)</script>' },
        { url: 'ftp://files.example/mention.txt' },
        { url: 'https://travelweekly.example/safe' },
      ]),
      CLIENT,
    )

    expect(pages.map((page) => page.url)).toEqual(['https://travelweekly.example/safe'])
  })

  it('lists a page once, and puts earned coverage before platforms', () => {
    const pages = listMentions(
      footprint([
        { url: 'https://www.linkedin.com/company/heartbeest' },
        { url: 'https://zebra-news.example/b' },
        { url: 'https://zebra-news.example/b' },
        { url: 'https://antelope-post.example/a' },
        { url: 'https://zebra-news.example/a' },
      ]),
      CLIENT,
    )

    expect(pages.map((page) => page.url)).toEqual([
      'https://antelope-post.example/a',
      'https://zebra-news.example/a',
      'https://zebra-news.example/b',
      'https://www.linkedin.com/company/heartbeest',
    ])
  })

  it('tidies a title, and keeps none when the result had none', () => {
    const pages = listMentions(
      footprint([
        { url: 'https://a.example/1', title: `  Spread   over\n lines ${'x'.repeat(400)}` },
        { url: 'https://a.example/2', title: '   ' },
      ]),
      CLIENT,
    )

    expect(pages[0]!.title!.startsWith('Spread over lines x')).toBe(true)
    expect(pages[0]!.title!.length).toBe(200)
    expect('title' in pages[1]!).toBe(false)
  })

  it('is bounded, however many results the search returned', () => {
    const many = Array.from({ length: 400 }, (_, index) => ({
      url: `https://site-${index}.example/page`,
    }))

    expect(listMentions(footprint(many), CLIENT)).toHaveLength(MAX_MENTION_PAGES)
  })
})
