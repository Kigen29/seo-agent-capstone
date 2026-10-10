import type { FixAttempt } from '@seo/api-client'
import { DataTable } from '@/components/ui/data-table'
import { OutboundLink } from '@/components/ui/outbound-link'

/**
 * The two tables on a finding: the pages it affects, and every attempt to fix it.
 *
 * A finding can affect several hundred pages, and listed in full they pushed everything under
 * them off the screen. They page now, like every other list.
 */

export function AffectedPages({ urls }: { urls: string[] }) {
  return (
    <section>
      <h2 className="h-section mb-3">Affected pages ({urls.length})</h2>
      <DataTable
        label="Pages this finding affects"
        columns={[{ header: 'Page', className: 'text-[13px]' }]}
        rows={urls.map((url) => ({
          key: url,
          cells: [
            <OutboundLink key="url" href={url}>
              {url}
            </OutboundLink>,
          ],
        }))}
      />
    </section>
  )
}

const ATTEMPT_LABEL: Record<FixAttempt['outcome'], { label: string; tag: string }> = {
  running: { label: 'Checking repository / preparing fix', tag: 'tag tag-outline' },
  pr_opened: { label: 'Opened a pull request', tag: 'tag tag-success' },
  pr_adopted: {
    label: 'Reused the pull request an earlier attempt opened',
    tag: 'tag tag-success',
  },
  failed: { label: 'Failed', tag: 'tag tag-critical' },
}

const attemptTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

/** What became of the pull request an attempt opened, when it opened one. */
function Resolution({ attempt }: { attempt: FixAttempt }) {
  if (attempt.revertedAt) return <span className="tag tag-critical">Merged, then reverted</span>
  if (attempt.prResolution === 'merged') return <span className="tag tag-success">Merged</span>
  if (attempt.prResolution === 'closed') return <span className="tag">Closed without merging</span>
  return null
}

/**
 * Every attempt to fix this finding, newest first.
 *
 * The note above shows only the latest failure. This keeps the rest, so a person can see how many
 * times the agent tried, why each failed, and which attempt opened the pull request.
 */
export function FixAttempts({ attempts }: { attempts: FixAttempt[] }) {
  return (
    <section className="mb-6" aria-labelledby="attempts-heading">
      <h2 id="attempts-heading" className="h-section mb-2">
        Fix attempts ({attempts.length})
      </h2>
      <DataTable
        label="Attempts to fix this finding"
        pageSize={5}
        columns={[
          { header: 'When', className: 'whitespace-nowrap' },
          { header: 'What happened' },
          { header: 'Pull request', className: 'whitespace-nowrap' },
        ]}
        rows={attempts.map((attempt, index) => ({
          key: `${attempt.startedAt}-${index}`,
          cells: [
            <span key="when" className="text-muted text-[13px]">
              {attemptTime.format(new Date(attempt.finishedAt ?? attempt.startedAt))}
            </span>,
            <div key="what" className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={ATTEMPT_LABEL[attempt.outcome].tag}>
                  {ATTEMPT_LABEL[attempt.outcome].label}
                </span>
                <Resolution attempt={attempt} />
              </div>
              {attempt.error && (
                <div className="text-muted text-[13px] break-words">{attempt.error}</div>
              )}
            </div>,
            <div key="pr" className="flex flex-col gap-1 text-[13px]">
              {attempt.prUrl && <OutboundLink href={attempt.prUrl}>Pull request</OutboundLink>}
              {attempt.revertPrUrl && (
                <OutboundLink href={attempt.revertPrUrl}>The revert</OutboundLink>
              )}
            </div>,
          ],
        }))}
      />
    </section>
  )
}
