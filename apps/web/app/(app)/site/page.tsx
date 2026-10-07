import type { Site, SiteProfile } from '@seo/api-client'
import Link from 'next/link'
import { ApiAsleep } from '@/components/api-asleep'
import { GoogleCallbackNote } from '@/components/google-connection'
import { RepoCallback } from '@/components/repo-callback'
import { EmptyState } from '@/components/ui/empty-state'
import { InfoHint } from '@/components/ui/info-hint'
import { PageHeader } from '@/components/ui/page-header'
import { handleApiError } from '@/lib/api-error'
import { getClient, getSites } from '@/lib/session'
import { SetupChecklist } from '../dashboard/setup-checklist'
import { CompetitorsEditor } from './competitors-editor'
import { ProfileForm } from './profile-form'

export const dynamic = 'force-dynamic'

/**
 * Everything a site is told once and then measured against: who it is, who it competes with, and
 * what it is connected to.
 *
 * These used to live in three places. The brand name and the competitors sat inside the AI
 * visibility editor, behind a button labelled for questions, although the authority page and the
 * competitor watch read them too. The connections were a collapsed strip at the bottom of the
 * dashboard. Somebody looking for "where do I say who my competitors are" had no page to go to.
 * This is that page, and the others now link here.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default async function SiteSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string; google?: string; github?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { siteId, google: googleCallback, github: githubCallback } = await searchParams

  let site: Site | undefined
  let profile: SiteProfile | undefined
  let connections
  try {
    const sites = await getSites()
    site = siteId ? sites.find((candidate) => candidate.id === siteId) : sites[0]
    if (site) {
      ;[profile, connections] = await Promise.all([
        api.getSiteProfile(site.id),
        api.getConnections(),
      ])
    }
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  if (!site || !profile || !connections) {
    return (
      <main id="main" className="wrap">
        <PageHeader kicker="This site" title="Site setup" />
        <EmptyState
          figure="0"
          title="No sites yet"
          action={
            <Link href="/onboarding" className="btn btn-primary">
              Add your site
            </Link>
          }
        >
          Add a site and its details, competitors and connections are set up here.
        </EmptyState>
      </main>
    )
  }

  return (
    <main id="main" className="wrap">
      <PageHeader
        kicker="This site"
        title="Site setup"
        description={`What we know about ${hostOf(site.url)}, who it is compared with, and what it is connected to. You set these once and every page uses them.`}
      />

      <GoogleCallbackNote callback={googleCallback} />
      <RepoCallback callback={githubCallback} />

      <section className="mb-10" aria-labelledby="details-heading">
        <h2 id="details-heading" className="h-section mb-1">
          Your business
        </h2>
        <div className="text-muted mb-3 max-w-[68ch] text-sm">
          Used to find who mentions you, and to suggest competitors and questions that fit what you
          actually do.
        </div>
        {/* Keyed by site, so switching site in the sidebar resets the form to that site's values. */}
        <ProfileForm key={site.id} siteId={site.id} profile={profile} />
      </section>

      <section className="mb-10" aria-labelledby="competitors-heading">
        <div className="mb-1 flex items-center gap-1">
          <h2 id="competitors-heading" className="h-section m-0">
            Competitors
          </h2>
          <InfoHint label="how competitors are used">
            Two things read this list. Share of voice counts how often AI assistants cite you
            against how often they cite these sites. The weekly competitor watch reads a few of
            their public pages and records what changed. Up to ten.
          </InfoHint>
        </div>
        <div className="text-muted mb-3 max-w-[68ch] text-sm">
          The sites you are measured against. Ask for suggestions, or add the ones you already know.
        </div>
        <CompetitorsEditor key={site.id} siteId={site.id} initial={profile.competitors} />
      </section>

      <SetupChecklist site={site} google={connections.google} />
    </main>
  )
}
