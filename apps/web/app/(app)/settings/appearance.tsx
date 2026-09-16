'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * The appearance settings, and the only place the theme is chosen now.
 *
 * It used to be a three-button segmented control wedged into the bottom of the sidebar, where it
 * sat permanently on screen competing with the navigation for a decision most people make once.
 * Settings is where a once-only decision belongs; the sidebar keeps a quick light/dark flip in the
 * account menu for the case that is genuinely frequent, which is flipping at night.
 *
 * Three states, not two. A two-state toggle cannot express "follow my system", which is what most
 * people actually want, and it strands anyone whose OS switches at sunset.
 */
type Theme = 'light' | 'dark' | 'system'

const KEY = 'rw-theme'

const OPTIONS: { value: Theme; label: string; hint: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', hint: 'Warm paper, always', Icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Low light, always', Icon: Moon },
  { value: 'system', label: 'Match system', hint: 'Follows your OS, live', Icon: Monitor },
]

/**
 * `system` removes the attribute rather than resolving it to light or dark.
 *
 * Resolving it once would freeze the choice at page load, so a machine that switches at sunset
 * would stay light until the next reload. Removing it hands the decision back to the media query,
 * which keeps following the OS.
 */
function apply(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function AppearanceSettings() {
  const [theme, setTheme] = useState<Theme>('system')
  const [reduceMotion, setReduceMotion] = useState(false)

  // Read on mount, not during render: localStorage does not exist on the server, and reading it
  // during render would make the first client paint disagree with the server's HTML.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY)
      if (stored === 'light' || stored === 'dark' || stored === 'system') setTheme(stored)
    } catch {
      // Private modes throw outright. A theme preference is never worth taking the page down for.
    }

    setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  function choose(next: Theme) {
    setTheme(next)
    apply(next)
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // The theme still applies for this page; it just will not be remembered.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="h-section mb-1">Theme</h2>
        <p className="text-muted mt-0 mb-3 max-w-[60ch] text-sm">
          Stored in this browser, not on your account, so it does not follow you to another device.
        </p>

        <div role="radiogroup" aria-label="Colour theme" className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map(({ value, label, hint, Icon }) => {
            const active = theme === value

            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(value)}
                className="card elev-sm cursor-pointer items-start gap-1 text-left"
                style={{
                  padding: 'var(--space-4)',
                  borderColor: active ? 'var(--color-accent)' : 'var(--color-divider)',
                  // Two signals, not one. Colour alone fails for anyone who cannot distinguish
                  // gold from grey, so the active card is also outlined.
                  outline: active ? '1px solid var(--color-accent)' : 'none',
                }}
              >
                <Icon
                  size={18}
                  aria-hidden="true"
                  style={{ color: active ? 'var(--color-accent-700)' : 'var(--color-text-muted)' }}
                />
                <span className="text-sm">{label}</span>
                <span className="text-muted text-xs">{hint}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="h-section mb-1">Motion</h2>
        <div className="card elev-sm" style={{ padding: 'var(--space-4)' }}>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="reduce-motion" className="text-sm">
                Reduce motion
              </Label>
              <p className="text-muted m-0 text-xs">
                {reduceMotion
                  ? 'Your system already asks for reduced motion, and the app follows it.'
                  : 'Your system does not currently ask for reduced motion.'}
              </p>
            </div>

            {/*
              Deliberately disabled, and labelled as reflecting the OS rather than overriding it.

              An in-app switch here would be a second source of truth for something the operating
              system already answers, and the honest version of this row is to show what the app
              is doing and where the setting actually lives. A control that claims to set something
              it does not is worse than no control.
            */}
            <Switch
              id="reduce-motion"
              checked={reduceMotion}
              disabled
              aria-label="Reduce motion, controlled by your operating system"
            />
          </div>
        </div>
        <p className="text-muted mt-2 text-xs">
          Change this in your operating system&apos;s accessibility settings. The app reads it and
          does not override it.
        </p>
      </section>
    </div>
  )
}
