import type { Site, SiteProfile } from '@seo/api-client'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { startAudit } from '@/app/(app)/dashboard/actions'
import { ApiAsleep } from '@/components/api-asleep'
import { SubmitButton } from '@/components/ui/submit-button'
import { handleApiError } from '@/lib/api-error'
import { readPendingSite } from '@/lib/pending-site'
import { getClient, getSites, getToken } from '@/lib/session'
import { BusinessStep, CompetitorsStep, QuestionsStep, SiteStep } from './steps'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Set up your site', robots: { index: false } }

/**
 * The guided setup a new account lands in: five short steps, then the first audit.
 *
 * Before this, a new account arrived on an empty dashboard with an "Add site" field in one corner
 * and then had to discover, on four different pages, that a brand name, competitors, questions
 * and connections existed. Here they are asked for in the order they depend on each other, with
 * as much as possible filled in already: the address from the landing page, the brand from the
 * homepage title, the competitors and questions as suggestions to tick.
 *
 * Outside the `(app)` group on purpose. The sidebar is a map of a product the person has not seen
 * yet, and every link in it is a way to leave a five-step flow half done.
 *
 * The step is in the URL and everything saves as it goes, so the flow is resumable and a refresh
 * loses nothing. Only the first step is required; the rest can be skipped and done later on the
 * site setup page, which uses the same forms.
 */

const STEPS = [
  { id: 'site', label: 'Your site' },
  { id: 'business', label: 'Your business' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'questions', label: 'Questions' },
  { id: 'finish', label: 'First audit' },
] as const

type StepId = (typeof STEPS)[number]['id']

const HEADINGS: Record<StepId, { title: string; lead: string }> = {
  site: {
    title: 'Which site should we look after?',
    lead: 'We read its homepage to pick up your brand name, so the next step is mostly filled in.',
  },
  business: {
    title: 'Tell us about the business',
    lead: 'Three short answers. They decide which competitors and questions we suggest next, and the brand name is how we find who mentions you.',
  },
  competitors: {
    title: 'Who do you compete with?',
    lead: 'We suggest some from what you offer and where. Tick the real ones, and add any we missed. You can change this list at any time.',
  },
  questions: {
    title: 'What do your customers ask AI assistants?',
    lead: 'Each question is put to the AI engines once a day, and we report whether your site is cited in the answer. Real questions work better than keywords.',
  },
  finish: {
    title: 'Ready for the first audit',
    lead: 'The audit crawls your site and checks it against every rule. It takes a few minutes and needs nothing else from you.',
  },
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default async function Onboarding({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string; step?: string }>
}) {
  if (!(await getToken())) redirect('/login?next=/onboarding')

  const api = await getClient()
  if (!api) redirect('/login?next=/onboarding')

  const { siteId, step: rawStep } = await searchParams

  let site: Site | undefined
  let profile: SiteProfile | undefined
  let hasSites = false
  try {
    const sites = await getSites()
    hasSites = sites.length > 0
    site = siteId ? sites.find((candidate) => candidate.id === siteId) : undefined
    if (site) profile = await api.getSiteProfile(site.id)
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  // Without a site there is only the first step, whatever the address says.
  const step: StepId =
    site && profile
      ? (STEPS.find((entry) => entry.id === rawStep && entry.id !== 'site')?.id ?? 'business')
      : 'site'
  const position = STEPS.findIndex((entry) => entry.id === step)
  const heading = HEADINGS[step]

  return (
    <main id="main" className="mx-auto w-full max-w-[720px] px-4 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <span className="nav-brand" style={{ margin: 0 }}>
          RankWright
        </span>
        {/* Only offered once there is somewhere to go: an account with no site has no dashboard. */}
        {hasSites && (
          <Link href={site ? `/dashboard?siteId=${site.id}` : '/dashboard'} className="text-[13px]">
            Finish later
          </Link>
        )}
      </div>

      <ol
        className="m-0 mb-8 flex list-none flex-wrap gap-x-5 gap-y-2 p-0"
        aria-label="Setup steps"
      >
        {STEPS.map((entry, index) => {
          const state = index < position ? 'done' : index === position ? 'current' : 'todo'
          return (
            <li
              key={entry.id}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex items-center gap-2 text-[13px]"
              style={{
                color: state === 'todo' ? 'var(--color-text-muted)' : 'var(--color-text)',
                fontWeight: state === 'current' ? 600 : 400,
              }}
            >
              <span
                className="tnum flex size-6 items-center justify-center rounded-full text-[12px]"
                style={{
                  background:
                    state === 'current'
                      ? 'var(--color-accent-700)'
                      : state === 'done'
                        ? 'var(--color-accent-100)'
                        : 'transparent',
                  color:
                    state === 'current'
                      ? 'var(--color-bg)'
                      : state === 'done'
                        ? 'var(--color-accent-700)'
                        : 'inherit',
                  border: state === 'todo' ? '1px solid var(--color-divider)' : 'none',
                }}
              >
                {index + 1}
              </span>
              {entry.label}
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </li>
          )
        })}
      </ol>

      <div className="card-kicker">
        Step {position + 1} of {STEPS.length}
        {site ? `, ${hostOf(site.url)}` : ''}
      </div>
      <h1 className="mt-1 mb-2">{heading.title}</h1>
      <div className="text-muted mb-6 max-w-[62ch] text-sm" style={{ lineHeight: 1.65 }}>
        {heading.lead}
      </div>

      {step === 'site' && <SiteStep initialUrl={(await readPendingSite()) ?? ''} />}

      {site && profile && step === 'business' && (
        <>
          {profile.brand && (
            <div className="note note-ok mb-4">
              We read &ldquo;{profile.brand}&rdquo; from your homepage. Correct it if that is not
              how the name is written.
            </div>
          )}
          <BusinessStep siteId={site.id} profile={profile} />
        </>
      )}

      {site && profile && step === 'competitors' && (
        <CompetitorsStep siteId={site.id} initial={profile.competitors} />
      )}

      {site && step === 'questions' && (
        <QuestionsStep siteId={site.id} tracked={site.trackedPrompts ?? 0} />
      )}

      {site && profile && step === 'finish' && <Finish site={site} profile={profile} />}
    </main>
  )
}

/** What was set, the one thing to do now, and the two worth doing soon. */
function Finish({ site, profile }: { site: Site; profile: SiteProfile }) {
  const prompts = site.trackedPrompts ?? 0
  const summary: { label: string; value: string; set: boolean }[] = [
    { label: 'Brand', value: profile.brand ?? 'Not set', set: Boolean(profile.brand) },
    {
      label: 'What you offer',
      value: profile.offering ?? 'Not set',
      set: Boolean(profile.offering),
    },
    { label: 'Market', value: profile.market ?? 'Not set', set: Boolean(profile.market) },
    {
      label: 'Competitors',
      value: profile.competitors.length > 0 ? `${profile.competitors.length} tracked` : 'None yet',
      set: profile.competitors.length > 0,
    },
    {
      label: 'AI questions',
      value: prompts > 0 ? `${prompts} tracked` : 'None yet',
      set: prompts > 0,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <dl className="frame m-0 px-5">
        {summary.map((row, index) => (
          <div
            key={row.label}
            className="flex flex-wrap items-baseline justify-between gap-3 py-3"
            style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-divider)' }}
          >
            <dt className="text-muted text-[13px]">{row.label}</dt>
            <dd className={`m-0 min-w-0 text-right ${row.set ? '' : 'text-muted'}`}>{row.value}</dd>
          </div>
        ))}
      </dl>

      <form action={startAudit}>
        <input type="hidden" name="siteId" value={site.id} />
        <SubmitButton className="btn btn-primary" pendingLabel="Queueing...">
          Run the first audit
        </SubmitButton>
      </form>

      <div className="card" style={{ padding: 'var(--space-5)', gap: 'var(--space-2)' }}>
        <div className="card-heading">Two connections worth making next</div>
        <div className="text-muted text-sm" style={{ lineHeight: 1.65 }}>
          The audit runs without them. Connecting your code repository is what lets fixes arrive as
          pull requests for you to review, and Google Search Console adds the searches and clicks
          your site really gets. Both are on the site setup page, along with everything you entered
          here.
        </div>
        <div>
          <Link href={`/site?siteId=${site.id}`} className="btn btn-secondary btn-sm">
            Open site setup
          </Link>
        </div>
      </div>

      <div>
        <Link href={`/onboarding?siteId=${site.id}&step=questions`} className="btn btn-ghost">
          Back
        </Link>
      </div>
    </div>
  )
}
