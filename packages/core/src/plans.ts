/**
 * The plans a tenant can be on (ADR-0036).
 *
 * A plan changes exactly one thing: the monthly cap on paid work, which is the only part of the
 * product that costs anything to run (ADR-0017). Crawling, the rule engine, the scorecard, pull
 * requests and Search Console verification are free on every plan and are not gated here, because
 * charging for the parts that cost nothing would be charging for the brand.
 *
 * Prices are in Kenyan shillings because that is the market the research identified as unserved
 * (`docs/research-dossier.md`: an entry tier other tools price at 29 dollars is already out of
 * reach, and a paid tier between KES 3,000 and 10,000 a month has the market to itself). The two
 * paid tiers sit at the ends of that range. They are a starting position, not a finding: change
 * them here and nowhere else.
 */
export type PlanId = 'free' | 'growth' | 'agency'

export interface Plan {
  id: PlanId
  name: string
  /** In the currency's minor unit (cents), which is what every payment rail takes. Zero is free. */
  priceMinor: number
  /** ISO 4217, lower case. */
  currency: 'kes'
  /**
   * The monthly cap on paid model and data calls this plan grants, in millionths of a dollar.
   * Null for the free plan, whose cap is whatever the deployment gives a new account.
   */
  monthlyBudgetMicros: number | null
  summary: string
}

export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    name: 'Free',
    priceMinor: 0,
    currency: 'kes',
    monthlyBudgetMicros: null,
    summary:
      'Every audit, every rule, the eight-axis scorecard, fix pull requests and Search Console verification.',
  },
  {
    id: 'growth',
    name: 'Growth',
    priceMinor: 300_000,
    currency: 'kes',
    monthlyBudgetMicros: 8_000_000,
    summary:
      'Everything in Free, with a larger monthly allowance for AI visibility polling, keyword research and drafted outreach.',
  },
  {
    id: 'agency',
    name: 'Agency',
    priceMinor: 1_000_000,
    currency: 'kes',
    monthlyBudgetMicros: 30_000_000,
    summary:
      'Everything in Growth, with an allowance sized for several client sites polled every day.',
  },
]

export const planById = (id: string): Plan | undefined => PLANS.find((plan) => plan.id === id)

/** A plan somebody can pay for. The free plan is not bought, it is what remains. */
export const isPaidPlan = (plan: Plan): plan is Plan & { monthlyBudgetMicros: number } =>
  plan.priceMinor > 0 && plan.monthlyBudgetMicros !== null
