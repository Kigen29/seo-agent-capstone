import type { Axis, AxisStatus, Scorecard } from '@seo/core'

/**
 * Keyed by the domain types, not by `string`.
 *
 * With `Record<string, string>` a ninth axis could be added to `@seo/core` and this file
 * would still compile: the new axis would simply render with no label, silently, and nobody
 * would find out until they saw a blank row in production. Keying on `Axis` means adding one
 * is a compile error here, which is the whole reason the Postgres enums are derived from the
 * Zod schemas rather than retyped.
 */
const AXIS_LABEL: Record<Axis, string> = {
  crawl_health: 'Crawl health',
  performance: 'Performance',
  content: 'Content',
  structure: 'Structure',
  authority: 'Authority',
  local: 'Local',
  ai_visibility: 'AI visibility',
  agent_readiness: 'Agent readiness',
}

/** The dot on the hairline track, coloured by band. Not measured shows no dot at all. */
const DOT_COLOR: Record<AxisStatus, string> = {
  good: 'var(--color-accent-700)',
  needs_work: 'var(--color-accent-500)',
  poor: 'var(--color-neutral-500)',
  not_measured: 'transparent',
}

const STATUS_LABEL: Record<AxisStatus, string> = {
  good: 'Good',
  needs_work: 'Needs work',
  poor: 'Poor',
  not_measured: 'Not measured',
}

/**
 * Eight scores, never one, and four of them are honestly blank.
 *
 * The unmeasured axes render a dash, not a zero and not a hundred. Zero would read as
 * failure and a hundred as a clean bill of health, and both would be lies about something we
 * never looked at. A wall of eight full bars is the artefact this product exists to replace,
 * and it would be trivially easy to render one by accident right here.
 *
 * There is deliberately no total. The axes move independently, and a site can have immaculate
 * crawl health while being invisible to every AI engine on the web. Averaging those into a 72
 * destroys the only information the user needed.
 */
export function ScorecardGrid({ scorecard }: { scorecard: Scorecard }) {
  return (
    <div className="card elev-sm" style={{ padding: 'var(--space-6)' }}>
      {scorecard.axes.map((axis) => {
        const measured = axis.score !== null
        const pct = measured ? Math.round(axis.score!) : 0
        const good = axis.status === 'good'

        return (
          <div key={axis.axis}>
            <div className="score-row">
              <div style={{ fontSize: 13 }}>{AXIS_LABEL[axis.axis]}</div>

              <div className="score-track">
                {measured && (
                  <span
                    className="score-dot"
                    style={{ left: `${pct}%`, background: DOT_COLOR[axis.status] }}
                  />
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'flex-end',
                  gap: 'var(--space-3)',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
                  }}
                >
                  {STATUS_LABEL[axis.status]}
                </span>
                <span
                  className="tnum"
                  style={{
                    fontSize: 15,
                    minWidth: 28,
                    textAlign: 'right',
                    color: good ? 'var(--color-accent-700)' : 'var(--color-text)',
                  }}
                >
                  {measured ? pct : '--'}
                </span>
              </div>
            </div>

            {/*
              The coverage note is not a disclaimer to be tucked away. It is the product.
              "AI visibility 100" from a single robots.txt check would be claiming we had
              verified the site is cited in ChatGPT, when all we verified is that the crawler
              is not blocked. The note says which data source is missing and what connecting
              it would buy.
            */}
            {axis.coverage.note && (
              <p
                style={{
                  margin: '0 0 var(--space-2)',
                  paddingLeft: 'calc(150px + var(--space-4))',
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
                }}
              >
                {axis.coverage.note}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
