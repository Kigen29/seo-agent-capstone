'use client'

import { ChevronRight, Play } from 'lucide-react'
import Link from 'next/link'
import { startAudit } from '@/app/(app)/dashboard/actions'
import { SubmitButton } from '@/components/ui/submit-button'
import { useActiveSite } from '@/lib/active-site'

/**
 * The bar across the top of every signed-in page.
 *
 * Three things, each of which used to cost a trip back to the dashboard: where you are, whether
 * Search Console is connected, and running an audit of the site you are looking at.
 *
 * The location is text, not a second breadcrumb trail. Detail pages already render a real
 * `Breadcrumbs` nav with links to their ancestors, and two navigations with the same job on one
 * page is one too many for a screen reader.
 *
 * Hidden below `md`, where the sidebar's own bar with the Menu button is the top of the page.
 */
export interface TopbarSite {
  id: string
  /** An audit is queued or running, so a second one must not be started on top of it. */
  auditRunning: boolean
}

const SECTIONS: { prefix: string; label: string }[] = [
  { prefix: '/dashboard', label: 'Dashboard' },
  { prefix: '/keywords', label: 'Keywords' },
  { prefix: '/authority', label: 'Authority' },
  { prefix: '/visibility', label: 'AI visibility' },
  { prefix: '/competitors', label: 'Competitors' },
  { prefix: '/topics', label: 'Topics' },
  { prefix: '/findings', label: 'Findings' },
  { prefix: '/audits', label: 'Audits' },
  { prefix: '/schedule', label: 'Schedule' },
  { prefix: '/outcomes', label: 'Outcomes' },
  { prefix: '/site', label: 'Site setup' },
  { prefix: '/settings', label: 'Settings' },
  { prefix: '/profile', label: 'Profile' },
]

export function Topbar({
  sites,
  google,
}: {
  sites: TopbarSite[]
  /** Null when the connection state could not be read, in which case nothing is claimed. */
  google: { connected: boolean; needsReconnect?: boolean } | null
}) {
  const { pathname, activeSite } = useActiveSite(sites)
  const section = SECTIONS.find((entry) => pathname.startsWith(entry.prefix))
  const site = sites.find((candidate) => candidate.id === activeSite)

  return (
    <div className="topbar hidden md:flex">
      <div className="text-muted flex min-w-0 items-center gap-1">
        <span>Console</span>
        {section && (
          <>
            <ChevronRight size={14} aria-hidden="true" />
            <span className="truncate font-semibold" style={{ color: 'var(--color-text)' }}>
              {section.label}
            </span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {google &&
          (google.connected && google.needsReconnect ? (
            // Said on every page, because everything that reads search data is paused until then.
            <Link href="/settings/connections" className="tag tag-dot tag-accent">
              Google needs reconnecting
            </Link>
          ) : google.connected ? (
            <span className="tag tag-dot tag-success">Search Console connected</span>
          ) : (
            <Link href="/settings/connections" className="tag tag-dot tag-neutral">
              Search Console not connected
            </Link>
          ))}

        {site && (
          <form action={startAudit}>
            <input type="hidden" name="siteId" value={site.id} />
            <SubmitButton
              className="btn btn-primary btn-sm"
              pendingLabel="Queueing..."
              disabled={site.auditRunning}
            >
              <Play size={13} aria-hidden="true" />
              {site.auditRunning ? 'Audit running' : 'Run audit'}
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  )
}
