# ADR-0019: `llms.txt` is agent-readiness infrastructure, and never a ranking claim

**Status:** Accepted
**Date:** 2026-08-02

## Context

`llms.txt` is the most oversold file in the industry. It is marketed as an AI-SEO essential, sold as a deliverable, and added to sites by consultants who tell clients it will improve how they appear in AI answers. Google's own guidance, published 15 May 2026 and updated 15 June 2026, lists it among the tactics to **ignore**: Google Search does not use it. AI Overviews and AI Mode run on the same core ranking systems as Search, so a file Search ignores does not influence them either.

We ship an `llms.txt` rule and an `llms.txt` fixer. That puts us one sentence away from selling the same lie, and the sentence is easy to write by accident: "adds llms.txt to improve your AI visibility" is the kind of phrasing that appears in a PR body when nobody is watching.

CLAUDE.md rule 8 has forbidden that claim since the first commit. This ADR promotes it from a project convention to an accepted architectural decision with a test behind it, because a rule that lives only in a markdown file is a rule that survives exactly as long as the next person to read it.

## Decision

**`llms.txt` is shipped as agent-readiness infrastructure. No text we generate may claim, imply, or hint that it improves Google rankings or AI Overview visibility, and a test asserts the disclaimer.**

- The finding, the fixer, and the pull request body all state plainly that `llms.txt` helps AI agents navigate the site and that **Google Search ignores it**. Two tests assert the disclaimer, one on the finding (so the UI cannot drop it) and one on the generated file.
- Any generated text implying a ranking benefit is a **bug**, not a wording preference, and is covered by a test rather than by review attention.
- **The finding scores on `agent_readiness`, not on search, and it is `low` rather than `info`.** This is the subtle part, and it was nearly decided the other way. The argument for `info` (damage weight zero) is that a finding admitting it changes nothing must not change a score. That argument is right about *search* and wrong here: this finding does not sit on a search axis. `agent_readiness` measures whether agents can read and act on the site, missing `llms.txt` is a genuine if small gap in exactly that, and scoring it zero would leave the axis unable to tell a site that has the file from one that does not, on the one property it exists to measure. Honesty about what a fix will not do is not the same as pretending the gap is not there.

## Consequences

### Good

- A client can trust the rest of the report. The cheapest way to prove a tool is honest is to watch it decline to oversell something it is actively selling, and this is the one place we do that in plain sight.
- The intellectual honesty is testable and therefore durable. It cannot rot through a refactor, a reworded PR template, or a new contributor who has read the marketing but not the docs.
- It generalises. The same reasoning applies to the next tactic Google names and the industry sells anyway, and the pattern to copy is here: ship the thing if it has a real use, state what it does not do, and let the severity weight match the claim.

### Bad

- It makes a feature look less impressive than a competitor's identical feature. A rival's dashboard says "improve your AI visibility with llms.txt"; ours says Google ignores it. On a feature comparison sheet we lose that row, and we are choosing to.
- A client who has been told otherwise by a consultant will need convincing, and the note is where that argument gets had.

### Neutral

- If Google's position changes, this ADR is superseded rather than edited, and the tests change with it. That is the mechanism working, not a flaw in it.

## Alternatives considered

### Say nothing either way, and just ship the file

Rejected. Silence in a product that generates recommendations reads as endorsement: a client who sees "add llms.txt" in a list of SEO findings will reasonably assume we think it helps SEO, because everything else in that list does. Not making the claim is not the same as denying it, and only one of the two is honest here.

### Do not ship `llms.txt` at all, since Search ignores it

Rejected. It has a genuine use that is not search: agents and crawlers that do read it navigate the site better, and the agentic web is a surface this product measures on its own axis. Refusing to ship a useful file because it is commonly mis-sold would be a different kind of dishonesty, the kind that throws away real value to avoid an argument.

### Keep it as a CLAUDE.md rule and rely on review

Rejected, and this is the point of writing the ADR at all. Rule 8 has held so far because the same small group has written every line. A convention enforced by attention fails silently the first time attention lapses, and the failure mode is a sentence in a PR body that a client reads and believes. A test fails loudly instead.
