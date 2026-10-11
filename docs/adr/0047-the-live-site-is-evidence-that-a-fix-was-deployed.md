# ADR-0047: The live site is evidence that a fix was deployed

- Status: Accepted; supersedes the fail-closed rule in ADR-0027, which otherwise stands
- Date: 2026-10-11

## Context

ADR-0027 made verification wait for deployment evidence: a GitHub deployment record, or a connected Vercel project, showing that the merge was released. Without that evidence the worker did not look at the site at all, and the finding stayed on "merged, checking" with a note saying it was waiting.

The reasoning was sound as far as it went. A merge is not a deployment, and crawling before the deployment would find the problem still there and record a working fix as a failure.

What it did to real accounts was this. On the first account with merged fixes there were four, on two sites, merged between two and five days earlier. All four said "Waiting for deployment evidence". None of those hosts creates GitHub deployment records, and no Vercel project was connected, so the evidence was never going to arrive. The worker checked every hour whether it had, and would have gone on doing so indefinitely.

The loop this product exists for is: open a pull request, a person merges it, verify it in production. For any site on a host that reports nothing, the third step never happened. The owner of that account put it exactly: there was still no full circuit.

## Decision

**When there is no deployment report, the worker looks at the live site anyway, and the two possible observations are treated differently.**

- **The fix is on the live site: verified.** The page showing the change is the evidence that the change was deployed. A report from the host would say the same thing with less authority.
- **The problem is still there: nothing is concluded yet.** The commonest reason is that the deployment has not happened. It is recorded as not working only once the merge has **settled**, 48 hours after the pull request was merged.
- **The pages could not be read: nothing is concluded**, as before. Absence is never inferred from a page that was not fetched.

A deployment report is still used when there is one, and then nothing waits: what the site shows is the verdict at once, in either direction. ADR-0027's permission and ADR-0028's per-site hosting connection are unchanged. They are now a way to get an answer sooner, and no longer a condition of getting one.

## Details

- **When the site is looked at.** Each look is a crawl and a row in the audit history, so without a report it is not hourly: one, three, six, twelve and twenty-four hours after the merge, then once a day for as long as nothing can be concluded. A checkpoint the worker slept through is not lost. A fix never looked at before is looked at on the next wake, which is what releases the ones that were stuck.
- **Settled means 48 hours from the merge**, taken from the pull request's recorded resolution. If no merge time was recorded, the fix is never failed on age alone: it is looked at once a day until the site shows the change or a report arrives.
- **The basis is part of the record.** A verdict reached without a report says so in its summary. "Confirmed on the live site itself" for a success. For a failure, that it was still there more than 48 hours after the merge with no report, and what to do if the change was simply never deployed.
- **A fix that is waiting says what was seen, and when.** The note begins "Checked the live site on" with the date, then what was found. Before this, the only feedback was that it was waiting, with no sign anything was happening.
- **A report that cannot be read is no report.** A 403 or an outage reading deployment evidence used to fail the job. It is now the same as there being none: the site is looked at, and the reason is added to the note in our own words.
- **Waiting is not a failed job.** A fix on its schedule returns quietly. Only a confirmed deployment whose pages could not be read fails the job, because that is the case worth the queue's quick retry.

## Consequences

- **A success can be attributed to the wrong cause.** If the problem went away for a reason other than the merged fix, this records the fix as having worked. What is true either way is that the problem is no longer on the live site, and the summary says what was observed and not why.
- **A failure can be a deployment that never happened.** After 48 hours with the problem still there, the record says "did not work" when the truth may be "was not deployed". The two cannot be told apart from outside without a report. The summary names both, and connecting hosting removes the ambiguity.
- **More verification crawls for sites with no report**: up to seven in the first two days per site with merged fixes, where before there were none. Each is an audit in the history.
- **The backlog resolves at once.** Fixes merged more than 48 hours before this shipped are settled on their first look, so each is decided immediately as worked or did not work.
- **Connecting hosting is optional.** The settings page says what it buys: an answer when the deployment finishes, and certainty about which of the two failures it was.
