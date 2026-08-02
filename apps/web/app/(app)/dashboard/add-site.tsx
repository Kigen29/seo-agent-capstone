'use client'

import { useActionState } from 'react'
import { addSite } from './actions'

export function AddSite() {
  const [state, action, pending] = useActionState(addSite, {})

  return (
    <form
      action={action}
      style={{
        marginTop: 'var(--space-6)',
        display: 'flex',
        gap: 'var(--space-2)',
        flexWrap: 'wrap',
      }}
    >
      <input
        name="url"
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder="example.com"
        className="input"
        style={{ flex: 1, minWidth: 220 }}
      />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Adding...' : 'Add site'}
      </button>

      {state.error && (
        <p role="alert" className="note note-error" style={{ width: '100%' }}>
          {state.error}
        </p>
      )}
    </form>
  )
}
