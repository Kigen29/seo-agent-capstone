'use client'

import { useActionState, useEffect, useRef } from 'react'
import type { HostingStatus } from '@seo/api-client'
import { Note } from '@/components/ui/note'
import { saveHosting } from './actions'

/**
 * Connect, replace or remove one site's Vercel project.
 *
 * The token field is cleared after every submit, successful or not, and is never pre-filled: the
 * API does not return a stored token, so there is nothing to put there, and a failed attempt must
 * not leave a credential sitting in the page.
 */
export function HostingForm({ siteId, status }: { siteId: string; status: HostingStatus }) {
  const [state, action, pending] = useActionState(saveHosting, { message: '', ok: false })
  const token = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (token.current) token.current.value = ''
  }, [state])

  const connection = status.connection

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="siteId" value={siteId} />

      {connection ? (
        connection.needsReconnect ? (
          <Note tone="warn">
            This site or its repository changed after the project was connected, so fixes cannot be
            verified with it. Enter the token again to reconnect.
          </Note>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="tag tag-success">Connected</span>
            <span className="text-sm break-all">{connection.projectId}</span>
          </div>
        )
      ) : (
        <span className="tag tag-neutral self-start">Not connected</span>
      )}

      <label className="flex flex-col gap-1">
        <span className="card-kicker">
          Vercel project ID, optional: left empty, it is found from the repository
        </span>
        <input
          className="input"
          name="projectId"
          placeholder="prj_…"
          defaultValue={connection?.projectId ?? ''}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="card-kicker">Team ID, only if the project belongs to a team</span>
        <input
          className="input"
          name="teamId"
          placeholder="team_…"
          defaultValue={connection?.teamId ?? ''}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="card-kicker">Vercel access token</span>
        <input
          ref={token}
          className="input"
          name="token"
          type="password"
          autoComplete="off"
          required
          aria-describedby="hosting-token-help"
        />
      </label>
      <p id="hosting-token-help" className="text-muted m-0 text-[13px]">
        Before saving, we check that this project serves the site from its connected repository. The
        token is stored encrypted, used for this site only, and never shown again.
      </p>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" name="operation" value="connect" disabled={pending}>
          {pending ? 'Checking…' : connection ? 'Check and replace' : 'Check and connect'}
        </button>
        {connection && (
          <button
            className="btn btn-secondary"
            name="operation"
            value="disconnect"
            formNoValidate
            disabled={pending}
          >
            Disconnect
          </button>
        )}
      </div>

      {state.message && (
        <Note tone={state.ok ? 'ok' : 'error'} role={state.ok ? 'status' : 'alert'}>
          {state.message}
        </Note>
      )}
    </form>
  )
}
