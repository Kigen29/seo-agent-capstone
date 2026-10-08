# ADR-0039: A mention is confirmed by the name on the page, not by the search that returned it

- Status: Accepted
- Date: 2026-10-08

## Context

The authority axis counts the sites that mention a client's brand. It did this with one web search for the brand name in quotes, excluding the client's own site, and counted every result returned as a mention.

On 8 October 2026 a client reported that every site listed on their authority page was about another business. The client is Heartbeest Safaris. The search engine read "Heartbeest" as a misspelling of "hartebeest", the antelope, substituted it, and returned pages about African Hartebeest Safaris, a different company. The product then told the client that six sites wrote about them, that six had not linked, listed each page with a link, raised a finding naming those sites, and offered to draft an email to each.

Nothing in the pipeline had looked at whether a returned page contained the name. The quotes in the query are a request to the search engine, and a search engine returns what it believes was meant.

This is the first law of the codebase applied to a place it had not reached: a deterministic check decides what is true. A search engine's ranking is not that check, any more than a model's opinion is.

## Decision

**A search result counts as a mention only if its own title, summary or address contains the brand name as written.**

- The comparison ignores capitals, punctuation, spacing and accents, and requires the whole name as whole words in order. "Heartbeest-Safaris" is the name. "Hartebeest Safaris" is not, and neither is "Heartbeest" alone.
- It is done by a pure function, `confirmMentions`, before anything is counted, classified, listed or pitched. No model is involved.
- The same check is applied to each competitor's search, so the comparison between them is made on one instrument.
- The search is also asked not to substitute a spelling it prefers. That is a request and may be ignored, which is why it is not the fix.

**What was refused is reported, not hidden.** The audit records the name it searched for and how many results it left out. The page shows both, with the rule a result has to pass. An audit measured before this check carries a warning that its figures may describe a similarly named business.

**Listing sites are not publications.** The same report showed a marketplace profile, an uploaded brochure and `tripadvisor.ru` presented as independent coverage to pitch. Travel marketplaces and document hosts are added to the directory list, and the listing brands that run one site per country are matched by name whatever the ending.

## Consequences

- **The count can now be too low.** A page that names the brand only outside the title and the summary the search returned, or writes the name differently, is left out. That is the accepted direction of error: a low count costs a number; a false mention costs a client emailing strangers about articles that were never about them, and their trust in every other figure on the page.
- **It cannot tell two businesses with exactly the same name apart.** If another company is also called Heartbeest Safaris, its pages pass. Nothing in a title can settle that. The page shows the working and links every result so a person can see it, and a way for a client to exclude a named site is the next step if this is met in practice.
- **A client whose name is a common phrase will match unrelated pages.** A brand called "Blue Sky" is named by a great many pages that are not about it. The exact-name rule does not help there, and the page's statement of what was searched is the only guard.
- **Existing audits keep their old figures** until the site is audited again. They are marked.

## How we would know this was wrong

- A page listed as a mention that does not contain the brand name as written.
- A real mention, with the name plainly in the search result's title, left out.
- "Results were left out" shown with no way for the reader to tell why.
