# ADR-0031: The agent's context shrinks to fit the model

Status: accepted, 2026-10-05. Amends ADR-0030.

## Context

ADR-0030 fixed the agent's context at 14 files and 70,000 characters, and its evidence section said plainly that nothing had been run against a real repository or a real model. The first thing done after it merged was to run the deterministic half, with no model, against the repositories of the two real sites the product is used on. That run found four defects before anyone clicked Fix.

1. **The request was too large for the model that is configured.** The prompt came to about 76,000 characters, roughly 19,000 tokens. The `smart` chain is two models on a free plan that commonly allows about 8,000 tokens a minute, so every agent fix would have been refused for size. ADR-0006 makes the free tier a hard constraint, so this is the normal case, not an edge.
2. **A refusal for size did not fall through the chain.** The LLM layer moves to the next target on rate limits, quota and server errors. "Request too large" matched none of those, so a larger model later in the chain would never have been tried.
3. **The reason shown would have been useless.** When every target fails, the error's first line says only that the chain failed. The finding would have shown that line and not the provider's own words.
4. **The ranking was wrong in ways a made-up tree did not show.** A URL of `/destinations` matched every file in a `destinations/` folder, which buried the page under a dozen stubs. Long page files filled the budget and pushed out the small shared component that sets every page's description. The site's own address, taken from the evidence, appeared in so many files that it promoted all of them above the HTML shell that held the tag. An admin layout ranked first for a finding about the public pages' main landmark.

## Decision

**Three sizes, largest first.** The context is cut to 14 files and 60,000 characters, then 8 files and 22,000, then 5 files and 8,000, with the list of other paths shrinking alongside. The agent starts with the largest. When a provider refuses a request for its size, the agent tries the next size down. The limit depends on the provider and on the plan the operator pays for, and neither is knowable in code, so the provider's refusal is the measurement.

**A refused request is not an answer.** ADR-0030 allows two model calls per finding. A request refused for size produced no output and no charge, so stepping down does not count against the two. Candidates are read and ranked once and cut as many times as needed; each file is fetched once however many sizes are tried.

**Too large falls through the chain.** The LLM layer now treats a size refusal like a rate limit: try the next target. A chain that ends in a model with a larger window gets the full context there before the agent shrinks anything.

**The reason is the provider's own.** When a chain fails, the last attempt's line is shown. When even the smallest request is refused, the finding says the files are larger than the configured model accepts. When the agent stepped down and then could not fix the finding, the reason says the model's limit cut what it could be shown and that a model with a larger limit could attempt it. Without that, a limit of the plan would read as a fault of the repository.

**Ranking, corrected against real trees.**

- A URL segment matches a file's own name, or its folder when the framework gives every route the same file name (`page.tsx`, `index.tsx`). A folder match alone is worth little.
- A file named for the document head outranks everything for the ten rules fixed in the head, and counts for little on the others.
- For those rules the HTML document itself ranks alongside the head component, so the two of them survive the smallest cut ahead of helpers that only have SEO in their name.
- No file may take more than two fifths of the budget unless it contains the finding's evidence. The two best-ranked files are exempt, since the cap exists to protect them.
- Evidence found in more than three of the files read is treated as common: it adds a little and pins nothing.
- Admin and dashboard files are pushed well down. They are not what a search engine crawls.

## Consequences

- On a small plan the agent can fix findings whose cause is in short shared files: a canonical in the HTML shell, a missing viewport, a missing language, a default title. It cannot fix a finding that needs a 20,000 character page file, and it says so. That is a limit of the plan, stated on the finding, with the remedy.
- The cheapest remedy keeps the cost at zero: add a second provider with a larger free request limit to the end of the `smart` chain. No code change (ADR-0005).
- The dry run is the method worth keeping. Selection is deterministic, so it can be run against any connected repository without a model, a key or a cost, and what it chooses can be read by a person.
- Still unproven: whether the configured models write good edits. Nothing here changes that; it is measured by the merge and revert rate of agent pull requests.

## Evidence

`packages/agent/test/repo-context.test.ts` has a case for each ranking defect, named for what went wrong on the real repository. `packages/agent/test/repo-fix.test.ts` covers stepping down once and twice, giving up with the provider's words, one more-files request after stepping down, no retry for an unrelated error, and the reason shown in each case. `packages/llm/test/client.test.ts` covers the fall-through.
