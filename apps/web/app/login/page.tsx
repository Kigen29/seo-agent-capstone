import { fetchAuthProviders } from '@seo/api-client'
import { apiUrl } from '@/lib/session'
import { SignInProviders } from './providers'

/**
 * A server component, and the flags come from `searchParams` rather than from `useSearchParams`.
 *
 * The first version used the hook. That silently opts the whole route out of server rendering, and
 * the page came back as an empty 5.9 KB shell with no heading, no form, and no text: everything
 * appeared only after hydration. Shipping a blank-HTML page from the product that audits other
 * people's HTML would be quite the thing to be caught doing.
 *
 * There is nothing interactive left on this page at all now: signing in is two links to another
 * origin, so the whole route is server-rendered and ships no component JavaScript.
 */
export const dynamic = 'force-dynamic'

/**
 * What went wrong, in words rather than a code.
 *
 * Every one of these is reachable by an ordinary person doing nothing unusual: declining a consent
 * screen, leaving a tab open too long, reloading the callback. They get plain sentences and a way
 * forward, because an error page that blames the user at the moment they are deciding whether to
 * trust the product is an expensive thing to get wrong.
 */
const ERRORS: Record<string, string> = {
  declined: 'Sign-in was cancelled. Nothing happened, and you can try again.',
  invalid_state:
    'That sign-in link did not match this browser, so it was refused. This happens if the link ' +
    'sat open for a while, or if it was started somewhere else. Start again from here.',
  expired:
    'That sign-in link had already been used, or had expired. They are good for two minutes and ' +
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
  let providers: string[] = []
  let providersUnavailable = false
  try {
    providers = await fetchAuthProviders(apiUrl())
  } catch {
    providersUnavailable = true
  }
  const message = error ? (ERRORS[error] ?? ERRORS.failed) : undefined

  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center"
      style={{ padding: 'var(--space-6)' }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="text-center" style={{ marginBottom: 'var(--space-6)' }}>
          <span className="nav-brand" style={{ margin: 0 }}>
            RankWright
          </span>
          {/*
            The width is constrained on a wrapper, not on the paragraph.

            `.classical p` sets a margin at specificity (0,1,1), which beats `.mx-auto` at (0,1,0),
            so `mx-auto` on a `<p>` silently does nothing and the text sits against the left edge
            while everything around it is centred. DESIGN.md warns about this class of fight in
            general; this is the specific one that keeps recurring.
          */}
          <div className="mx-auto max-w-[34ch]">
            <p className="text-muted mt-2 text-[13px]" style={{ lineHeight: 1.6 }}>
              Every other AI-SEO tool sends your marketer a list. We send your repo a pull request.
            </p>
          </div>
        </div>

        <div className="card elev-md" style={{ padding: 'var(--space-7)' }}>
          <h1 className="h-section mb-1 text-center" style={{ fontSize: 22 }}>
            Sign in
          </h1>
          <p className="text-muted mb-5 text-center text-[13px]">
            New here? Signing in creates your account.
          </p>

          {message && (
            <p role="alert" className="note note-warn" style={{ marginBottom: 'var(--space-4)' }}>
              {message}
            </p>
          )}

          {expired === '1' && (
            <p role="alert" className="note note-warn" style={{ marginBottom: 'var(--space-4)' }}>
              Your session is no longer valid. It may have been revoked, or it may simply have
              expired. Sign in again.
            </p>
          )}

          <SignInProviders providers={providers} {...(next ? { next } : {})} />

          {/*
            No provider configured is a deployment problem, not a user problem, and it used to be
            hidden behind a token field that looked like the intended way in. Saying it plainly is
            better than offering a credential prompt almost nobody can satisfy.
          */}
          {providersUnavailable && (
            <p role="alert" className="note note-warn m-0">
              The sign-in service is temporarily unavailable. Please refresh this page in a moment.
            </p>
          )}
          {!providersUnavailable && providers.length === 0 && (
            <p className="note note-warn m-0">
              No sign-in method is configured on this deployment yet, so there is no way in from
              this page. If you are running it, set the GitHub App or Google OAuth credentials and
              redeploy.
            </p>
          )}
        </div>

        {/* Same fight as above: the constraint goes on the wrapper, never on the paragraph. */}
        <div className="mx-auto mt-5 max-w-[40ch]">
          <p className="text-muted m-0 text-center text-[12px]" style={{ lineHeight: 1.7 }}>
            We store your provider account id, and your name and email to show you who is signed in.
            Nothing is posted anywhere on your behalf, and we never ask for a password.
          </p>
        </div>
      </div>
    </main>
  )
}
