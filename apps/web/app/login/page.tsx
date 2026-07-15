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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="text-sm font-medium tracking-widest text-neutral-500 uppercase">Rankwright</p>
      <h1 className="mt-4 text-2xl font-semibold text-neutral-50">Sign in</h1>

      <LoginForm expired={expired === '1'} />

      <p className="mt-8 text-sm leading-relaxed text-neutral-500">
        Mint a token with{' '}
        <code className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-xs text-neutral-400">
          pnpm --filter @seo/api mint-token &lt;tenant&gt;
        </code>
        . Sign-in with GitHub arrives with the GitHub App in sprint 2, which we need anyway to open
        pull requests.
      </p>
    </main>
  )
}
