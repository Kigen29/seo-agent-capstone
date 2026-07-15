import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const api = await getClient()
  if (!api) return null

  let sites
  try {
    sites = await api.listSites()
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  return (
    <main className="mt-10">
      <h1 className="text-2xl font-semibold text-neutral-50">Sites</h1>

      {sites.length === 0 ? (
        <p className="mt-6 text-sm leading-relaxed text-neutral-500">
          No sites yet. Run an audit with{' '}
          <code className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-xs text-neutral-400">
            pnpm --filter @seo/audit audit:run &lt;url&gt;
          </code>{' '}
          and it will appear here. Starting an audit from this page needs the job queue, which is
          not built yet, and a button that did nothing would be worse than no button.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-neutral-900 overflow-hidden rounded-lg border border-neutral-800">
          {sites.map((site) => (
            <li key={site.id} className="bg-neutral-950 p-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-medium text-neutral-200">{site.url}</p>

                {site.latestAudit ? (
                  <Link
                    href={`/dashboard/audits/${site.latestAudit.id}`}
                    className="text-sm text-emerald-400 underline underline-offset-4 hover:text-emerald-300"
                  >
                    View audit
                  </Link>
                ) : (
                  <span className="text-sm text-neutral-600">Never audited</span>
                )}
              </div>

              {site.latestAudit && (
                <p className="mt-1 text-xs text-neutral-600">
                  {site.latestAudit.status} &middot; {site.latestAudit.pagesCrawled} pages &middot;{' '}
                  {new Date(site.latestAudit.startedAt).toLocaleString()}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
