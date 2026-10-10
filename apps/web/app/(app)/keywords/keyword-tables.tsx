import type { KeywordGapResult, KeywordIdeasResult } from '@seo/api-client'
import type { ReactNode } from 'react'
import { DataTable } from '@/components/ui/data-table'
import { Legend } from '@/components/ui/legend'
import { OutboundLink } from '@/components/ui/outbound-link'

/**
 * The two tables on the keyword page: related searches, and what a competitor ranks for.
 *
 * Out of the page file so the page is what is fetched and what is said when nothing came back,
 * and this is the rows.
 */

/**
 * A figure, or a dash when the vendor reported none. Never a zero.
 *
 * The vendor not reporting a volume and a keyword nobody searches for are different facts, and
 * only one of them is a reason to drop the keyword.
 */
function Figure({
  value,
  children,
}: {
  value: number | null
  children: (value: number) => ReactNode
}) {
  if (value === null) {
    return (
      <>
        <span className="text-subtle" aria-hidden="true">
          &ndash;
        </span>
        <span className="sr-only">Not reported</span>
      </>
    )
  }
  return <span className="tnum">{children(value)}</span>
}

/** Related searches, the most searched first, with the key to the three figures above them. */
export function IdeasTable({ ideas }: { ideas: KeywordIdeasResult['ideas'] }) {
  const sorted = [...ideas].sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1))
  return (
    <>
      {/*
        The three figures, said once in the open. Two of them are about advertising, which is
        easy to misread as "how hard is it to rank".
      */}
      <Legend
        className="mb-3"
        items={[
          {
            term: 'Monthly searches',
            meaning: 'Google’s estimate of how often this is searched in the chosen country.',
          },
          {
            term: 'Ad competition',
            meaning:
              'How many advertisers bid on it. A sign that the search is worth money, not of how hard it is to rank for.',
          },
          {
            term: 'Cost per click',
            meaning:
              'What an advertiser pays for one visitor. You pay nothing; a high figure means buyers are searching.',
          },
        ]}
      />
      <DataTable
        label="Related searches"
        pageSize={15}
        columns={[
          { header: 'Keyword' },
          { header: 'Monthly searches', align: 'end' },
          { header: 'Ad competition', align: 'end' },
          { header: 'Cost per click', align: 'end' },
        ]}
        rows={sorted.map((idea) => ({
          key: idea.keyword,
          cells: [
            idea.keyword,
            <Figure key="volume" value={idea.searchVolume}>
              {(volume) => volume.toLocaleString('en-US')}
            </Figure>,
            <Figure key="competition" value={idea.competition}>
              {(competition) => competition.toFixed(2)}
            </Figure>,
            <Figure key="cpc" value={idea.cpc}>
              {(cpc) => `$${cpc.toFixed(2)}`}
            </Figure>,
          ],
        }))}
      />
    </>
  )
}

/** Searches a competitor appears for and the client does not, with the page that ranks. */
export function GapTable({ keywords }: { keywords: KeywordGapResult['keywords'] }) {
  return (
    <DataTable
      label="Searches the competitor ranks for and you do not"
      pageSize={15}
      className="mt-4"
      columns={[
        { header: 'Keyword' },
        { header: 'Monthly searches', align: 'end' },
        { header: 'Their position', align: 'end' },
        { header: 'Their page' },
      ]}
      rows={keywords.map((entry) => ({
        key: entry.keyword,
        cells: [
          entry.keyword,
          <Figure key="volume" value={entry.searchVolume}>
            {(volume) => volume.toLocaleString('en-US')}
          </Figure>,
          <Figure key="position" value={entry.competitorPosition}>
            {(position) => position}
          </Figure>,
          entry.competitorUrl ? (
            <OutboundLink key="page" href={entry.competitorUrl} className="text-[13px]">
              {entry.competitorUrl.replace(/^https?:\/\//, '')}
            </OutboundLink>
          ) : (
            <Figure key="page" value={null}>
              {() => null}
            </Figure>
          ),
        ],
      }))}
    />
  )
}
