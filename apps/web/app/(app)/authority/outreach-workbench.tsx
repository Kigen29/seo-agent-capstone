'use client'

import type { ContributorSearch } from '@seo/api-client'
import { useId, useState, useTransition } from 'react'
import { ErrorNote } from '@/components/ui/error-note'
import { Field } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { UserError } from '@/lib/user-error'
import { findContributors } from './contributor-action'
import { EmailComposer, type Fact } from './email-composer'

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

/** Matches the API's limit on the niche. */
const NICHE_MAX = 120

interface Target {
  domain: string
  /** Where the row links to. Defaults to the domain's homepage. */
  url?: string
  /** A line under the domain: a page title, when there is one. */
  detail?: string
}

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

function Lead({ children }: { children: React.ReactNode }) {
  return <div className="text-muted mb-3 max-w-[68ch] text-sm">{children}</div>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="note note-info max-w-[68ch]">{children}</div>
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
    <ul className="frame m-0 list-none p-0">
      {targets.map((target, index) => (
        <li
          key={target.domain}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}
        >
          <div className="min-w-0 flex-1">
            <a
              href={target.url ?? `https://${target.domain}`}
              target="_blank"
              rel="noreferrer"
              className="break-all"
            >
              {target.domain}
            </a>
            {target.detail && <div className="text-muted mt-0.5 text-[13px]">{target.detail}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {drafted.has(target.domain) && <span className="tag tag-success">Drafted</span>}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onWrite(target.domain)}
            >
              {drafted.has(target.domain) ? 'Write again' : 'Write email'}
              <span className="sr-only"> to {target.domain}</span>
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Publications that invite contributors in the client's field.
 *
 * The ask is coverage, not a link, because that is what the evidence supports. And every
 * candidate's page has been read before it appears, with the ones selling placements shown as
 * refused rather than quietly dropped, so a client can see the filter working and argue with it.
 */
function FindPublications({
  siteId,
  market,
  result,
  onResult,
  children,
}: {
  siteId: string
  market: string
  result: ContributorSearch | null
  onResult: (result: ContributorSearch) => void
  children: (candidates: Target[]) => React.ReactNode
}) {
  const id = useId()
  const [niche, setNiche] = useState('')
  const [locale, setLocale] = useState(market)
  const [error, setError] = useState<UserError | null>(null)
  const [pending, start] = useTransition()

  function search(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    start(async () => {
      const answer = await findContributors(siteId, niche.trim(), locale.trim())
      if (!answer.ok) {
        setError(answer.error)
        return
      }
      onResult(answer.data)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Lead>
        Publications in your field that invite outside writers. Each page is read before it is
        listed, and any that sell placements are refused and named, because paying for those is the
        one tactic that can cost you rankings.
      </Lead>

      <form onSubmit={search} className="card" style={{ padding: 'var(--space-5)' }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <Field
              id={`${id}-niche`}
              label="Your topic, in two or three words"
              hint={{
                about: 'how the topic is searched',
                body: 'It is searched as an exact phrase, so use the words a publication would use for its subject, such as "safari tours" or "Kenya travel", not a description of your business. The search is paid for from your monthly allowance and reads each page it finds, so it takes a few seconds.',
              }}
            >
              <input
                id={`${id}-niche`}
                className="input"
                value={niche}
                onChange={(event) => setNiche(event.target.value)}
                placeholder="safari tours"
                spellCheck={false}
                maxLength={NICHE_MAX}
              />
            </Field>
          </div>
          <div className="w-[12rem]">
            <Field id={`${id}-market`} label="Market (optional)">
              <input
                id={`${id}-market`}
                className="input"
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
                placeholder="Kenya"
                spellCheck={false}
              />
            </Field>
          </div>
          <button
            type="submit"
            className="btn btn-primary shrink-0"
            disabled={pending || niche.trim().length < 3}
          >
            {pending ? 'Searching...' : 'Find publications'}
          </button>
        </div>
      </form>

      <ErrorNote error={error} />

      {result?.note && <div className="text-muted text-[13px]">{result.note}</div>}

      {result &&
        result.opportunities.length > 0 &&
        children(
          result.opportunities.map((candidate) => ({
            domain: candidate.domain,
            url: candidate.url,
            ...(candidate.title ? { detail: candidate.title } : {}),
          })),
        )}

      {result && result.opportunities.length === 0 && !result.note && (
        <Empty>
          Nothing passed the check. For a narrow topic that is a real answer: the pages found were
          either selling placements or not inviting writers at all. Try a broader phrase.
        </Empty>
      )}

      {result && result.refused.length > 0 && (
        <details>
          <summary className="text-muted cursor-pointer text-[13px]">
            {result.refused.length} refused for selling placements
          </summary>
          <ul className="text-muted mt-2 grid gap-2 pl-5 text-[13px]">
            {result.refused.map((candidate) => (
              <li key={candidate.domain}>
                <span className="break-all">{candidate.domain}</span>
                {candidate.matched.length > 0 && <>: {candidate.matched.slice(0, 3).join(', ')}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
