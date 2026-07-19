# ADR-0015: AI-visibility citation is measured deterministically, over many polls

**Status:** Accepted
**Date:** 2026-07-19

## Context

AI visibility is the axis the product is named for: whether ChatGPT, Perplexity, and Google's AI Overviews cite the client for the questions their customers ask. It is also the axis most easily faked, and the fakery is the industry norm. Two mistakes are almost universal.

The first is letting a model decide its own citation. It is tempting to ask a model "is this site cited for this query", but that is an LLM grading itself, the exact failure ADR-0001 rejected on the detection side, now on a new axis. The answer is non-reproducible and unfalsifiable.

The second is reporting a citation from a single poll. The research is blunt about why this is wrong: in a controlled study, roughly 45% of citations appeared in only one of three checks. A tool that polls once and reports "you are cited" is reporting noise as fact about half the time, and the client acts on a citation that was never stable.

## Decision

**The engine is measured, never asked to judge, and a citation is reported only when it is stable across at least three polls over at least three days.**

Concretely, in `packages/connectors/src/visibility`:

- An `AiEngine` is polled with a prompt and returns its answer and, where it exposes them, the sources it cited. A **deterministic parser** (`checkCitation`) then decides whether the client's domain is among the cited sources. No model is ever asked whether the client was cited. The engine is external data we measure, in the same category as CrUX field data on the performance axis (ADR-0010), not an oracle we trust to grade itself.
- Citation is decided by **source-domain match** when the engine gives a source list (Perplexity, AI Overviews), normalising hosts (lowercased, `www.` stripped, subdomains counted as the same site) and rejecting look-alikes (`example.com.evil.test` is not `example.com`). When an engine returns no sources (a plain chat model), the parser falls back to the client's domain appearing in the answer text, and records that the basis was a `mention`, which a caller weights below a real citation. The fallback matches the domain or its exact stem token, never a stem inside a longer word.
- A citation is summarised over the poll window, not per poll. `summarisePrompt` returns `insufficient` below three polls, `absent` when three or more never cite, `unstable` when the citation appears but below a two-of-three threshold, and `stable` only at two of three or better. **A citation seen once in three is reported as unstable, never as a citation.**
- **Share of voice** is computed against named competitors, so a client sees not just whether they are cited but whether a rival owns the answer, which the research names as the second-strongest predictor after geographic-scope match.

The poll orchestration takes its engines as injected dependencies and knows nothing about HTTP, keys, or budgets, so the deterministic core is tested with fake engines and no network, and a real adapter (paid or free) slots in without touching the measurement logic.

## Consequences

### Good

- The axis is reproducible and falsifiable: the same answers yield the same verdict, and every finding can state what would prove it wrong (re-poll and the citation does not hold).
- Hallucinated citations are structurally impossible: the parser can only report a domain it actually saw in the sources or the text.
- The single-poll overclaim, the industry's default, cannot happen: the summary refuses to report a citation from fewer than three polls, and reports instability honestly.
- The measurement core is a pure function of engine answers, unit tested against fixtures with no key and no spend.

### Bad

- Honesty is slower and costs more. Three polls over three days is a scheduled saga, not an instant number, and the client is told a citation verdict takes days, not seconds.
- The `mention` fallback for engines without a source list is genuinely weaker than a source match, and cannot match a spaced brand name against a concatenated domain. It is labelled as a mention rather than dressed up as a citation.

### Neutral

- The threshold (two of three) and the minimum (three polls) are constants in one file, so tightening the honesty bar later is a one-line change with a test, not a rewrite.

## Alternatives considered

### Ask a model whether the client is cited

Rejected, as the AI-visibility form of ADR-0001. It is non-reproducible, unfalsifiable, and it is a model grading output from its own family, which the same LLM layer already guards against for the eval harness (ADR-0005, the `judge` role must be a different family). A parser over the sources is the honest instrument.

### Poll once and report the citation

Rejected on the evidence: about 45% of citations appear in only one of three checks, so a single poll reports noise as fact roughly half the time. The stability score exists precisely to refuse this.

### Score AI visibility from the robots.txt crawler check alone

Already rejected in the scorecard's coverage notes, and reaffirmed here. Checking that `OAI-SearchBot` is not blocked proves the site *can* be cited; it says nothing about whether it *is*. That check is the precondition, not the measurement, and the axis stays honestly partial until the poll runs.
