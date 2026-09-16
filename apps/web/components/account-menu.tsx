'use client'

import type { SignedInIdentity } from '@seo/api-client'
import { LogOut, Moon, Settings, Sun, User } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { signOut } from '@/app/auth/actions'
import { Avatar, AvatarFallback, AvatarImage, initials } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Who you are, and the three things you do about it.
 *
 * This replaces a three-button theme control and a bare "Sign out" button that sat permanently in
 * the sidebar footer. Both were decisions made rarely, occupying space on every screen, and
 * neither said who was signed in, which after adding social sign-in is the first thing a person
 * looks for.
 *
 * The full theme choice lives in settings, where a once-only decision belongs. What stays here is
 * the light/dark flip, because that one genuinely is frequent: somebody switches at night. It
 * moves between light and dark only and does not touch "match system": a person who has chosen to
 * follow their OS has said they do not want to make this decision by hand, and quietly dropping
 * them out of that mode because they tapped once would be the wrong reading.
 */
const KEY = 'rw-theme'

type Theme = 'light' | 'dark' | 'system'

function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Private modes throw. Fall through to the default.
  }
  return 'system'
}

/** What the page is actually showing right now, which is not the same as what was chosen. */
function resolved(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function AccountMenu({ identity }: { identity: SignedInIdentity | null }) {
  const [theme, setTheme] = useState<Theme>('system')
  const [showing, setShowing] = useState<'light' | 'dark'>('light')

  // On mount, not during render: localStorage and matchMedia do not exist on the server, and
  // reading them during render would make the first client paint disagree with the server's HTML.
  useEffect(() => {
    const stored = readTheme()
    setTheme(stored)
    setShowing(resolved(stored))
  }, [])

  function flip() {
    const next: Theme = showing === 'dark' ? 'light' : 'dark'

    setTheme(next)
    setShowing(next)
    document.documentElement.setAttribute('data-theme', next)

    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // Applies for this page; it just will not be remembered.
    }
  }

  const name = identity?.name ?? identity?.email ?? 'Signed in'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
          style={{ background: 'transparent' }}
        >
          <Avatar className="size-7">
            {identity?.avatarUrl && (
              <AvatarImage
                src={identity.avatarUrl}
                alt=""
                width={28}
                height={28}
                referrerPolicy="no-referrer"
              />
            )}
            <AvatarFallback>{initials(identity?.name, identity?.email)}</AvatarFallback>
          </Avatar>

          {/* min-w-0 before truncate, or a long email pushes the sidebar wider instead of eliding. */}
          <span className="min-w-0 flex-1 truncate">{name}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate">{identity?.email ?? 'API token session'}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User size={15} aria-hidden="true" />
            Your profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings size={15} aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>

        {/*
          onSelect is prevented from closing the menu, so somebody can see the theme change and
          flip straight back if it was not what they wanted. Every other item here navigates, and
          those should close.
        */}
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            flip()
          }}
        >
          {showing === 'dark' ? (
            <Sun size={15} aria-hidden="true" />
          ) : (
            <Moon size={15} aria-hidden="true" />
          )}
          {showing === 'dark' ? 'Switch to light' : 'Switch to dark'}
          {theme === 'system' && <span className="text-subtle ml-auto text-[11px]">auto</span>}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          {/*
            A real form posting to the sign-out action, not an onClick. Signing out revokes the
            token on the server, so it is a state change and belongs in a POST rather than in a
            click handler that would do nothing without JavaScript.
          */}
          <form action={signOut}>
            <button type="submit" className="flex w-full items-center gap-2 text-left">
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
