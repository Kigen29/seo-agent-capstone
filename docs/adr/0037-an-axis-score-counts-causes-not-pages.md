# ADR-0037: An axis score counts causes, not pages

Status: accepted, 2026-10-07.

## Context

An axis score starts at 100 and loses a fixed amount per finding: severity, times confidence, times impact. It is then capped by the worst severity present, so one certain critical keeps an axis out of green whatever else is true.

That works when a finding is a problem. It stops working when a rule raises one finding per page, because the score then measures how many pages share a problem and not how many problems there are.

A real site made this concrete. Its canonical tag was built from one hard-coded origin, in one file. The canonical rule fired on every page crawled, sixteen page records in all, each a "high" finding worth fourteen points. Crawl health read **0**: the score a site with a dozen unrelated serious faults would get, for a change that was one string. The owner's reaction was the correct one. A zero told them the site was beyond help when it was one pull request from clean.

Some of the sixteen were a counting bug (the same document crawled at two addresses, fixed separately). Eight were not, and eight findings at fourteen points is still a zero.

The newer page-level rules already avoid this by raising one finding for the site with the pages listed. That is the right shape for a rule and cannot be applied to all of them: a finding that a pull request can fix has to be about something specific enough to fix, and several older rules are fixable per page.

## Decision

**Within one rule on one axis, each further finding counts for half of the one before it.** The worst counts in full, the next at a half, the next at a quarter, ordered by damage so the result does not depend on the order findings arrive in. The total from one rule can therefore never reach twice its worst finding, however many pages it fires on.

**Findings from different rules still add up in full.** Different rules are different problems, and a site with twelve separate faults should still score as one.

**The severity ceiling is unchanged.** One certain high still holds its axis at 65, one certain critical at 40. The ceiling answers "how bad is the worst thing here"; the damage answers "how much is wrong"; this decision only changes how repetition is counted in the second.

For the site above: sixteen findings that used to subtract 224 now subtract less than 28, leaving 72, and the ceiling for a certain high brings that to 65. Needs work, which is what one serious cause deserves.

## Consequences

- A score moves when a cause is fixed, not in proportion to how many pages the cause touched. Fixing the one hard-coded origin takes that axis from 65 to wherever its other findings leave it.
- Two sites with the same fault on ten pages and on a thousand score the same on that fault. That is intended. The page count is in the finding, where it is information, and no longer in the score, where it was noise.
- A rule that fires on many pages for many unrelated reasons is under-counted. A missing description on forty pages may be forty omissions, not one template. This is accepted: those rules mostly already report once per site, and under-counting a repeated minor fault is a smaller error than reporting a fixable site as hopeless.
- Every existing scorecard was computed under the old model and is not recomputed. A site's score can rise on its next audit with nothing changed on the site. The audit history shows scores per audit, so the step is visible, and this ADR is the explanation.
- The priority order of the inbox is untouched. Priority is per finding and never used the axis score.
- Half is a chosen number. A smaller ratio would make repetition nearly free and a larger one would bring the zero back; a half keeps "this is on many pages" worth something, up to double, and no more.

## Alternatives considered

- **Count each rule once.** Rejected: a fault on one page and on every page are not the same, and the score should be able to tell.
- **Group every per-page rule into one finding per site.** Rejected as a general fix: it changes finding identity (ADR-0029) and what a pull request is opened against for every fixable rule. It remains the right shape for a new rule that is not fixable per page.
- **Divide damage by pages crawled.** Rejected: it makes a small site score worse than a large one for the same fault, and ties the score to the crawl cap.
- **Leave the score and explain it better.** Rejected: an honest explanation of "zero" would have been "one line is wrong, sixteen times".

## Evidence

- `packages/core/test/scorecard.test.ts`: sixteen findings from one rule score 65 where sixteen from different rules score 0; a repeated cause still costs more than one instance of it; the result is the same in any order; the floor at zero still holds for four different critical faults.
