# ADR-0017: The cost guard is enforced before the spend, per tenant, in its own package

**Status:** Accepted
**Date:** 2026-08-02

## Context

ADR-0016 decided that paid data sits behind a provider interface and "a per-tenant budget guard, before the spend, checked before the request is sent, not reconciled after". It named uncontrolled cost as the primary operational risk of a product that makes paid API calls.

That guard did not exist. `@seo/llm` has taken a `BudgetChecker` and a `SpendRecorder` as constructor arguments since ADR-0005, which is the right seam, but the worker filled it with `async () => ({ allowed: true })` and a `console.log`. For most of the project that was a defensible deferral: the only paid calls were one `smart` call per fixable finding, triggered by a human clicking a button, and a human clicking a button is itself a rate limit.

STORY-027 ended that. The AI-visibility poll spends **every day, per prompt, per site, indefinitely, with nobody present**. A tenant with twenty prompts and a paid `LLM_POLL` chain makes six hundred calls a month without anybody deciding to. The gap between an ADR that says "capped" and code that says `allowed: true` stopped being a deferral and became a false statement about the system.

## Decision

**Spending is refused before the call, against a per-tenant cap, using a ledger in the same Postgres as everything else. The guard lives in `@seo/budget`, which is added to the list of packages permitted to hold a database handle.**

Four parts:

1. **Before, not after.** `checkBudget` runs ahead of every paid call and can refuse it. A guard that reconciles afterwards is a report, not a cap: it can tell you what you spent but it cannot stop you spending it. The worst case for a misconfigured tenant is therefore a dark axis, never a bill.

2. **Per tenant, keyed on the tenant.** A platform-wide limit is not a cap for anybody. The first tenant to run away spends everyone else's allowance, and the tenants who then get refused are the ones who did nothing wrong. The cap is a column on `tenants`; the ledger carries `tenant_id` and is under row-level security like everything else (ADR-0008).

3. **A ledger, not a counter.** Every paid call writes a row: kind, provider, model, cost, tokens, time. A running total answers "how much" and nothing else, and when a bill surprises somebody the only useful question is *what* spent it. It also makes the cap auditable: the guard's verdict is a sum over rows anyone can re-run by hand. `kind` distinguishes `llm` from `serp` so both paid dependencies share one cap rather than having one each, which two separate budgets would let a tenant quietly exceed.

4. **Money is an integer.** Costs are stored in micro-dollars. A single cheap model call costs fractions of a cent and thousands of them have to sum without drift; an integer gets that by construction, a float gets it by luck.

The guard is a package rather than a file in the worker because the ledger has more than one reader: the worker writes it, the SERP provider will check it (ADR-0016), and the dashboard will show a tenant what it has spent. `@seo/budget` therefore joins `apps/api`, `apps/worker` and `packages/audit` on the ESLint allow-list for `@seo/db`. That list exists to keep `DATABASE_URL`, which is the owner credential and carries `BYPASSRLS`, out of the web app and off Vercel. A server-side package imported only by the API and the worker does not touch that risk, and `packages/audit` is the existing precedent for exactly this shape.

## Consequences

### Good

- Cost is bounded by construction per tenant, rather than by watching a dashboard. The specific failure a cost guard exists to prevent, a runaway recurring spend nobody is watching, is now structurally impossible rather than merely unlikely.
- The check fails **closed**. If the ledger cannot be read, the call is refused. A guard that allows the call when the database is unhappy is a guard-shaped hole that opens at exactly the wrong moment, and the cost of being wrong that way is real money, where the cost of being wrong the other way is a job that retries.
- Nothing that calls `llm.object` changed. The seam was designed for this in ADR-0005, and this is the implementation dropped into it.
- The window is a calendar month, so a budget is a sentence a human can act on: "you have $2 left until the 1st".

### Bad

- The cap is a threshold, not a reservation, so a tenant can overshoot by at most one call: the cost of a call is not known until it returns. Bounded by `maxTokens`, and small, but not zero.
- **An unpriced model is invisible to the cap.** `priceOf` returns 0 for a model missing from the hand-maintained pricing table (ADR-0005), so such a call bills real money and records nothing. The defence is a loud warning naming the model, which is a mitigation and not a fix. The real fix is keeping the table current.
- One more package, and one more entry on the database allow-list. Every addition to that list makes the boundary slightly less obvious, which is why it needs this document.

### Neutral

- The default cap of $5 a month is deliberately small and is a per-tenant column, so raising it is a database update rather than a deploy. Everything in the product is free until somebody opts into a paid model or a paid data source (ADR-0006), so the first tenant to spend anything should meet a wall they chose to raise.

## Alternatives considered

### Leave the stub and watch the vendor's dashboard

Rejected, and it is worth being blunt about why, because it was the status quo. A vendor-side spend limit protects the vendor's billing relationship, not one tenant from another and not us from a bug. It also only alerts after the money is gone. "We will notice" is not a control, and with a daily unattended poll there is nobody present to notice.

### Track spend in a counter on the tenant row

Rejected. It is cheaper to read and it answers only one question. The first real incident will be "why did this cost $40 last month", and a counter cannot answer it. An `UPDATE ... SET total = total + x` on every call also serialises every paid call for a tenant behind one row lock, for no benefit.

### Put the guard in the worker instead of a package

Rejected, narrowly. It would have avoided touching the database allow-list, and today the worker is the only writer. But the ledger already has three known readers, and a domain concept living inside one app is how the next reader ends up either importing from an app or duplicating the sum. Widening the allow-list once, in writing, is the smaller cost.

### A rolling 30-day window instead of a calendar month

Rejected. It caps the same amount of money and is much harder to reason about: the moment a tenant's budget frees up depends on the hour it was spent thirty days earlier. A calendar month matches how every vendor behind it bills, and gives a plain answer to "when can I run again".
