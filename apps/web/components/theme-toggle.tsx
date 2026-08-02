'use client'

import { useEffect, useState } from 'react'

/**
 * Light, dark, or whatever the operating system says.
 *
 * The token layer does the actual work: `globals.css` flips every colour under
 * `prefers-color-scheme: dark` and again under `[data-theme='dark']`, so this component only
 * writes an attribute on `<html>`. The three-state choice matters. A two-state toggle cannot
 * express "follow my system", which is what most people actually want, and it strands anyone
 * whose OS switches at sunset.
 */

type Theme = 'light' | 'dark' | 'system'

const KEY = 'rw-theme'

/**
 * Applied before paint by the inline script in the layout, and again here on every change.
 * `system` removes the attribute entirely rather than resolving it, so the media query keeps
 * following the OS live: resolving it once would freeze the choice at page load.
 */
function apply(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
]

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  // Read once on mount rather than during render: localStorage does not exist on the server, and
  // reading it during render would make the first client paint disagree with the server's HTML.
  useEffect(() => {
    const stored = window.localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') setTheme(stored)
  }, [])

  function choose(next: Theme) {
    setTheme(next)
    window.localStorage.setItem(KEY, next)
    apply(next)
  }

  return (
    <div className="seg" role="group" aria-label="Colour theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`seg-opt${theme === option.value ? ' is-active' : ''}`}
          aria-pressed={theme === option.value}
          onClick={() => choose(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The anti-flash script, inlined in `<head>` so it runs before first paint.
 *
 * Without it a user who chose dark gets a full frame of light paper before React hydrates, which
 * is the single most noticeable bug in any theme implementation. Wrapped in try/catch because
 * localStorage throws outright in some privacy modes, and a theme preference is never worth
 * taking the page down for.
 */
export const themeScript = `try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`
