'use client'

import { useActionState } from 'react'
import { signIn, type LoginState } from './actions'

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {})

  return (
    <>
      {expired && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-300"
        >
          Your token is no longer valid. It may have been revoked. Sign in again.
        </p>
      )}

      <form action={action} className="mt-8">
        <label htmlFor="token" className="block text-sm text-neutral-400">
          API token
        </label>

        <input
          id="token"
          name="token"
          type="password"
          autoComplete="off"
          placeholder="seo_..."
          className="mt-2 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />

        {state.error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-5 w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? 'Checking...' : 'Sign in'}
        </button>
      </form>
    </>
  )
}
