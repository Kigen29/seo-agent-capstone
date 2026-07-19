# ADR-0016: Third-party SERP and AI data behind a provider, under a per-tenant budget cap

**Status:** Accepted
**Date:** 2026-07-19

## Context

Two of the eight axes need data no crawl can produce. AI visibility needs the answers and cited sources from AI Overviews, which come from a SERP data vendor (SerpApi, DataForSEO). Authority needs brand mentions across the web, which come from the same kind of source. These are queried per keyword, per engine, per poll, and unlike everything else in the stack, **they cost money per query.**

This collides head-on with the hard constraint of ADR-0006: total infrastructure cost is zero. Neon, Render, Vercel, and GitHub Actions are all permanent free tiers; the LLM layer degrades to a free provider when credit runs out (ADR-0005). SERP and AI-Overview data has no equivalent free tier that is usable at product scale. This is the first genuinely paid dependency in the product, and the risk it introduces is the one architecture.md already names as the primary operational risk of an LLM product: uncontrolled cost.

## Decision

**Third-party SERP and AI data sits behind a provider interface, and every paid query passes a per-tenant budget guard before it is made. With no key or no budget, the axis is unmeasured and says so, never partial and never a surprise charge.**

Three parts, each already present in the design or built with the AI-visibility core (ADR-0015):

1. **A provider seam (Strategy).** AI engines are polled through the injected `AiEngine` interface, and SERP and AI-Overview data through a `SerpProvider` interface, exactly as version control sits behind `VersionControlProvider` (ADR-0002) and model vendors behind the LLM providers (ADR-0005). SerpApi and DataForSEO are interchangeable adapters; the deterministic measurement code (`checkCitation`, `summarisePrompt`) never names a vendor and is tested against fakes. The `SerpProvider` is the seam architecture.md's patterns table has named as planned since Sprint 1; this is where it is built.

2. **A per-tenant budget guard, before the spend.** Every paid call passes the same budget guard that already sits above every LLM call (ADR-0005), keyed on the tenant, checked before the request is sent, not reconciled after. A tenant that has spent its cap gets an unmeasured axis for the rest of the window, not a bill. Cost is bounded per tenant by construction, not by watching a dashboard.

3. **Opt-in, and honest when off.** Paid data is not required for an audit. A tenant with no SERP key gets the seven other axes in full, and AI visibility and authority report unmeasured with a note naming the missing source, the same three-state honesty the performance axis uses for a missing CrUX key (ADR-0010). Absence of a paid source is an absence of measurement, stated plainly, never a zero dressed up as a score.

## Consequences

### Good

- The vendor is swappable in configuration: SerpApi to DataForSEO is an adapter and an environment variable, no call site changes, because the measurement code only sees the provider interface.
- Cost cannot run away. The guard is before the call and per tenant, so the worst case for one tenant is a dark axis, never an unbounded charge, which is the specific failure a cost guard exists to prevent.
- The zero-cost promise stays true for every tenant who does not opt in, and true for the whole product until the first paid key is added. The paid path is the exception, wrapped and capped, not the default.
- The honest core stays testable: because the providers are injected and the parsers are pure (ADR-0015), the whole measurement is unit tested with fakes and no key and no spend.

### Bad

- The $0 story now has an asterisk. It is still $0 for the crawl, performance, content, structure, agent-readiness, and local axes, and for any tenant without a SERP key, but the two earned-media axes cost money to measure at all, and the design says so rather than pretending otherwise.
- A per-tenant budget and a pricing table for SERP queries must be maintained by hand, the same maintenance cost the LLM pricing table already carries (ADR-0005).
- The two axes are dark for tenants who do not pay for data, which is most early tenants. That is the honest state, and it is better than a fabricated number, but it is a real gap in a free-tier demo.

### Neutral

- This extends, rather than breaks, the discipline of ADR-0006. That ADR dropped Redis and object storage to reach $0; this one admits the one place $0 is not achievable and contains it behind an interface and a cap, so the rest of the stack is unaffected and the paid surface is one swappable, budgeted component.

## Alternatives considered

### Scrape AI Overviews and SERPs ourselves

Rejected. It looks free and is not. Google actively blocks scraping of AI Overviews, so it needs rotating proxies and headless browsers at scale, which is infrastructure we would pay for and babysit, on top of a terms-of-service position no client wants their brand associated with. A vendor that sells the data with an API is cheaper once the true cost of scraping is counted, and it is honest.

### No budget guard, trust the vendor's spend limits

Rejected. Cost blowout is the number-one operational risk of a product that makes paid API calls, and a vendor-side limit protects the vendor's billing, not the client's budget or ours per tenant. The guard has to be ours, before the call, keyed on the tenant, so one tenant's runaway keyword list cannot spend another tenant's cap or the platform's.

### Require paid data before an audit can run

Rejected, for the same reason ADR-0010 rejected requiring CrUX field data: it would make the product useless for exactly the new and small clients who most need the free axes. Unmeasured-but-honest beats blocked, and the axis lights up the moment a key and a budget are present.

### Put the paid providers directly in the measurement code

Rejected. It would tie the citation parser and the stability aggregator to a vendor's response shape and make them untestable without a key, undoing the whole point of ADR-0015's pure, injected core. The provider interface keeps the deterministic logic vendor-blind and the paid I/O at the edge.
