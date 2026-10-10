import type { ApiCredential } from '@seo/api-client'
import { DataTable } from '@/components/ui/data-table'
import { OutcomeNote } from '@/components/ui/outcome-note'
import { SubmitButton } from '@/components/ui/submit-button'
import { revokeCredential, revokeOtherCredentials } from './actions'
import { formatDay } from '@/lib/format'

const when = (iso: string | null, none: string) => (iso ? formatDay(iso) : none)

/**
 * Every session and token that can act as this account, each with a way to switch it off.
 *
 * Signing out only ends the session in this browser. This is for everything else: the laptop
 * left signed in, the CLI token pasted into a chat. A token's value is never shown, because we
 * never had it; the name, kind and dates are what a person uses to recognise one.
 */
export function Credentials({
  credentials,
  revoked,
  notRevoked = false,
}: {
  credentials: ApiCredential[]
  /** How many were just revoked, read back from the redirect, or null. */
  revoked: number | null
  /** A revoke was asked for and the service did not answer, so nothing was revoked. */
  notRevoked?: boolean
}) {
  const others = credentials.filter((credential) => !credential.current).length

  return (
    <section aria-labelledby="credentials-heading">
      <h2 id="credentials-heading" className="h-section mb-1">
        Sessions and tokens
      </h2>
      <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
        Everything that can act as this account. Browser sessions end after thirty days. Tokens are
        made above, for an editor or the command line, and last until they expire or you revoke
        them. Revoking one stops it working immediately.
      </p>

      {/*
        The failure used to be sent back in the address and read by nothing, so a revoke that did
        not happen looked exactly like one that did. For signing a lost device out, that is the
        wrong thing to leave unsaid.
      */}
      {notRevoked && (
        <OutcomeNote
          className="mb-3"
          outcome={{
            tone: 'warn',
            title: 'Nothing was revoked',
            detail:
              'The service was starting up and did not answer, so every session below is still active. Try again in a moment.',
          }}
        />
      )}
      {revoked !== null && (
        <OutcomeNote
          className="mb-3"
          outcome={
            revoked === 0
              ? { tone: 'info', title: 'Nothing else was signed in' }
              : {
                  tone: 'ok',
                  title: `Revoked ${revoked} ${revoked === 1 ? 'session' : 'sessions'}`,
                  detail: 'They can no longer act as this account.',
                }
          }
        />
      )}

      <DataTable
        label="Sessions and tokens"
        columns={[
          { header: 'Name' },
          { header: 'Kind' },
          { header: 'Created' },
          { header: 'Last used' },
          { header: 'Expires' },
          { header: 'Revoke', hideHeader: true, align: 'end', className: 'whitespace-nowrap' },
        ]}
        rows={credentials.map((credential) => ({
          key: credential.id,
          cells: [
            <span key="name">
              {credential.name}
              {credential.current ? (
                <span className="tag tag-neutral ml-2">This browser</span>
              ) : null}
            </span>,
            <span key="kind" className="text-muted">
              {credential.kind === 'session' ? 'Browser session' : 'Token'}
            </span>,
            <span key="created" className="text-muted">
              {formatDay(credential.createdAt)}
            </span>,
            <span key="used" className="text-muted">
              {when(credential.lastUsedAt, 'Never')}
            </span>,
            <span key="expires" className="text-muted">
              {when(credential.expiresAt, 'Never')}
            </span>,
            <form key="revoke" action={revokeCredential}>
              <input type="hidden" name="id" value={credential.id} />
              <SubmitButton
                className="btn btn-ghost btn-sm"
                pendingLabel={credential.current ? 'Signing out...' : 'Revoking...'}
              >
                {credential.current ? 'Sign out' : 'Revoke'}
                <span className="sr-only"> {credential.name}</span>
              </SubmitButton>
            </form>,
          ],
        }))}
      />

      <div className="mt-3">
        <form action={revokeOtherCredentials}>
          <SubmitButton
            className="btn btn-danger btn-sm"
            pendingLabel="Signing out everywhere else..."
            disabled={others === 0}
          >
            Sign out everywhere else
          </SubmitButton>
        </form>
      </div>
    </section>
  )
}
