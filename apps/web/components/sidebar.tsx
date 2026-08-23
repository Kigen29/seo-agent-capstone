'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { signOut } from '@/app/login/actions'
import { ThemeToggle } from '@/components/theme-toggle'

/**
 * The app shell: where you are, what else there is, and which site you are looking at.
 *
 * The app had a top bar with four items, two of which were dead `<span>`s, and no sense of place
 * at all: the findings inbox lived at one top-level route with its own auth gate and its own copy
 * of the nav, while a finding's detail lived under `/dashboard`, so moving between them changed
 * both the URL shape and which chrome was rendering. A sidebar makes the structure visible, and
 * one layout renders it once for every authenticated page.
 *
 * The site switcher is the part that was missing entirely. Every screen in the product is about a
 * site, and until now nothing on the page said which one, or let you change it without going back
 * to a list. It writes `siteId` into the query string rather than into a route segment, because
 * the inbox already filters on exactly that parameter: picking a site here and picking one in the
 * filter bar are the same action, and they should not be two different mechanisms.
 */

export interface SidebarSite {
  id: string
  url: string
}

/**
 * The navigation, grouped by what you came here to do.
 *
 * Three flat links became six in two groups, because the product measures far more than it used
 * to show and a flat list of six reads as a pile. The split is between finding something out
 * (research: what people search for, who talks about you, whether the engines cite you) and
 * looking after this site (what is broken, and the history of checking).
 *
 * `match` is a predicate rather than a prefix compare because `/audits` and `/authority` share a
 * prefix, and `startsWith('/a')` would light both.
 */
const GROUPS: {
  label: string
  links: { href: string; label: string; match: (p: string) => boolean }[]
}[] = [
  {
    label: 'Overview',
    links: [{ href: '/dashboard', label: 'Dashboard', match: (p) => p === '/dashboard' }],
  },
  {
    label: 'Research',
    links: [
      { href: '/keywords', label: 'Keywords', match: (p) => p.startsWith('/keywords') },
      { href: '/authority', label: 'Authority', match: (p) => p.startsWith('/authority') },
      { href: '/visibility', label: 'AI visibility', match: (p) => p.startsWith('/visibility') },
    ],
  },
  {
    label: 'This site',
    links: [
      { href: '/findings', label: 'Findings', match: (p) => p.startsWith('/findings') },
      { href: '/audits', label: 'Audits', match: (p) => p.startsWith('/audits') },
    ],
  },
]

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function Sidebar({ sites }: { sites: SidebarSite[] }) {
  const pathname = usePathname() ?? ''
  const params = useSearchParams()
  const [open, setOpen] = useState(false)

  const activeSite = params.get('siteId')

  /** Keeps the chosen site when moving between sections, so context survives navigation. */
  const withSite = (href: string): string =>
    activeSite && href !== '/dashboard' ? `${href}?siteId=${activeSite}` : href

  return (
    <>
      {/*
        The mobile trigger. The sidebar is a fixed column from `md` and a disclosure below it,
        because a 240px column on a 360px screen leaves 120px for the actual product.

        Deliberately NOT using the `.nav` class, which was the first attempt and was wrong in a way
        worth recording. `.classical .nav` sets `display: flex` at specificity (0,2,0); Tailwind's
        `md:hidden` sets `display: none` at (0,1,0). The lower-specificity rule loses regardless of
        the media query, so this bar stayed visible on desktop, and because it is a flex child of
        the row below it also took a slice of the sidebar's width. The result was a stray brand and
        Menu button floating mid-page and a sidebar half again as wide as it should be.

        Any hand-written component class carries this hazard against a utility. Layout here is
        utilities only.
      */}
      <div
        className="flex items-center justify-between gap-4 border-b px-4 py-3 md:hidden"
        style={{ borderColor: 'var(--color-divider)' }}
      >
        <Link href="/dashboard" className="nav-brand" style={{ color: 'inherit' }}>
          RankWright
        </Link>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-expanded={open}
          aria-controls="app-sidebar"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      <div
        id="app-sidebar"
        className={`${open ? 'flex' : 'hidden'} w-full shrink-0 flex-col gap-6 border-b p-4 md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:self-start md:overflow-y-auto md:border-r md:border-b-0`}
        style={{ borderColor: 'var(--color-divider)' }}
      >
        <Link href="/dashboard" className="nav-brand hidden md:block" style={{ color: 'inherit' }}>
          RankWright
        </Link>

        {sites.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="card-kicker">Site</span>
            <select
              className="input"
              aria-label="Which site to show"
              value={activeSite ?? ''}
              onChange={(event) => {
                const value = event.target.value
                const target = pathname === '/dashboard' ? '/findings' : pathname
                window.location.href = value ? `${target}?siteId=${value}` : target
              }}
            >
              <option value="">All sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {hostOf(site.url)}
                </option>
              ))}
            </select>
          </label>
        )}

        <nav aria-label="Main" className="flex flex-col gap-4">
          {GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              {/*
                A real heading rather than a styled div, so the group is a landmark a screen reader
                can jump between and not just a smaller font.
              */}
              <h2 className="card-kicker m-0 px-2">{group.label}</h2>
              {group.links.map((link) => {
                const active = link.match(pathname)
                return (
                  <Link
                    key={link.href}
                    href={withSite(link.href)}
                    aria-current={active ? 'page' : undefined}
                    className="rounded px-2 py-1.5 text-sm"
                    style={{
                      color: active ? 'var(--color-accent-700)' : 'inherit',
                      background: active ? 'var(--color-accent-100)' : undefined,
                    }}
                  >
                    {link.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <ThemeToggle />
          <form action={signOut}>
            <button type="submit" className="btn btn-ghost btn-sm">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
