import type { Site } from '@seo/api-client'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { connectGoogle } from './actions'
import { VerifyOwnership } from './verify-ownership'
import { BusinessProfile } from './business-profile'
import { ConnectRepo } from './connect-repo'

type Status = { label: string; tone: 'success' | 'neutral' | 'accent' | 'outline' }

const TAG: Record<Status['tone'], string> = {
  success: 'tag tag-success',
  neutral: 'tag tag-neutral',
  accent: 'tag tag-accent',
  outline: 'tag tag-outline',
}

/**
 * What is connected for this site, what is missing, and the one thing to do about each.
 *
 * The dashboard used to scatter these across the page: a Search Console panel with only a
 * "Reconnect" button, repository and verification tags in one row, and a Business Profile that
 * showed its state only after it was clicked. A person could not tell at a glance whether anything
 * was connected. Each row here names the connection, says its state in words, and offers exactly
 * one action, labelled for what it does.
 *
 * It lives on the site setup page. The dashboard carries a one-line count that links here, since
 * a dashboard is for where the site stands and not for wiring it up.
 */
export function SetupChecklist({
  site,
  google,
}: {
  site: Site
  google: { connected: boolean; email?: string | null; needsReconnect?: boolean }
}) {
  const verification = site.gscVerificationStatus ?? 'none'
  /*
    Connected and usable are two things. Google can refuse a saved sign-in, and until that was
    recorded the row said "Connected" while nothing that needed Google could run (ADR-0048).
  */
  const googleUsable = google.connected && !google.needsReconnect
  const verificationError = verification === 'none' ? (site.gscVerificationError ?? null) : null
  const prompts = site.trackedPrompts ?? 0

  const rows: { name: string; status: Status; detail: ReactNode; action?: ReactNode }[] = [
    {
      name: 'Google Search Console',
      status: googleUsable
        ? { label: 'Connected', tone: 'success' }
        : google.needsReconnect
          ? { label: 'Needs reconnecting', tone: 'accent' }
          : { label: 'Not connected', tone: 'neutral' },
      detail: googleUsable
        ? `Connected as ${google.email ?? 'your Google account'}. Real searches and clicks feed your audits.`
        : google.needsReconnect
          ? `Google has stopped accepting the sign-in saved for ${google.email ?? 'your account'}, so search data and verification are paused. Connect again to carry on. Nothing is lost.`
          : 'Shows the searches people find you with. OAuth only; we never see your password.',
      action: (
        <form action={connectGoogle}>
          <button
            type="submit"
            className={googleUsable ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
          >
            {googleUsable
              ? 'Use another account'
              : google.needsReconnect
                ? 'Connect again'
                : 'Connect'}
          </button>
        </form>
      ),
    },
    {
      name: 'Code repository',
      status: site.repoFullName
        ? { label: 'Connected', tone: 'success' }
        : { label: 'Not connected', tone: 'neutral' },
      detail: site.repoFullName
        ? `Fixes arrive as pull requests on ${site.repoFullName}.`
        : "Connect the site's code so fixes can arrive as pull requests you review.",
      action: <ConnectRepo siteId={site.id} repoFullName={site.repoFullName ?? null} />,
    },
    {
      name: 'Search Console ownership',
      status:
        verification === 'verified'
          ? { label: 'Verified', tone: 'success' }
          : verification === 'merged'
            ? { label: 'Waiting for Google', tone: 'outline' }
            : verification === 'pr_open'
              ? { label: 'Needs your review', tone: 'accent' }
              : verificationError
                ? { label: 'Did not work', tone: 'accent' }
                : { label: 'Not started', tone: 'neutral' },
      detail:
        verification === 'verified'
          ? 'Google has confirmed you own this site.'
          : verification === 'merged'
            ? 'The tag is merged. Google confirms once your site redeploys with it.'
            : verification === 'pr_open'
              ? 'A pull request adds the verification tag. Merge it to finish.'
              : verificationError
                ? verificationError
                : site.repoFullName && googleUsable
                  ? 'Checks whether your Google account already has this site verified. If it does, that is used and nothing is opened. If not, a pull request adds the tag that proves it.'
                  : google.needsReconnect
                    ? 'Waits until Google is connected again.'
                    : 'Needs Search Console and a repository connected first.',
      action:
        verification === 'pr_open' && site.gscVerificationPrUrl ? (
          <a
            href={site.gscVerificationPrUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary btn-sm"
          >
            Review the pull request
          </a>
        ) : verification === 'none' && site.repoFullName && googleUsable ? (
          <VerifyOwnership siteId={site.id} retry={Boolean(verificationError)} />
        ) : undefined,
    },
    {
      name: 'Google Business Profile',
      status: site.businessProfileConnected
        ? { label: 'Connected', tone: 'success' }
        : { label: 'Not connected', tone: 'neutral' },
      detail: site.businessProfileConnected
        ? 'Your Maps listing is linked, so local checks and structured data can use it.'
        : 'Paste your Google Maps link so local search and reviews can be checked.',
      action: (
        <BusinessProfile
          siteId={site.id}
          siteUrl={site.url}
          label={site.businessProfileConnected ? 'Change' : 'Add profile'}
        />
      ),
    },
    {
      name: 'AI visibility questions',
      status:
        prompts > 0
          ? { label: `${prompts} tracked`, tone: 'success' }
          : { label: 'None yet', tone: 'neutral' },
      detail:
        prompts > 0
          ? 'Checked daily for whether AI assistants mention your site when customers ask them.'
          : 'Let the agent suggest the questions customers ask AI assistants about what you offer.',
      action: (
        <Link
          href={`/visibility?siteId=${site.id}`}
          className={prompts > 0 ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
        >
          {prompts > 0 ? 'Manage questions' : 'Suggest questions'}
        </Link>
      ),
    },
  ]

  const done = rows.filter((row) => row.status.tone === 'success').length

  return (
    <section className="mb-8" aria-labelledby="setup-heading">
      <div className="mb-1 flex flex-wrap items-baseline gap-3">
        <h2 id="setup-heading" className="h-section m-0">
          Connections
        </h2>
        <span className="text-muted text-[13px]">
          {done} of {rows.length} done
        </span>
      </div>
      <div className="text-muted mb-3 max-w-[68ch] text-sm">
        An audit runs with none of these. A repository is what turns findings into pull requests,
        and Search Console adds your real searches and clicks. The last two are optional.
      </div>
      {/* Rows inside one frame. A card per row would be five boxes saying the same thing. */}
      <ul className="frame m-0 list-none p-0 px-5">
        {rows.map((row, index) => (
          <li
            key={row.name}
            className="flex flex-wrap items-start justify-between gap-3 py-4"
            style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{row.name}</span>
                <span className={TAG[row.status.tone]}>{row.status.label}</span>
              </div>
              <p className="text-muted mt-1 mb-0 max-w-[68ch] text-[13px]">{row.detail}</p>
            </div>
            {row.action && <div className="shrink-0">{row.action}</div>}
          </li>
        ))}
      </ul>
    </section>
  )
}
