# ADR-0042: The client says which sites are not them

- Status: Accepted; extends ADR-0039
- Date: 2026-10-08

## Context

ADR-0039 made a search result count as a mention only if it contains the brand name as written. It recorded what that cannot do: tell apart two businesses with exactly the same name. Both contain the name, both pass, and nothing on either page can settle which one is the client.

That is not a gap a better parser closes. It is a fact held by one party, the client, who can tell at a glance.

## Decision

**A client can mark a site as "not us", and that site is left out of their brand mentions.**

- Stored per site as a list of domains (`sites.mention_exclusions`), up to 50. A site and its subdomains are excluded together.
- **Applied when an audit measures**, after the exact-name check and before anything is counted, so no finding is raised and no email is offered about a site that is not theirs.
- **Applied when a stored audit is read back**, so marking a site changes the figures on screen at once and does not wait for the next audit.
- **The stored audit is never rewritten.** It is a record of what was measured. Reading it through the current list is what lets "put back" restore a site exactly.
- On reading, a count is lowered by the sites removed. It is not recounted from the page list, which is capped while the count is not.

The control is one button per site on the authority page, and the marked sites are listed there with a way back.

## Consequences

- **A client can remove real coverage they dislike.** Nothing stops a site being marked that is in fact about them. The effect is only on their own report, the list of what was marked is on the page, and it can be undone. A client hiding their own bad press from themselves is a smaller harm than a report they cannot correct.
- **An audit that kept no page list is not adjusted on reading**, because there is nothing to work from. The exclusion applies to it from the site's next audit.
- **A finding already raised about a marked site stays until the next audit.** Findings are a record of an audit, and are replaced by the next one.
- **The page reloads fully after a change.** An in-place refresh was the first choice and left the page showing the old figures while the store and the API had the new ones; the cause was not found. A full reload was measured to be correct, and is used. If the refresh is ever understood, it can replace the reload.

## How we would know this was wrong

- A site that was marked still counted, listed or offered as a publication to contact.
- A site that was put back and does not return.
- A count that drops by more than the number of sites marked.
