# ADR-0045: A failed scheduled audit is retried the next day

- Status: Accepted; extends ADR-0044
- Date: 2026-10-10

## Context

ADR-0044 schedules the next audit by counting the site's interval from its last audit. It did not say what "last audit" means when that audit failed.

The first run of the real worker against a site that could not be reached answered it by accident. The scheduled audit started, the crawl failed, and the calendar put the next attempt seven days out. The failure had been counted as the audit. For a site on the thirty-day interval, one hour of its host being down would have meant two months between audits, and nothing on the page would have said why.

Counting from the last audit that completed is the obvious correction and is wrong in the other direction. A site that fails every time (a domain that has lapsed, a host that blocks the crawler) would then be due on every wake of the worker, which is every fifteen minutes, forever.

## Decision

**When the newest audit of a site failed, the next scheduled one is due one day after it, whatever the interval.** After an audit that completes, the interval applies as before.

- `nextAuditDay` takes a fourth argument, `lastAuditFailed`. It is still the one function the calendar and the worker's sweep both call, so the retry a person is shown is the retry the worker makes.
- The calendar names that entry "Audit, tried again" and says the last one did not finish. The entries after it are at the usual interval, counted from the retry.
- Scheduled audits that are off stay off. A failure schedules nothing by itself.

## Consequences

- **A site that always fails is crawled once a day, not once an interval and not every fifteen minutes.** That is more work than before for a permanently broken site and far less than the alternative. Each failure is a row in the audit history with its reason, so a person looking can see the pattern and turn the schedule off.
- **A failure started by hand is treated the same way.** If somebody runs an audit, it fails, and scheduled audits are on, the worker tries again the next day. The audit row does not record who started it (ADR-0044), and a retry after a manual failure is what the person wanted anyway.
- **There is no back-off.** Day after day at one attempt a day is cheap enough not to need one. If a site has failed thirty days running, the useful change is to tell its owner, which is a notification and a different decision.
- **Nothing was migrated or corrected.** This was found and fixed on the day ADR-0044 was accepted, before any site had scheduled audits on.
