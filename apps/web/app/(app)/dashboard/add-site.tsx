'use client'

import { useActionState } from 'react'
import { ErrorNote } from '@/components/ui/error-note'
import { addSite } from './actions'

export function AddSite() {
  const [state, action, pending] = useActionState(addSite, {})

  return (
    <form action={action} className="flex flex-wrap justify-end gap-2">
      <input
        name="url"
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder="example.com"
        className="input"
        style={{ flex: 1, minWidth: 220, maxWidth: 320 }}
      />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Adding...' : 'Add site'}
      </button>

      <ErrorNote error={state.error} className="w-full" />
    </form>
  )
}
