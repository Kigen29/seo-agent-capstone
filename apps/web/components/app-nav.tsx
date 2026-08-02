'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/app/login/actions'
import { ThemeToggle } from '@/components/theme-toggle'

/**
 * The app chrome. One nav across every authenticated page, so "where am I" and "sign out" live in
 * the same place everywhere.
 *
 * Three things changed here, all of them user-visible faults rather than tidying.
 *
 * The nav used to carry "Soundboard" and "Backstop" as `<span>` elements at 40% opacity with a
 * `title` tooltip and no href: two of its four items led nowhere, could not be reached by keyboard,
 * were invisible to a screen reader, and explained themselves only on mouse hover. Naming a feature
 * you have not built is a reasonable thing to want; rendering it as a dead control in the primary
 * navigation is not. They return as real destinations when they are real.
 *
 * "Level" is now "Sites". The old label was invented vocabulary for a list of sites, which reads as
 * considered to the person who named it and as a puzzle to everyone else.
 *
 * And the active state is derived from the URL rather than passed in. The dashboard layout used to
 * hardcode `active="level"` for its whole subtree, so the nav told a user reading a finding that
 * they were on the sites list, with `aria-current="page"` asserting it to a screen reader. A
 * component that answers "where am I" cannot take the answer as a parameter from something that
 * does not know.
 */

const isActive = (pathname: string, href: string): boolean =>
  href === '/dashboard'
    ? pathname === '/dashboard' || pathname.startsWith('/dashboard/audits')
    : pathname.startsWith(href)

const LINKS = [
  { href: '/dashboard', label: 'Sites' },
  { href: '/findings', label: 'Findings' },
]

export function AppNav() {
  const pathname = usePathname() ?? ''

  return (
    <nav className="nav" aria-label="Main">
      <Link href="/dashboard" className="nav-brand" style={{ color: 'inherit' }}>
        RankWright
      </Link>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isActive(pathname, link.href) ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
      <ThemeToggle />
      <form action={signOut}>
        <button type="submit" className="btn btn-ghost btn-sm">
          Sign out
        </button>
      </form>
    </nav>
  )
}
