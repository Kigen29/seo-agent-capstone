# ADR-0041: A competitor is named the way the client is

- Status: Accepted; extends ADR-0040
- Date: 2026-10-08

## Context

ADR-0040 made an AI answer with no source list count as mentioning the client when it contains the client's brand name. A competitor was still looked for only by its web address, because only the client had a name on record.

ADR-0040 recorded the consequence the day it was accepted: on engines that give no sources, the client is found far more readily than its competitors, so share of voice leans towards the client. An answer reading "Heartbeest Safaris and Mufasa Tours are the usual picks" gave the client a citation and the competitor none.

A figure that flatters whoever is paying for the report is the one thing this product is built not to produce. ADR-0034 already holds a comparison to "one instrument" for exactly this reason.

## Decision

**Each tracked competitor is given a name by the rule the client's own name is captured by**, and is looked for in an answer by that name.

- The name comes from the competitor's own homepage title, through `brandFromTitle`: accepted only when the title plainly states a name that agrees with the domain, otherwise nothing. No model and no guess from the domain.
- It is read by the daily poll, before the first answer is judged, for any competitor that has no entry yet. Not when a competitor is saved, so competitors added before this existed are named on their next poll with nobody re-saving anything.
- It is stored per site as a map from domain to one of three states: a name; an explicit null, meaning the homepage was read and states no name, so it is not fetched again; or absent, meaning not read yet or the site did not answer, so the next run tries again.
- A competitor with no name is looked for by its address, exactly as the client is when it has no brand name set.
- Failing to read a name never fails the poll.

## Consequences

- **Share of voice on engines without sources can fall for the client**, from the next poll, where a competitor is named in answers. That is the comparison being made fair, not the client losing ground. Past polls are not re-scored.
- **One extra page fetch per competitor, once**, through the SSRF guard. At most ten per site.
- **A competitor whose title does not state its name stays at a disadvantage**, found only by address. The map says which those are, and letting a person type a competitor's name is the step that would close it.
- **A competitor that renames itself keeps its old name here.** Nothing re-reads a homepage once it has an entry. Removing and re-adding the competitor does not clear it either, since entries are not pruned; clearing is a manual step until this is seen to matter.
- **The exact-name rule applies to competitors too**, with the same limit as ADR-0039: a name that is a common phrase will match unrelated answers.

## How we would know this was wrong

- An answer that names a competitor in plain words, from an engine with no sources, in which that competitor is not counted and has a name on record.
- A competitor given a name that its own homepage title does not contain.
