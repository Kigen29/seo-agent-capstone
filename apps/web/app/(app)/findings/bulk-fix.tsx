import { Note } from '@/components/ui/note'
import { SubmitButton } from '@/components/ui/submit-button'
import { openFixPrs } from './actions'

/** How many pull requests one click asks for. The API enforces the same number. */
export const BULK_FIX_LIMIT = 10

/**
 * One click for several pull requests.
 *
 * Each finding still gets its own pull request, because a reviewer should be able to merge the
 * canonical fix and send the heading fix back, and because each one is verified against the live
 * site separately after it merges. What this removes is opening findings one by one to press the
 * same button.
 */
export function BulkFix({ siteId, fixable }: { siteId: string; fixable: number }) {
  if (fixable === 0) return null
  const count = Math.min(fixable, BULK_FIX_LIMIT)

  return (
    <div
      className="card elev-sm mb-5 flex flex-wrap items-center gap-3"
      style={{ padding: 'var(--space-4)' }}
    >
      <p className="m-0 min-w-0 flex-1 text-sm" style={{ minWidth: '28ch' }}>
        The agent can open a pull request for <strong>{fixable}</strong> open{' '}
        {fixable === 1 ? 'finding' : 'findings'} on this site.{' '}
        <span className="text-muted">
          Each gets its own pull request, most important first
          {fixable > BULK_FIX_LIMIT ? `, ${BULK_FIX_LIMIT} at a time` : ''}.
        </span>
      </p>
      <form action={openFixPrs}>
        <input type="hidden" name="siteId" value={siteId} />
        <SubmitButton pendingLabel="Asking the agent..." className="btn btn-primary btn-sm">
          Open {count} pull {count === 1 ? 'request' : 'requests'}
        </SubmitButton>
      </form>
    </div>
  )
}

/** What the last request for several pull requests did, read back from the address. */
export function BulkFixOutcome({ params }: { params: Record<string, string | undefined> }) {
  if (params.bulk === 'failed') {
    return (
      <Note tone="error" className="mb-5">
        The request did not reach the agent, so no pull requests were asked for. Try again in a
        moment.
      </Note>
    )
  }
  if (params.bulk !== 'done') return null

  const queued = Number(params.queued) || 0
  const skipped = Number(params.skipped) || 0
  const remaining = Number(params.remaining) || 0

  return (
    <Note tone={queued > 0 ? 'ok' : 'info'} className="mb-5">
      {queued > 0
        ? `The agent is working on ${queued} pull ${queued === 1 ? 'request' : 'requests'}. Each finding shows its own progress, and a pull request appears on it when it is ready.`
        : 'No pull requests were asked for.'}
      {skipped > 0 &&
        ` ${skipped} ${skipped === 1 ? 'finding was' : 'findings were'} left out${params.why ? `: ${params.why}` : '.'}`}
      {remaining > 0 && ` ${remaining} more can be asked for once these are in.`}
    </Note>
  )
}
