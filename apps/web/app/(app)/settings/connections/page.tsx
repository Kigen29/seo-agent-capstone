import Link from 'next/link'
import { connectGoogle } from '@/app/(app)/dashboard/actions'
import { ApiAsleep } from '@/components/api-asleep'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

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

        <div className="card elev-sm" style={{ padding: 'var(--space-4)' }}>
          {connections.google.connected ? (
            <>
              <span className="tag tag-success self-start">Connected</span>
              <p className="m-0 text-sm">
                {connections.google.email ?? 'Connected, but the account email was not returned.'}
              </p>
            </>
          ) : (
            <>
              <span className="tag tag-neutral self-start">Not connected</span>
              <p className="text-muted m-0 text-sm">
                Search data stays unmeasured until this is connected.
              </p>
              <form action={connectGoogle}>
                <button type="submit" className="btn btn-primary btn-sm">
                  Connect Search Console
                </button>
              </form>
            </>
          )}
        </div>
      </section>

      <section>
        <h2 className="h-section mb-1">GitHub</h2>
        <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
          The repository the agent opens pull requests against. It can never write to your default
          branch: every change is a branch and a pull request you review.
        </p>

        <div className="card elev-sm" style={{ padding: 'var(--space-4)' }}>
          {connections.github.connected ? (
            <>
              <span className="tag tag-success self-start">Connected</span>
              {connections.github.repos.length > 0 ? (
                <ul className="m-0 pl-4 text-sm">
                  {connections.github.repos.map((repo) => (
                    <li key={repo} className="break-all">
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
                <p className="text-muted m-0 text-sm">
                  The app is installed but has not been granted access to any repository yet.
                </p>
              )}
            </>
          ) : (
            <>
              <span className="tag tag-neutral self-start">Not connected</span>
              <p className="text-muted m-0 text-sm">
                Findings are still raised, but none can become a pull request until a site&apos;s
                repository is connected. Repositories are connected per site.
              </p>
              <Link href="/dashboard" className="btn btn-primary btn-sm self-start">
                Connect a repository
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
