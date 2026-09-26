import type { ApiCredential } from '@seo/api-client'
import { Note } from '@/components/ui/note'
import { SubmitButton } from '@/components/ui/submit-button'
import { revokeCredential, revokeOtherCredentials } from './actions'

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })
const when = (iso: string | null, none: string) => (iso ? day.format(new Date(iso)) : none)

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
}: {
  credentials: ApiCredential[]
  /** How many were just revoked, read back from the redirect, or null. */
  revoked: number | null
}) {
  const others = credentials.filter((credential) => !credential.current).length

  return (
    <section aria-labelledby="credentials-heading">
      <h2 id="credentials-heading" className="h-section mb-1">
        Sessions and tokens
      </h2>
      <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
        Everything that can act as this account. Browser sessions end after thirty days; tokens
        minted for the CLI or the MCP server last until they expire or you revoke them. Revoking one
        stops it working immediately.
      </p>

      {revoked !== null ? (
        <Note tone="info" className="mb-3">
          {revoked === 0
            ? 'Nothing else was signed in.'
            : `Revoked ${revoked} ${revoked === 1 ? 'credential' : 'credentials'}.`}
        </Note>
      ) : null}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Expires</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((credential) => (
              <tr key={credential.id}>
                <td>
                  {credential.name}
                  {credential.current ? (
                    <span className="tag tag-neutral ml-2">This browser</span>
                  ) : null}
                </td>
                <td className="text-muted">
                  {credential.kind === 'session' ? 'Browser session' : 'Token'}
                </td>
                <td className="text-muted">{when(credential.createdAt, '—')}</td>
                <td className="text-muted">{when(credential.lastUsedAt, 'Never')}</td>
                <td className="text-muted">{when(credential.expiresAt, 'Never')}</td>
                <td className="whitespace-nowrap">
                  <form action={revokeCredential}>
                    <input type="hidden" name="id" value={credential.id} />
                    <input type="hidden" name="current" value={String(credential.current)} />
                    <SubmitButton
                      className="btn btn-ghost btn-sm"
                      pendingLabel={credential.current ? 'Signing out...' : 'Revoking...'}
                    >
                      {credential.current ? 'Sign out' : 'Revoke'}
                      <span className="sr-only"> {credential.name}</span>
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={revokeOtherCredentials} className="mt-3">
        <SubmitButton
          className="btn btn-danger btn-sm"
          pendingLabel="Signing out everywhere else..."
          disabled={others === 0}
        >
          Sign out everywhere else
        </SubmitButton>
      </form>
    </section>
  )
}
