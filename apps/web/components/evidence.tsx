import type { Evidence } from '@seo/core'

/**
 * Evidence is a discriminated union, and each kind has something different worth showing.
 * Rendering a JSON blob would be technically complete and useless: the point is that a human
 * can look at this and check it themselves.
 *
 * The return type is annotated rather than inferred, and that is load-bearing. Without it, a
 * switch missing a variant infers `JSX.Element | undefined`, which is a perfectly legal React
 * child, so an unhandled evidence kind renders as an empty panel and nothing anywhere fails.
 * That is exactly how the `citation` variant went unrendered from the day it was added: the
 * same omission in `pr-body.ts` broke the build immediately, because that switch returns a
 * `string` and has nowhere to hide an `undefined`. Annotating buys the same protection here.
 */
export function EvidenceBlock({ evidence }: { evidence: Evidence }): React.ReactElement {
  const pre = (text: string) => <pre className="mono">{text}</pre>
  const caption = (text: string) => (
    <p
      style={{ margin: 'var(--space-2) 0 0', fontSize: 12, opacity: 0.55, wordBreak: 'break-all' }}
    >
      {text}
    </p>
  )

  switch (evidence.kind) {
    case 'http':
      return pre(
        [
          `${evidence.url}`,
          `status: ${evidence.status}`,
          evidence.redirectChain.length > 0
            ? `redirects: ${evidence.redirectChain.join(' -> ')}`
            : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
      )

    case 'markup':
      return (
        <>
          {/* An empty snippet means the element was absent, which is usually the finding. */}
          {pre(evidence.snippet === '' ? '(the element was not there)' : evidence.snippet)}
          {caption(`${evidence.url} @ ${evidence.locator}`)}
        </>
      )

    case 'metric':
      return (
        <>
          {pre(`${evidence.metric}: ${evidence.value}${evidence.unit}`)}
          {/*
            Core Web Vitals mean nothing without their percentile: they are defined at the
            75th of real Chrome users over 28 days. Printing a bare number invites a lab
            measurement to be read as a field one, which is the single most common way an
            SEO report misleads. If we know the percentile, we say it.
          */}
          {evidence.percentile !== undefined &&
            caption(`at the ${evidence.percentile}th percentile of real users`)}
        </>
      )

    case 'file':
      return (
        <>
          {pre(evidence.excerpt)}
          {caption(`${evidence.path}${evidence.line !== undefined ? `:${evidence.line}` : ''}`)}
        </>
      )

    case 'graph':
      return (
        <>
          {pre(
            [
              `inbound internal links: ${evidence.inboundInternalLinks}`,
              `click depth from the homepage: ${evidence.clickDepth ?? 'unreachable by crawling'}`,
            ].join('\n'),
          )}
          {caption(evidence.url)}
        </>
      )

    case 'search':
      return (
        <>
          {pre(
            [
              evidence.query ? `query: "${evidence.query}"` : undefined,
              `average position: ${evidence.position.toFixed(1)}`,
              `impressions: ${evidence.impressions.toLocaleString()}`,
              `clicks: ${evidence.clicks.toLocaleString()}`,
              `click-through rate: ${(evidence.ctr * 100).toFixed(1)}%`,
            ]
              .filter(Boolean)
              .join('\n'),
          )}
          {caption(
            `Real Search Console data over ${evidence.startDate} to ${evidence.endDate}. Position is the average rank across those impressions; Search Console lags two to three days.`,
          )}
        </>
      )

    case 'citation':
      return (
        <>
          {pre(
            [
              `"${evidence.prompt}"`,
              '',
              `cited in ${evidence.citedCount} of ${evidence.pollsRun} checks, across ${evidence.daysPolled} days`,
              `engines: ${evidence.engines.join(', ') || 'no engine'}`,
              // An empty list is the whole finding on AIV-001, so it says so rather than
              // vanishing. A missing row and a row reading zero look identical to a reader
              // who does not know the row was supposed to be there.
              evidence.matchedSources.length > 0
                ? `matched: ${evidence.matchedSources.join('\n         ')}`
                : 'matched: no answer cited this site',
              evidence.citedCompetitors.length > 0
                ? `also cited: ${evidence.citedCompetitors.join(', ')}`
                : undefined,
              evidence.consensus
                ? `the answers agreed on ${evidence.consensus.currency} ` +
                  `${evidence.consensus.low.toLocaleString('en-US')} to ` +
                  `${evidence.consensus.high.toLocaleString('en-US')} ` +
                  `(${evidence.consensus.answers} answers named a figure)`
                : undefined,
            ]
              .filter((line) => line !== undefined)
              .join('\n'),
          )}
          {/*
            The counts are the claim, and the caption is why they are stated as counts. Roughly
            45% of citations appear in only one of three checks, so a single "yes" is noise and
            a bare "you are cited" would be a claim this axis refuses to make (ADR-0015). The
            matched URLs above are what makes it falsifiable: if none of them is this site, the
            poller was wrong, and a reader can check that without us.
          */}
          {caption(
            'Each prompt is polled at least three times across at least three days. A citation ' +
              'in one check out of three is not reported as a citation, because roughly 45% of ' +
              'citations appear in only one of three checks. The matched URLs are what the ' +
              'parser actually found in the answers and their sources.',
          )}
        </>
      )
  }
}
