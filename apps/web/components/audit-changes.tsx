import type { AuditChanges, ChangedFinding } from '@seo/api-client'
import Link from 'next/link'
import { AXIS_LABEL, STATUS_LABEL } from '@/app/(app)/findings/labels'

/**
 * What this audit resolved and raised, against the completed audit before it.
 *
 * This is the audit trail for a fix. A pull request merging says the code changed; an issue the
 * earlier audit raised and this one did not is the evidence that the site did. So a resolved
 * issue shows the pull request that was open or merged for it, when there was one, and says
 * plainly when there was not: an issue can also stop being detected because the page it was on
 * was not reached this time, which the page counts at the bottom let a reader judge.
 */
const SEVERITY_TAG: Record<string, string> = {
  critical: 'tag tag-critical',
  high: 'tag tag-high',
  medium: 'tag tag-medium',
  low: 'tag tag-low',
  info: 'tag tag-neutral',
}

function ChangeList({ rows, resolved }: { rows: ChangedFinding[]; resolved: boolean }) {
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {rows.map((row) => (
        <li key={row.rowId} className="flex flex-wrap items-baseline gap-2 text-sm">
          <span className={SEVERITY_TAG[row.severity] ?? 'tag tag-neutral'}>{row.severity}</span>
          <Link href={`/findings/${row.rowId}`} className="min-w-0">
            {row.title}
          </Link>
          {resolved &&
            (row.prUrl ? (
              <a href={row.prUrl} target="_blank" rel="noopener noreferrer" className="text-[13px]">
                {STATUS_LABEL[row.status]?.label ?? row.status} pull request &rarr;
              </a>
            ) : (
              <span className="text-muted text-[13px]">no pull request from us</span>
            ))}
        </li>
      ))}
    </ul>
  )
}

const shown = (score: number | null): string => (score === null ? '--' : String(Math.round(score)))

export function AuditChangesSection({ changes }: { changes: AuditChanges }) {
  const moved = changes.scores.filter(
    (point) => point.before !== point.after && (point.before !== null || point.after !== null),
  )

  return (
    <section style={{ marginTop: 'var(--space-8)' }} aria-label="Since the previous audit">
      <h2 className="h-section" style={{ marginBottom: 'var(--space-2)' }}>
        Since the previous audit
      </h2>

      {!changes.previous ? (
        <p className="text-muted m-0 text-sm">
          This is the first completed audit of this site, so there is nothing to compare it with
          yet. The next one will show what was resolved and what is new.
        </p>
      ) : (
        <>
          <p className="text-muted mb-4 max-w-[68ch] text-sm">
            Compared with the audit of{' '}
            <Link href={`/audits/${changes.previous.id}`}>
              {new Date(changes.previous.startedAt).toLocaleString()}
            </Link>
            . <strong>{changes.resolved.length}</strong> resolved,{' '}
            <strong>{changes.added.length}</strong> new, <strong>{changes.carried}</strong> still
            open from before.
          </p>

          {moved.length > 0 && (
            <div className="table-scroll mb-5">
              <table className="table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Before</th>
                    <th>Now</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {moved.map((point) => {
                    const delta =
                      point.before !== null && point.after !== null
                        ? Math.round(point.after) - Math.round(point.before)
                        : null
                    return (
                      <tr key={point.axis}>
                        <td>{AXIS_LABEL[point.axis] ?? point.axis}</td>
                        <td className="tnum text-muted">{shown(point.before)}</td>
                        <td className="tnum">{shown(point.after)}</td>
                        <td className="tnum">
                          {delta === null ? (
                            <span className="text-muted">
                              {point.after === null ? 'no longer measured' : 'newly measured'}
                            </span>
                          ) : (
                            <span className={delta > 0 ? 'tag tag-success' : 'tag tag-critical'}>
                              {delta > 0 ? `+${delta}` : delta}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Resolved ({changes.resolved.length})</h3>
              {changes.resolved.length === 0 ? (
                <p className="text-muted m-0 text-sm">
                  Nothing the previous audit raised has gone.
                </p>
              ) : (
                <ChangeList rows={changes.resolved} resolved />
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">New ({changes.added.length})</h3>
              {changes.added.length === 0 ? (
                <p className="text-muted m-0 text-sm">Nothing new since the previous audit.</p>
              ) : (
                <ChangeList rows={changes.added} resolved={false} />
              )}
            </div>
          </div>

          {changes.pages && changes.pages.after < changes.pages.before && (
            <p className="note note-info mt-4 text-[13px]">
              This audit reached {changes.pages.after} pages and the previous one reached{' '}
              {changes.pages.before}. An issue on a page that was not reached this time shows as
              resolved without having been fixed.
            </p>
          )}
        </>
      )}

      {changes.next && (
        <p className="text-muted mt-4 mb-0 text-[13px]">
          This is not the latest audit of this site.{' '}
          <Link href={`/audits/${changes.next.id}`}>
            See the next one, from {new Date(changes.next.startedAt).toLocaleString()} &rarr;
          </Link>
        </p>
      )}
    </section>
  )
}
