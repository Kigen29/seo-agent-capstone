import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { GoogleConnection } from '@/components/google-connection'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { startAudit } from './actions'
import { AddSite } from './add-site'

export const dynamic = 'force-dynamic'

/** Statuses that mean an audit is on the queue or running, so "Run audit" should read differently. */
const RUNNING = new Set(['queued', 'crawling', 'evaluating'])

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { google: googleCallback } = await searchParams

  let sites
  let connections
  try {
    ;[sites, connections] = await Promise.all([api.listSites(), api.getConnections()])
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  return (
    <main className="mt-10">
      <h1 className="text-2xl font-semibold text-neutral-50">Sites</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Add a site and run an audit. The crawl runs on the worker and this page shows its progress
        live.
      </p>

      <GoogleConnection connection={connections.google} callback={googleCallback} />

      <AddSite />

      {sites.length === 0 ? (
        <p className="mt-8 text-sm leading-relaxed text-neutral-500">
          No sites yet. Add one above to run your first audit.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-neutral-900 overflow-hidden rounded-lg border border-neutral-800">
          {sites.map((site) => {
            const running = site.latestAudit && RUNNING.has(site.latestAudit.status)

            return (
              <li key={site.id} className="bg-neutral-950 p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-medium text-neutral-200">{site.url}</p>

                  <div className="flex items-center gap-4">
                    {site.latestAudit && (
                      <Link
                        href={`/dashboard/audits/${site.latestAudit.id}`}
                        className="text-sm text-emerald-400 underline underline-offset-4 hover:text-emerald-300"
                      >
                        {running ? 'View progress' : 'View audit'}
                      </Link>
                    )}

                    <form action={startAudit}>
                      <input type="hidden" name="siteId" value={site.id} />
                      <button
                        type="submit"
                        disabled={Boolean(running)}
                        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {running ? 'Running...' : 'Run audit'}
                      </button>
                    </form>
                  </div>
                </div>

                {site.latestAudit ? (
                  <p className="mt-1 text-xs text-neutral-600">
                    {site.latestAudit.status} &middot; {site.latestAudit.pagesCrawled} pages
                    &middot; {new Date(site.latestAudit.startedAt).toLocaleString()}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-neutral-600">Never audited</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
