import { fetchAuthProviders } from '@seo/api-client'
import { apiUrl } from '@/lib/session'
import { LoginForm } from './form'
import { SignInProviders } from './providers'

/**
 * A server component, and the flags come from `searchParams` rather than from `useSearchParams`.
 *
 * The first version used the hook. That silently opts the whole route out of server rendering,
 * and the page came back as an empty 5.9 KB shell with no heading, no form, and no text:
 * everything appeared only after hydration. Shipping a blank-HTML page from the product that
 * audits other people's HTML would be quite the thing to be caught doing.
 *
 * Reading the params on the server keeps the page server-rendered, and the only thing that needs
 * to be a client component is the token form, which needs useActionState.
 */
export const dynamic = 'force-dynamic'

/**
 * What went wrong, said in words rather than in a code.
 *
 * Every one of these is reachable, and several are reachable by an ordinary user doing nothing
 * unusual: declining a consent screen, leaving a tab open too long, reloading the callback. They
 * get plain sentences and a way forward, because an error page that blames the user at the moment
 * they are deciding whether to trust the product is an expensive thing to get wrong.
 */
const ERRORS: Record<string, string> = {
  declined: 'Sign-in was cancelled. Nothing happened, and you can try again.',
  invalid_state:
    'That sign-in link did not match this browser, so it was refused. This happens if the ' +
    'link sat open for a while, or if it was started somewhere else. Start again from here.',
  expired:
    'That sign-in link had already been used or had expired. They are good for two minutes and ' +
    'once only, on purpose. Try again.',
  provider_unavailable: 'That sign-in method is not configured on this deployment.',
  api_asleep:
    'The API was waking up and the sign-in link expired before it answered. It sleeps when idle ' +
    'on the free tier. Try again; the second attempt is usually immediate.',
  failed: 'The sign-in did not complete. Try again.',
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; error?: string; next?: string }>
}) {
  const { expired, error, next } = await searchParams

  // Asked at render time rather than configured here, so the page can never draw a button that
  // leads to a 503. It answers with an empty list rather than throwing if the API is asleep.
  const providers = await fetchAuthProviders(apiUrl())
  const message = error ? (ERRORS[error] ?? ERRORS.failed) : undefined

  return (
    <main
      id="main"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <span className="nav-brand" style={{ margin: 0 }}>
            RankWright
          </span>
        </div>

        <div className="card elev-md" style={{ padding: 'var(--space-8)' }}>
          <div className="card-kicker" style={{ textAlign: 'center' }}>
            Welcome
          </div>
          <h2 className="mb-4 text-center">Sign in</h2>

          {message && (
            <p role="alert" className="note note-warn" style={{ marginBottom: 'var(--space-4)' }}>
              {message}
            </p>
          )}

          {expired === '1' && (
            <p role="alert" className="note note-warn" style={{ marginBottom: 'var(--space-4)' }}>
              Your session is no longer valid. It may have been revoked. Sign in again.
            </p>
          )}

          <SignInProviders providers={providers} {...(next ? { next } : {})} />

          {providers.length > 0 && (
            <div
              className="text-subtle"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                margin: 'var(--space-5) 0',
                fontSize: 12,
              }}
            >
              <span style={{ flex: 1, height: 1, background: 'var(--color-divider)' }} />
              or
              <span style={{ flex: 1, height: 1, background: 'var(--color-divider)' }} />
            </div>
          )}

          {/*
            The token form stays, and it is not a fallback nobody uses.

            It is how the CLI, the MCP server and the end-to-end suite authenticate, and it is the
            only way in if both providers are unconfigured. It is behind a disclosure because a
            person arriving here should see two buttons, not a field asking for a credential they
            have never heard of.
          */}
          <details {...(providers.length === 0 ? { open: true } : {})}>
            <summary className="cursor-pointer text-[13px] select-none">
              Sign in with an API token
            </summary>

            <div className="mt-3">
              <LoginForm expired={false} />

              <p className="text-muted mt-3 text-[13px]">
                For the CLI and the MCP server. Mint one with{' '}
                <code
                  style={{
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 12,
                    background: 'var(--color-surface)',
                    borderRadius: 3,
                    padding: '2px 6px',
                  }}
                >
                  pnpm --filter @seo/api mint-token &lt;tenant&gt;
                </code>
                .
              </p>
            </div>
          </details>
        </div>

        <p className="text-muted mt-4 text-center text-[13px]">
          Signing in creates an account on first use. We store the provider&apos;s account id, and
          your name and email to show you who is signed in. Nothing is posted anywhere on your
          behalf.
        </p>
      </div>
    </main>
  )
}
