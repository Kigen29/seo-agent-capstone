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

const LINKS = [
  { href: '/dashboard', label: 'Sites', match: (p: string) => p === '/dashboard' },
  { href: '/findings', label: 'Findings', match: (p: string) => p.startsWith('/findings') },
  { href: '/audits', label: 'Audits', match: (p: string) => p.startsWith('/audits') },
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
      */}
      <div className="nav md:hidden">
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
        className={`${open ? 'flex' : 'hidden'} w-full shrink-0 flex-col gap-6 border-b p-4 md:flex md:h-dvh md:w-60 md:border-r md:border-b-0 md:sticky md:top-0`}
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

        <nav aria-label="Main" className="flex flex-col gap-1">
          {LINKS.map((link) => {
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
