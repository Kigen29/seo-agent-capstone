# ADR-0018: The authority axis leads with mentions, not links

**Status:** Accepted
**Date:** 2026-08-02

## Context

Every SEO tool on the market opens its off-page section with backlinks. Domain Rating, referring domains, link velocity, a toxic-link audit. It is the oldest number in the industry and the one clients ask for by name.

The evidence for what actually moves AI visibility does not support that ordering. Ahrefs' 75,000-brand study found branded web **mentions** correlate **0.664** with AI Overview visibility, while backlinks correlate **0.218**. Muck Rack's May 2026 data found **84% of AI citations come from earned media**. Mention-building and link-building are not two names for one activity: one is getting written about, the other is getting linked, and the first is three times the signal for the surface this product exists to move.

We also have a practical constraint that turns out to point the same way. A backlink index is a paid, expensive dependency (Ahrefs, DataForSEO backlinks), and Sprint 3's plan explicitly declined to make one a default. So the axis had no data source, has been dark since Sprint 1, and its coverage note said it was waiting for a backlink source. It was waiting for the wrong thing.

## Decision

**The authority axis measures brand mentions as its primary signal. Referring domains are reported as unmeasured, never as zero, until a client justifies a backlink index.**

- **Mentions come from the `SerpProvider`** (ADR-0016) as a query for the brand name, quoted, with the client's own site excluded by search operator. The exclusion is what makes the result earned media *by construction* rather than something filtered afterwards and hoped for.
- **Counted by distinct domain, never by result.** Ten pages on one publication is one publication that covered the client. Counting results would let a single press release read as a campaign.
- **Earned coverage is separated from self-published platforms** (LinkedIn, Medium, Reddit, a `wordpress.com` subdomain). Not because social is lesser, but because it is different evidence: a company's own post is a mention it wrote, a trade publication's article is one it earned, and the research says the engines draw on the earned kind. Merged, a busy social calendar would read as authority.
- **The brand name is stored, not derived.** `heartbeestsafaris.com` yields a stem the web has never heard of, because the press writes "Heartbeest Safaris". Splitting the stem back into words would under-count every multi-word brand, and an under-count here is indistinguishable from a brand nobody talks about. Until somebody sets it, the axis says so and names the missing field.
- **Outreach is drafted, never sent** (CLAUDE.md rule 6). A draft is refused outright when there is no concrete, sourced fact to build it on, because a pitch with no specific fact is the template every other tool sends, and sending one under a client's name costs them a relationship for no gain.

## Consequences

### Good

- The axis measures the thing the evidence says matters, and its findings say why in their own falsification text, so a client who wants to argue can check the numbers rather than take our word.
- It lights up on a data source we already pay for, instead of waiting indefinitely for a backlink index nobody has bought.
- Reporting referring domains as unmeasured rather than zero keeps the axis honest in the one way that matters most: a zero and an absence look identical on a dashboard and mean opposite things.
- Drafting-but-never-sending keeps the client's name under the client's control, which is the only defensible position for an agent that could otherwise email strangers unsupervised.

### Bad

- It contradicts what clients expect to see, and "where is my Domain Rating" is a conversation this axis will have forever. The answer is in the note, but the note has to be read.
- Mention counts from a SERP query are a sample of what a search engine chose to show, not a census of the web. It is directionally right and comparable over time, which is what the findings claim, but it is not a complete count and does not pretend to be.
- Self-published classification uses a short, fixed list of platforms. It will misfile something eventually, and the finding says so in its own falsification: a human can settle it in a minute by opening the links.
- Competitor comparison costs one paid query per rival, so it is capped at three.

### Neutral

- If a client does justify a backlink index later, nothing here changes: referring domains become a second measured signal on the same axis, and the ordering stays as it is, because the ordering is about evidence and not about availability.

## Alternatives considered

### Lead with backlinks, like everyone else

Rejected on the evidence. 0.218 against 0.664 is not a close call, and following the convention would mean pointing clients at the weaker of two levers while claiming to optimise for AI visibility. This product's whole positioning is that it does the thing that works rather than the thing that is expected.

### Report referring domains as zero until we have an index

Rejected as the exact dishonesty the scorecard exists to prevent. A zero says "nobody links to you", which for most sites is false, and it would be indistinguishable from a real zero for the site where it is true.

### Buy a backlink index and measure both from the start

Rejected for now on cost, and it is a deferral rather than a refusal: this is the second paid dependency in a product whose constraint is $0 (ADR-0006), the first one is already asterisked (ADR-0016), and the signal it buys is the weaker one. The migration trigger is a paying client who needs it.

### Have the agent send the outreach once a human approves a template

Rejected. It sounds like a small step from drafting and it is not: the moment sending is automated, the review becomes a formality, and the failure mode is a client's name on a hundred emails they did not read. Rule 6 is a product decision, not a missing feature.
