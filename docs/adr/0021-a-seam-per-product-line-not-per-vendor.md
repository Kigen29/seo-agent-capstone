# ADR-0021: A seam per product line, not per vendor, and links enter as a second signal

**Status:** Accepted
**Date:** 2026-08-23
**Deciders:** Kigen

## Context

Two data gaps remained against the products this one is measured against: backlink research and keyword research. Both are sold by DataForSEO, whose credentials have been in `.env.example` since Sprint 3 waiting for this.

`SerpProvider` (ADR-0016) already exists as the Strategy seam for paid data, with a SerpApi adapter and a budget decorator. The obvious move was to add `referringDomains()` and `ideas()` to it.

That is wrong, and the reason is not tidiness. **SerpApi does not sell backlink data or search-volume data at all.** Adding those methods to `SerpProvider` would force `serpapi.ts` to implement two methods it cannot honour, and there are only two ways to do that: throw, which turns a vendor's product boundary into a runtime error on an axis that was working; or return an empty result, which is a lie that reads as "this site has no backlinks". Every SERP-only vendor added afterwards would inherit the same two dead methods.

The second question was what backlinks should *do* once measurable. ADR-0018 established that this axis leads with mentions, on evidence: branded mentions correlate 0.664 with AI Overview visibility, backlinks 0.218. It also said what should happen when an index arrived: *"referring domains become a second measured signal on the same axis, and the ordering stays as it is."* The temptation on arrival is to add the finding every other tool leads with, "your referring domains are low", which would quietly undo that.

## Decision

**One interface per product line, not per vendor.** `BacklinkProvider` and `KeywordProvider` live alongside `SerpProvider`, each with its own DataForSEO adapter and its own budget decorator. DataForSEO implements all three because it sells all three; SerpApi implements one because it sells one. A vendor's catalogue is a fact about the vendor, and the interfaces describe capabilities rather than suppliers.

The three budget decorators stay separate and explicit rather than becoming one generic `Proxy` over any provider. Each returns an object literal typed as its interface, so **a method added to an interface and forgotten in its decorator fails to compile** rather than silently arriving unguarded. On the only paid surface in the product, that compile error is worth more than the duplication it costs.

**Backlinks enter as a measured number plus exactly one finding.** The number appears on the authority axis; there is deliberately no "you have few referring domains" finding. The one finding is **AUTH-004: domains that mention the brand without linking to it** — the set difference between the mention footprint we already gather and the referring domains we now fetch.

**Keyword research is exposed as an MCP tool, not a dashboard page**, through a budget-guarded REST route like every other client (ADR-0009, ADR-0020).

## Consequences

### Good

- **ADR-0018 pays off rather than being softened.** AUTH-004 is only computable because this axis leads with mentions; neither signal produces it alone. Links made the mention data more useful instead of displacing it.
- **The one link finding is specific.** "You have few backlinks" sends a client to buy links. A named list of publications that already covered them is an afternoon of email with a real hit rate, and unlinked-mention reclamation is a recognised tactic rather than something invented here.
- Adding a vendor that sells only one product line costs one adapter, not an interface change.
- The compiler guards the budget wrapper, which is the property that made the decorators worth keeping separate.
- Keyword research needed no storage, no page and no saga, which is what let it ship alongside backlinks.

### Bad

- **Three interfaces and three decorators where a generic wrapper would be one.** The duplication is real and deliberate; the section above says what it buys.
- **AUTH-004 is computed over a slice, not the whole index.** The comparison covers the top N referring domains by authority, so a link from outside that slice looks like an absence. The finding's falsification condition names the limit and the true total rather than hiding it, but a reader who ignores it can still waste an email.
- A second paid vendor is a second set of credentials, a second contract test to keep honest, and a second thing that can start returning subtly wrong data without failing.

### Neutral

- Both surfaces are off by default and honest when off, exactly as SerpApi is. An operator with no DataForSEO account sees the same product they saw before, including the same sentence about referring domains being unmeasured.

## Alternatives considered

### Add the methods to `SerpProvider`

Rejected: SerpApi cannot implement them. The interface would have described a vendor that does not exist, and the adapter would have had to lie or throw. See the context above.

### One generic budgeted `Proxy` over any provider

Shorter, and it gives up the compile error. A `Proxy` guards methods it has never heard of, which sounds like a feature until the failure mode is considered: a new method on a paid interface would be wrapped by reflection and *appear* guarded whether or not anyone had thought about what it costs. Explicit decorators make adding a paid method a decision somebody has to write down.

### A "low referring domains" finding

Rejected, and it is the finding every competitor leads with. It is generic advice, it is unfalsifiable in any useful sense ("get more links" has no failure condition), and it re-orders the axis toward the signal the evidence says matters less. The count is reported; it is not advice.

### Rank tracking in the same slice

Deferred. Backlinks and keyword ideas are per-call and need no storage. Rank tracking needs a tracked-keywords table, a rank-checks table, a daily poll saga, and a per-keyword-per-day cost that never stops. It is the one workflow that genuinely breaks the zero-cost-by-default posture of ADR-0006, and it deserves its own decision rather than arriving as a rider on this one.
