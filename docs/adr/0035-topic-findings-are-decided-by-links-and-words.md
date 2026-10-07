# ADR-0035: The topic map's findings are decided by links and words, not by vectors

Status: accepted, 2026-10-07. Extends ADR-0024.

## Context

ADR-0024 allowed embeddings as an input to measurement and built the topic map on them: pages are embedded, grouped by a deterministic function of the vectors, and only then named by a model. It also said what any finding computed from the map must rest on: "the group's membership, the internal link graph, or Search Console, all of which a human can check."

The map shipped without findings. It has been measured and drawn on every audit since, has advised nothing, and for that reason adds no checks to any axis. `docs/state-of-play.md` has carried the two missing findings as a loose end: a cluster with no internal hub, and a tracked question with no matching cluster.

The first fits ADR-0024 as written. The second, built the obvious way, does not. "No matching cluster" would mean embedding each tracked question and calling it unmatched when no page's vector is within the clustering threshold. That threshold is calibrated per embedding model for how alike two pages are (ADR-0032). A one-line question against a few hundred words of page text is a different comparison, nobody has calibrated it, and its only evidence would be a similarity figure: a finding a person could not check without the model.

## Decision

**TOPIC-001: several pages on one subject, and no page that links them together.** For each group of three or more pages, count for every member how many of the other members it links to, from the links the crawler found. A hub is a member that links to at least half of the others. A group with no hub is raised, on the structure axis, naming the best connected page and how many it links to.

**TOPIC-002: a tracked question that no page is about.** For each question the site tracks for AI visibility, take its subject words (the same tokeniser and stop words CONTENT-002 uses) and test whether most of them appear in the title or main heading of any crawled page. A question no page covers is raised, on the content axis. No embedding is involved, so it runs whether or not the map was measured.

**The split of labour is ADR-0024's, stated once more.** Vectors may say which pages belong together. Whether that is a problem is decided by something a person can check with a browser: who links to whom, and which words are in which titles. Neither finding reads a cluster's name, and a test asserts the name does not appear in the finding at all.

**Both say what they cannot know.** TOPIC-001 carries confidence 0.8 and its falsification names two ways to be wrong: a member that does link to enough of the others, and a group that is not in fact one subject, "because the grouping comes from text similarity and can be mistaken". TOPIC-002 says a page answering the question in different words is a reason to dismiss it. Neither promises a ranking or a citation; TOPIC-002 says in terms that whether engines cite a new page is measured separately, over days.

**Neither is fixable by a pull request.** A hub page and an answer to a customer's question are pages somebody has to write with facts only the business has. They are not in the fixable list, and the inbox files them under "needs your content".

**They bring their checks with them, and only when they ran.** The structure axis gains one check when the map was measured and at least one group was large enough to have a hub. The content axis gains one when there were tracked questions and crawled pages to test them against. A site that could not sit a test is not credited with passing it.

**Each is capped at five per audit**, largest groups first for TOPIC-001, so a large site does not bury its inbox.

## Consequences

- The topic map now changes a score, and only through advice it actually gave or could have given.
- TOPIC-002 overlaps CONTENT-002 in method and differs in source. CONTENT-002 starts from questions Search Console shows the site already draws impressions for; TOPIC-002 starts from questions the client chose to track. A question can appear in both, and each says where it came from.
- The word test is crude in both directions. It will miss a page that covers a subject in other words (so the falsification invites dismissal), and it will be satisfied by a page whose title shares the words and answers nothing. It errs toward silence, which is the right way round for a finding that asks somebody to write a page.
- The hub definition is a threshold somebody chose: half of the others. It is in the finding's own text, so a reader can disagree with the number rather than with a verdict.
- Cluster membership still depends on the embedding model and its calibrated threshold. A change of model can regroup pages and so raise or clear TOPIC-001 with no change to the site. ADR-0032 already makes the model part of the recorded measurement; this is the first place that dependency reaches the inbox.

## Alternatives considered

- **Match questions to clusters by vector similarity.** Rejected for now, for the reasons in the context: an uncalibrated threshold and evidence only the model can check. If a question-to-page threshold is ever calibrated the way ADR-0032 calibrated page-to-page, the vector can be added as a second, agreeing signal. It must not replace the word test.
- **Have a model judge whether a page answers the question.** Rejected. That is a model deciding something is a finding, which rule 1 and ADR-0024 both ban.
- **Define a hub by inbound links from the group, or by PageRank within it.** Considered. Outbound was chosen because "this page links to the others" is the property a reader navigating the subject needs, and it is the one a person can verify by opening a single page.
- **Near-duplicate pages inside a cluster that Search Console confirms compete.** Listed in the research document as a third finding. Not built: CONTENT-001 already raises queries where two pages split the impressions, and TECH-012 raises near-duplicate copy, so the join would restate both.

## Evidence

- `packages/audit/test/topic-findings.test.ts`: each finding's silences (a hub that exists, a group too small, a question a page covers, nothing crawled), that links outside the group do not count, that the cluster name never appears, and that no fixer claims either rule.
