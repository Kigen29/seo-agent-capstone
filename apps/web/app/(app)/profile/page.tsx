import Link from 'next/link'
import { signOut } from '@/app/auth/actions'
import { ApiAsleep } from '@/components/api-asleep'
import { Avatar, AvatarFallback, AvatarImage, initials } from '@/components/ui/avatar'
import { Note } from '@/components/ui/note'
import { PageHeader } from '@/components/ui/page-header'
import { SubmitButton } from '@/components/ui/submit-button'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

export const dynamic = 'force-dynamic'

const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
}

/**
 * Who you are signed in as.
 *
 * Small on purpose. There is no profile to edit here, and pretending otherwise would be the
 * dishonest version of this page: the name, email and picture all live at GitHub or Google, we
 * refresh them from the provider on every sign-in, and a form that let you change them here would
 * either lie or be silently overwritten the next time you signed in. So it says where each value
 * comes from and where to change it.
 *
 * It also has to handle the account that has no identity at all. A session minted by
 * `mint-token` for the CLI or the MCP server is a perfectly valid session with nobody behind it,
 * and `/auth/me` returns null rather than inventing a person.
 */
export default async function ProfilePage() {
  const api = await getClient()
  if (!api) return null

  let account
  try {
    account = await api.getAccount()
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  const { identity } = account

  return (
    <main id="main" className="wrap-narrow">
      <PageHeader
        kicker="Account"
        title="Your profile"
        description="Who this browser is signed in as, and where those details come from."
      />

      {identity ? (
        <div className="card elev-sm" style={{ padding: 'var(--space-5)' }}>
          <div className="flex items-center gap-4">
            <Avatar className="size-12">
              {identity.avatarUrl && (
                <AvatarImage
                  src={identity.avatarUrl}
                  alt=""
                  width={48}
                  height={48}
                  referrerPolicy="no-referrer"
                />
              )}
              <AvatarFallback>{initials(identity.name, identity.email)}</AvatarFallback>
            </Avatar>

            <div className="min-w-0">
              <p className="m-0 text-base">{identity.name ?? 'No name from the provider'}</p>
              <p className="text-muted m-0 text-sm break-all">
                {identity.email ?? 'No email shared'}
              </p>
            </div>

            <span className="tag tag-outline ml-auto shrink-0">
              {PROVIDER_LABEL[identity.provider] ?? identity.provider}
            </span>
          </div>

          <p className="text-muted mt-4 mb-0 text-[13px]" style={{ lineHeight: 1.7 }}>
            Your name, email and picture are read from{' '}
            {PROVIDER_LABEL[identity.provider] ?? identity.provider} each time you sign in, so
            changing them there changes them here. We identify you by the account id rather than by
            the email, which is why changing your email address does not lose your work.
          </p>

          {/*
            GitHub hands back a null email for anyone whose address is private, which is the
            default for a lot of accounts. That is not a fault and nothing is broken, so it gets an
            explanation rather than a blank where a value should be.
          */}
          {!identity.email && (
            <Note tone="info" className="mt-3">
              Your provider did not share an email address, which is normal if yours is private.
              Nothing depends on it: you are identified by your account id.
            </Note>
          )}
        </div>
      ) : (
        <Note tone="info">
          This session was created from an API token rather than by signing in, so there is no
          profile behind it. That is how the CLI, the MCP server and the end-to-end tests
          authenticate, and it is working as intended.
        </Note>
      )}

      <section className="mt-8">
        <h2 className="h-section mb-3">Session</h2>
        <div className="card elev-sm" style={{ padding: 'var(--space-4)' }}>
          <p className="text-muted m-0 max-w-[60ch] text-sm">
            Signing out revokes this browser&apos;s session on the server, not just in this browser,
            so the credential stops working rather than merely being forgotten. Other devices you
            are signed in on, and any token you minted for the CLI, are left alone.
          </p>

          {/* Width-constrained: `.card` stretches its children, and a bare button becomes a bar. */}
          <form action={signOut} className="self-start">
            <SubmitButton pendingLabel="Signing out..." className="btn btn-secondary btn-sm">
              Sign out
            </SubmitButton>
          </form>
        </div>
      </section>

      <p className="text-muted mt-8 text-[13px]">
        Looking for the theme, connections or spend? Those are in{' '}
        <Link href="/settings">settings</Link>.
      </p>
    </main>
  )
}
