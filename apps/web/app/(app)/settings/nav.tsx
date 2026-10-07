'use client'

import { Cable, Palette, Wallet } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * The settings sections.
 *
 * A client component only because it needs the current path to mark one link as current. The links
 * themselves are real navigation, so this works with JavaScript off and every section is
 * addressable.
 */
const SECTIONS = [
  { href: '/settings', label: 'Appearance', icon: Palette, exact: true },
  { href: '/settings/connections', label: 'Connections', icon: Cable, exact: false },
  { href: '/settings/account', label: 'Account and spend', icon: Wallet, exact: false },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Settings sections"
      className="flex shrink-0 flex-col gap-1 self-start rounded-xl border p-1 md:w-60"
      style={{ borderColor: 'var(--color-divider)', background: 'var(--color-raised)' }}
    >
      {SECTIONS.map((section) => {
        const active = section.exact ? pathname === section.href : pathname.startsWith(section.href)
        const Icon = section.icon

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className="side-link"
          >
            <Icon size={16} aria-hidden="true" />
            {section.label}
          </Link>
        )
      })}
    </nav>
  )
}
