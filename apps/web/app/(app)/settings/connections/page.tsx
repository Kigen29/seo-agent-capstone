import Link from 'next/link'
import { connectGoogle } from '@/app/(app)/dashboard/actions'
import { ApiAsleep } from '@/components/api-asleep'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Connections' }

/**
 * What this account is connected to, in one place.
 *
 * Read-only on purpose. Connecting Google and connecting a repository both start flows that belong
 * with the site they are for, and they already live on the dashboard where a person is looking at
 * that site. Duplicating the buttons here would mean two places that can start the same OAuth
 * round trip and two places to keep in step with its callbacks.
 *
 * So this answers the question settings is actually asked, which is "what am I connected to right
 * now", and links to where each thing is changed.
 */
export default async function ConnectionsSettingsPage() {
  const api = await getClient()
  if (!api) return null

  let connections
  try {
    connections = await api.getConnections()
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="h-section mb-1">Google Search Console</h2>
        <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
          Read-only access to your Search Analytics, and the ability to verify a property for you.
          We never ask for a password: OAuth only, and you can revoke it from your Google account at
          any time.
        </p>

        <div className="card" style={{ padding: 'var(--space-4) var(--space-5)' }}>
          {/*
            One shape for all three cards: what the state is on the left, what you can do about it
            on the right. A row that wraps on a phone, so the action lands under the text.
          */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col items-start gap-1">
              {connections.google.connected ? (
                <>
                  <span className="tag tag-dot tag-success">Connected</span>
                  <span className="text-sm font-semibold break-all">
                    {connections.google.email ??
                      'Connected, but the account email was not returned.'}
                  </span>
                </>
              ) : (
                <>
                  <span className="tag tag-dot tag-neutral">Not connected</span>
                  <span className="text-muted text-sm">
                    Search data stays unmeasured until this is connected.
                  </span>
                </>
              )}
            </div>
            {!connections.google.connected && (
              <form action={connectGoogle} className="shrink-0">
                {/* The page's one primary action: it is the connection every axis gains from. */}
                <button type="submit" className="btn btn-primary btn-sm">
                  Connect Search Console
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="h-section mb-1">GitHub</h2>
        <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
          The repository the agent opens pull requests against. It can never write to your default
          branch: every change is a branch and a pull request you review.
        </p>

        <div className="card" style={{ padding: 'var(--space-4) var(--space-5)' }}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col items-start gap-1">
              {connections.github.connected ? (
                <>
                  <span className="tag tag-dot tag-success">Connected</span>
                  {connections.github.repos.length > 0 ? (
                    <ul className="m-0 list-none p-0 text-sm">
                      {connections.github.repos.map((repo) => (
                        <li
                          key={repo}
                          className="break-all"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                        >
                          {repo}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    /*
                      Installed with no repository granted is a real state and a confusing one: the
                      App is connected and the fixer still cannot do anything. Saying so beats an
                      empty list that reads as a rendering bug.
                    */
                    <span className="text-muted text-sm">
                      The app is installed but has not been granted access to any repository yet.
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="tag tag-dot tag-neutral">Not connected</span>
                  <span className="text-muted max-w-[62ch] text-sm">
                    Findings are still raised, but none can become a pull request until a
                    site&apos;s repository is connected. Repositories are connected per site.
                  </span>
                </>
              )}
            </div>
            <Link href="/dashboard" className="btn btn-secondary btn-sm shrink-0">
              {connections.github.connected ? 'Connect another site' : 'Connect a repository'}
            </Link>
          </div>
        </div>
      </section>

      <section>
        <h2 className="h-section mb-1">Hosting</h2>
        <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
          After you merge a fix, the agent checks it is live before calling it verified. That needs
          proof of what your site is serving: connect each site&apos;s own Vercel project, or have
          another host report its deployments through GitHub.
        </p>
        <div className="card" style={{ padding: 'var(--space-4) var(--space-5)' }}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="text-muted max-w-[62ch] min-w-0 text-sm">
              Set up per site. A token you add is used for that site only and is never shared with
              another account.
            </span>
            <Link
              href="/settings/connections/hosting"
              className="btn btn-secondary btn-sm shrink-0"
            >
              Set up hosting for a site
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
