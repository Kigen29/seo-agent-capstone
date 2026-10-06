# ADR-0032: The topic threshold belongs to the embedding model

Status: accepted, 2026-10-06. Amends ADR-0024.

## Context

ADR-0024 lets embeddings measure what a site is about and fixes how pages are grouped: one deterministic pass with a similarity threshold of 0.86. It also records that the threshold is model-dependent. That stayed theoretical while there was one embedding model.

Then the only configured provider's account went inactive and every audit logged an embedding failure and skipped the topic map. A second provider was available, on a free tier, which is the constraint the product runs under (ADR-0006). Moving to it raised three things.

1. **The threshold does not transfer.** It was chosen by reading clusters from one model's vectors. Another model scores the same two pages differently, so 0.86 on new vectors is a number with no reasoning behind it, and the map would look as authoritative as before.
2. **The spend record would have failed.** The new provider's embedding endpoint reports no token count, and through the SDK that arrives as NaN, not as a missing value. The client's fallback was `??`, which NaN passes. A NaN cost cannot be recorded, and a call whose cost cannot be recorded stops the chain by design.
3. **The text being embedded was mostly the menu.** `pageText` took the title, the first heading and the first 600 characters of the body, on the stated grounds that the opening announces the subject. Printing that text for real pages showed the opening of a body is the navigation, then on short pages the footer. A contact page and a reviews page scored 0.985 alike. This was wrong for any model; a change of model was only what made someone look.

## Decision

**A threshold per model, and an honest fallback.** `similarityThresholdFor` holds the threshold for each embedding model it has been chosen for. A model with no entry gets the default, and the topic map's coverage note then says the grouping is provisional. An uncalibrated map can no longer pass as a measured one.

**Calibration is a repeatable act, not a memory.** `packages/eval/src/calibrate-topics.ts` embeds the golden dataset's real pages exactly as an audit would and prints the spread of pairwise similarity, the closest and furthest pairs, and the clusters at each candidate threshold. The `calibrate-topics` workflow runs it with the repository's keys, from any branch. It decides nothing. The threshold stays a judgement made by a person reading real clusters, which is what ADR-0024 said it was; the change is that the reading can be done again in a few minutes and leaves a log.

**The embedded text is the page's own content.** The crawler's extract gains `mainText`: the main landmark when a page declares one, otherwise the body without navigation, banner and footer, with a space between adjacent elements so a menu or a card grid is not one unbroken word. `pageText` reads its opening from that, and falls back to the body for a page that is nothing but its frame. The whole-body `text` is unchanged, because the word count and the duplicate check are defined over it.

**A missing token count is replaced by the estimate.** The client records the reservation's own estimate whenever a provider's count is not a finite number. The estimate is deliberately high, so a provider that reports nothing is over-charged against the budget and never under-charged.

**`google:gemini-embedding-001` is 0.88.** Measured on 2026-10-06 over the dataset's two sites with enough pages to say anything:

| Threshold | Tile shop, 4 pages | Safari operator, 24 pages |
|---|---|---|
| 0.83 | all four pages in one topic | fourteen unrelated pages in one topic |
| 0.86 | home and about together; catalogue and contact apart | twelve in one topic, including three identical not-found pages grouped with the homepage |
| 0.88 | the same | home, contact, reviews, the safaris index and its three packages together; the three not-found pages in their own topic; hotels apart |
| 0.90 | the same | the packages split from their own index page |

0.88 is the highest value that keeps the package pages with their index and the lowest that separates the not-found pages from the homepage. On these vectors pairwise similarity within one site runs from about 0.66 to 1.0, a narrower band than the earlier model's, which is why a value that looks close to the old one is not the old one.

**Google's clustering task type was tried and rejected.** It narrowed the band to 0.86 through 1.0 on the safari site and put all four tile pages above 0.95, leaving no threshold that separated anything.

## Consequences

- The topic map works again without a paid account. `LLM_EMBED` moves to the Google model as a configuration change (ADR-0005).
- The evidence is two sites. On a site about one subject most detail pages stand alone at 0.88, and that is reported as it is: many small topics, not a forced grouping. A third kind of site may move the number, and the workflow is how that would be found out.
- Vectors are never stored, so there is nothing to migrate and no mixed-model state to reason about.
- A page with no main landmark and no navigation or footer elements still embeds from the top of its body. That is the case the agent-readiness rule for a missing main landmark already reports.
- The earlier model keeps 0.86, but that value was chosen on the old body-opening text. It is no longer in use and should be re-read with the workflow before it is used again.

## Evidence

Calibration runs 37410438933 (default task type, body-opening text), 37410608832 (clustering task type) and 37411046258 (default task type, page content) in this repository's Actions history. `packages/crawler/test/extract.test.ts` covers the content extraction, `packages/audit/test/topics.test.ts` the lookup and the page text, `packages/llm/test/client.test.ts` the missing token count, and `packages/eval/test/calibrate-topics.test.ts` that the calibration computes what an audit would.
