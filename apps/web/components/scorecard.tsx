import type { Scorecard } from '@seo/core'

const AXIS_LABEL: Record<string, string> = {
  crawl_health: 'Crawl health',
  performance: 'Performance',
  content: 'Content',
  structure: 'Structure',
  authority: 'Authority',
  local: 'Local',
  ai_visibility: 'AI visibility',
  agent_readiness: 'Agent readiness',
}

const STATUS_STYLE: Record<string, string> = {
  good: 'text-emerald-400',
  needs_work: 'text-amber-400',
  poor: 'text-red-400',
  not_measured: 'text-neutral-600',
}

const STATUS_LABEL: Record<string, string> = {
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
 * never looked at. A wall of eight green circles is the artefact this product exists to
 * replace, and it would be trivially easy to render one by accident right here.
 *
 * There is deliberately no total. The axes move independently, and a site can have immaculate
 * crawl health while being invisible to every AI engine on the web. Averaging those into a 72
 * destroys the only information the user needed.
 */
export function ScorecardGrid({ scorecard }: { scorecard: Scorecard }) {
  return (
    <ul className="grid gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 sm:grid-cols-2">
      {scorecard.axes.map((axis) => {
        const measured = axis.score !== null

        return (
          <li key={axis.axis} className="bg-neutral-950 p-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-medium text-neutral-200">{AXIS_LABEL[axis.axis] ?? axis.axis}</p>

              <p className={`font-mono text-2xl tabular-nums ${STATUS_STYLE[axis.status]}`}>
                {measured ? Math.round(axis.score!) : '--'}
              </p>
            </div>

            <div className="mt-1 flex items-baseline justify-between gap-4">
              <p className="text-xs text-neutral-600">
                {axis.coverage.checksRun} {axis.coverage.checksRun === 1 ? 'check' : 'checks'}
              </p>
              <p className={`text-xs ${STATUS_STYLE[axis.status]}`}>{STATUS_LABEL[axis.status]}</p>
            </div>

            {/*
              The coverage note is not a disclaimer to be tucked away. It is the product.
              "AI visibility 100" from a single robots.txt check would be claiming we had
              verified the site is cited in ChatGPT, when all we verified is that the crawler
              is not blocked. The note says which data source is missing and what connecting
              it would buy.
            */}
            {axis.coverage.note && (
              <p className="mt-3 border-t border-neutral-900 pt-3 text-xs leading-relaxed text-neutral-500">
                {axis.coverage.note}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
