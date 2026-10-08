import type { AuthorityMetrics } from '@seo/api-client'
import { ExternalLink } from 'lucide-react'
import { InfoHint } from '@/components/ui/info-hint'

/**
 * Where the brand was mentioned: the pages, grouped by the site they are on.
 *
 * The figures at the top of the page say how many sites wrote about the business. This is what
 * those figures are made of, so they can be checked: every row opens the page that carried the
 * mention. Without it the count was a number to take on trust, and the first question anybody
 * asks of "six sites wrote about you" is "which ones, and what did they say?".
 *
 * Independent coverage leads, with whether each site links back when that was checked. Platforms
 * the business can post to itself (a social profile, a directory listing) are real mentions and
 * are not coverage, so they sit behind a disclosure and do not pad the list.
 *
 * A server component: it is a list of links, and it should be readable with JavaScript off.
 */

type Mention = NonNullable<AuthorityMetrics['mentions']>[number]

/** How many sites are shown before the rest fold away. Enough to see the shape of the coverage. */
const SHOWN = 8

interface Site {
  domain: string
  linked: boolean | undefined
  pages: Mention[]
}

function bySite(mentions: Mention[]): Site[] {
  const sites = new Map<string, Site>()
  for (const mention of mentions) {
    const site = sites.get(mention.domain) ?? {
      domain: mention.domain,
      linked: mention.linked,
      pages: [],
    }
    site.pages.push(mention)
    sites.set(mention.domain, site)
  }
  return [...sites.values()]
}

/** The path, since the site is already named on the row above it. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    const path = `${parsed.pathname}${parsed.search}`
    return path === '/' ? 'Home page' : decodeURI(path)
  } catch {
    return url
  }
}

function SiteRows({ sites }: { sites: Site[] }) {
  return (
    <ul className="frame m-0 list-none p-0">
      {sites.map((site, index) => (
        <li
          key={site.domain}
          className="px-4 py-3"
          style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 font-semibold break-all">{site.domain}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-muted tnum text-[13px]">
                {site.pages.length} {site.pages.length === 1 ? 'page' : 'pages'}
              </span>
              {/* Nothing at all when links were not checked: unknown is not "no link". */}
              {site.linked === true && <span className="tag tag-success">Links to you</span>}
              {site.linked === false && <span className="tag tag-accent">No link yet</span>}
            </span>
          </div>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
            {site.pages.map((page) => (
              <li key={page.url} className="min-w-0">
                <a
                  href={page.url}
                  target="_blank"
                  // The page being opened is somebody else's. It gets no handle on this tab and
                  // is not told which account was looking.
                  rel="noopener noreferrer nofollow"
                  className="inline-flex max-w-full items-baseline gap-1.5 text-sm"
                >
                  <span className="min-w-0 break-words">{page.title ?? pathOf(page.url)}</span>
                  <ExternalLink size={12} aria-hidden="true" className="shrink-0 self-center" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                {page.title && (
                  <div className="text-muted text-[12px] break-all">{pathOf(page.url)}</div>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

export function MentionList({
  mentions,
  measured,
  search,
}: {
  /** How the mentions were found. Absent on an audit from before this was recorded. */
  search?: { brand: string; leftOut: number } | undefined
  /** Undefined on an audit from before the pages were kept. */
  mentions: Mention[] | undefined
  /** Mentions were counted on this audit, so a missing list means "not recorded", not "none". */
  measured: boolean
}) {
  if (!measured) return null

  const earned = bySite((mentions ?? []).filter((mention) => mention.kind === 'earned'))
  const platforms = bySite((mentions ?? []).filter((mention) => mention.kind === 'self_published'))

  return (
    <section className="mt-8" aria-labelledby="mentions-heading">
      <div className="mb-1 flex items-center gap-1">
        <h2 id="mentions-heading" className="h-section m-0">
          Where you were mentioned
        </h2>
        <InfoHint label="how mentions are found">
          We search the web for your brand name, written exactly, and leave out your own site. Each
          result is a page that names you. They are grouped by site, because ten pages on one news
          site is still one publication. A search returns its top results, so this is the coverage
          that is easiest to find, not a list of every mention that exists.
        </InfoHint>
      </div>
      <div className="text-muted mb-3 max-w-[68ch] text-sm">
        The pages behind the figures above. Open any of them to read what was said.
      </div>

      {/*
        The working, shown. A count nobody can trace is a count nobody should trust, and the one
        time this axis was badly wrong it was because a search engine answered a different
        question from the one asked and nothing on the page said what had been asked.
      */}
      {search && (
        <div className="text-muted mb-3 max-w-[68ch] text-[13px]">
          Searched for the exact name &ldquo;{search.brand}&rdquo;, leaving out your own site. A
          result is only counted when its title, summary or address contains that name as written.
          {search.leftOut > 0 && (
            <>
              {' '}
              <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                {search.leftOut} {search.leftOut === 1 ? 'result was' : 'results were'} left out
              </span>{' '}
              because {search.leftOut === 1 ? 'it did' : 'they did'} not, which usually means a
              business with a similar name.
            </>
          )}
        </div>
      )}

      {/*
        An audit from before each result was checked for the name. Its figures may describe a
        business with a similar name, and saying so is better than showing them as fact.
      */}
      {mentions !== undefined && !search && (
        <div role="alert" className="note note-warn mb-3 max-w-[68ch]">
          <div className="font-semibold">These results were not checked for your exact name</div>
          <div className="mt-0.5">
            This audit was measured before that check existed, so some or all of the pages below,
            and the figures above, may be about a business with a similar name. Run a new audit and
            only pages that contain your name as written will be counted.
          </div>
        </div>
      )}

      {mentions === undefined && (
        <div className="note note-info max-w-[68ch]">
          The pages were not recorded on this audit, only how many sites there were. Run a new audit
          and each mention will be listed here with a link to it.
        </div>
      )}

      {mentions !== undefined && earned.length === 0 && (
        <div className="note note-info max-w-[68ch]">
          No independent site was found that mentions your brand name as written. If that looks
          wrong, check the brand name on site setup is spelled the way the press writes it.
        </div>
      )}

      {earned.length > 0 && <SiteRows sites={earned.slice(0, SHOWN)} />}

      {earned.length > SHOWN && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px]">
            Show {earned.length - SHOWN} more {earned.length - SHOWN === 1 ? 'site' : 'sites'}
          </summary>
          <div className="mt-3">
            <SiteRows sites={earned.slice(SHOWN)} />
          </div>
        </details>
      )}

      {platforms.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px]">
            {platforms.length} {platforms.length === 1 ? 'platform' : 'platforms'} you can post to
            yourself
          </summary>
          <div className="text-muted mt-2 mb-3 max-w-[68ch] text-[13px]">
            Profiles and listings. They are real mentions and worth keeping accurate, and they are
            not counted as coverage, because nobody else chose to write them.
          </div>
          <SiteRows sites={platforms} />
        </details>
      )}
    </section>
  )
}
