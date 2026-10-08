import type { Billing, BillingPlan } from '@seo/api-client'
import { Note } from '@/components/ui/note'
import { OutcomeNote, outcomeFor, type Outcome } from '@/components/ui/outcome-note'
import { SubmitButton } from '@/components/ui/submit-button'
import { choosePlan } from './actions'

/**
 * Which plan the account is on, and the plans there are (ADR-0036).
 *
 * A plan changes one thing, the monthly cap on paid work, so each card states that number and
 * nothing vaguer. Everything free is listed as free on every plan, because a pricing table that
 * implies the pull requests are behind a paywall would be selling the part that costs us nothing.
 *
 * Test mode is said on the page, every time. This deployment cannot take a real payment, and a
 * person about to type a card number is owed that before they do, not in an ADR.
 */

const MICROS_PER_USD = 1_000_000

const price = (plan: BillingPlan): string =>
  plan.priceMinor === 0
    ? 'Free'
    : `${new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency: plan.currency.toUpperCase(),
        maximumFractionDigits: 0,
      }).format(plan.priceMinor / 100)} a month`

const allowance = (plan: BillingPlan): string =>
  plan.monthlyBudgetMicros === null
    ? 'The allowance every new account gets'
    : `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
        plan.monthlyBudgetMicros / MICROS_PER_USD,
      )} of paid work a month`

/** What came back from the payment page. Neither changes the plan; only the webhook does. */
const RETURNED: Record<string, Outcome> = {
  success: {
    tone: 'ok',
    title: 'Checkout completed',
    detail:
      'Your plan changes when the payment provider confirms it, usually within a minute. Reload this page to see it.',
  },
  cancelled: {
    tone: 'info',
    title: 'Nothing changed',
    detail: 'Checkout was cancelled, and nothing was charged.',
  },
  failed: {
    tone: 'error',
    title: 'We could not start the checkout',
    detail: 'Nothing was charged. That is a fault on our side. Try again in a moment.',
  },
}

export function PlanSection({ billing, returned }: { billing: Billing; returned?: string }) {
  const current = billing.plans.find((plan) => plan.id === billing.plan)

  return (
    <section aria-labelledby="plan-heading">
      <h2 id="plan-heading" className="h-section mb-1">
        Plan
      </h2>
      <p className="text-muted mt-0 mb-3 max-w-[62ch] text-sm">
        A plan sets how much paid work this account may run each month: AI visibility polling,
        keyword research and drafted outreach. Audits, every rule, the scorecard, fix pull requests
        and Search Console verification are free on every plan.
      </p>

      <OutcomeNote outcome={outcomeFor(RETURNED, returned)} className="mb-3" />

      {!billing.configured && (
        <Note tone="info" className="mb-3">
          Paid plans are not switched on for this deployment, so every account is on the free plan.
          The plans below are what would be offered.
        </Note>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {billing.plans.map((plan) => {
          const isCurrent = plan.id === billing.plan
          const canBuy = billing.configured && plan.priceMinor > 0 && !isCurrent

          return (
            <div
              key={plan.id}
              className="card"
              style={{
                padding: 'var(--space-5)',
                gap: 'var(--space-3)',
                // The same two signals as the theme cards: colour and an outline, never colour alone.
                borderColor: isCurrent ? 'var(--color-accent)' : 'var(--color-divider)',
                outline: isCurrent ? '1px solid var(--color-accent)' : 'none',
              }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="card-heading">{plan.name}</h3>
                {isCurrent && <span className="tag tag-accent">Your plan</span>}
              </div>
              <div>
                <div className="stat-value stat-value-sm">{price(plan)}</div>
                <div className="stat-hint">{allowance(plan)}</div>
              </div>
              <div className="text-muted text-[13px]">{plan.summary}</div>

              {canBuy && (
                <form action={choosePlan} className="card-foot">
                  <input type="hidden" name="planId" value={plan.id} />
                  <span>Test mode: no real charge</span>
                  <SubmitButton
                    className="btn btn-secondary btn-sm"
                    pendingLabel="Opening checkout..."
                  >
                    Choose {plan.name}
                  </SubmitButton>
                </form>
              )}
            </div>
          )
        })}
      </div>

      {/*
        Said once more under the cards when a rail is live, because it is the one fact about this
        page that would be expensive to miss.
      */}
      {billing.configured && (
        <div className="text-muted mt-3 text-[13px]">
          Payments run through {billing.provider} in test mode. No real charge can be made on this
          deployment
          {current && current.priceMinor > 0
            ? ', and cancelling in the payment provider returns the account to the free plan.'
            : '.'}
        </div>
      )}
    </section>
  )
}
