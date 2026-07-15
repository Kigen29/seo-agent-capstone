# ADR-0010: The performance axis is CrUX field data, never Lighthouse

**Status:** Accepted
**Date:** 2026-07-15

## Context

The performance axis measures Core Web Vitals. There are two sources for them, and they are not interchangeable, and confusing them is the single most common way an SEO tool misleads its users.

**Lab data** (Lighthouse, PageSpeed Insights' Lighthouse half) runs the page once, in a simulated environment, on demand. It is fast, repeatable, and available for any URL. It is also not what Google ranks on, and it **cannot measure INP at all** — it substitutes Total Blocking Time as a proxy. A green Lighthouse score sitting next to a red Search Console report is not a bug; it is the normal, expected state of affairs.

**Field data** (the Chrome UX Report) is the 75th percentile of real Chrome users over a rolling 28-day window. It is what Google actually uses. It only exists for origins with enough real traffic, and it lags reality by up to 28 days.

## Decision

**The performance axis is scored from CrUX field data at p75, and never from Lighthouse.**

We query the CrUX API for the site's origin and evaluate LCP, INP, and CLS against Google's published thresholds (unchanged since INP replaced FID on 12 March 2024):

| Metric | Good | Poor |
|---|---|---|
| LCP | ≤ 2.5s | > 4.0s |
| INP | ≤ 200ms | > 500ms |
| CLS | ≤ 0.1 | > 0.25 |

The thresholds live in one file (`packages/connectors/src/crux/thresholds.ts`) against which the primary source can be checked, so no rule can quietly invent its own idea of "slow".

### "No performance findings" has three meanings, and they must stay distinct

This is the honesty the whole scorecard is built on, arriving on a new axis. The performance step reports one of three states, never collapsing them:

1. **No API key.** We could measure this; we were not asked to. Unmeasured, with a note saying how to switch it on.
2. **Key present, but the origin is absent from CrUX.** Too new or too quiet to have field data. This is an *absence of measurement, not a fast site*. Scoring it would be inventing a number from nothing. Unmeasured, with a note blaming traffic, not speed.
3. **Key present, data found.** Only now is the axis measured. All-good scores 100 with no findings; poor and needs-improvement metrics become findings.

A CrUX outage or rate limit downgrades performance to unmeasured *for that run* rather than failing the whole audit. The crawl and the other seven axes are real; losing one bonus axis to a Google hiccup is the proportionate response.

### Never flag a green metric

The evaluator emits nothing for a metric already in the good band. "Never optimise a green metric" is a rule of the domain: a finding for a 1.8s LCP would send a developer to make a fast thing slightly faster while the actually-poor metric sits untouched.

### Every performance finding pre-empts the two classic confusions

The falsification on each finding states, in plain language, that (a) CrUX will not move for up to 28 days because the window is rolling, so an immediate re-check proving nothing is expected, and (b) a green Lighthouse score is not this metric — and for INP, that Lighthouse cannot measure it at all. These are the two things a user will otherwise conclude we were wrong about the day after they ship a fix.

### Performance is a separate vertical from the crawl rule engine

The deterministic rule engine (`packages/rules`) is pure over the crawl: its `RuleContext` has no network. Performance data comes from an API and is measured per-site rather than always, so it does not fit that model and is not forced into it. The CrUX client and its evaluator live in `packages/connectors`, produce the same `Finding` shape, and the audit runner merges the two streams. The scorecard does not care where a finding came from.

This keeps the rule engine honestly crawl-only and testable against fixtures, and keeps the "did this site even have field data" decision where it belongs: in the runner that orchestrates the fetch.

## The tension we resolved, and did not hide

CLAUDE.md gives a Core-Web-Vitals fix order: poor first, then INP (hardest), then LCP (biggest commercial impact), then CLS (easiest). The global priority score (ADR domain model: `severity_weight × confidence × impact / effort`) produces a *different* order, because it is deliberately ROI-based: it divides by effort so the backlog is not led by expensive work that merely sounds important. Poor CLS is cheap, so it outranks poor LCP despite LCP's higher raw impact.

These two orderings optimise different things and cannot both drive one sorted list. **We let the ROI formula win**, because it is the product's stated core and it governs the whole backlog, crawl and performance findings together. The CWV fix-order guidance is surfaced in the finding text, not forced into the sort. The impact numbers stay honest (LCP highest) and effort stays honest (INP largest); the resulting order is simply what those honest numbers produce. A test documents this rather than asserting the contradiction away.

## Consequences

**Good.** The axis reflects what Google actually ranks on. It is honest about the large fraction of real client sites that are too small to have field data. It cannot be gamed by a one-off fast lab run.

**Cost.** The axis is dark for low-traffic sites, which is most new sites, and there is nothing we can do about that except say so. The 28-day lag means the verification loop for a performance fix is slow, and the user has to be told up front.

**Deferred.** Per-form-factor breakdown (phone vs desktop, where mobile is usually worse and Google is mobile-first) is a refinement on top of the combined headline. Per-URL field data for key landing pages is another. Both are additive.

## Alternatives considered

**Lighthouse / PageSpeed lab data for the axis.** Rejected: it is not what Google ranks on, it cannot measure INP, and presenting a lab score as a Core Web Vital is the exact dishonesty this product is positioned against. PageSpeed Insights remains useful for its *diagnostic* opportunities (unused JavaScript, render-blocking resources) that suggest *why* a field metric is poor, and that is a good later use of the PSI key — as diagnosis feeding a fix, never as the score.

**Requiring field data before an audit can complete.** Rejected: it would make the product useless for exactly the new sites that most need the other seven axes. Unmeasured-but-honest beats blocked.
