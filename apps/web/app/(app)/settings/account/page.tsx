import { ApiAsleep } from '@/components/api-asleep'
import { Note } from '@/components/ui/note'
import { Stat, StatRow } from '@/components/ui/stat'
import { handleApiError } from '@/lib/api-error'
import { getClient } from '@/lib/session'

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

export default async function AccountSettingsPage() {
  const api = await getClient()
  if (!api) return null

  let account
  try {
    account = await api.getAccount()
  } catch (error) {
    handleApiError(error)
    return <ApiAsleep />
  }

  const { budget } = account
  const remaining = Math.max(0, budget.capMicros - budget.spentMicros)

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="h-section mb-3">Account</h2>
        <div className="card elev-sm" style={{ padding: 'var(--space-4)' }}>
          <dl className="m-0 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="card-kicker">Name</dt>
              <dd className="m-0 text-sm">{account.tenantName ?? 'Unnamed'}</dd>
            </div>
            <div>
              <dt className="card-kicker">Created</dt>
              <dd className="m-0 text-sm">
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
          <Stat label="Spent" value={money(budget.spentMicros)} />
          <Stat label="Monthly cap" value={money(budget.capMicros)} />
          <Stat label="Remaining" value={money(remaining)} />
        </StatRow>

        {/*
          The cap being zero is a configuration, not a fault, and it has to read as one. A tenant
          created on a deployment with NEW_TENANT_BUDGET_MICROS=0 is fully usable for everything
          that does not cost money, and telling that person something went wrong would be false.
        */}
        {budget.capMicros === 0 ? (
          <Note tone="info" className="mt-3">
            This account has no paid budget. Everything free still works: crawling, all 27 rules,
            the eight-axis scorecard, fix pull requests and Search Console verification. AI
            visibility polling, keyword research and drafted outreach need a budget, and will say so
            rather than failing quietly.
          </Note>
        ) : budget.allowed ? null : (
          <Note tone="warn" className="mt-3">
            The cap for this month has been reached, so paid work is paused until the 1st. Nothing
            is lost and nothing is charged; the axes that need paid data will report themselves
            unmeasured until then.
          </Note>
        )}
      </section>
    </div>
  )
}
