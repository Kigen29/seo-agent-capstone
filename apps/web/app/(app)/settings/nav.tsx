'use client'

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
  { href: '/settings', label: 'Appearance', exact: true },
  { href: '/settings/connections', label: 'Connections', exact: false },
  { href: '/settings/account', label: 'Account and spend', exact: false },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Settings sections" className="flex shrink-0 flex-col gap-1 md:w-52">
      {SECTIONS.map((section) => {
        const active = section.exact ? pathname === section.href : pathname.startsWith(section.href)

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className="rounded px-2 py-1.5 text-sm"
            style={{
              color: active ? 'var(--color-accent-700)' : 'inherit',
              background: active ? 'var(--color-accent-100)' : undefined,
            }}
          >
            {section.label}
          </Link>
        )
      })}
    </nav>
  )
}
