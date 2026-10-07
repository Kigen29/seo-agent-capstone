import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { EmptyState } from '@/components/ui/empty-state'
import { Note, type NoteTone } from '@/components/ui/note'
import { SubmitButton } from '@/components/ui/submit-button'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { connectVercel } from './actions'
import { HostingForm } from './form'

export const dynamic = 'force-dynamic'

/**
 * Hosting, per site (ADR-0028).
 *
 * A merged fix is only called verified once there is proof the site is serving it. This page is
 * where a customer supplies that proof for their own site: their own Vercel project, or deployment
 * reports from any other host. It is per site because the credential is, and it says plainly that
 * audits and pull requests do not need it, so nobody connects a token they did not have to.
 */
/** What came back from Vercel's consent screen, in words a person can act on. */
const VERCEL_OUTCOME: Record<string, { tone: NoteTone; text: string }> = {
  connected: {
    tone: 'ok',
    text: 'Connected to Vercel. Merged fixes for this site will now be checked against its project.',
  },
  no_project: {
    tone: 'warn',
    text: 'Vercel access was approved, but the account you chose has no project that deploys this site’s repository. Try again and pick the team that owns the project, and include that project when Vercel asks which ones to share.',
  },
  unconfirmed: {
    tone: 'warn',
    text: 'A project linked to this repository was found, but nothing confirms it serves this site’s address yet. Check the domain is assigned to the project and that a production deployment has completed, then try again.',
  },
  declined: {
    tone: 'info',
    text: 'Nothing was connected: the approval on Vercel was not completed.',
  },
  norepo: { tone: 'warn', text: 'Connect this site’s repository first, then connect Vercel.' },
  changed: {
    tone: 'warn',
    text: 'The site’s connection changed while this was in progress. Please try again.',
  },
  invalid: {
    tone: 'error',
    text: 'That approval could not be matched to a request from this account, or it took too long. Please start again.',
  },
  unavailable: {
    tone: 'error',
    text: 'Connecting to Vercel in one step is not set up on this deployment. Use an access token instead.',
  },
  failed: {
    tone: 'error',
    text: 'Vercel could not be reached to finish connecting. Nothing was changed. Try again in a minute.',
  },
}

function TokenHelp() {
  return (
    <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
      <a href="https://vercel.com/account/settings/tokens" target="_blank" rel="noreferrer">
        Create an access token
      </a>{' '}
      for the account or team that owns the project. The project is found from the repository; a
      team ID is only needed when the project belongs to a team.
    </p>
  )
}

export default async function HostingPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string; vercel?: string }>
}) {
  const api = await getClient()
  if (!api) return null
  const { siteId, vercel } = await searchParams

  let sites
  let site
  let status
  try {
    sites = await api.listSites()
    site = sites.find((item) => item.id === siteId) ?? sites[0]
    if (site) status = await api.getHosting(site.id)
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (!site || !status) {
    return (
      <EmptyState
        figure="0"
        title="No sites yet"
        action={
          <Link href="/dashboard" className="btn btn-primary">
            Add a site
          </Link>
        }
      >
        Add a site first. Hosting is set up for each site separately.
      </EmptyState>
    )
  }

  const origin = new URL(site.url).origin

  return (
    <div className="flex flex-col gap-6">
      <section>
        <Link href="/settings/connections" className="text-[13px]">
          &larr; Connections
        </Link>
        <h2 className="h-section mt-2 mb-1">Hosting</h2>
        <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
          Audits and fix pull requests work without this. It is only needed to mark a merged fix as
          verified, which requires proof of what the site is serving.
        </p>
        {sites.length > 1 && (
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="flex flex-col gap-1">
              <span className="card-kicker">Site</span>
              <select className="input" name="siteId" defaultValue={site.id}>
                {sites.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.url}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-secondary" type="submit">
              Show
            </button>
          </form>
        )}
      </section>

      <section>
        <h3 className="h-section mb-1">Hosted on Vercel</h3>
        <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
          Connect the Vercel project that serves <strong className="break-all">{origin}</strong>. We
          find the project from the site&apos;s repository and check that it really serves this
          address before anything is saved.
        </p>
        {vercel && VERCEL_OUTCOME[vercel] && (
          <Note tone={VERCEL_OUTCOME[vercel].tone} className="mb-3">
            {VERCEL_OUTCOME[vercel].text}
          </Note>
        )}
        <div className="card elev-sm" style={{ padding: 'var(--space-4)' }}>
          {site.repoFullName ? (
            <>
              {status.oneClick && (
                <form action={connectVercel} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="siteId" value={site.id} />
                  <SubmitButton pendingLabel="Opening Vercel..." className="btn btn-primary">
                    {status.connection ? 'Reconnect to Vercel' : 'Connect to Vercel'}
                  </SubmitButton>
                  <span className="text-muted text-[13px]">
                    You approve access on Vercel. No token to create or paste.
                  </span>
                </form>
              )}
              {/*
                The token form stays: it is the only way when the operator has not registered a
                Vercel integration, and a fallback when consent is not possible for an account.
                Folded away when the button is there, so the easy path is the one in view.
              */}
              {status.oneClick ? (
                <details>
                  <summary className="cursor-pointer text-sm">
                    {status.connection
                      ? 'Connection details, or use a token instead'
                      : 'Use an access token instead'}
                  </summary>
                  <div className="mt-3">
                    <TokenHelp />
                    <HostingForm key={site.id} siteId={site.id} status={status} />
                  </div>
                </details>
              ) : (
                <>
                  <TokenHelp />
                  <HostingForm key={site.id} siteId={site.id} status={status} />
                </>
              )}
            </>
          ) : (
            <>
              <span className="tag tag-neutral self-start">Repository needed first</span>
              <p className="text-muted m-0 text-sm">
                The check is that the project serves this site from its repository, so the
                repository has to be connected before the project can be.
              </p>
              <Link
                href={`/dashboard?siteId=${site.id}`}
                className="btn btn-primary btn-sm self-start"
              >
                Connect a repository
              </Link>
            </>
          )}
        </div>
        <p className="text-muted mt-3 mb-0 max-w-[62ch] text-[13px]">
          Disconnecting deletes the saved token. You can also revoke it in Vercel at any time. Past
          verification results are kept.
        </p>
      </section>

      <section>
        <h3 className="h-section mb-1">Hosted somewhere else</h3>
        <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
          No token is needed. Your own release pipeline tells GitHub when a commit is live on{' '}
          <strong className="break-all">{origin}</strong>, and the agent reads that.
        </p>
        <div className="card elev-sm" style={{ padding: 'var(--space-4)' }}>
          <ol className="m-0 flex flex-col gap-2 pl-5 text-sm">
            <li>Approve the Deployments read permission for the Rankwright GitHub App.</li>
            <li>Add the reporting step to the workflow that already deploys your site.</li>
            <li>
              Report success only after your host confirms the commit is serving the domain. Report
              retries and rollbacks too.
            </li>
          </ol>
          <a
            className="btn btn-secondary btn-sm self-start"
            href="https://github.com/Kigen29/seo-agent-capstone/blob/main/docs/hosting-independent-deployments.md"
            target="_blank"
            rel="noreferrer"
          >
            Open the setup guide
          </a>
        </div>
        <p className="text-muted mt-3 mb-0 max-w-[62ch] text-[13px]">
          A passing build is not proof of a deployment. Until a report arrives, merged fixes stay
          marked as waiting to be verified.
        </p>
      </section>
    </div>
  )
}
