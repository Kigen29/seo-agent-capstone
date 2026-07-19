import { describe, expect, it } from 'vitest'
import { runRules } from '../src/engine.js'
import { ruleById } from '../src/registry.js'
import type { Rule, RuleContext } from '../src/types.js'
import { context, html, page, u } from './context.js'

/** Run one rule in isolation and return the ids of the findings it raised. */
const fire = (id: string, ctx: RuleContext) => runRules(ctx, { rules: [ruleById(id) as Rule] })

const AI_BLOCK = `User-agent: GPTBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /`
const SENSIBLE = `User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: ${u('/sitemap.xml')}`

describe('TECH-001: robots.txt blocks a page the sitemap wants indexed', () => {
  it('fires when Googlebot is blocked from the homepage', () => {
    const findings = fire(
      'TECH-001',
      context({ pages: [page({ path: '/' })], robotsTxt: 'User-agent: *\nDisallow: /' }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('critical')
  })

  it('fires when a sitemap URL is disallowed', () => {
    const findings = fire(
      'TECH-001',
      context({
        pages: [page({ path: '/' })],
        robotsTxt: 'User-agent: *\nDisallow: /private',
        sitemapUrls: [u('/private/page')],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.affectedUrls).toEqual([u('/private/page')])
  })

  it('stays silent when robots.txt blocks nothing important', () => {
    const findings = fire(
      'TECH-001',
      context({
        pages: [page({ path: '/' })],
        robotsTxt: 'User-agent: *\nDisallow: /admin',
        sitemapUrls: [u('/')],
      }),
    )

    expect(findings).toEqual([])
  })

  it('stays silent when there is no robots.txt at all', () => {
    expect(fire('TECH-001', context({ pages: [page({ path: '/' })] }))).toEqual([])
  })
})

describe('TECH-002: AI search crawlers blocked', () => {
  it('fires when OAI-SearchBot is disallowed', () => {
    const findings = fire(
      'TECH-002',
      context({ pages: [page({ path: '/' })], robotsTxt: AI_BLOCK }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('critical')
    expect(findings[0]?.title).toContain('OAI-SearchBot')
  })

  it('stays silent when only TRAINING crawlers are blocked', () => {
    // Blocking GPTBot but not OAI-SearchBot is correct configuration, not a finding.
    // Crying wolf here would destroy trust in the highest-severity rule we ship.
    expect(
      fire('TECH-002', context({ pages: [page({ path: '/' })], robotsTxt: SENSIBLE })),
    ).toEqual([])
  })
})

describe('TECH-003: no sitemap declared', () => {
  it('fires when robots.txt declares no sitemap', () => {
    expect(
      fire(
        'TECH-003',
        context({ pages: [page({ path: '/' })], robotsTxt: 'User-agent: *\nAllow: /' }),
      ),
    ).toHaveLength(1)
  })

  it('stays silent when a sitemap is declared', () => {
    expect(
      fire('TECH-003', context({ pages: [page({ path: '/' })], robotsTxt: SENSIBLE })),
    ).toEqual([])
  })
})

describe('TECH-004: the sitemap lists URLs that are not indexable', () => {
  it('fires on a sitemap URL that 404s', () => {
    const findings = fire(
      'TECH-004',
      context({
        pages: [page({ path: '/' }), page({ path: '/gone', status: 404 })],
        sitemapUrls: [u('/gone')],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toContain('404')
  })

  it('fires on a sitemap URL that redirects', () => {
    const findings = fire(
      'TECH-004',
      context({
        pages: [page({ path: '/old', redirectChain: ['/old'], finalPath: '/new' })],
        sitemapUrls: [u('/old')],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toContain('redirects')
  })

  it('stays silent when every sitemap URL is a live indexable page', () => {
    expect(
      fire('TECH-004', context({ pages: [page({ path: '/' })], sitemapUrls: [u('/')] })),
    ).toEqual([])
  })
})

describe('TECH-005: noindex on a page that is in the sitemap', () => {
  it('fires on the contradiction', () => {
    const findings = fire(
      'TECH-005',
      context({
        pages: [page({ path: '/x', html: html.noindex() })],
        sitemapUrls: [u('/x')],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('high')
  })

  it('fires when the noindex comes from the X-Robots-Tag header', () => {
    const findings = fire(
      'TECH-005',
      context({
        pages: [page({ path: '/x', xRobotsTag: 'noindex, nofollow' })],
        sitemapUrls: [u('/x')],
      }),
    )

    expect(findings).toHaveLength(1)
  })

  it('stays silent on a noindexed page that is NOT in the sitemap', () => {
    // A deliberate noindex is normal. Flagging every one of them is how you get ignored.
    expect(
      fire('TECH-005', context({ pages: [page({ path: '/thanks', html: html.noindex() })] })),
    ).toEqual([])
  })
})

describe('TECH-006: missing canonical', () => {
  it('fires on an indexable page with no canonical', () => {
    expect(fire('TECH-006', context({ pages: [page({ path: '/' })] }))).toHaveLength(1)
  })

  it('stays silent when a canonical is present', () => {
    expect(
      fire('TECH-006', context({ pages: [page({ path: '/', html: html.withCanonical(u('/')) })] })),
    ).toEqual([])
  })

  it('stays silent on a noindexed page, which is not trying to rank', () => {
    expect(
      fire('TECH-006', context({ pages: [page({ path: '/x', html: html.noindex() })] })),
    ).toEqual([])
  })
})

describe('TECH-007: canonical points at a broken page', () => {
  it('fires when the canonical target 404s', () => {
    const findings = fire(
      'TECH-007',
      context({
        pages: [
          page({ path: '/a', html: html.withCanonical(u('/gone')) }),
          page({ path: '/gone', status: 404 }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('high')
  })

  it('stays silent when the canonical target is a live page', () => {
    expect(
      fire(
        'TECH-007',
        context({
          pages: [page({ path: '/a', html: html.withCanonical(u('/b')) }), page({ path: '/b' })],
        }),
      ),
    ).toEqual([])
  })

  it('stays silent when the canonical points somewhere we never crawled', () => {
    // Silence is the honest answer. It might be a perfectly good page on another host,
    // and we have no evidence either way.
    expect(
      fire(
        'TECH-007',
        context({ pages: [page({ path: '/a', html: html.withCanonical('https://other.com/x') })] }),
      ),
    ).toEqual([])
  })
})

describe('TECH-008 and TECH-009: redirect chains and loops', () => {
  it('TECH-008 fires on a chain of two hops', () => {
    const findings = fire(
      'TECH-008',
      context({
        pages: [page({ path: '/a', redirectChain: ['/a', '/b'], finalPath: '/c' })],
      }),
    )

    expect(findings).toHaveLength(1)
  })

  it('TECH-008 stays silent on a single hop, which is normal and fine', () => {
    expect(
      fire(
        'TECH-008',
        context({ pages: [page({ path: '/a', redirectChain: ['/a'], finalPath: '/b' })] }),
      ),
    ).toEqual([])
  })

  it('TECH-009 fires on a loop, and TECH-008 does not also fire on it', () => {
    // A loop is a critical outage. Letting it also surface as a low-severity "tidy up
    // your redirects" finding would let it hide in a list of housekeeping.
    const looping = context({
      pages: [page({ path: '/a', redirectChain: ['/a', '/b', '/a'], finalPath: '/b' })],
    })

    expect(fire('TECH-009', looping)).toHaveLength(1)
    expect(fire('TECH-009', looping)[0]?.severity).toBe('critical')
    expect(fire('TECH-008', looping)).toEqual([])
  })
})

describe('TECH-010: broken internal links', () => {
  it('reports one finding per broken TARGET, not per link', () => {
    // A 404 linked from forty pages is one problem, not forty. Reporting it forty times
    // is how a findings inbox becomes something people close without reading.
    const findings = fire(
      'TECH-010',
      context({
        pages: [
          page({ path: '/', html: html.linkingTo('/gone') }),
          page({ path: '/b', html: html.linkingTo('/gone') }),
          page({ path: '/gone', status: 404 }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toContain('2 page(s)')
  })

  it('stays silent when a broken page exists but nothing links to it', () => {
    // Not a broken LINK. That is TECH-004's job, and it is a different fix.
    expect(
      fire(
        'TECH-010',
        context({ pages: [page({ path: '/' }), page({ path: '/gone', status: 404 })] }),
      ),
    ).toEqual([])
  })
})

describe('TECH-011: duplicate titles', () => {
  it('fires when two indexable pages share a title', () => {
    const findings = fire(
      'TECH-011',
      context({
        pages: [
          page({ path: '/a', html: html.withTitle('Tiles') }),
          page({ path: '/b', html: html.withTitle('Tiles') }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.affectedUrls).toHaveLength(2)
  })

  it('ignores a duplicate title on a noindexed page', () => {
    expect(
      fire(
        'TECH-011',
        context({
          pages: [
            page({ path: '/a', html: html.withTitle('Tiles') }),
            page({
              path: '/b',
              html: '<!doctype html><html><head><title>Tiles</title><meta name="robots" content="noindex"></head><body><h1>H</h1></body></html>',
            }),
          ],
        }),
      ),
    ).toEqual([])
  })
})

describe('TECH-012: near-duplicate content', () => {
  it('fires on two pages with substantially the same body', () => {
    const findings = fire(
      'TECH-012',
      context({
        pages: [
          page({ path: '/a', html: html.prose(300) }),
          page({ path: '/b', html: html.prose(300) }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.affectedUrls).toHaveLength(2)
  })

  it('does not flag two genuinely different articles', () => {
    const findings = fire(
      'TECH-012',
      context({
        pages: [
          page({
            path: '/a',
            html: html.doc(
              `<h1>Tiles</h1><p>${'porcelain ceramic grout screed rectified bathroom kitchen floor '.repeat(30)}</p>`,
            ),
          }),
          page({
            path: '/b',
            html: html.doc(
              `<h1>Safari</h1><p>${'wildebeest migration crater lodge guide savannah elephant camp '.repeat(30)}</p>`,
            ),
          }),
        ],
      }),
    )

    expect(findings).toEqual([])
  })

  it('does not compare thin pages, where similarity means nothing', () => {
    // "Contact us" and "About us" land close together simply because there is not enough
    // text to tell them apart. Calling that duplicate content is a confident false positive.
    expect(
      fire(
        'TECH-012',
        context({
          pages: [
            page({ path: '/contact', html: html.doc('<h1>Contact</h1><p>Call us.</p>') }),
            page({ path: '/about', html: html.doc('<h1>About</h1><p>Call us.</p>') }),
          ],
        }),
      ),
    ).toEqual([])
  })
})

describe('TECH-013 and TECH-014: orphans and buried pages', () => {
  it('TECH-013 fires on a page nothing links to', () => {
    const findings = fire(
      'TECH-013',
      context({
        pages: [
          page({ path: '/', html: html.linkingTo('/a') }),
          page({ path: '/a' }),
          page({ path: '/orphan' }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.affectedUrls).toEqual([u('/orphan')])
  })

  it('TECH-013 never flags the homepage', () => {
    expect(
      fire(
        'TECH-013',
        context({ pages: [page({ path: '/', html: html.linkingTo('/a') }), page({ path: '/a' })] }),
      ),
    ).toEqual([])
  })

  it('TECH-014 fires on a page more than three clicks deep', () => {
    const findings = fire(
      'TECH-014',
      context({
        pages: [
          page({ path: '/', html: html.linkingTo('/1') }),
          page({ path: '/1', html: html.linkingTo('/2') }),
          page({ path: '/2', html: html.linkingTo('/3') }),
          page({ path: '/3', html: html.linkingTo('/4') }),
          page({ path: '/4' }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.affectedUrls).toEqual([u('/4')])
  })
})

describe('TECH-015: mixed content', () => {
  it('fires when an HTTPS page loads a script over HTTP', () => {
    const findings = fire(
      'TECH-015',
      context({
        pages: [
          page({
            path: '/',
            html: html.doc('<h1>H</h1><script src="http://cdn.example.com/a.js"></script>'),
          }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('high')
  })

  it('stays silent when every resource is https', () => {
    expect(
      fire(
        'TECH-015',
        context({
          pages: [
            page({
              path: '/',
              html: html.doc('<h1>H</h1><script src="https://cdn.example.com/a.js"></script>'),
            }),
          ],
        }),
      ),
    ).toEqual([])
  })

  it('stays silent on a protocol-relative URL, which inherits https', () => {
    expect(
      fire(
        'TECH-015',
        context({
          pages: [
            page({
              path: '/',
              html: html.doc('<h1>H</h1><script src="//cdn.example.com/a.js"></script>'),
            }),
          ],
        }),
      ),
    ).toEqual([])
  })
})

describe('TECH-016: hreflang without a return tag', () => {
  const withHreflang = (...alternates: [string, string][]) =>
    html.doc(
      '<h1>H</h1>',
      alternates
        .map(([lang, href]) => `<link rel="alternate" hreflang="${lang}" href="${href}">`)
        .join(''),
    )

  it('fires when the alternate does not link back', () => {
    const findings = fire(
      'TECH-016',
      context({
        pages: [
          page({ path: '/en', html: withHreflang(['sw', u('/sw')]) }),
          page({ path: '/sw', html: html.doc('<h1>H</h1>') }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
  })

  it('stays silent when the annotation is reciprocal', () => {
    expect(
      fire(
        'TECH-016',
        context({
          pages: [
            page({ path: '/en', html: withHreflang(['sw', u('/sw')]) }),
            page({ path: '/sw', html: withHreflang(['en', u('/en')]) }),
          ],
        }),
      ),
    ).toEqual([])
  })

  it('matches alternates by normalised URL, so a trailing slash does not hide the bug', () => {
    // The alternate is declared as /sw/ but the page was crawled as /sw. Keying on the
    // raw URL makes the crawled page look uncrawled, and the rule goes quiet on a site
    // that genuinely has broken hreflang. A false negative, and an invisible one.
    const findings = fire(
      'TECH-016',
      context({
        pages: [
          page({ path: '/en', html: withHreflang(['sw', `${u('/sw')}?utm_source=x`]) }),
          page({ path: '/sw', html: html.doc('<h1>H</h1>') }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
  })

  it('stays silent when the alternate was never crawled, because we know nothing', () => {
    expect(
      fire(
        'TECH-016',
        context({
          pages: [page({ path: '/en', html: withHreflang(['fr', 'https://fr.example.org/']) })],
        }),
      ),
    ).toEqual([])
  })
})

describe('TECH-017: soft 404', () => {
  it('fires on a thin page titled "Page not found" that returns 200', () => {
    const findings = fire(
      'TECH-017',
      context({
        pages: [
          page({
            path: '/missing',
            html: html.doc('<h1>Page not found</h1><p>Sorry.</p>', '<title>Page not found</title>'),
          }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
  })

  it('does NOT flag a real article about 404 pages', () => {
    // The false positive this rule exists to avoid. A 2,000-word guide titled "How to
    // design a good 404 page" is a real page, and flagging it would be embarrassing.
    expect(
      fire(
        'TECH-017',
        context({
          pages: [
            page({
              path: '/blog/404-pages',
              html: html.prose(400, 'How to design a good 404 page for your website.'),
            }),
          ],
        }),
      ),
    ).toEqual([])
  })

  it('stays silent on a page that correctly returns 404', () => {
    expect(
      fire(
        'TECH-017',
        context({
          pages: [
            page({ path: '/missing', status: 404, html: html.doc('<h1>Page not found</h1>') }),
          ],
        }),
      ),
    ).toEqual([])
  })
})

describe('TECH-018: client-side rendered', () => {
  it('fires when the server sends an empty shell', () => {
    const findings = fire(
      'TECH-018',
      context({
        pages: [
          page({
            path: '/',
            preJsHtml: html.doc('<div id="root"></div>'),
            html: html.prose(300),
          }),
        ],
      }),
    )

    expect(findings).toHaveLength(1)
  })

  it('stays silent on a server-rendered page', () => {
    const rendered = html.prose(300)

    expect(
      fire(
        'TECH-018',
        context({ pages: [page({ path: '/', preJsHtml: rendered, html: rendered })] }),
      ),
    ).toEqual([])
  })
})

describe('TECH-019 and TECH-020: headings', () => {
  it('TECH-019 fires when there is no h1', () => {
    expect(
      fire(
        'TECH-019',
        context({ pages: [page({ path: '/', html: html.doc('<h2>Only an h2</h2>') })] }),
      ),
    ).toHaveLength(1)
  })

  it('TECH-019 fires when there are two h1s', () => {
    expect(
      fire('TECH-019', context({ pages: [page({ path: '/', html: html.h1s(2) })] })),
    ).toHaveLength(1)
  })

  it('TECH-019 stays silent on exactly one h1', () => {
    expect(fire('TECH-019', context({ pages: [page({ path: '/', html: html.h1s(1) })] }))).toEqual(
      [],
    )
  })

  it('TECH-019 scores impact honestly, because multiple h1s are valid HTML5', () => {
    const finding = fire(
      'TECH-019',
      context({ pages: [page({ path: '/', html: html.h1s(2) })] }),
    )[0]

    expect(finding?.severity).toBe('low')
    expect(finding?.estimatedImpact).toBeLessThan(20)
    expect(finding?.falsification).toContain('Do not expect a ranking movement')
  })

  it('TECH-020 fires when a level is skipped', () => {
    const findings = fire(
      'TECH-020',
      context({ pages: [page({ path: '/', html: html.headings(1, 2, 4) })] }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toContain('h2 -> h4')
    expect(findings[0]?.severity).toBe('info')
  })

  it('TECH-020 stays silent on a clean hierarchy, including going back up', () => {
    expect(
      fire(
        'TECH-020',
        context({ pages: [page({ path: '/', html: html.headings(1, 2, 3, 2, 3) })] }),
      ),
    ).toEqual([])
  })
})

describe('TECH-021: the homepage has no meta description', () => {
  const withDescription = html.doc(
    '<h1>Home</h1><p>Body.</p>',
    '<title>Home</title><meta name="description" content="A safari company in Nairobi.">',
  )

  it('fires when the homepage has no meta description', () => {
    const findings = fire('TECH-021', context({ pages: [page({ path: '/' })] }))

    expect(findings).toHaveLength(1)
    expect(findings[0]?.affectedUrls).toEqual([u('/')])
    expect(findings[0]?.fixable).toBe(true)
  })

  it('stays silent when the homepage already has one', () => {
    expect(
      fire('TECH-021', context({ pages: [page({ path: '/', html: withDescription })] })),
    ).toEqual([])
  })

  it('fires when the description is present but empty or whitespace', () => {
    // content="" gives Google nothing to show, so it is no better than a missing tag.
    const blank = html.doc(
      '<h1>Home</h1>',
      '<title>Home</title><meta name="description" content="   ">',
    )
    const findings = fire('TECH-021', context({ pages: [page({ path: '/', html: blank })] }))

    expect(findings).toHaveLength(1)
    expect(findings[0]?.affectedUrls).toEqual([u('/')])
  })

  it('only looks at the homepage, not a deep page missing a description', () => {
    // A deep page with no description is not this rule's business; scoping to the seed keeps the
    // finding focused and the fixer's single head edit honest.
    expect(
      fire(
        'TECH-021',
        context({
          seed: u('/'),
          pages: [page({ path: '/', html: withDescription }), page({ path: '/deep' })],
        }),
      ),
    ).toEqual([])
  })
})

describe('AGENT-001: the site has no llms.txt', () => {
  it('fires when there is no llms.txt', () => {
    const findings = fire('AGENT-001', context({ pages: [page({ path: '/' })], llmsTxt: null }))

    expect(findings).toHaveLength(1)
    expect(findings[0]?.axis).toBe('agent_readiness')
    expect(findings[0]?.fixable).toBe(true)
    expect(findings[0]?.affectedUrls[0]).toBe(u('/'))
  })

  it('states honestly that llms.txt is not a Google ranking factor (rule 8)', () => {
    const findings = fire('AGENT-001', context({ pages: [page({ path: '/' })], llmsTxt: null }))
    // The disclaimer must live in the finding itself, so the UI cannot drop it.
    expect(findings[0]?.falsification).toMatch(/Google Search ignores it/i)
  })

  it('stays silent when a non-empty llms.txt is present', () => {
    expect(
      fire(
        'AGENT-001',
        context({ pages: [page({ path: '/' })], llmsTxt: '# Site\n\n> A site.\n\n- [Home](/)' }),
      ),
    ).toEqual([])
  })

  it('treats an empty or whitespace-only llms.txt as missing', () => {
    expect(
      fire('AGENT-001', context({ pages: [page({ path: '/' })], llmsTxt: '   ' })),
    ).toHaveLength(1)
  })

  it('lists the homepage first, then the most-linked pages, for the fixer', () => {
    // The affected URLs are what the fixer turns into the llms.txt page list, so their order
    // matters: the homepage leads, then pages ranked by how many internal links point at them.
    // /popular gets two inbound links (from / and /a); /quiet gets one (from / only).
    const findings = fire(
      'AGENT-001',
      context({
        seed: u('/'),
        pages: [
          page({ path: '/', html: html.linkingTo('/popular', '/quiet') }),
          page({ path: '/a', html: html.linkingTo('/popular') }),
          page({ path: '/popular' }),
          page({ path: '/quiet' }),
        ],
      }),
    )

    const urls = findings[0]!.affectedUrls
    expect(urls[0]).toBe(u('/')) // the homepage always leads
    // /popular has two inbound links, /quiet has one, so /popular ranks ahead of /quiet.
    expect(urls.indexOf(u('/popular'))).toBeLessThan(urls.indexOf(u('/quiet')))
  })
})

describe('LOCAL-001: contact details but no LocalBusiness schema', () => {
  const ldScript = (data: unknown) =>
    `<script type="application/ld+json">${JSON.stringify(data)}</script>`

  const orgWithAddress = html.doc(
    '<h1>Acme Cafe</h1>',
    ldScript({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Acme Cafe',
      address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Nairobi' },
      telephone: '+254700000000',
    }),
  )

  it('fires when the homepage shows an address but no LocalBusiness type', () => {
    const findings = fire(
      'LOCAL-001',
      context({ pages: [page({ path: '/', html: orgWithAddress })] }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.axis).toBe('local')
    expect(findings[0]?.fixable).toBe(true)
    // The evidence carries the contact data the fixer will re-type as a LocalBusiness.
    const contact = JSON.parse((findings[0]!.evidence as { snippet: string }).snippet)
    expect(contact.name).toBe('Acme Cafe')
    expect(contact.telephone).toBe('+254700000000')
  })

  it('stays silent when a LocalBusiness subtype is already present', () => {
    const restaurant = html.doc(
      '<h1>Acme</h1>',
      ldScript({
        '@type': 'Restaurant',
        name: 'Acme',
        address: { '@type': 'PostalAddress', streetAddress: '1 Main St' },
      }),
    )
    expect(fire('LOCAL-001', context({ pages: [page({ path: '/', html: restaurant })] }))).toEqual(
      [],
    )
  })

  it('stays silent when the site shows no contact data, so it is not evidently local', () => {
    const saas = html.doc('<h1>SaaS</h1>', ldScript({ '@type': 'WebSite', name: 'SaaS' }))
    expect(fire('LOCAL-001', context({ pages: [page({ path: '/', html: saas })] }))).toEqual([])
  })

  it('reads a LocalBusiness inside an @graph container', () => {
    const graph = html.doc(
      '<h1>Acme</h1>',
      ldScript({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite' },
          { '@type': 'LocalBusiness', name: 'Acme', telephone: '1' },
        ],
      }),
    )
    expect(fire('LOCAL-001', context({ pages: [page({ path: '/', html: graph })] }))).toEqual([])
  })
})
