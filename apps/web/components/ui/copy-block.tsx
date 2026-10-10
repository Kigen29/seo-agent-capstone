'use client'

import { useState } from 'react'

/**
 * Text to be copied exactly, with a button that copies it.
 *
 * For a command, a config file or a token: things where one missing character is a failure the
 * reader cannot diagnose, so selecting it by hand is the wrong way to take it.
 *
 * The button says what happened. If the browser refuses the clipboard (an insecure origin, a
 * denied permission), it says to select the text instead, and the text is selectable.
 */
export function CopyBlock({
  label,
  text,
  what = 'it',
  className = '',
}: {
  /** What the block is, shown above it and read out with the button. */
  label: string
  text: string
  /** Finishes "Copy ...", for the button's accessible name. */
  what?: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'refused'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('refused')
    }
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="card-kicker">{label}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
          {state === 'copied' ? 'Copied' : 'Copy'}
          <span className="sr-only"> {what}</span>
        </button>
      </div>
      <pre
        className="mono m-0 overflow-x-auto text-[12px] whitespace-pre"
        style={{ padding: 'var(--space-3)', lineHeight: 1.6 }}
        tabIndex={0}
        aria-label={label}
      >
        {text}
      </pre>
      <div role="status" className="text-muted min-h-[1lh] text-[12px]">
        {state === 'refused' &&
          'The browser would not copy it. Select the text above and copy it by hand.'}
      </div>
    </div>
  )
}
