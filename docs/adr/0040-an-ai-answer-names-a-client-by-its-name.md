# ADR-0040: An AI answer names a client by its name, not by its web address

- Status: Accepted; extends ADR-0039
- Date: 2026-10-08

## Context

When an answer engine returns a list of sources, the client is cited if one of them is on the client's site. That is exact and is not changed here.

Some engines return an answer and no sources. For those the only evidence is the answer's own words, and the check looked for the client's web address in them: the full host, or failing that the first part of the host as one word. For `heartbeestsafaris.com` that word is `heartbeestsafaris`.

After ADR-0039 fixed a search engine's guess being taken as a mention, the same question was asked of this check, and it had the fault in both directions:

- **It missed real mentions.** An assistant recommending a business writes "Heartbeest Safaris". It does not write the address. That answer was recorded as not mentioning the client, so a business named every day read as invisible on that engine.
- **It invented mentions.** For a site whose address begins with an ordinary word, such as `tiles.co.ke`, the word looked for is "tiles", and every answer about tiles contains it.

The site's brand name has been stored since the authority axis needed it, and since October 2026 it is captured when a site is added. This check did not use it.

## Decision

**When the site has a brand name, an answer with no sources mentions the client if it contains the full address or the brand name as written.** The guess from the first part of the address is not used.

"As written" is the rule ADR-0039 set, and it is now one function, `containsName`, used by both checks: whole words, in order, ignoring capitals, punctuation, spacing and accents. "African Hartebeest Safaris" is not "Heartbeest Safaris" here either.

**When the site has no brand name, nothing changes.** The address and its first part are looked for as before.

**A competitor is still matched by its address.** Only the client has a name on record. The client's name is never used to decide whether a competitor was mentioned.

**Sources still overrule words.** If the engine cited sources and the client's site is not among them, the client is not cited, whatever the answer says.

## Consequences

- **Figures for engines without sources can rise** for a site with a brand name set, from the next poll. That is the measurement becoming correct, not the site improving, and a reader comparing weeks across this date should know it. Past polls are not re-scored: the stored verdict is what was decided at the time.
- **Figures can fall** for a site whose address begins with a common word, for the same reason in the other direction.
- **The comparison with competitors is no longer made on one instrument.** The client is found by name; a competitor only by address, which finds less. So on engines without sources, share of voice now leans towards the client. Recording a name for each competitor is what would level it, and until then the "mention" basis stays the weaker of the two and is labelled as such.
- **A brand that is a common phrase will match unrelated answers**, as in ADR-0039.

## How we would know this was wrong

- An answer that names the business in plain words, from an engine with no sources, recorded as not cited.
- An answer recorded as citing the client that contains neither its address nor its name.
