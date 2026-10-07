# ADR-0036: Billing is a seam, runs in test mode only, and buys one thing

Status: accepted, 2026-10-07.

## Context

STORY-033 (#117) asks for "a way to charge, so that the plans in the design are real", through a provider in test or sandbox mode, behind a provider interface so the market's rail is swappable. Its falsification condition is "a live charge is made in a demo, or the billing rail is hard-coded to one provider". It was declared a stretch in Sprint 3 and deferred.

Three things shape the answer.

**There is exactly one thing in this product that costs money to run.** ADR-0017 put a per-tenant monthly cap, in micro-dollars, in front of every paid model and data call. Everything else (crawling, the rule engine, the scorecard, pull requests, Search Console verification) runs on infrastructure whose cost is zero (ADR-0006). A plan that gated any of those would be charging for the brand.

**The market the research identified pays differently.** `docs/research-dossier.md` puts the opening at a paid tier between KES 3,000 and 10,000 a month, in a market where the rail most customers would choose is M-Pesa and not a card.

**This is a graded capstone with a public deployment.** A configuration mistake that takes real money from a stranger is the worst outcome available, and "we will remember to use a test key" is a guideline.

## Decision

**A plan sets the monthly cap, and nothing else.** Three plans in `packages/core/src/plans.ts`: Free, Growth at KES 3,000 a month, Agency at KES 10,000. Each paid plan names the cap it grants (8 and 30 dollars of paid work a month). A plan is a label on the tenant row beside the number it set. No route, rule or page checks the plan; the cost guard goes on checking the cap exactly as before, so billing adds no second place where access is decided.

**The rail is behind `BillingProvider`.** Two methods: start a checkout and return its address, and verify and read a webhook delivery into one of three events (subscribed, cancelled, ignored). There is no method to charge a stored instrument, because nothing here should take money without a person approving it on the rail's own screen. `StripeBilling` is the first adapter. The API routes are tested against a fake rail with no key and no network, which is the evidence that the seam is real: those tests would hold unchanged for a Daraja adapter.

**Test mode is a precondition, enforced in two places.** The Stripe adapter will not construct with a key that is not a test key, and the refusal never repeats the key. Its webhook reader ignores any event Stripe marks as live, even a correctly signed one. `BillingProvider.mode` has the single value `'test'`. So there is no configuration of this deployment that can take real money, and making one possible means changing a type and writing an ADR. The first half of the falsification condition is closed by construction, not by care.

**A live key leaves billing off; it does not stop the API.** `billingFromEnv` reports the reason and returns no provider. Refusing to start over a misconfigured optional feature would turn a billing mistake into an outage of everything else.

**Only the webhook changes a plan.** Starting a checkout changes nothing, and neither does the browser returning from one, because anybody can type the return address. The webhook route is public, as the rail calls it with no bearer token, so it verifies the signature over the exact bytes received before it parses them: HMAC-SHA256 over `timestamp.body`, compared in constant time, with deliveries more than five minutes old refused as possible replays. Nothing from an unverified body is read, acted on or logged.

**Applying an event is idempotent, so no table of seen events is kept.** A subscription sets the plan and the cap; a second delivery sets them to the same values. A cancellation returns the tenant to the free plan and to the cap a new account on this deployment gets.

**The ids in a verified event are still checked.** The tenant id must be a uuid and the plan must be one that can be bought. A signature proves who sent the message, not that our own metadata was well formed.

**No vendor SDK.** The surface used is one form-encoded POST and one HMAC, written against `fetch`. An SDK for that would be a dependency larger than the feature.

**The page says test mode, where the buyer is.** The account page states under the plans that payments run in test mode and no real charge can be made, and each button carries it too. When no rail is configured the page says paid plans are not switched on, and shows what would be offered.

## Consequences

- With no Stripe variables set, which is the default and the state of the deployed product, nothing changes: every account is on the free plan and the page says so.
- An operator who wants to demonstrate billing sets `STRIPE_SECRET_KEY` (a test key) and `STRIPE_WEBHOOK_SECRET`, and points a Stripe test webhook at `/webhooks/billing`. That is an operator step this ADR cannot perform.
- The prices and the caps are a starting position taken from the ends of the range in the research, not a finding. They live in one file.
- Because a plan is only a cap, upgrading does not unlock a feature a free account lacks. It lets the paid axes run more. That is deliberate and is the honest shape of this product's costs, and it means the pricing page can never imply the pull requests are behind a paywall.
- A cancellation discards any cap an operator had set by hand for that tenant, since the previous value is not stored. Accepted: hand-set caps exist for the operator's own accounts, which do not subscribe.
- The cap is in dollars and the price is in shillings. No exchange rate is applied anywhere; the two numbers are set independently in the plan table.
- Going live is out of scope and is more than removing a guard. It needs a decision on tax, receipts, refunds, failed renewals and what happens to data when an account lapses, none of which a capstone should improvise.
- Migration 0033 adds `tenants.plan`.

## Alternatives considered

- **Stripe's SDK.** Rejected as above.
- **M-Pesa Daraja first.** It is the better fit for the market and the worse fit for a subscription: STK push is a one-off payment, so recurring billing needs a schedule of our own and a reconciliation job on a worker that is a throttled cron. Built second, behind the same interface, it would be a top-up of the cap for a month and not a subscription.
- **Gating features by plan.** Rejected: it adds a second authority on what an account may do, beside the cost guard, and charges for things that cost nothing.
- **Changing the plan when the browser returns from checkout.** Rejected: the return address is not evidence of payment.
- **A table of processed webhook event ids.** Rejected as unnecessary while applying an event is idempotent. It becomes necessary the day an event has an effect that must not repeat, such as granting a one-off credit.

## Evidence

- `packages/connectors/test/stripe-billing.contract.test.ts`: the refusal of live and malformed keys, a live event ignored though correctly signed, the checkout request's shape, and every way a webhook signature can fail (wrong secret, altered body, too old, malformed header).
- `apps/api/test/billing.integration.test.ts`: against Postgres with a fake rail. Starting a checkout does not change the plan; a webhook moves that tenant and no other; a second delivery changes nothing; a cancellation restores the free plan; an unsigned or forged delivery is refused and leaves the row untouched; an unknown plan or malformed tenant id is acknowledged and ignored.
