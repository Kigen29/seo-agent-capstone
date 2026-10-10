import type { AuthorityMetrics } from '@seo/api-client'
import { DataTable } from '@/components/ui/data-table'
import { InfoHint } from '@/components/ui/info-hint'
import { OutboundLink, pathOf } from '@/components/ui/outbound-link'
import { ExcludedSites, NotUsButton } from './not-us'

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
 * A table, a page of sites at a time, so a brand with sixty mentions gets the same page as one
 * with six and the section below is never forty rows away.
 */

type Mention = NonNullable<AuthorityMetrics['mentions']>[number]

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

/** One row per site: what it is, which of its pages name the brand, and whether it links back. */
function SiteTable({
  label,
  sites,
  siteId,
  excluded,
}: {
  label: string
  sites: Site[]
  siteId: string
  excluded: string[]
}) {
  // Only worth a column when links were checked for at least one site. An all-blank column
  // would read as "none of them link", which is not what an unchecked audit knows.
  const linksChecked = sites.some((site) => site.linked !== undefined)

  return (
    <DataTable
      label={label}
      columns={[
        { header: 'Site' },
        { header: 'Pages that name you' },
        ...(linksChecked ? [{ header: 'Link back' }] : []),
        { header: 'Not your business?', hideHeader: true, align: 'end' as const },
      ]}
      rows={sites.map((site) => ({
        key: site.domain,
        cells: [
          <div key="site" className="font-semibold break-all">
            {site.domain}
          </div>,
          <ul key="pages" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {site.pages.map((page) => (
              <li key={page.url} className="min-w-0">
                <OutboundLink href={page.url}>{page.title ?? pathOf(page.url)}</OutboundLink>
                {page.title && (
                  <div className="text-muted text-[12px] break-all">{pathOf(page.url)}</div>
                )}
              </li>
            ))}
          </ul>,
          ...(linksChecked
            ? [
                site.linked === true ? (
                  <span key="link" className="tag tag-success">
                    Links to you
                  </span>
                ) : site.linked === false ? (
                  <span key="link" className="tag tag-accent">
                    No link yet
                  </span>
                ) : (
                  // Unknown is not "no link", so it is said in words and not left blank.
                  <span key="link" className="text-muted text-[13px]">
                    Not checked
                  </span>
                ),
              ]
            : []),
          <NotUsButton key="not-us" siteId={siteId} domain={site.domain} excluded={excluded} />,
        ],
      }))}
    />
  )
}

export function MentionList({
  mentions,
  measured,
  search,
  siteId,
  excluded,
}: {
  siteId: string
  /** Sites the owner has marked as a different business. Already left out of `mentions`. */
  excluded: string[]
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
          If a site here is a different business with the same name, mark it &ldquo;Not us&rdquo;
          and it is left out from then on.
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

      <SiteTable
        label="Sites that mention you"
        sites={earned}
        siteId={siteId}
        excluded={excluded}
      />

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
          <SiteTable
            label="Platforms you can post to yourself"
            sites={platforms}
            siteId={siteId}
            excluded={excluded}
          />
        </details>
      )}

      <ExcludedSites siteId={siteId} excluded={excluded} />
    </section>
  )
}
