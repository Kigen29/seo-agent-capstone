import { ApiAsleep } from '@/components/api-asleep'
import { Note } from '@/components/ui/note'
import { Stat, StatRow } from '@/components/ui/stat'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'
import { Credentials } from './credentials'

export const dynamic = 'force-dynamic'

/**
 * What this account is, and what it may spend.
 *
 * The spend section is here rather than hidden in a log because this deployment is open: anyone
 * who signs in gets a tenant with a cap on somebody else's API keys (ADR-0023), and the person
 * holding the account should be able to see their own cap without reading the source.
 *
 * It states the two numbers and stops. A "you have plenty left" summary would be the product
 * editorialising about money, which is the last place it should.
 */
/**
 * The conversion is repeated here rather than imported from `@seo/budget`, deliberately.
 *
 * That package reads the spend ledger, so it imports `@seo/db`, and pulling it into the web app
 * would drag a database dependency into the tier that must not have one. ADR-0009 is explicit
 * that the web app holds no database credential and cannot reach Postgres, and ESLint fails the
 * build on a `@seo/db` import here. Duplicating one division is the cheaper side of that trade.
 *
 * Micro-dollars, because money is never a float in this codebase: a `fast` call costs fractions
 * of a cent and thousands of them have to sum without drift. Convert once, at the edge, for
 * display only.
 */
const MICROS_PER_USD = 1_000_000

const money = (micros: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    micros / MICROS_PER_USD,
  )

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ revoked?: string }>
}) {
  const api = await getClient()
  if (!api) return null

  const { revoked: revokedParam } = await searchParams
  const revokedCount = Number(revokedParam)
  const revoked = Number.isInteger(revokedCount) && revokedCount >= 0 ? revokedCount : null

  let account
  let credentials
  try {
    ;[account, credentials] = await Promise.all([api.getAccount(), api.listCredentials()])
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  const { budget } = account
  const reserved = budget.reservedMicros ?? 0
  const remaining = Math.max(0, budget.capMicros - budget.spentMicros - reserved)

  /** A part of the cap as a whole percentage, clamped, for the bar and the hints under a figure. */
  const share = (micros: number): number =>
    budget.capMicros > 0
      ? Math.min(100, Math.max(0, Math.round((micros / budget.capMicros) * 100)))
      : 0
  const ofCap = (micros: number) =>
    budget.capMicros > 0 ? `${share(micros)}% of the cap` : undefined

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="h-section mb-3">Account</h2>
        <div className="card" style={{ padding: 'var(--space-4) var(--space-5)' }}>
          <dl className="m-0 flex flex-wrap items-start justify-between gap-4">
            <div>
              <dt className="card-kicker">Name</dt>
              <dd className="m-0 mt-1 font-semibold">{account.tenantName ?? 'Unnamed'}</dd>
            </div>
            <div className="sm:text-right">
              <dt className="card-kicker">Created</dt>
              <dd className="m-0 mt-1 font-semibold">
                {account.createdAt
                  ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
                      new Date(account.createdAt),
                    )
                  : '\u2014'}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section>
        <h2 className="h-section mb-1">Spend this month</h2>
        <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
          Only paid work counts: model calls and SERP data. Crawling, the rule engine, the
          scorecard, opening pull requests and Search Console verification are all free and are not
          capped.
        </p>

        <StatRow>
          <Stat label="Spent" value={money(budget.spentMicros)} hint={ofCap(budget.spentMicros)} />
          <Stat
            label="Reserved"
            value={money(reserved)}
            hint={reserved > 0 ? 'Held for running work' : undefined}
          />
          <Stat label="Monthly cap" value={money(budget.capMicros)} />
          <Stat
            label="Remaining"
            value={money(remaining)}
            hint={ofCap(remaining)}
            tone={remaining > 0 ? 'success' : undefined}
          />
        </StatRow>

        {/*
          The same three amounts as one bar, because "is most of it gone" is a question about
          proportion and four separate figures make the reader do the division. Not drawn at all
          when there is no cap: a bar that is 0% of nothing is not a measurement.
        */}
        {budget.capMicros > 0 && (
          <div
            className="mb-6 rounded-lg border p-3"
            style={{ borderColor: 'var(--color-divider)', background: 'var(--color-surface)' }}
          >
            <div className="flex flex-wrap justify-between gap-2 text-[12px]">
              <span className="text-muted">
                Spent and reserved: {money(budget.spentMicros + reserved)} of{' '}
                {money(budget.capMicros)}
              </span>
              <span className="tnum font-semibold">
                {share(budget.spentMicros + reserved)}% used
              </span>
            </div>
            <div
              className="meter mt-2"
              role="img"
              aria-label={`${share(budget.spentMicros)}% spent, ${share(reserved)}% reserved`}
            >
              <span
                style={{
                  width: `${share(budget.spentMicros)}%`,
                  background: 'var(--color-accent)',
                }}
              />
              <span style={{ width: `${share(reserved)}%`, background: 'var(--color-info)' }} />
            </div>
            <div className="text-muted mt-2 flex flex-wrap gap-4 text-[12px]">
              <span className="flex items-center gap-1.5">
                <span className="dot" style={{ color: 'var(--color-accent)' }} />
                Spent
              </span>
              <span className="flex items-center gap-1.5">
                <span className="dot" style={{ color: 'var(--color-info)' }} />
                Reserved
              </span>
              <span className="flex items-center gap-1.5">
                <span className="dot" style={{ color: 'var(--color-neutral-400)' }} />
                Remaining
              </span>
            </div>
          </div>
        )}

        {/*
          The cap being zero is a configuration, not a fault, and it has to read as one. A tenant
          created on a deployment with NEW_TENANT_BUDGET_MICROS=0 is fully usable for everything
          that does not cost money, and telling that person something went wrong would be false.
        */}
        {budget.capMicros === 0 ? (
          <Note tone="info" className="mt-3">
            This account has no paid budget. Everything free still works: crawling, every rule, the
            eight-axis scorecard, fix pull requests and Search Console verification. AI visibility
            polling, keyword research and drafted outreach need a budget, and will say so rather
            than failing quietly.
          </Note>
        ) : budget.allowed ? null : (
          <Note tone="warn" className="mt-3">
            The available account budget is spent or reserved, so new paid work is paused.
            Reservations cover running calls and calls awaiting charge confirmation. Confirmed
            unused amounts become available after reconciliation.
          </Note>
        )}
      </section>

      <Credentials credentials={credentials} revoked={revoked} />
    </div>
  )
}
