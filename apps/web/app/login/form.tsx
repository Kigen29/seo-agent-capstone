'use client'

import { useActionState } from 'react'
import { signIn, type LoginState } from './actions'

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {})

  return (
    <>
      {expired && (
        <p role="alert" className="note note-warn" style={{ marginBottom: 'var(--space-4)' }}>
          Your token is no longer valid. It may have been revoked. Sign in again.
        </p>
      )}

      <form action={action} className="field">
        <label htmlFor="token">API token</label>

        <input
          id="token"
          name="token"
          type="password"
          autoComplete="off"
          placeholder="seo_..."
          className="input"
          style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
        />

        {state.error && (
          <p
            role="alert"
            style={{ marginTop: 'var(--space-2)', fontSize: 13, color: 'var(--color-neutral-800)' }}
          >
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary btn-block">
          {pending ? 'Checking...' : 'Sign in'}
        </button>
      </form>
    </>
  )
}
