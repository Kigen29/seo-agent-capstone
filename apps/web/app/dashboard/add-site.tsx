'use client'

import { useActionState } from 'react'
import { addSite } from './actions'

export function AddSite() {
  const [state, action, pending] = useActionState(addSite, {})

  return (
    <form action={action} className="mt-6 flex flex-col gap-2 sm:flex-row">
      <input
        name="url"
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder="example.com"
        className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white disabled:opacity-50"
      >
        {pending ? 'Adding...' : 'Add site'}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-sm text-red-400 sm:mt-1">
          {state.error}
        </p>
      )}
    </form>
  )
}
