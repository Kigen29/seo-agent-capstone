# ADR-0001: Deterministic detection first, LLM second

**Status:** Accepted
**Date:** 2026-07-12

## Context
An "AI SEO agent" invites an obvious but wrong architecture: feed the page HTML to an LLM and ask it to find SEO issues. This is fast to prototype and impossible to trust. LLMs hallucinate findings, produce non-reproducible output across runs, cost money per page, and cannot be unit tested.

Meanwhile, the overwhelming majority of SEO checks are trivially deterministic. Is there a canonical tag? Does it resolve to a 200? Is LCP above 2.5s at p75? Is `OAI-SearchBot` disallowed in robots.txt? These are parser questions, not reasoning questions.

## Decision
The rule engine (`packages/rules`) contains **zero LLM calls**. A deterministic parser or API client detects every finding. The LLM is used only to (a) explain a finding in plain language, (b) generate the code fix, and (c) perform genuinely subjective work such as content quality assessment and competitive angle generation.

If a check can be expressed as a pure function, it must be.

## Consequences

### Good
- Findings are reproducible, testable, and free.
- Hallucinated findings become structurally impossible for the ~40 core checks.
- The rule engine can reach 100% unit test coverage.
- Cost per audit collapses. Most of an audit costs nothing but compute.
- We can honestly tell a client "we found 14 issues" and mean it.

### Bad
- More upfront engineering than prompting a model.
- Rules must be maintained as the web changes.

### Neutral
- Draws a hard line about where "AI" actually adds value in this product, which is a useful thing to be forced to answer.

## Alternatives considered

### LLM-as-detector
Rejected. Non-reproducible, untestable, expensive, and it hallucinates findings that reference code that does not exist. This is the failure mode of most "AI SEO" products on the market.

### Hybrid with LLM as a second-pass validator
Deferred. Possibly useful later for edge cases, but it must never be the primary detector.
