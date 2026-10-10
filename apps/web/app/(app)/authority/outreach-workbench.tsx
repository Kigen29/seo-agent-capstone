'use client'

import type { ContributorSearch } from '@seo/api-client'
import { useState } from 'react'
import { DataTable } from '@/components/ui/data-table'
import { OutboundLink } from '@/components/ui/outbound-link'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmailComposer, type Fact } from './email-composer'
import { FindPublications, type Target } from './find-publications'
import { Empty, Lead } from './outreach-parts'

/**
 * Who to contact, in three lists, with one email composer between them.
 *
 * The page used to print the three lists one under another, each row carrying its own folded
 * form. It was long before anybody opened anything, and there was no telling which list mattered
 * most. They are tabs now, ordered by how likely a reply is, with the count on each tab so an
 * empty one costs no scrolling:
 *
 *   1. wrote about you and did not link (they already know you),
 *   2. link to your competitors and not to you (they cover your field),
 *   3. publications that invite contributors (cold, found by search).
 *
 * Every row has the same single action, and it opens the same composer.
 */

export interface LinkGap {
  editorialDomains: string[]
  refusedAsSpam: number
  directoryDomains: string[]
  comparedWith: string[]
}

export function OutreachWorkbench({
  siteId,
  unlinked,
  mentionPages,
  sampled,
  gap,
  market,
}: {
  siteId: string
  /** Undefined when links were never checked, which is different from an empty list. */
  unlinked?: string[] | undefined
  /** The pages that mention the brand, so a row can open the mention and not just the site. */
  mentionPages?: { url: string; domain: string; title?: string }[] | undefined
  sampled?: number | null | undefined
  gap?: LinkGap | undefined
  /** The site's market, to start the search field from. */
  market?: string | null | undefined
}) {
  const [target, setTarget] = useState<string | null>(null)
  const [fact, setFact] = useState<Fact>({ claim: '', sourceUrl: '' })
  const [drafted, setDrafted] = useState<Set<string>>(new Set())
  const [found, setFound] = useState<ContributorSearch | null>(null)

  const mentions = unlinked ?? []
  /**
   * The page on each site that mentions the brand, when the audit kept it. Somebody about to
   * write to a publication should land on what it said about them, not on its front page.
   */
  const mentionOn = (domain: string): Target => {
    const page = mentionPages?.find((entry) => entry.domain === domain)
    return page
      ? { domain, url: page.url, ...(page.title ? { detail: page.title } : {}) }
      : { domain }
  }
  const editorial = gap?.editorialDomains ?? []
  const first = mentions.length > 0 ? 'mentions' : editorial.length > 0 ? 'gap' : 'find'

  const list = (targets: Target[]) => (
    <TargetList targets={targets} drafted={drafted} onWrite={setTarget} />
  )

  return (
    <>
      <Tabs defaultValue={first}>
        <TabsList>
          <TabsTrigger value="mentions">Wrote about you ({mentions.length})</TabsTrigger>
          <TabsTrigger value="gap">Link to competitors ({editorial.length})</TabsTrigger>
          <TabsTrigger value="find">
            Find publications{found ? ` (${found.opportunities.length})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mentions">
          <Lead>
            These publications have already written about you and did not link. They know who you
            are, so the ask is small and a reply is far more likely than from a cold email.
            {sampled
              ? ` Checked against your top ${sampled} linking sites, so open each one to confirm before you write.`
              : ''}
          </Lead>
          {unlinked === undefined ? (
            <Empty>
              Not checked on the last audit. This list needs a backlink index as well as mention
              data, and only the mentions were available.
            </Empty>
          ) : mentions.length === 0 ? (
            <Empty>
              Every publication that mentions you already links to you. Nothing to chase here.
            </Empty>
          ) : (
            list(mentions.map(mentionOn))
          )}
        </TabsContent>

        <TabsContent value="gap">
          {gap ? (
            <>
              <Lead>
                Sites that link to every one of {gap.comparedWith.join(', ')} and not to you. Only
                real publications are listed. {gap.refusedAsSpam}{' '}
                {gap.refusedAsSpam === 1 ? 'link farm was' : 'link farms were'} left out, and{' '}
                {gap.directoryDomains.length}{' '}
                {gap.directoryDomains.length === 1 ? 'directory is' : 'directories are'} listings to
                claim, not editors to email.
              </Lead>
              {editorial.length === 0 ? (
                <Empty>
                  Nothing worth an email. Every site linking to all of your competitors and not to
                  you was a link farm or a directory. That says something about their links, not
                  about your site.
                </Empty>
              ) : (
                list(editorial.map((domain) => ({ domain })))
              )}
            </>
          ) : (
            <Empty>
              Not compared yet. This needs at least one competitor on the site setup page and a
              backlink index, and it is worked out during an audit.
            </Empty>
          )}
        </TabsContent>

        <TabsContent value="find">
          <FindPublications
            siteId={siteId}
            market={market ?? ''}
            result={found}
            onResult={setFound}
          >
            {(candidates) => list(candidates)}
          </FindPublications>
        </TabsContent>
      </Tabs>

      <EmailComposer
        siteId={siteId}
        domain={target}
        fact={fact}
        onFact={setFact}
        onDrafted={(domain) => setDrafted((current) => new Set(current).add(domain))}
        onClose={() => setTarget(null)}
      />
    </>
  )
}

/** One row per publication: where it is, and the one thing to do about it. */
function TargetList({
  targets,
  drafted,
  onWrite,
}: {
  targets: Target[]
  drafted: Set<string>
  onWrite: (domain: string) => void
}) {
  return (
    <DataTable
      label="Publications to contact"
      columns={[
        { header: 'Publication' },
        { header: 'What they published' },
        { header: 'Email', hideHeader: true, align: 'end' },
      ]}
      rows={targets.map((target) => ({
        key: target.domain,
        cells: [
          <OutboundLink key="site" href={target.url ?? `https://${target.domain}`}>
            {target.domain}
          </OutboundLink>,
          <span key="detail" className="text-muted text-[13px]">
            {target.detail ?? 'Open the site to see what they cover.'}
          </span>,
          <div key="write" className="flex items-center justify-end gap-2">
            {drafted.has(target.domain) && <span className="tag tag-success">Drafted</span>}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onWrite(target.domain)}
            >
              {drafted.has(target.domain) ? 'Write again' : 'Write email'}
              <span className="sr-only"> to {target.domain}</span>
            </button>
          </div>,
        ],
      }))}
    />
  )
}
