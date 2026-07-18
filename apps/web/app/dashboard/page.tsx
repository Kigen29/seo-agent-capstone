import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { GoogleConnection } from '@/components/google-connection'
import { RepoCallback } from '@/components/repo-callback'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { connectRepo, startAudit, verifySite } from './actions'
import { AddSite } from './add-site'

export const dynamic = 'force-dynamic'

/** The banner shown after a Verify-with-a-PR click, keyed on the ?verify= status. */
const VERIFY_MESSAGE: Record<string, { tone: string; text: string }> = {
  queued: {
    tone: 'border-emerald-900 bg-emerald-950/40 text-emerald-300',
    text: 'Verification queued. The agent is opening a pull request that adds the meta tag; it will appear on the site shortly.',
  },
  precondition: {
    tone: 'border-amber-900 bg-amber-950/40 text-amber-300',
    text: 'Connect a repository and Google Search Console to this site first.',
  },
  failed: {
    tone: 'border-red-900 bg-red-950/40 text-red-300',
    text: 'Could not queue verification. Try again shortly.',
  },
}

/** Statuses that mean an audit is on the queue or running, so "Run audit" should read differently. */
const RUNNING = new Set(['queued', 'crawling', 'evaluating'])

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; github?: string; verify?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const {
    google: googleCallback,
    github: githubCallback,
    verify: verifyCallback,
  } = await searchParams
  const verifyMessage = verifyCallback ? VERIFY_MESSAGE[verifyCallback] : undefined

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

      <RepoCallback callback={githubCallback} />

      {verifyMessage && (
        <p
          role="status"
          className={`mt-4 rounded-md border px-3 py-2 text-sm ${verifyMessage.tone}`}
        >
          {verifyMessage.text}
        </p>
      )}

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

                    <form action={connectRepo}>
                      <input type="hidden" name="siteId" value={site.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500 hover:text-white"
                      >
                        {site.repoFullName ? 'Reconnect repo' : 'Connect repo'}
                      </button>
                    </form>

                    {site.repoFullName && connections.google.connected && !site.gscVerified && (
                      <form action={verifySite}>
                        <input type="hidden" name="siteId" value={site.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-emerald-800 px-3 py-1.5 text-sm text-emerald-300 hover:border-emerald-600 hover:text-emerald-200"
                        >
                          Verify with a PR
                        </button>
                      </form>
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

                <p className="mt-1 text-xs text-neutral-600">
                  {site.repoFullName ? (
                    <span className="text-neutral-400">repo: {site.repoFullName}</span>
                  ) : (
                    <span>No repo connected, so findings can be shown but not fixed by a PR.</span>
                  )}
                  {' · '}
                  {site.latestAudit
                    ? `${site.latestAudit.status} · ${site.latestAudit.pagesCrawled} pages · ${new Date(site.latestAudit.startedAt).toLocaleString()}`
                    : 'Never audited'}
                </p>

                {site.gscVerified ? (
                  <p className="mt-1 text-xs text-emerald-500">&#10003; Search Console verified</p>
                ) : site.gscVerificationPrUrl ? (
                  <p className="mt-1 text-xs text-neutral-600">
                    Verification PR open:{' '}
                    <a
                      href={site.gscVerificationPrUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 underline underline-offset-4 hover:text-emerald-300"
                    >
                      review and merge it
                    </a>
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
