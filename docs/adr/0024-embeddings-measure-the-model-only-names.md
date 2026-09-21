# ADR-0024: Embeddings may measure; the model may only name what was measured

**Status:** Accepted
**Date:** 2026-09-21
**Deciders:** Kigen

## Context

The product this one is measured against most directly on topical analysis is What Is My Website
About. It reads a sitemap, takes each page's title and description, and asks Claude to sort them
into topics, which it draws as a treemap. The output is genuinely useful and the method is the one
ADR-0001 forbids: a model is the detector, so the answer is unreproducible, unverifiable, and
different next Tuesday.

We want the capability. A client who can see that 40% of their pages are about one thing and
nothing is about the thing they are tracked on has learned something no individual finding tells
them. The question this ADR settles is whether it can be built without breaking rule 1, because a
vector produced by a model is not obviously a measurement and is not obviously not one.

The honest difficulty: an embedding **is** model output. Two models embed the same page
differently, and an embedding cannot be checked by reading it. That is exactly what makes ADR-0001
suspicious of model output in the detection path.

## Decision

**Embeddings are allowed as an input to measurement. A model is never allowed to decide that
something is a finding, and never allowed to decide what two pages have in common.**

Concretely, three rules:

1. **The model may produce vectors. It may not produce groups.** Pages are embedded, and the
   clustering over those vectors is a deterministic function: fixed similarity threshold, fixed
   tie-breaking, sorted input, no randomness, no k chosen by a model. The same pages and the same
   embedding model produce the same clusters, and a test asserts it by running twice.

2. **The model may name a cluster. Nothing downstream may depend on the name.** Naming is the one
   genuinely subjective step and the one with no consequence: the name is a label on a group that
   already exists. Every finding is computed from the group's membership, the internal link graph,
   or Search Console, all of which a human can check. A finding whose only evidence was "the model
   called this cluster Pricing" is banned.

3. **The measurement declares its instrument.** The audit records which embedding model produced
   the vectors and how many pages were embedded out of how many crawled. Cluster shares computed
   over 50 of 200 pages are a statement about the 50, and the scorecard says so.

**Vectors are not persisted, and pgvector stays unused for now.** Clustering happens in memory
during the audit, and the clusters, not the vectors, are stored with the audit's other metrics.
This is a deliberate correction to a claim the stack documents have carried since Sprint 1: nothing
in the product queries vectors across audits, so a vector column would be storage with no reader.
When something needs cross-audit similarity (the obvious candidate is "has this page drifted since
the last audit"), that feature brings the column with it and a migration.

## Consequences

### Good

- The capability arrives without a model becoming a detector, which is the line ADR-0001 draws and
  the line this product's positioning rests on.
- **The `embed` role finally has a caller.** It has had infrastructure, a config chain and pricing
  since Sprint 3, and nothing invoking it, which the state of play has been recording as a loose
  end.
- The reproducibility test is cheap and real: run the clustering twice over one crawl and compare.
  A model-as-detector implementation cannot pass it, so the test enforces the decision rather than
  restating it.
- Unconfigured degrades honestly like every other axis: no embedding provider means no topic map
  and a note saying which key is missing, never an empty treemap that reads as "no topics".

### Bad

- **Two runs against different embedding models can produce different clusters.** The vectors are
  model output and swapping `LLM_EMBED` changes them, so the map is reproducible within a model
  and not across models. The recorded instrument is what makes that visible rather than confusing;
  it is a real limitation and it is not one a threshold can remove.
- A similarity threshold is a judgement in a numeric disguise. It was chosen by inspecting real
  clusters and it will be wrong for some site. It is one named constant with its reasoning
  attached, which is the best available answer, not a good one.
- Embedding fifty pages is a per-audit cost where the rule engine is free. Small, capped, and
  behind the same per-tenant budget guard as everything else, but no longer zero.

### Neutral

- The naming call is the cheapest LLM call in the product: one `fast` request per audit over a list
  of titles, not one per page. Cost discipline (CLAUDE.md) is preserved.

## Alternatives considered

### Ask the model to sort the pages, like the tool we are copying

Rejected, and it is the whole reason this ADR exists. It is one prompt instead of an embedding
pass plus a clustering function, and it gives up reproducibility, testability and any defence when
a client asks why a page moved between topics.

### Cluster on words instead of vectors, and keep the model out entirely

Tempting, because it would need no ADR at all. Rejected because it measures the wrong thing:
shared vocabulary is not shared subject. "Tile prices" and "how much does flooring cost" are the
same topic with no words in common, and a word-frequency clustering would file them apart while
filing "tile adhesive" and "tile prices" together. The product already has a word-overlap
comparison in CONTENT-002, where it is used to ask a much weaker question (does any page mention
this subject at all), and its crudeness is defensible there because the finding is confirmed by
Search Console impressions.

### Let the model choose the number of clusters

Rejected. It sounds like a small delegation and it is the detector question in disguise: the number
of clusters determines which pages are grouped, which determines every finding computed from the
grouping. The threshold is fixed, and the number of clusters is whatever the data produces.
