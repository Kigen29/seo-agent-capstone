import Link from 'next/link'
import { setupProgress, type SetupStep } from '@/lib/setup-progress'

/**
 * One line on the dashboard: how much of the setup is done, and the next thing worth doing.
 *
 * The whole checklist used to sit here, collapsed, under the scorecard. It was the wrong page for
 * it: a dashboard answers "how is the site doing", and five rows of connect buttons answer a
 * different question. What the dashboard does owe is a reminder that something is unfinished and
 * a single way to go and finish it.
 *
 * Renders nothing once everything is set up, so a finished account is not nagged.
 */
export function SetupStrip({ siteId, steps }: { siteId: string; steps: SetupStep[] }) {
  const { done, total, next } = setupProgress(steps)
  if (!next) return null

  return (
    <div
      className="mt-6 mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-5 py-3"
      style={{ borderColor: 'var(--color-divider)', background: 'var(--color-raised)' }}
    >
      <div className="min-w-0">
        <div className="font-semibold">
          Setup: {done} of {total} done
        </div>
        <div className="text-muted mt-0.5 text-[13px]">Next: {next.next}.</div>
      </div>
      <Link href={`/site?siteId=${siteId}`} className="btn btn-primary btn-sm shrink-0">
        Finish setup
      </Link>
    </div>
  )
}
