import { LoginForm } from './form'

/**
 * A server component, and the `expired` flag comes from `searchParams` rather than from
 * `useSearchParams`.
 *
 * The first version used the hook. That silently opts the whole route out of server
 * rendering, and the page came back as an empty 5.9 KB shell with no heading, no form, and
 * no text: everything appeared only after hydration. Shipping a blank-HTML page from the
 * product that audits other people's HTML would be quite the thing to be caught doing.
 *
 * Reading the param on the server keeps the page server-rendered, and the only thing that
 * needs to be a client component is the form itself, which needs useActionState.
 */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>
}) {
  const { expired } = await searchParams

  return (
    <main
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
            Welcome back
          </div>
          <h2 style={{ fontWeight: 400, textAlign: 'center', marginBottom: 'var(--space-4)' }}>
            Sign in
          </h2>

          <LoginForm expired={expired === '1'} />

          <p style={{ marginTop: 'var(--space-6)', fontSize: 13, opacity: 0.75, lineHeight: 1.7 }}>
            Mint a token with{' '}
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
            . Sign-in with GitHub arrives with the GitHub App, which we need anyway to open pull
            requests.
          </p>
        </div>
      </div>
    </main>
  )
}
