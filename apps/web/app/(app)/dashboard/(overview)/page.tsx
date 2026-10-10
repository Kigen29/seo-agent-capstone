import type { Audit, SiteProfile, VisibilityReport } from '@seo/api-client'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ApiAsleep } from '@/components/api-asleep'
import { GoogleCallbackNote } from '@/components/google-connection'
import { RepoCallback } from '@/components/repo-callback'
import { OutcomeNote, outcomeFor, type Outcome } from '@/components/ui/outcome-note'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient, getSites } from '@/lib/session'
import { setupSteps } from '@/lib/setup-progress'
import { AddSite } from '../add-site'
import { SetupStrip } from '../setup-strip'
import { Overview } from './overview'
import { SitesTable } from './sites-table'

export const dynamic = 'force-dynamic'

/** The banner shown after a Verify-with-a-PR click, keyed on the ?verify= status. */
const VERIFY: Record<string, Outcome> = {
  queued: {
    tone: 'ok',
    title: 'Verification started',
    detail:
      'The agent is opening a pull request that adds the ownership tag. It will appear against this site shortly.',
  },
  precondition: {
    tone: 'warn',
    title: 'Two connections are needed first',
    detail: 'Connect a repository and Google Search Console to this site, then verify.',
  },
  failed: {
    tone: 'error',
    title: 'We could not start verification',
    detail: 'That is a fault on our side, not something you did. Try again in a moment.',
  },
}

/** `startAudit` comes back here with this when the API did not answer. */
const AUDIT_NOT_QUEUED: Outcome = {
  tone: 'info',
  title: 'The audit was not started',
  detail:
    'The service was starting up. It sleeps after about fifteen minutes without use and takes up to a minute to wake. Nothing was lost. Press Run audit again.',
}

/** The host, for a page title. A full URL as an h1 reads as a string rather than a name. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const metadata = { title: 'Dashboard' }

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{
    google?: string
    github?: string
    verify?: string
    asleep?: string
    siteId?: string
  }>
}) {
  const api = await getClient()
  if (!api) return null

  const {
    google: googleCallback,
    github: githubCallback,
    verify: verifyCallback,
    asleep,
    siteId,
  } = await searchParams

  let sites
  let connections
  let audit: Audit | undefined
  let visibility: VisibilityReport | undefined
  let profile: SiteProfile | null = null
  try {
    ;[sites, connections] = await Promise.all([getSites(), api.getConnections()])

    /**
     * The overview is about one site, and the switcher in the sidebar says which. Falling back to
     * the first is what every other page here does, so arriving with no `siteId` shows something
     * rather than an empty frame.
     *
     * Settled rather than awaited together with the list: these two are the overview's detail and
     * a failure in either must not cost the site list, the connect flows, or the Add-site form,
     * which are what a user with nothing set up actually needs.
     */
    const active = siteId ? sites.find((site) => site.id === siteId) : sites[0]
    if (active) {
      const [auditResult, visibilityResult, profileResult] = await Promise.allSettled([
        active.latestAudit ? api.getAudit(active.latestAudit.id) : Promise.resolve(undefined),
        api.getVisibilityReport(active.id),
        api.getSiteProfile(active.id),
      ])
      if (auditResult.status === 'fulfilled') audit = auditResult.value
      if (visibilityResult.status === 'fulfilled') visibility = visibilityResult.value
      if (profileResult.status === 'fulfilled') profile = profileResult.value
    }
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  /**
   * An account with no site has nothing to show here, so it goes to the guided setup instead of
   * an empty dashboard with a form in one corner. Outside the `try`, because `redirect` works by
   * throwing and the catch above would swallow it.
   */
  if (sites.length === 0) redirect('/onboarding')

  const activeSite = siteId ? sites.find((site) => site.id === siteId) : sites[0]

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="Overview"
        title={activeSite ? hostOf(activeSite.url) : 'Your sites'}
        description="How this site is doing in each area we measure. Anything we could not measure says why, and never shows a zero."
        actions={<Link href="/findings">All findings &rarr;</Link>}
      />

      <GoogleCallbackNote callback={googleCallback} />

      <RepoCallback callback={githubCallback} />

      {/*
        `startAudit` redirects here with ?asleep=1 when the API did not answer, and nothing read
        it: the parameter was set, the page destructured three other keys, and the user got a
        silent bounce back to the dashboard with their audit never queued and no explanation. The
        button appeared to do nothing at all.
      */}
      {asleep && <OutcomeNote outcome={AUDIT_NOT_QUEUED} className="mt-4" />}

      <OutcomeNote outcome={outcomeFor(VERIFY, verifyCallback)} className="mt-4" />

      {activeSite && (
        <Overview
          site={activeSite}
          {...(audit ? { audit } : {})}
          {...(visibility ? { visibility } : {})}
        />
      )}

      {activeSite && (
        <SetupStrip
          siteId={activeSite.id}
          steps={setupSteps(activeSite, connections.google, profile)}
        />
      )}

      <div
        className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b pb-4"
        style={{ borderColor: 'var(--color-divider)' }}
      >
        <div>
          <h2 className="h-section m-0">Your sites</h2>
          <div className="text-muted mt-1 text-[13px]">Every site this account audits.</div>
        </div>
        <AddSite />
      </div>

      <SitesTable sites={sites} activeId={activeSite?.id} hostOf={hostOf} />
    </main>
  )
}
